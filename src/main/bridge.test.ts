import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeBank } from '../core/awc/fixtures'
import { parseAwc } from '../core/awc/read'
import { writeAwc } from '../core/awc/write'
import { BRIDGE_NAME, bridgePath, devCodeWalkerPath, runBridge, type ExtractResult, type ListResult } from './bridge'
import { TemplateLibrary } from './library'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'gsm-bridge-'))

function fakeBridge(script: string): string {
  const path = join(tmp(), 'fake-bridge')
  writeFileSync(path, `#!/usr/bin/env node\n${script}\n`)
  chmodSync(path, 0o755)
  return path
}

describe.skipIf(process.platform === 'win32')('runBridge', () => {
  it('returns the result and forwards progress', async () => {
    const exe = fakeBridge(`
      process.stderr.write(JSON.stringify({ progress: 'step 1' }) + '\\n')
      process.stderr.write('not json\\n')
      process.stdout.write(JSON.stringify({ ok: true, result: { args: process.argv.slice(2) } }) + '\\n')
    `)
    const seen: string[] = []
    const r = await runBridge<{ args: string[] }>(exe, ['list', '--gta', 'x'], (m) => seen.push(m))
    expect(r.args).toEqual(['list', '--gta', 'x'])
    expect(seen).toEqual(['step 1'])
  })

  it('turns bridge failures into errors with codes', async () => {
    const exe = fakeBridge(`process.stdout.write(JSON.stringify({ ok: false, code: 'keys', error: 'bad keys' })); process.exit(1)`)
    await expect(runBridge(exe, [])).rejects.toMatchObject({ code: 'keys', message: 'bad keys' })
    const crash = fakeBridge(`process.stderr.write('Unhandled exception\\n'); process.exit(3)`)
    await expect(runBridge(crash, [])).rejects.toMatchObject({ code: 'crash', message: expect.stringContaining('Unhandled exception') })
    await expect(runBridge('/does/not/exist', [])).rejects.toMatchObject({ code: 'no-bridge' })
  })

  it('locates the executable', () => {
    expect(bridgePath({ isPackaged: true, resourcesPath: '/r', appPath: '/a' })).toBe(join('/r', 'bridge', BRIDGE_NAME))
    expect(bridgePath({ isPackaged: false, resourcesPath: '/r', appPath: '/a' })).toBe(join('/a', 'resources', 'bridge', BRIDGE_NAME))
  })
})

// Runs against the real bridge and CodeWalker.Core once `npm run build:bridge` has been run.
const root = resolve(__dirname, '../..')
const exe = bridgePath({ isPackaged: false, resourcesPath: '', appPath: root })
const cw = devCodeWalkerPath(root)

describe.skipIf(!existsSync(exe) || !cw)('CodeWalker bridge (integration)', () => {
  // CodeWalker parses gesture chunks as 36-byte records, so drop the fixture's deliberately malformed one.
  const bank_ = (): Uint8Array => {
    const b = makeBank()
    return writeAwc({ ...b, streams: b.streams.filter((s) => s.chunks.some((c) => c.kind === 'format')) })
  }
  const key = Buffer.from(Array.from({ length: 16 }, (_, i) => i + 1)).toString('base64')

  async function fakeGame(extra: string[]): Promise<string> {
    const dir = tmp()
    const smg = join(dir, 'smg_smg.awc')
    writeFileSync(smg, bank_())
    const res = join(dir, 'weapons.awc')
    writeFileSync(res, bank_())
    const game = join(dir, 'game')
    await runBridge(exe, [
      'make-test-game',
      '--codewalker',
      cw!,
      '--out',
      game,
      '--weapons-player-awc',
      smg,
      '--resident-awc',
      res,
      ...extra
    ])
    return game
  }

  for (const mode of ['single-channel', 'whole-file'] as const) {
    it(`lists and extracts ${mode} encrypted banks`, async () => {
      const extra = ['--test-awc-key', key, ...(mode === 'whole-file' ? ['--whole-file'] : [])]
      const game = await fakeGame(extra)
      const args = ['--codewalker', cw!, '--gta', game, '--no-keys', '--test-awc-key', key]

      const list = await runBridge<ListResult>(exe, ['list', ...args])
      expect(list.banks.map((b) => `${b.pack}/${b.file}`).sort()).toEqual(['resident/weapons.awc', 'weapons_player/smg_smg.awc'])
      expect(list.game.exe).toBe('gta5.exe')

      const out = tmp()
      const progress: string[] = []
      const result = await runBridge<ExtractResult>(exe, ['extract', ...args, '--out', out, '--bank', 'weapons_player/smg_smg.awc'], (m) =>
        progress.push(m)
      )
      expect(result.errors).toEqual([])
      expect(result.extracted).toHaveLength(1)
      expect(result.extracted[0]).toMatchObject({ pack: 'weapons_player', file: 'smg_smg.awc', streams: 3, wasEncrypted: true })
      expect(progress).toContain('Extracting weapons_player/smg_smg.awc')

      // decrypted bank has exactly the original streams
      const original = parseAwc(bank_())
      const got = parseAwc(new Uint8Array(readFileSync(result.extracted[0].path)))
      expect(got.streams).toEqual(original.streams)

      const lib = new TemplateLibrary(join(tmp(), 'templates'))
      const report = await lib.importExtracted(result.extracted)
      expect(report.imported[0]).toMatchObject({ pack: 'weapons_player', file: 'smg_smg.awc', origin: 'gta', streamCount: 3 })
    })
  }

  it('reports missing banks and bad folders', async () => {
    const game = await fakeGame([])
    const r = await runBridge<ExtractResult>(exe, [
      'extract',
      '--codewalker',
      cw!,
      '--gta',
      game,
      '--no-keys',
      '--out',
      tmp(),
      '--bank',
      'resident/nope.awc'
    ])
    expect(r.extracted).toEqual([])
    expect(r.errors).toEqual([{ pack: 'resident', file: 'nope.awc', error: 'Not found in the game files.' }])
    await expect(runBridge(exe, ['list', '--codewalker', cw!, '--gta', tmp()])).rejects.toMatchObject({ code: 'no-gta' })
    await expect(runBridge(exe, ['list', '--codewalker', tmp(), '--gta', game])).rejects.toMatchObject({ code: 'no-codewalker' })
  })
})
