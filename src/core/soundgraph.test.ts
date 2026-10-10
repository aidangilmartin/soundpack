import { describe, expect, it } from 'vitest'
import { joaat } from './hash'
import { envelopeAutomation, newPlanState, planBurst, planShot, seededRng, shotRoles, type Voice } from './soundgraph'
import type { SoundNode, WeaponIndex } from './weapons'
import { fixtureIndex } from './weapons.fixture'

describe('planShot', () => {
  const index = fixtureIndex()
  const player = index.weapons[0].variants[0]

  it('layers the gunshot and report with the game data levels', () => {
    const voices = planShot(index, player, newPlanState(seededRng(1)))
    const fire = voices.filter((v) => v.role === 'fire')
    expect(fire).toHaveLength(2) // one random body + mechanics
    for (const v of fire) {
      expect(v.gainDb).toBeCloseTo(-1) // -100 mB on the multitrack
      expect(v.cents).toBe(50)
    }
    expect(fire.find((v) => v.file === 0x0aa87351)!.time).toBeCloseTo(0.01) // 10 ms predelay
    const report = voices.find((v) => v.role === 'report')!
    expect(report.gainDb).toBeCloseTo(-3) // ReportVolumeDelta
    expect(report.time).toBeCloseTo(0.02) // ReportPredelayDelta
    expect(report.lpfHz).toBe(8000)
    // the envelope maps its ADSHR level onto −100..0 dB: silent → full in 5 ms, down to 80% (−20 dB),
    // held, then released to silence
    const env = report.envelope!
    expect(env.target).toBe('volume')
    expect(env.values[0]).toBe(-100)
    expect(env.values[env.times.findIndex((t) => t >= 0.005)]).toBeCloseTo(0)
    expect(env.values[env.values.length - 1]).toBeCloseTo(-100)
    expect(env.times[env.times.length - 1]).toBeCloseTo(0.455)
  })

  it('picks random variations by weight and never repeats the last one', () => {
    const state = newPlanState(seededRng(42))
    const picks: number[] = []
    for (let i = 0; i < 400; i++) {
      const v = planShot(index, player, state, { roles: ['fire'] }).find((x) => x.file !== 0x0aa87351)!
      picks.push(v.file)
    }
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1])
    const b = picks.filter((f) => f === 0x02032920).length
    expect(b).toBe(200) // alternation forced by the no-repeat rule
  })

  it('is reproducible with the same seed', () => {
    const a = planShot(index, player, newPlanState(seededRng(7)))
    const b = planShot(index, player, newPlanState(seededRng(7)))
    expect(a).toEqual(b)
  })

  it('spaces bursts at the fire rate', () => {
    const voices = planBurst(index, player, newPlanState(seededRng(3)), 3, 0.15, ['fire'])
    const starts = voices.filter((v) => v.file === 0x0aa87351).map((v) => v.time)
    expect(starts.map((t) => Math.round(t * 1000))).toEqual([10, 160, 310])
  })

  it('resolves switches from variables, assuming 0 for game variables', () => {
    const idx = fixtureIndex()
    idx.nodes[String(joaat('switch'))] = {
      type: 'SwitchSound',
      header: {},
      children: [joaat('pistol_body_a'), joaat('pistol_body_b')],
      cond: { variable: joaat('game.var') }
    }
    const state = newPlanState(seededRng(1))
    const v = planShot(idx, { ...player, roles: { fire: joaat('switch') } }, state, { roles: ['fire'] })
    expect(v.map((x) => x.file)).toEqual([0x16ef0ea5])
    expect([...state.approximations]).toEqual(['a game variable the engine sets at runtime was assumed to be 0'])
    // a VariableBlockSound above sets it: no approximation
    idx.nodes[String(joaat('block'))] = {
      type: 'VariableBlockSound',
      header: {},
      children: [joaat('switch')],
      cond: { variables: [{ name: joaat('game.var'), value: 1, variance: 0, type: 2 }] }
    }
    const s2 = newPlanState(seededRng(1))
    expect(planShot(idx, { ...player, roles: { fire: joaat('block') } }, s2, { roles: ['fire'] }).map((x) => x.file)).toEqual([0x02032920])
    expect(s2.approximations.size).toBe(0)
  })

  it('applies variance and stereo collapse', () => {
    const idx = fixtureIndex()
    idx.nodes[String(joaat('stereo'))] = {
      type: 'CollapsingStereoSound',
      header: { volumeVariance: 300 },
      children: [joaat('pistol_body_a'), joaat('pistol_body_b')]
    }
    const v = planShot(idx, { ...player, roles: { fire: joaat('stereo') } }, newPlanState(seededRng(9)), { roles: ['fire'] })
    expect(v.map((x) => x.pan)).toEqual([-1, 1])
    expect(Math.abs(v[0].gainDb)).toBeLessThanOrEqual(3)
    expect(v[0].gainDb).toBe(v[1].gainDb)
  })
})

