import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bridgeExe as exe, fixtureBank, makeFakeGame, testAwcKey as key } from '../../tests/fakeGame'
import { parseAwc } from '../core/awc/read'
import { joaat } from '../core/hash'
import type { WeaponIndex } from '../core/weapons'
import { runBridge, type ScanResult } from './bridge'

describe.skipIf(!existsSync(exe))('bridge scan (integration)', () => {
  it('indexes every gun, its player/NPC variants and sound graphs, and extracts the banks', async () => {
    const work = mkdtempSync(join(tmpdir(), 'gsm-scan-'))
    const game = await makeFakeGame(work, { key })
    const out = join(work, 'out')
    const progress: string[] = []
    const r = await runBridge<ScanResult>(exe, ['scan', '--gta', game, '--out', out, '--no-keys', '--test-awc-key', key], (m) =>
      progress.push(m)
    )
    expect(r.errors).toEqual([])
    expect(r.weapons).toBe(2) // the knife is in weapons.meta but isn't a gun
    expect(progress).toContain('Resolving weapon sounds')

    const index = JSON.parse(readFileSync(r.indexPath, 'utf8')) as WeaponIndex
    expect(index.weapons.map((w) => w.name)).toEqual(['WEAPON_PISTOL', 'WEAPON_SMG'])
    const pistol = index.weapons[0]
    expect(pistol.group).toBe('GROUP_PISTOL')
    expect(pistol.timeBetweenShots).toBeCloseTo(0.15)
    expect(pistol.variants.map((v) => v.category)).toEqual(['player', 'fallback'])
    const player = pistol.variants[0]
    // the 8 shot parts keep their short keys; every other sound field is listed too
    expect(player.roles).toEqual({
      fire: joaat('pistol_player_fire'),
      report: joaat('pistol_report'),
      echo: joaat('pistol_echo'),
      heftSound: joaat('pistol_heft'),
      reloadSounds: joaat('pistol_reload_set'),
      slowMoFireSound: joaat('pistol_slowmo')
    })
    expect(player.reportVolumeDelta).toBe(-3)
    expect(player.reportPredelayDelta).toBe(20)

    const fire = index.nodes[String(joaat('pistol_player_fire'))]!
    expect(fire.type).toBe('MultitrackSound')
    expect(fire.header).toEqual({ volume: -100, pitch: 50, preDelay: 0 })
    expect(fire.children).toEqual([joaat('pistol_body_rnd'), joaat('pistol_mech')])
    const rnd = index.nodes[String(joaat('pistol_body_rnd'))]!
    expect(rnd.type).toBe('RandomizedSound')
    expect(rnd.weights).toEqual([1, 3])
    expect(rnd.header).toEqual({ volumeVariance: 200, pitchVariance: 30 })
    const env = index.nodes[String(joaat('pistol_report'))]!
    expect(env.envelope).toEqual({ attack: 5, decay: 50, sustain: 80, hold: 100, release: 300 })
    expect(env.header).toEqual({ lpf: 8000 })
    const leaf = index.nodes[String(joaat('pistol_body_a'))]!
    expect(leaf.simple).toEqual({ container: joaat('weapons_player/ptl_pistol'), file: 0x16ef0ea5 })
    expect(index.containers[String(joaat('weapons_player/ptl_pistol'))]).toEqual({ pack: 'weapons_player', bank: 'ptl_pistol.awc' })
    expect(index.containers[String(joaat('resident/weapons'))]).toEqual({ pack: 'resident', bank: 'weapons.awc' })
    expect(index.warnings.some((w) => w.includes('not found in the game files'))).toBe(true) // the SMG's bank is missing

    expect(r.extracted.map((e) => `${e.pack}/${e.file}`).sort()).toEqual(['resident/weapons.awc', 'weapons_player/ptl_pistol.awc'])
    const extracted = parseAwc(new Uint8Array(readFileSync(r.extracted[0].path)))
    expect(extracted.streams).toEqual(parseAwc(fixtureBank()).streams)
  })
})
