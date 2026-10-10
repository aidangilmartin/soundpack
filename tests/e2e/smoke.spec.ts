import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeBank } from '../../src/core/awc/fixtures'
import { parseAwc } from '../../src/core/awc/read'
import { getFormat } from '../../src/core/awc/types'
import { writeAwc } from '../../src/core/awc/write'
import { encodeWav16 } from '../../src/core/wav'

const shots = process.env.SCREENSHOT_DIR

test('import a bank, assign a sound and export a resource', async () => {
  const work = mkdtempSync(join(tmpdir(), 'gsm-e2e-'))
  const bankPath = join(work, 'smg_smg.awc')
  writeFileSync(bankPath, writeAwc(makeBank()))
  const shot = Int16Array.from({ length: 24000 }, (_, i) => Math.round(Math.sin(i / 3) * 20000 * Math.exp(-i / 4000)))
  const wavPath = join(work, 'my_shot.wav')
  writeFileSync(wavPath, encodeWav16(shot, 48000))
  const outDir = join(work, 'out')

  const app = await electron.launch({
    args: ['--no-sandbox', join(__dirname, '../../out/main/index.js')],
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

  const root = join(outDir, 'e2e_pack')
  const manifest = readFileSync(join(root, 'fxmanifest.lua'), 'utf8')
  expect(manifest).toContain("'audio/sfx/weapons_player/smg_smg.awc'")
  expect(manifest).toContain("data_file 'AUDIO_WAVEPACK' 'audio/sfx/weapons_player'")
  expect(existsSync(join(root, 'README.txt'))).toBe(true)
  const awc = parseAwc(new Uint8Array(readFileSync(join(root, 'audio/sfx/weapons_player/smg_smg.awc'))))
  expect(awc.streams).toHaveLength(4)
  const replaced = getFormat(awc.streams.find((s) => s.id === 0x16ef0ea5)!)!
  expect(replaced.sampleRate).toBe(44100)
  expect(replaced.samples).toBeGreaterThan(20000)
  expect(getFormat(awc.streams.find((s) => s.id === 0x02032920)!)!.samples).toBe(128)

  await app.close()
})
