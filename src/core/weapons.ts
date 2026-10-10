/**
 * The weapon index the CodeWalker bridge builds from the game: every gun, its audio variants
 * (your own gun vs. how others hear it) and the sound graph behind each part of a gunshot.
 */

import { FieldGroup, prettyName, ROLE_KEYS, WEAPON_FIELDS } from './fields'

/**
 * A weapon sound field: 'fire', 'auto', 'suppressed', 'report', 'echo', 'suppressedEcho',
 * 'shellCasing', 'interior', or any other WeaponSettings sound field in lowerCamel ('heftSound',
 * 'slowMoFireSound', 'reloadSounds'…). See fields.ts.
 */
export type Role = string

/** Every known role, grouped (shooting first). Roles the app doesn't know follow in name order. */
export const ROLE_ORDER: Role[] = ROLE_KEYS

export const ROLE_LABELS: Record<string, string> = Object.fromEntries(Object.entries(WEAPON_FIELDS).map(([k, f]) => [k, f.label]))

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role] ?? prettyName(role.charAt(0).toUpperCase() + role.slice(1))
}

export function roleGroup(role: Role): FieldGroup {
  return WEAPON_FIELDS[role]?.group ?? 'other'
}

/** A variant's roles in display order. */
export function orderedRoles(roles: Iterable<Role>): Role[] {
  const set = new Set(roles)
  return [...ROLE_ORDER.filter((r) => set.has(r)), ...[...set].filter((r) => !ROLE_ORDER.includes(r)).sort()]
}

/** Header fields as stored in the game data; absent fields fall back to engine defaults. */
export interface SoundHeader {
  volume?: number // mB
  volumeVariance?: number
  pitch?: number // cents
  pitchVariance?: number
  pan?: number // degrees
  panVariance?: number
  preDelay?: number // ms
  preDelayVariance?: number
  startOffset?: number // ms
  startOffsetVariance?: number
  attack?: number // ms
  release?: number // ms
  lpf?: number // Hz
  lpfVariance?: number
  hpf?: number // Hz
  hpfVariance?: number
  smallReverb?: number
  mediumReverb?: number
  largeReverb?: number
}

export interface SoundNode {
  type: string
  header?: SoundHeader
  children?: number[]
  weights?: number[] | null
  envelope?: { attack: number; decay: number; sustain: number; hold: number; release: number } | null
  simple?: { container: number; file: number } | null
}

export interface WeaponVariant {
  category: string
  settings: number
  roles: Record<Role, number>
  reportVolumeDelta: number
  reportPredelayDelta: number
  tailEnergy: number
}

export interface Weapon {
  name: string
  displayName: string | null
  group: string
  audio: string
  timeBetweenShots: number
  fireType: string
  variants: WeaponVariant[]
}

export interface WeaponIndex {
  version: number
  game: { gtaPath: string; exe: string }
  weapons: Weapon[]
  nodes: Record<string, SoundNode>
  containers: Record<string, { pack: string; bank: string }>
  warnings: string[]
}

export const GROUP_ORDER = [
  'GROUP_PISTOL',
  'GROUP_SMG',
  'GROUP_RIFLE',
  'GROUP_SHOTGUN',
  'GROUP_SNIPER',
  'GROUP_MG',
  'GROUP_HEAVY',
  'GROUP_STUNGUN'
]

export const GROUP_LABELS: Record<string, string> = {
  GROUP_PISTOL: 'Pistols',
  GROUP_SMG: 'SMGs',
  GROUP_RIFLE: 'Rifles',
  GROUP_SHOTGUN: 'Shotguns',
  GROUP_SNIPER: 'Snipers',
  GROUP_MG: 'Machine guns',
  GROUP_HEAVY: 'Heavy',
  GROUP_STUNGUN: 'Stun guns'
}

const SMALL_WORDS = new Set(['mk2', 'smg', 'mg', 'ap', 'rpg'])

