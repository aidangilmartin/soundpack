import { describe, expect, it } from 'vitest'
import { makeBank } from './awc/fixtures'
import { parseAwc } from './awc/read'
import { decodeStreamPcm } from './awc/replace'
import { getFormat } from './awc/types'
import { buildResource } from './build'
import { DEFAULT_SHAPE } from './dsp'
import { generateManifest, sanitizeResourceName } from './manifest'
import { assignSource, bankKey, newProject, silenceStreams } from './project'

const tone = (n: number): Float32Array => Float32Array.from({ length: n }, (_, i) => Math.sin(i / 5) * 0.8)

describe('manifest', () => {
  it('sanitizes resource names', () => {
    expect(sanitizeResourceName(' My Gun Pack! ')).toBe('my_gun_pack')
    expect(sanitizeResourceName('***')).toBe('gunpack')
  })

  it('lists files and registers each wave pack once', () => {
    const lua = generateManifest({ resourceName: 'pack', author: "O'Brien", description: 'x', resourceVersion: '1.0.0' }, [
      'audio/sfx/weapons_player/smg_smg.awc',
      'fxmanifest.lua',
      'audio/sfx/resident/weapons.awc',
      'audio/sfx/weapons_player/ptl_pistol.awc'
    ])
    expect(lua).toMatchInlineSnapshot(`
      "fx_version 'cerulean'
      game 'gta5'

      name 'pack'
      description 'x'
      author 'O\\'Brien'
      version '1.0.0'

      files {
        'audio/sfx/resident/weapons.awc',
        'audio/sfx/weapons_player/ptl_pistol.awc',
        'audio/sfx/weapons_player/smg_smg.awc'
      }

      data_file 'AUDIO_WAVEPACK' 'audio/sfx/resident'
      data_file 'AUDIO_WAVEPACK' 'audio/sfx/weapons_player'
      "
    `)
  })
})

describe('buildResource', () => {
  const template = makeBank()
  const templates = new Map([[bankKey('weapons_player', 'ptl_pistol.awc'), template]])
  const source = { id: 's1', fileName: 'shot.wav', channels: 1, sampleRate: 48000, durationMs: 250 }
  const sources = new Map([['s1', { sampleRate: 48000, channels: [tone(12000)] }]])

  it('replaces and silences streams, copying the rest untouched', () => {
    let project = { ...newProject(), resourceName: 'Test Pack' }
    project = assignSource(
      project,
      'weapons_player',
      'ptl_pistol.awc',
      [0x16ef0ea5],
      source,
      { ...DEFAULT_SHAPE, trimSilence: false, fadeOutMs: 0 },
      []
    )
    project = silenceStreams(project, 'weapons_player', 'ptl_pistol.awc', [0x02032920])
    const result = buildResource({ project, templates, sources })

    expect(result.resourceName).toBe('test_pack')
    expect(result.files.map((f) => f.path)).toEqual(['fxmanifest.lua', 'README.txt', 'audio/sfx/weapons_player/ptl_pistol.awc'])
    expect(result.banks).toEqual([{ pack: 'weapons_player', file: 'ptl_pistol.awc', replaced: 1, silenced: 1 }])
    expect(result.warnings.some((w) => w.includes('resident/weapons.awc'))).toBe(true)
    const manifest = new TextDecoder().decode(result.files[0].bytes)
    expect(manifest).toContain("data_file 'AUDIO_WAVEPACK' 'audio/sfx/weapons_player'")

    const awc = parseAwc(result.files[2].bytes)
    const replaced = awc.streams.find((s) => s.id === 0x16ef0ea5)!
    expect(getFormat(replaced)!.sampleRate).toBe(44100) // template rate kept
    expect(getFormat(replaced)!.samples).toBe(Math.round(12000 * (44100 / 48000)))
    expect(getFormat(awc.streams.find((s) => s.id === 0x02032920)!)!.samples).toBe(128)
    const untouched = awc.streams.find((s) => s.id === 0x0aa87351)!
    const orig = template.streams.find((s) => s.id === 0x0aa87351)!
    expect(Array.from(decodeStreamPcm(untouched).pcm)).toEqual(Array.from(decodeStreamPcm(orig).pcm))
  })

  it('fails clearly when something is missing', () => {
    expect(() => buildResource({ project: newProject(), templates, sources })).toThrow(/Nothing to export/)
    const project = assignSource(newProject(), 'weapons_player', 'smg_smg.awc', [1], source, DEFAULT_SHAPE, [])
    expect(() => buildResource({ project, templates, sources })).toThrow(/template for weapons_player\/smg_smg.awc/)
    const p2 = assignSource(newProject(), 'weapons_player', 'ptl_pistol.awc', [0x16ef0ea5], source, DEFAULT_SHAPE, [])
    expect(() => buildResource({ project: p2, templates, sources: new Map() })).toThrow(/audio file/)
  })

  it('warns about streams missing from the template', () => {
    const project = assignSource(newProject(), 'weapons_player', 'ptl_pistol.awc', [0x0aa87351, 42], source, DEFAULT_SHAPE, [])
    const r = buildResource({
      project,
      templates,
      sources,
      names: new Map([[bankKey('weapons_player', 'ptl_pistol.awc'), { 42: 'ghost' }]])
    })
    expect(r.warnings).toContain('ptl_pistol.awc ghost is not in the template and was skipped.')
  })
})
