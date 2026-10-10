import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseAwc } from '../../src/core/awc/read'
import { getFormat } from '../../src/core/awc/types'
import { encodeWav16 } from '../../src/core/wav'
import { bridgeExe, makeFakeGame, repoRoot, testAwcKey } from '../fakeGame'

const shots = process.env.SCREENSHOT_DIR

async function stubOpen(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: p })) as typeof dialog.showOpenDialog
  }, paths)
}

test.skip(!existsSync(bridgeExe), 'run npm run build:bridge first')

test('first launch: find GTA V, edit a gun, preview it and export', async () => {
  const work = mkdtempSync(join(tmpdir(), 'gsm-e2e-'))
  const game = await makeFakeGame(work, { key: testAwcKey })
  const shot = Int16Array.from({ length: 24000 }, (_, i) => Math.round(Math.sin(i / 3) * 20000 * Math.exp(-i / 4000)))
  const wavPath = join(work, 'my_shot.wav')
  writeFileSync(wavPath, encodeWav16(shot, 48000))
  const outDir = join(work, 'out')

  const app = await electron.launch({
    args: ['--no-sandbox', repoRoot],
    env: {
      ...process.env,
      GSM_USER_DATA: join(work, 'profile'),
      // the fake game has no real gta5.exe; its banks are AWC-encrypted with a test key
      GSM_BRIDGE_EXTRA_ARGS: JSON.stringify(['--no-keys', '--test-awc-key', testAwcKey])
    }
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1360, height: 860 })

  // first launch asks for the game folder
  await expect(page.getByRole('heading', { name: 'Welcome to Gun Soundpack Maker' })).toBeVisible()
  await stubOpen(app, [game])
  await page.getByRole('button', { name: 'Browse…' }).click()
  await expect(page.getByText('gta5.exe found')).toBeVisible()
  if (shots) await page.screenshot({ path: join(shots, '1-setup.png') })
  await page.getByRole('button', { name: 'Find my guns' }).click()

  // every gun is listed; pick the pistol
  const guns = page.getByRole('navigation', { name: 'Guns' })
  await expect(guns.getByRole('button', { name: 'Pistol', exact: true })).toBeVisible()
  await expect(guns.getByRole('button', { name: 'SMG' })).toBeVisible()
  await guns.getByRole('button', { name: 'Pistol', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pistol', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Gunshot', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Distant report' })).toBeVisible()
  await expect(page.getByText('400 rounds/min')).toBeVisible()

  // in-game preview of the original gunshot
  await page.getByRole('button', { name: '▶ Original' }).click()
  await expect(page.locator('.preview-bar .waveform-label', { hasText: 'Original' })).toBeVisible()

  // replace the whole gunshot (also covers what others hear)
  const gunshot = page.locator('.role-group', { has: page.getByRole('heading', { name: 'Gunshot', exact: true }) })
  await gunshot.getByRole('button', { name: 'Select all' }).click()
  await stubOpen(app, [wavPath])
  await page.getByRole('button', { name: 'Add sound…' }).click()
  await expect(page.getByText('Also changes 1 matching sound that others hear.')).toBeVisible()
  await page.getByRole('button', { name: /^Assign/ }).click()
  await expect(gunshot.locator('tbody tr').first()).toContainText('my_shot.wav')
  await page.getByRole('tab', { name: 'Others hear' }).click()
  await expect(page.locator('.role-group').first()).toContainText('my_shot.wav')
  await page.getByRole('tab', { name: 'Your gun' }).click()

  await page.getByRole('button', { name: 'Burst ×5' }).click()
  await page.getByRole('button', { name: '▶ Yours' }).click()
  await expect(page.locator('.preview-bar .waveform-label', { hasText: 'Yours' })).toBeVisible()
  await expect(page.locator('.bank-item[title="WEAPON_PISTOL"]')).toContainText('4 changed')
  if (shots) await page.screenshot({ path: join(shots, '2-weapon.png') })

  // export both your gun's bank and the shared bank
  await page.getByRole('button', { name: /^Export/ }).click()
  await page.getByRole('textbox', { name: 'Resource name' }).fill('E2E Pack')
  await page.getByRole('button', { name: 'Build' }).click()
  await expect(page.getByText('audio/sfx/weapons_player/ptl_pistol.awc — 3 replaced')).toBeVisible()
  await expect(page.getByText('audio/sfx/resident/weapons.awc — 1 replaced')).toBeVisible()
  if (shots) await page.screenshot({ path: join(shots, '3-export.png') })
  await stubOpen(app, [outDir])
  await page.getByRole('button', { name: 'Save folder…' }).click()
  await expect(page.getByText(/Saved to/)).toBeVisible()

  const resource = join(outDir, 'e2e_pack')
  const manifest = readFileSync(join(resource, 'fxmanifest.lua'), 'utf8')
  expect(manifest).toContain("data_file 'AUDIO_WAVEPACK' 'audio/sfx/weapons_player'")
  expect(manifest).toContain("data_file 'AUDIO_WAVEPACK' 'audio/sfx/resident'")
  const bank = parseAwc(new Uint8Array(readFileSync(join(resource, 'audio/sfx/weapons_player/ptl_pistol.awc'))))
  const body = getFormat(bank.streams.find((s) => s.id === 0x16ef0ea5)!)!
  expect(body.sampleRate).toBe(44100)
  expect(body.samples).toBeGreaterThan(20000)
  await app.close()
})

test('sound banks tab: browse a scanned bank and silence a stream', async () => {
  const work = mkdtempSync(join(tmpdir(), 'gsm-e2e-banks-'))
  const game = await makeFakeGame(work, { key: testAwcKey })
  const app = await electron.launch({
    args: ['--no-sandbox', repoRoot],
    env: {
      ...process.env,
      GSM_USER_DATA: join(work, 'profile'),
      GSM_BRIDGE_EXTRA_ARGS: JSON.stringify(['--no-keys', '--test-awc-key', testAwcKey])
    }
  })
  const page = await app.firstWindow()
  await stubOpen(app, [game])
  await page.getByRole('button', { name: 'Browse…' }).click()
  await page.getByRole('button', { name: 'Find my guns' }).click()
  await expect(page.getByRole('navigation', { name: 'Guns' })).toBeVisible()

  await page.getByRole('tab', { name: 'Sound banks' }).click()
  await page.locator('.bank-item[title="resident/weapons.awc"]').click()
  await expect(page.getByText('from your game')).toBeVisible()
  await expect(page.locator('table.streams tbody tr')).toHaveCount(3)
  await page.locator('table.streams tbody tr', { hasText: '02032920' }).click()
  await page.getByRole('button', { name: 'Silence' }).click()
  await expect(page.locator('table.streams tbody tr', { hasText: '02032920' })).toContainText('Silenced')
  await app.close()
})
