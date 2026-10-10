import type { Role, SoundHeader, WeaponIndex, WeaponVariant } from './weapons'
import { node } from './weapons'

/**
 * Turns the game's sound graph for one gunshot into concrete "voices" (which wave, when, how
 * loud, pitch, pan, filters, envelope), the way the game's sound engine would trigger them.
 * Runtime effects the data doesn't describe (environment reverb, occlusion, distance) are left to
 * the preview's environment presets.
 */

export interface Envelope {
  attack: number
  decay: number
  sustain: number // 0..100 %
  hold: number
  release: number
}

export interface Voice {
  role: Role
  container: number
  file: number
  /** Seconds from the start of the shot. */
  time: number
  gainDb: number
  cents: number
  /** -1 (left) .. 1 (right) */
  pan: number
  lpfHz: number | null
  hpfHz: number | null
  startOffsetMs: number
  attackMs: number
  releaseMs: number
  envelope: Envelope | null
  /** 0..1 send into the environment reverb. */
  reverb: number
}

export type Rng = () => number

/** Small deterministic PRNG (mulberry32) so previews can be reproduced. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NO_LPF = 23900

/** Types that pick a branch from game state; we take the first branch. */
const STATEFUL = new Set([
  'SwitchSound',
  'IfSound',
  'VariableBlockSound',
  'VariableCurveSound',
  'VariablePrintValueSound',
  'ParameterTransformSound',
  'MathOperationSound',
  'FluctuatorSound',
  'AutomationSound',
  'AutomationNoteMapSound',
  'DirectionalSound',
  'KineticSound',
  'EnvironmentSound',
  'DynamicEntitySound',
  'SoundSet',
  'SoundSetList',
  'SoundHashList'
])

const SINGLE_CHILD = new Set([
  'WrapperSound',
  'OnStopSound',
  'LoopingSound',
  'RetriggeredOverlappedSound',
  'SequentialSound',
  'SequentialOverlapSound'
])

interface Acc {
  timeMs: number
  gainDb: number
  cents: number
  pan: number | null
  lpf: number
  hpf: number
  startOffsetMs: number
  attackMs: number
  releaseMs: number
  envelope: Envelope | null
  reverb: number
}

export interface PlanState {
  rng: Rng
  /** Last pick per RandomizedSound, so the same variation doesn't play twice in a row. */
  lastPick: Map<number, number>
  /** Sound types we had to approximate, for display. */
  approximations: Set<string>
}

export function newPlanState(rng: Rng = Math.random): PlanState {
  return { rng, lastPick: new Map(), approximations: new Set() }
}

const spread = (rng: Rng, v: number | undefined): number => (v ? (rng() * 2 - 1) * v : 0)

function applyHeader(acc: Acc, h: SoundHeader | undefined, rng: Rng): Acc {
  if (!h) return acc
  const next = { ...acc }
  next.gainDb += ((h.volume ?? 0) + spread(rng, h.volumeVariance)) / 100
  next.cents += (h.pitch ?? 0) + spread(rng, h.pitchVariance)
  next.timeMs += (h.preDelay ?? 0) + (h.preDelayVariance ? rng() * h.preDelayVariance : 0)
  next.startOffsetMs += (h.startOffset ?? 0) + (h.startOffsetVariance ? rng() * h.startOffsetVariance : 0)
  if (h.pan !== undefined && h.pan <= 360) {
    const deg = h.pan + spread(rng, h.panVariance)
    next.pan = Math.max(-1, Math.min(1, Math.sin((deg * Math.PI) / 180)))
  }
  if (h.lpf !== undefined && h.lpf > 0) next.lpf = Math.min(next.lpf, h.lpf + spread(rng, h.lpfVariance))
  if (h.hpf !== undefined) next.hpf = Math.max(next.hpf, h.hpf + spread(rng, h.hpfVariance))
  if (h.attack) next.attackMs = Math.max(next.attackMs, h.attack)
  if (h.release) next.releaseMs = Math.max(next.releaseMs, h.release)
  const sends = [h.smallReverb ?? 0, h.mediumReverb ?? 0, h.largeReverb ?? 0]
  if (sends.some((s) => s > 0)) next.reverb = Math.max(next.reverb, Math.min(1, Math.max(...sends) / 100))
  return next
}

function pickWeighted(state: PlanState, nodeHash: number, children: number[], weights: number[] | null | undefined): number {
  const w = children.map((_, i) => Math.max(0, weights?.[i] ?? 1))
  const last = state.lastPick.get(nodeHash)
  if (children.length > 1 && last !== undefined) w[last] = 0
  const total = w.reduce((a, b) => a + b, 0)
  let i = 0
  if (total > 0) {
    let r = state.rng() * total
    for (i = 0; i < w.length - 1; i++) {
      r -= w[i]
      if (r < 0) break
    }
  }
  state.lastPick.set(nodeHash, i)
  return i
}

