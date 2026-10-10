import { describe, expect, it } from 'vitest'
import { joaat } from './hash'
import { newPlanState, planBurst, planShot, seededRng } from './soundgraph'
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
    expect(report.envelope).toEqual({ attack: 5, decay: 50, sustain: 80, hold: 100, release: 300 })
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

  it('approximates game-state sounds by their first branch', () => {
    const idx = fixtureIndex()
    idx.nodes[String(joaat('switch'))] = { type: 'SwitchSound', header: {}, children: [joaat('pistol_body_a'), joaat('pistol_body_b')] }
    const state = newPlanState(seededRng(1))
    const v = planShot(idx, { ...player, roles: { fire: joaat('switch') } }, state, { roles: ['fire'] })
    expect(v.map((x) => x.file)).toEqual([0x16ef0ea5])
    expect([...state.approximations]).toEqual(['SwitchSound'])
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
