import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { bridgePath, devCodeWalkerPath, runBridge } from '../../src/main/bridge'
import { makeBank } from '../../src/core/awc/fixtures'
import { parseAwc } from '../../src/core/awc/read'
import { getFormat } from '../../src/core/awc/types'
import { writeAwc } from '../../src/core/awc/write'
import { encodeWav16 } from '../../src/core/wav'

const shots = process.env.SCREENSHOT_DIR
const root = resolve(__dirname, '../..')

test('import a bank, assign a sound and export a resource', async () => {
  const work = mkdtempSync(join(tmpdir(), 'gsm-e2e-'))
  const bankPath = join(work, 'smg_smg.awc')
  writeFileSync(bankPath, writeAwc(makeBank()))
  const shot = Int16Array.from({ length: 24000 }, (_, i) => Math.round(Math.sin(i / 3) * 20000 * Math.exp(-i / 4000)))
  const wavPath = join(work, 'my_shot.wav')
  writeFileSync(wavPath, encodeWav16(shot, 48000))
  const outDir = join(work, 'out')

  const app = await electron.launch({
    args: ['--no-sandbox', root],
    env: { ...process.env, GSM_USER_DATA: join(work, 'profile') }
  })
  const stubOpen = (paths: string[]) =>
    app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: p })) as typeof dialog.showOpenDialog
    }, paths)

  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1360, height: 860 })
  await expect(page.getByText('Build a gun sound pack')).toBeVisible()
  if (shots) await page.screenshot({ path: join(shots, '1-start.png') })

  await stubOpen([bankPath])
  await page.getByRole('button', { name: 'Import .awc…' }).first().click()
  await expect(page.getByRole('heading', { name: /^SMG/ })).toBeVisible()
  await expect(page.locator('table.streams tbody tr')).toHaveCount(4)

  // pick the longest stream and replace it
  await page.locator('table.streams tbody tr', { hasText: '16EF0EA5' }).click()
  await stubOpen([wavPath])
  await page.getByRole('button', { name: 'Add sound…' }).click()
  await expect(page.getByLabel('Sound to assign')).toContainText('my_shot.wav')
  await page.getByRole('button', { name: /^Assign/ }).click()
  await expect(page.locator('table.streams tbody tr', { hasText: '16EF0EA5' })).toContainText('my_shot.wav')
  await expect(page.getByText('Result')).toBeVisible()
  await page.getByLabel('Gain').fill('-3')
  await page.getByLabel('Gain').press('Enter')

  // silence another one
  await page.locator('table.streams tbody tr', { hasText: '02032920' }).click()
  await page.getByRole('button', { name: 'Silence' }).click()
  await expect(page.locator('table.streams tbody tr', { hasText: '02032920' })).toContainText('Silenced')
  await page.locator('table.streams tbody tr', { hasText: '16EF0EA5' }).click()
  if (shots) await page.screenshot({ path: join(shots, '2-bank.png') })

  await page.getByRole('button', { name: /^Export/ }).click()
  await page.getByRole('textbox', { name: 'Resource name' }).fill('E2E Pack')
  await page.getByRole('button', { name: 'Build' }).click()
  await expect(page.getByText('audio/sfx/weapons_player/smg_smg.awc — 1 replaced, 1 silenced')).toBeVisible()
  await expect(page.getByText(/resident\/weapons.awc is not replaced/)).toBeVisible()
  if (shots) await page.screenshot({ path: join(shots, '3-export.png') })
  await stubOpen([outDir])
  await page.getByRole('button', { name: 'Save folder…' }).click()
  await expect(page.getByText(/Saved to/)).toBeVisible()

  const resourceDir = join(outDir, 'e2e_pack')
  const manifest = readFileSync(join(resourceDir, 'fxmanifest.lua'), 'utf8')
  expect(manifest).toContain("'audio/sfx/weapons_player/smg_smg.awc'")
  expect(manifest).toContain("data_file 'AUDIO_WAVEPACK' 'audio/sfx/weapons_player'")
  expect(existsSync(join(resourceDir, 'README.txt'))).toBe(true)
  const awc = parseAwc(new Uint8Array(readFileSync(join(resourceDir, 'audio/sfx/weapons_player/smg_smg.awc'))))
  expect(awc.streams).toHaveLength(4)
  const replaced = getFormat(awc.streams.find((s) => s.id === 0x16ef0ea5)!)!
  expect(replaced.sampleRate).toBe(44100)
  expect(replaced.samples).toBeGreaterThan(20000)
  expect(getFormat(awc.streams.find((s) => s.id === 0x02032920)!)!.samples).toBe(128)

  await app.close()
})

const bridge = bridgePath({ isPackaged: false, resourcesPath: '', appPath: root })
const codewalker = devCodeWalkerPath(root)

test('extract gun banks from a GTA V folder through CodeWalker', async () => {
  test.skip(!existsSync(bridge) || !codewalker, 'run npm run build:bridge first')
  const work = mkdtempSync(join(tmpdir(), 'gsm-e2e-game-'))
  // CodeWalker parses gesture chunks as 36-byte records; keep only regular streams
  const b = makeBank()
  const bytes = writeAwc({ ...b, streams: b.streams.filter((s) => s.chunks.some((c) => c.kind === 'format')) })
  const smg = join(work, 'smg_smg.awc')
  const shared = join(work, 'weapons.awc')
  writeFileSync(smg, bytes)
  writeFileSync(shared, bytes)
  const key = Buffer.from(Array.from({ length: 16 }, (_, i) => i + 1)).toString('base64')
  const game = join(work, 'Grand Theft Auto V')
  const fixture = ['--codewalker', codewalker!, '--out', game, '--test-awc-key', key, '--weapons-player-awc', smg, '--resident-awc', shared]
  await runBridge(bridge, ['make-test-game', ...fixture])

  const app = await electron.launch({
    args: ['--no-sandbox', root],
    env: {
      ...process.env,
      GSM_USER_DATA: join(work, 'profile'),
      // the fake game has no gta5.exe keys; its banks are AWC-encrypted with a test key
      GSM_BRIDGE_EXTRA_ARGS: JSON.stringify(['--no-keys', '--test-awc-key', key])
    }
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1360, height: 860 })
  await page.getByRole('button', { name: 'Extract from GTA V…' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Extract from GTA V' })
  await expect(dialog.getByText('using the development build')).toBeVisible()

  await app.evaluate(({ dialog: d }, p) => {
    d.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof d.showOpenDialog
  }, game)
  await dialog.getByRole('button', { name: 'Browse…' }).first().click()
  await expect(dialog.getByText('gta5.exe found')).toBeVisible()

  await dialog.getByRole('button', { name: 'Find gun banks' }).click()
  await expect(dialog.getByText('2 of 2 selected')).toBeVisible()
  await expect(dialog.getByText('Shared weapon sounds')).toBeVisible()
  if (shots) await page.screenshot({ path: join(shots, '4-extract.png') })
  await dialog.getByRole('button', { name: 'Extract 2 banks' }).click()
  await expect(dialog.getByText('Extracted 2 banks.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).last().click()

  await expect(page.locator('table.streams tbody tr')).toHaveCount(3)
  await expect(page.getByText('from your game')).toBeVisible()
  await expect(page.locator('.bank-item[title="weapons_player/smg_smg.awc"]')).toContainText('3')
  await expect(page.locator('.bank-item[title="resident/weapons.awc"]')).toContainText('3')
  if (shots) await page.screenshot({ path: join(shots, '5-extracted.png') })
  await app.close()
})