/** A fixture index plus extra nodes, with a player variant whose gunshot is `root`. */
function withNodes(nodes: Record<string, SoundNode>, extra: Partial<WeaponIndex> = {}): WeaponIndex {
  const idx = { ...fixtureIndex(), ...extra }
  for (const [k, n] of Object.entries(nodes)) idx.nodes[String(joaat(k))] = n
  return idx
}

const A = 0x16ef0ea5
const B = 0x02032920

function shot(idx: WeaponIndex, root: string, distance = 0, opts: { shots?: number } = {}): { voices: Voice[]; notes: string[] } {
  const state = newPlanState(seededRng(5))
  const player = idx.weapons[0].variants[0]
  const voices = planShot(idx, { ...player, roles: { fire: joaat(root) } }, state, {
    roles: ['fire'],
    listener: { distance, environment: 'outdoor' },
    shots: opts.shots,
    shotGapMs: 100
  })
  return { voices, notes: [...state.approximations] }
}

describe('planShot with distance and game data', () => {
  const xf = (mode: number): SoundNode => ({
    type: 'CrossfadeSound',
    header: {},
    children: [joaat('pistol_body_a'), joaat('pistol_body_b')],
    cond: { mode, minDistance: 20, maxDistance: 100 }
  })

  it('crossfades near and far by distance (linear and equal power)', () => {
    const idx = withNodes({ xlin: xf(1), xeq: xf(2), xnone: xf(0) })
    const gain = (v: Voice[], file: number): number | undefined => v.find((x) => x.file === file)?.gainDb
    expect(shot(idx, 'xlin', 10).voices.map((v) => v.file)).toEqual([A])
    // at 60 m both sides are at half, on top of the default roll-off (these test sounds have no distance curve)
    const rollOff = 20 * Math.log10(1 / 60)
    const mid = shot(idx, 'xlin', 60).voices
    expect(gain(mid, A)).toBeCloseTo(rollOff + 20 * Math.log10(0.5))
    expect(gain(mid, B)).toBeCloseTo(rollOff + 20 * Math.log10(0.5))
    expect(shot(idx, 'xlin', 150).voices.map((v) => v.file)).toEqual([B])
    const eq = shot(idx, 'xeq', 60).voices
    expect(gain(eq, A)).toBeCloseTo(rollOff + 20 * Math.log10(Math.SQRT1_2))
    expect(shot(idx, 'xnone', 99).voices.map((v) => v.file)).toEqual([A])
    expect(shot(idx, 'xnone', 101).voices.map((v) => v.file)).toEqual([B])
  })

  it('collapses stereo to mono beyond its max distance', () => {
    const st: SoundNode = {
      type: 'CollapsingStereoSound',
      header: {},
      children: [joaat('pistol_body_a'), joaat('pistol_body_b')],
      cond: { minDistance: 5, maxDistance: 25 }
    }
    const idx = withNodes({ st })
    expect(shot(idx, 'st', 2).voices.map((v) => v.pan)).toEqual([-1, 1])
    expect(shot(idx, 'st', 15).voices.map((v) => v.pan)).toEqual([-0.5, 0.5])
    expect(shot(idx, 'st', 40).voices.map((v) => Math.abs(v.pan))).toEqual([0, 0])
  })

  it('applies the mix category chain and the distance curve', () => {
    const idx = withNodes(
      {
        cat: {
          type: 'MultitrackSound',
          header: { category: joaat('child_cat'), volumeCurve: joaat('dist'), volumeCurveScale: 200 },
          children: [joaat('pistol_body_a')]
        }
      },
      {
        categories: {
          [joaat('parent_cat')]: {
            parent: null,
            volume: -300,
            pitch: 100,
            lpf: 23900,
            hpf: 0,
            lpfDistanceCurve: null,
            hpfDistanceCurve: null,
            distanceRollOffScale: 100,
            plateauRollOffScale: 100,
            parentOverrides: 0
          },
          [joaat('child_cat')]: {
            parent: joaat('parent_cat'),
            volume: 100,
            pitch: 0,
            lpf: 12000,
            hpf: 0,
            lpfDistanceCurve: null,
            hpfDistanceCurve: null,
            distanceRollOffScale: 100,
            plateauRollOffScale: 100,
            parentOverrides: 0
          }
        },
        curves: {
          [joaat('dist')]: {
            type: 'LinearCurve',
            minInput: 0,
            maxInput: 100,
            leftHandPairX: 0,
            leftHandPairY: 1,
            rightHandPairX: 100,
            rightHandPairY: 0
          }
        }
      }
    )
    const close = shot(idx, 'cat', 0)
    expect(close.voices[0].gainDb).toBeCloseTo(-2) // -300 + 100 mB
    expect(close.voices[0].cents).toBe(100)
    expect(close.voices[0].lpfHz).toBe(12000)
    expect(close.notes).toEqual([])
    // 100 m with a 2× curve scale reads the curve at 50 m: half volume
    expect(shot(idx, 'cat', 100).voices[0].gainDb).toBeCloseTo(-2 + 20 * Math.log10(0.5))
  })

  it('falls back to the default roll-off when a sound has no distance curve, and says so', () => {
    const r = shot(withNodes({}), 'pistol_player_fire', 10)
    expect(r.voices[0].gainDb).toBeCloseTo(-1 - 20)
    expect(r.notes).toContain("the engine's default distance roll-off")
  })

  it('repeats a retriggered sound for each shot of a burst, then plays its stop sound', () => {
    const idx = withNodes({
      auto: {
        type: 'RetriggeredOverlappedSound',
        header: {},
        children: [joaat('pistol_body_a'), joaat('pistol_body_b'), joaat('pistol_mech')],
        cond: { loopCount: -1, delay: 80 }
      }
    })
    const v = shot(idx, 'auto', 0, { shots: 3 }).voices
    expect(v.map((x) => [x.file, Math.round(x.time * 1000)])).toEqual([
      [A, 0],
      [B, 80],
      [B, 160],
      [0x0aa87351, 250]
    ])
  })

  it('shapes pitch with a pitch envelope', () => {
    const idx = fixtureIndex()
    const auto = envelopeAutomation(
      idx,
      { attack: 10, decay: 0, sustain: 100, hold: 50, release: 20, mode: 1, outputMin: -1200, outputMax: 0 },
      newPlanState()
    )
    expect(auto!.target).toBe('pitch')
    expect(auto!.values[0]).toBe(-1200)
    expect(auto!.values[8]).toBe(0)
  })
})

describe('shot parts by environment', () => {
  const idx = fixtureIndex()
  const player = { ...idx.weapons[0].variants[0], roles: { ...idx.weapons[0].variants[0].roles, interior: 1 } }
  it('uses the indoor shot indoors and no outdoor echo', () => {
    expect(shotRoles(player, 'outdoor')).toEqual(['fire', 'report', 'echo', 'shellCasing'])
    expect(shotRoles(player, 'interior')).toEqual(['interior', 'report', 'shellCasing'])
  })

  it("plays an automatic gun's AutoSound in a burst", () => {
    const i2 = withNodes({ autoroot: { type: 'MultitrackSound', header: {}, children: [joaat('pistol_body_b')] } })
    const v = { ...i2.weapons[0].variants[0], roles: { ...i2.weapons[0].variants[0].roles, auto: joaat('autoroot') } }
    const burst = planBurst(i2, v, newPlanState(seededRng(2)), 3, 0.1, ['fire'], undefined, { automatic: true })
    expect(burst.every((x) => x.role === 'auto')).toBe(true)
    expect(
      planBurst(i2, v, newPlanState(seededRng(2)), 3, 0.1, ['fire'], undefined, { automatic: false }).every((x) => x.role === 'fire')
    ).toBe(true)
  })
})