/** "WEAPON_HEAVYPISTOL" → "Heavypistol"; used when the game text has no name. */
export function prettyWeaponName(name: string): string {
  return name
    .replace(/^WEAPON_/i, '')
    .toLowerCase()
    .split('_')
    .map((w) => (SMALL_WORDS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

export function weaponLabel(w: Weapon): string {
  return w.displayName && !/^(NULL|)$/i.test(w.displayName) ? w.displayName : prettyWeaponName(w.name)
}

export function node(index: WeaponIndex, hash: number): SoundNode | undefined {
  return index.nodes[String(hash >>> 0)]
}

/** Every wave (SimpleSound) under a sound, in graph order, without duplicates. */
export function leaves(index: WeaponIndex, root: number): { container: number; file: number }[] {
  const out: { container: number; file: number }[] = []
  const seen = new Set<number>()
  const walk = (h: number, depth: number): void => {
    if (seen.has(h) || depth > 64) return
    seen.add(h)
    const n = node(index, h)
    if (!n) return
    if (n.simple) {
      if (!out.some((l) => l.container === n.simple!.container && l.file === n.simple!.file)) out.push(n.simple)
      return
    }
    for (const c of n.children ?? []) walk(c, depth + 1)
  }
  walk(root >>> 0, 0)
  return out
}

export interface WeaponPart {
  role: Role
  pack: string
  bank: string
  streamId: number
}

/** The banks and streams behind each part of a weapon variant. Unresolvable waves are skipped. */
export function weaponParts(index: WeaponIndex, variant: WeaponVariant): WeaponPart[] {
  const parts: WeaponPart[] = []
  for (const role of orderedRoles(Object.keys(variant.roles))) {
    const root = variant.roles[role]
    if (!root) continue
    for (const leaf of leaves(index, root)) {
      const c = index.containers[String(leaf.container >>> 0)]
      if (!c) continue
      if (parts.some((p) => p.role === role && p.pack === c.pack && p.bank === c.bank && p.streamId === leaf.file)) continue
      parts.push({ role, pack: c.pack, bank: c.bank, streamId: leaf.file & 0x1fffffff })
    }
  }
  return parts
}

/** Whether a variant is what you hear from your own gun, or what others (and NPCs) sound like. */
export function variantAudience(index: WeaponIndex, variant: WeaponVariant): 'player' | 'others' {
  if (variant.category === 'player') return 'player'
  if (variant.category === 'npc') return 'others'
  const parts = weaponParts(index, variant)
  const player = parts.filter((p) => p.pack === 'weapons_player').length
  return parts.length > 0 && player >= parts.length / 2 ? 'player' : 'others'
}

/** The variant to use for "your gun" and for "others hear". Either may be the same variant. */
export function audienceVariants(index: WeaponIndex, weapon: Weapon): { player?: WeaponVariant; others?: WeaponVariant } {
  const player = weapon.variants.find((v) => variantAudience(index, v) === 'player') ?? weapon.variants[0]
  const others =
    weapon.variants.find((v) => v !== player && variantAudience(index, v) === 'others') ?? weapon.variants.find((v) => v !== player)
  return { player, others }
}

/** Rounds per minute from weapons.meta's TimeBetweenShots. */
export function fireRate(w: Weapon): number | null {
  return w.timeBetweenShots > 0 ? Math.round(60 / w.timeBetweenShots) : null
}

/**
 * With "same sound for everyone", a part picked in one variant (e.g. your gun's gunshot) also
 * covers the parts with the same role in the other variants (how others hear that gunshot).
 */
export function expandToAudiences(
  index: WeaponIndex,
  weapon: Weapon,
  refs: { pack: string; file: string; streamId: number }[]
): WeaponPart[] {
  const key = (p: { pack: string; file?: string; bank?: string; streamId: number }): string => `${p.pack}/${p.bank ?? p.file}:${p.streamId}`
  const wanted = new Set(refs.map(key))
  const roles = new Set<Role>()
  const out = new Map<string, WeaponPart>()
  const partsByVariant = weapon.variants.map((v) => weaponParts(index, v))
  const touched = partsByVariant.map((parts) => parts.some((p) => wanted.has(key(p))))
  partsByVariant.forEach((parts) => {
    for (const part of parts) {
      if (!wanted.has(key(part))) continue
      roles.add(part.role)
      out.set(key(part), part)
    }
  })
  // variants the selection came from keep exactly the selection; the others get the same roles
  partsByVariant.forEach((parts, i) => {
    if (touched[i]) return
    for (const part of parts) if (roles.has(part.role)) out.set(key(part), part)
  })
  return [...out.values()]
}