function walk(index: WeaponIndex, hash: number, acc: Acc, role: Role, state: PlanState, out: Voice[], depth: number): void {
  if (depth > 48) return
  const n = node(index, hash)
  if (!n) return
  const a = applyHeader(acc, n.header, state.rng)
  const children = n.children ?? []
  switch (n.type) {
    case 'SimpleSound':
      if (n.simple) {
        out.push({
          role,
          container: n.simple.container >>> 0,
          file: n.simple.file & 0x1fffffff,
          time: Math.max(0, a.timeMs) / 1000,
          gainDb: a.gainDb,
          cents: a.cents,
          pan: a.pan ?? 0,
          lpfHz: a.lpf < NO_LPF ? a.lpf : null,
          hpfHz: a.hpf > 0 ? a.hpf : null,
          startOffsetMs: Math.max(0, a.startOffsetMs),
          attackMs: a.attackMs,
          releaseMs: a.releaseMs,
          envelope: a.envelope,
          reverb: a.reverb
        })
      }
      return
    case 'MultitrackSound':
      for (const c of children) walk(index, c, a, role, state, out, depth + 1)
      return
    case 'RandomizedSound':
      if (children.length) walk(index, children[pickWeighted(state, hash, children, n.weights)], a, role, state, out, depth + 1)
      return
    case 'EnvelopeSound':
      if (children.length) walk(index, children[0], { ...a, envelope: n.envelope ?? a.envelope }, role, state, out, depth + 1)
      return
    case 'CollapsingStereoSound':
      children
        .slice(0, 2)
        .forEach((c, i) => walk(index, c, { ...a, pan: children.length > 1 ? (i === 0 ? -1 : 1) : a.pan }, role, state, out, depth + 1))
      return
    default:
      // Wrapper/OnStop/Looping/Retriggered wrap one main child; anything else that has a choice
      // (sequences, crossfades, game-state switches) is approximated by its first child.
      // (children keep their slots, so empty slots such as an OnStop without a stop sound are 0)
      if (STATEFUL.has(n.type) || !SINGLE_CHILD.has(n.type) || children.filter((c) => c !== 0).length > 1) state.approximations.add(n.type)
      if (children[0]) walk(index, children[0], a, role, state, out, depth + 1)
  }
}

export interface ShotOptions {
  /** Parts to include; default is a normal unsuppressed shot. */
  roles?: Role[]
  /** Fire time offset in seconds (for bursts). */
  at?: number
}

export const DEFAULT_SHOT_ROLES: Role[] = ['fire', 'report', 'echo', 'shellCasing']
export const SUPPRESSED_SHOT_ROLES: Role[] = ['suppressed', 'suppressedEcho', 'shellCasing']

/** Casings land a moment after the shot; the game triggers them on physics impact. */
const SHELL_CASING_DELAY_MS = 450

export function planShot(index: WeaponIndex, variant: WeaponVariant, state: PlanState, opts: ShotOptions = {}): Voice[] {
  const out: Voice[] = []
  const at = (opts.at ?? 0) * 1000
  for (const role of opts.roles ?? DEFAULT_SHOT_ROLES) {
    const root = variant.roles[role]
    if (!root) continue
    const acc: Acc = {
      timeMs: at,
      gainDb: 0,
      cents: 0,
      pan: null,
      lpf: NO_LPF,
      hpf: 0,
      startOffsetMs: 0,
      attackMs: 0,
      releaseMs: 0,
      envelope: null,
      reverb: 0
    }
    if (role === 'report') {
      acc.gainDb += variant.reportVolumeDelta || 0
      acc.timeMs += variant.reportPredelayDelta || 0
    }
    if (role === 'shellCasing') acc.timeMs += SHELL_CASING_DELAY_MS * (0.8 + state.rng() * 0.4)
    walk(index, root, acc, role, state, out, 0)
  }
  return out
}

/** Several shots at the weapon's fire rate, each with fresh random variation. */
export function planBurst(
  index: WeaponIndex,
  variant: WeaponVariant,
  state: PlanState,
  shots: number,
  timeBetweenShots: number,
  roles?: Role[]
): Voice[] {
  const gap = timeBetweenShots > 0 ? timeBetweenShots : 0.15
  const voices: Voice[] = []
  for (let i = 0; i < shots; i++) {
    // casings and reports for every shot, as in game
    voices.push(...planShot(index, variant, state, { roles, at: i * gap }))
  }
  return voices
}
