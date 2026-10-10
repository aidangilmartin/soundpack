import { describe, expect, it } from 'vitest'
import { fileLabel, gunFiles, shortStep } from './describe'
import { joaat } from './hash'
import type { SoundNode } from './weapons'
import { fixtureIndex } from './weapons.fixture'

const h = (s: string): number => joaat(s)
const simple = (container: string, file: number): SoundNode => ({
  type: 'SimpleSound',
  header: {},
  children: [],
  simple: { container: h(container), file }
})

describe('gunFiles', () => {
  it('lists every file under its part with what it is and who hears it', () => {
    const index = fixtureIndex()
    const sections = gunFiles(index, index.weapons[0])
    expect(sections.map((s) => s.label)).toEqual(['Gunshot', 'Distant report'])
    const fire = sections[0]
    expect(fire.meaning).toMatch(/every time the gun fires/)
    expect(fire.files.map((f) => [f.text, f.heardBy])).toEqual([
      ['Layer 1 of 2, plays together with the others, variation 1 of 2 (25% of shots)', 'you'],
      ['Layer 1 of 2, plays together with the others, variation 2 of 2 (75% of shots)', 'you'],
      ['Layer 2 of 2, plays together with the others', 'you'],
      ['The whole gunshot', 'others']
    ])
    // the first body wave is also the report
    expect(fire.files[0].alsoRoles).toEqual(['report'])
    expect(sections[1].files[0]).toMatchObject({ text: 'The whole distant report', alsoRoles: ['fire'] })
    expect(fileLabel(fire.files[3])).toBe('weapons · 0x16EF0EA5')
  })

  it('marks files both variants use as heard by everyone', () => {
    const index = fixtureIndex()
    const pistol = index.weapons[0]
    pistol.variants[1] = { ...pistol.variants[1], category: 'npc', roles: { fire: h('pistol_player_fire') } }
    const fire = gunFiles(index, pistol)[0]
    expect(fire.files.map((f) => f.heardBy)).toEqual(['everyone', 'everyone', 'everyone'])
  })

  it('describes crossfades, stereo pairs, sound sets and conditions', () => {
    const index = fixtureIndex()
    Object.assign(index.nodes, {
      [h('echo')]: { type: 'CrossfadeSound', header: {}, children: [h('near'), h('far')], cond: { minDistance: 20, maxDistance: 80 } },
      [h('near')]: { type: 'CollapsingStereoSound', header: {}, children: [h('l'), h('r')] },
      [h('l')]: simple('weapons_player/ptl_pistol', 0x0aa87351),
      [h('r')]: simple('weapons_player/ptl_pistol', 0x02032920),
      [h('far')]: simple('resident/weapons', 0x16ef0ea5),
      [h('reload')]: { type: 'SoundSet', header: {}, children: [h('l')], cond: { entries: [h('mag_in')] } }
    })
    const v = index.weapons[0].variants[0]
    v.roles = { echo: h('echo'), reloadSounds: h('reload') }
    const sections = gunFiles(index, { ...index.weapons[0], variants: [v] }, { [h('mag_in')]: 'mag_in' })
    expect(sections.map((s) => s.label)).toEqual(['Echo / tail', 'Reload sounds'])
    expect(sections[0].files.map((f) => f.text)).toEqual([
      'Close range (20–80 m), left channel',
      'Close range (20–80 m), right channel',
      'Far away (20–80 m)'
    ])
    expect(sections[1].files[0].text).toBe('"mag_in" sound')
    expect(sections[1].files[0].alsoRoles).toEqual(['echo'])
  })
})

describe('shortStep', () => {
  const names = (n: Record<number, string>) => (x: number) => n[x] ?? null
  it('says what an If branch means, naming the variable when it is known', () => {
    const n: SoundNode = { type: 'IfSound', header: {}, children: [1, 2], cond: { variable: 7, conditionType: 2, value: 0.5 } }
    expect(shortStep(n, 0, names({ 7: 'game.slowmo' }))).toBe('When game.slowmo > 0.5')
    expect(shortStep(n, 1, names({ 7: 'game.slowmo' }))).toBe('Otherwise (not game.slowmo > 0.5)')
    expect(shortStep(n, 0, names({}))).toBe('When a game condition is met')
  })

  it('names repeating parts and leaves plain wrappers out', () => {
    const r: SoundNode = { type: 'RetriggeredOverlappedSound', header: {}, children: [1, 2, 3] }
    expect([0, 1, 2].map((i) => shortStep(r, i, () => null))).toEqual(['Start', 'Repeating part', 'End'])
    expect(shortStep({ type: 'EnvelopeSound', header: {}, children: [1] }, 0, () => null)).toBeNull()
  })
})
