import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseAwc } from '../../src/core/awc/read'
import { getFormat } from '../../src/core/awc/types'
import { encodeWav16 } from '../../src/core/wav'
import { runBridge, type ExtractResult } from '../../src/main/bridge'
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
  // every other sound field of the gun is listed too, folded by kind
  await expect(page.locator('details.field-group summary', { hasText: 'Slow motion' })).toBeVisible()
  await expect(page.locator('details.field-group summary', { hasText: 'Handling' })).toContainText('Reload sounds')

  // what a sound is for, traced through the game data
  const gunshotRows = page.locator('.role-group', { has: page.getByRole('heading', { name: 'Gunshot', exact: true }) }).locator('tbody tr')
  await gunshotRows.first().click()
  const usage = page.locator('.panel.usage')
  await expect(usage.getByRole('heading', { name: "What it's for" })).toBeVisible()
  await expect(usage.locator('.use').first()).toContainText('Your gun')
  await expect(usage.locator('.use').first()).toContainText('Pistol · Gunshot')
  await expect(usage).toContainText('ID pack code')
  if (shots) await page.screenshot({ path: join(shots, '5-usage.png') })

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

  // export rebuilt WEAPONS_PLAYER.rpf and RESIDENT.rpf
  await page.getByRole('button', { name: /^Export \(/ }).click()
  const exportDialog = page.getByRole('dialog', { name: 'Export sound pack' })
  await exportDialog.getByRole('textbox', { name: 'Pack name' }).fill('E2E Pack')
  await expect(exportDialog.getByText('ptl_pistol.awc (3 replaced)')).toBeVisible()
  await expect(exportDialog.getByText('weapons.awc (1 replaced)')).toBeVisible()
  if (shots) await page.screenshot({ path: join(shots, '3-export.png') })
  await stubOpen(app, [outDir])
  await exportDialog.getByRole('button', { name: 'Export…' }).click()
  await expect(exportDialog.getByText(/Saved to/)).toBeVisible({ timeout: 30_000 })
  if (shots) await page.screenshot({ path: join(shots, '4-exported.png') })

  const pack = join(outDir, 'e2e_pack')
  expect(readFileSync(join(pack, 'README.txt'), 'utf8')).toContain('FiveM.app\\mods')
  for (const f of ['WEAPONS_PLAYER.rpf', 'RESIDENT.rpf']) {
    const b = readFileSync(join(pack, f))
    expect(b.readUInt32LE(0)).toBe(0x52504637) // RPF7
    expect(b.readUInt32LE(12)).toBe(0x4e45504f) // OPEN
  }
  // read the archives back like the game would
  const game2 = join(work, 'game2')
  mkdirSync(join(game2, 'x64', 'audio', 'sfx'), { recursive: true })
  writeFileSync(join(game2, 'gta5.exe'), 'MZ')
  for (const f of ['WEAPONS_PLAYER.rpf', 'RESIDENT.rpf']) copyFileSync(join(pack, f), join(game2, 'x64', 'audio', 'sfx', f))
  const ex = await runBridge<ExtractResult>(bridgeExe, [
    'extract',
    '--gta',
    game2,
    '--no-keys',
    '--test-awc-key',
    testAwcKey,
    '--out',
    join(work, 'check')
  ])
  expect(ex.errors).toEqual([])
  const bank = parseAwc(new Uint8Array(readFileSync(ex.extracted.find((e) => e.file === 'ptl_pistol.awc')!.path)))
  const body = getFormat(bank.streams.find((s) => s.id === 0x16ef0ea5)!)!
  expect(body.sampleRate).toBe(44100)
  expect(body.samples).toBeGreaterThan(20000)
  await app.close()
})

test('sound banks: every bank, what each sound is for, and the in-game ID pack', async () => {
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
  await page.locator('.bank-item[title^="resident/weapons.awc"]').click()
  await expect(page.getByText('from your game')).toBeVisible()
  await expect(page.locator('table.streams tbody tr')).toHaveCount(3)
  await page.locator('table.streams tbody tr', { hasText: '02032920' }).click()
  await expect(page.locator('table.streams tbody tr', { hasText: '02032920' })).toContainText('Your Pistol')
  await page.getByRole('button', { name: 'Silence' }).click()
  await expect(page.locator('table.streams tbody tr', { hasText: '02032920' })).toContainText('Silenced')

  // a bank no gun uses is listed from the sound map and loads from the game on demand
  const explosions = page.locator('.bank-item[title^="resident/explosions.awc"]')
  await expect(explosions).toHaveClass(/missing/) // not in the library yet
  await explosions.click()
  await page.getByRole('button', { name: 'Load from game' }).click()
  await expect(page.locator('table.streams tbody tr')).toHaveCount(3)
  await expect(page.locator('table.streams tbody tr', { hasText: '0AA87351' })).toContainText('Unused')
  await expect(page.locator('table.streams tbody tr', { hasText: '16EF0EA5' })).toContainText('Explosion')
  if (shots) await page.screenshot({ path: join(shots, '6-banks.png') })

  // the ID pack: every sound says its code
  await page.getByRole('button', { name: 'Identify in game…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Identify sounds in game' })
  await dialog.getByRole('radio', { name: /Everything/ }).check()
  await expect(dialog.getByText('3 banks, 9 sounds')).toBeVisible()
  const outDir = join(work, 'ids')
  await stubOpen(app, [outDir])
  await dialog.getByRole('button', { name: 'Build ID pack…' }).click()
  await expect(dialog.getByText(/Saved to/)).toBeVisible({ timeout: 30_000 })
  await expect(dialog.getByText(/9 sounds labelled with beeps/)).toBeVisible()
  if (shots) await page.screenshot({ path: join(shots, '7-idpack.png') })
  const folder = join(outDir, 'sound-id-pack')
  const legend = readFileSync(join(folder, 'ID-LEGEND.txt'), 'utf8')
  expect(legend).toContain('explosions 3')
  for (const f of ['WEAPONS_PLAYER.rpf', 'RESIDENT.rpf']) expect(existsSync(join(folder, f))).toBe(true)

  // "What did I hear?" jumps to the sound
  await dialog.getByRole('textbox', { name: 'ID pack code' }).fill('explosions three')
  await dialog.getByRole('button', { name: 'Find' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('table.streams tbody tr.selected')).toContainText('16EF0EA5')
  await expect(page.locator('.panel.usage')).toContainText('Explosion')
  await app.close()
})
