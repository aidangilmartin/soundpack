/**
 * Every file a gun uses, under the part of the shot it belongs to, with a short description of what
 * it is: "Variation 2 of 3 (40% of shots)", "Far away", "Left channel"… taken from the sound graph
 * between the weapon setting and the file.
 */

import { hex8 } from './hash'
import { WEAPON_FIELDS } from './fields'
import { orderedRoles, roleLabel, variantAudience, type Role, type SoundNode, type Weapon, type WeaponIndex } from './weapons'

export type HeardBy = 'you' | 'others' | 'everyone'

export interface GunFile {
  pack: string
  bank: string
  streamId: number
  /** What it is, e.g. "Variation 1 of 2 (25% of shots), left channel". */
  text: string
  heardBy: HeardBy
  /** Other parts of this gun that play the same file. */
  alsoRoles: Role[]
}

export interface GunSection {
  role: Role
  label: string
  /** What the part does, in one sentence. */
  meaning: string
  inferred: boolean
  files: GunFile[]
}

const OPS = ['<', '≤', '>', '≥', '=', '≠']

/** A short phrase for the step from `n` to its child in `slot`, or null when the step doesn't change what plays. */
export function shortStep(n: SoundNode, slot: number, nameOf: (hash: number) => string | null): string | null {
  const count = n.children?.filter((c) => c !== 0).length ?? 0
  const c = n.cond ?? {}
  switch (n.type) {
    case 'RandomizedSound': {
      const w = n.weights ?? []
      const sum = w.reduce((a, b) => a + b, 0)
      const share = sum > 0 && w[slot] !== undefined ? ` (${Math.round((w[slot] / sum) * 100)}% of shots)` : ''
      return count > 1 ? `Variation ${slot + 1} of ${count}${share}` : null
    }
    case 'MultitrackSound':
      return count > 1 ? `Layer ${slot + 1} of ${count}, plays together with the others` : null
    case 'CrossfadeSound': {
      const range = c.maxDistance ? ` (${Math.round(c.minDistance ?? 0)}–${Math.round(c.maxDistance)} m)` : ''
      return slot === 0 ? `Close range${range}` : slot === 1 ? `Far away${range}` : null
    }
    case 'CollapsingStereoSound':
      return slot === 0 ? 'Left channel' : slot === 1 ? 'Right channel' : null
    case 'SoundSet': {
      const name = nameOf(c.entries?.[slot] ?? 0)
      return name ? `"${name}" sound` : `Sound ${slot + 1} of ${count} in the set`
    }
    case 'IfSound': {
      const name = nameOf(c.variable ?? 0)
      const cond = name ? `${name} ${OPS[c.conditionType ?? 4] ?? '='} ${c.value ?? 0}` : 'a game condition is met'
      return slot === 0 ? `When ${cond}` : name ? `Otherwise (not ${cond})` : 'When a game condition is not met'
    }
    case 'SwitchSound':
      return `Option ${slot + 1}, picked by the game`
    case 'SequentialSound':
      return count > 1 ? `Part ${slot + 1} of ${count}, in order` : null
    case 'SequentialOverlapSound':
      return count > 1 ? `Part ${slot + 1} of ${count}` : null
    case 'RetriggeredOverlappedSound':
      return ['Start', 'Repeating part', 'End'][slot] ?? null
    case 'OnStopSound':
      return slot === 1 ? 'When the sound stops' : slot === 2 ? 'When it finishes' : null
    case 'WrapperSound':
      return slot === 1 ? 'Fallback' : null
    default:
      return null
  }
}

interface Leaf {
  container: number
  file: number
  steps: string[]
}

/** Every file under a sound with the phrases along its path (each path once, cycles and depth capped). */
function leafPaths(index: WeaponIndex, root: number, nameOf: (h: number) => string | null): Leaf[] {
  const out: Leaf[] = []
  const walk = (h: number, steps: string[], seen: Set<number>): void => {
    if (!h || seen.has(h) || seen.size > 32 || out.length > 256) return
    const n = index.nodes[String(h >>> 0)]
    if (!n) return
    if (n.simple) {
      out.push({ container: n.simple.container >>> 0, file: n.simple.file & 0x1fffffff, steps })
      return
    }
    const next = new Set(seen).add(h)
    ;(n.children ?? []).forEach((c, slot) => {
      const phrase = shortStep(n, slot, nameOf)
      walk(c, phrase ? [...steps, phrase] : steps, next)
    })
  }
  walk(root >>> 0, [], new Set())
  return out
}

const sentence = (parts: string[]): string =>
  parts.map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p.charAt(0).toLowerCase() + p.slice(1))).join(', ')

/**
 * The gun's files grouped by part (gunshot, distant report, echo, reload…), in display order, each
 * with what it is and who hears it. `names` resolves hashes (variable and sound set entry names).
 */
export function gunFiles(index: WeaponIndex, weapon: Weapon, names: Record<string, string> = {}): GunSection[] {
  const nameOf = (h: number): string | null => (h ? (names[String(h >>> 0)] ?? null) : null)
  const sections = new Map<Role, Map<string, GunFile & { texts: Set<string>; audiences: Set<'you' | 'others'> }>>()
  const rolesOfFile = new Map<string, Set<Role>>()
  for (const v of weapon.variants) {
    const audience = variantAudience(index, v) === 'player' ? 'you' : 'others'
    for (const role of orderedRoles(Object.keys(v.roles))) {
      for (const leaf of leafPaths(index, v.roles[role], nameOf)) {
        const c = index.containers[String(leaf.container)]
        if (!c) continue
        const key = `${c.pack}/${c.bank}:${leaf.file}`
        rolesOfFile.set(key, (rolesOfFile.get(key) ?? new Set()).add(role))
        const files = sections.get(role) ?? new Map()
        sections.set(role, files)
        const f = files.get(key) ?? {
          pack: c.pack,
          bank: c.bank,
          streamId: leaf.file,
          text: '',
          heardBy: audience,
          alsoRoles: [],
          texts: new Set<string>(),
          audiences: new Set<'you' | 'others'>()
        }
        f.texts.add(leaf.steps.length ? sentence(leaf.steps) : `The whole ${roleLabel(role).toLowerCase()}`)
        f.audiences.add(audience)
        files.set(key, f)
      }
    }
  }
  return orderedRoles(sections.keys()).map((role) => {
    const info = WEAPON_FIELDS[role] ?? { meaning: '', inferred: true }
    return {
      role,
      label: roleLabel(role),
      meaning: info.meaning,
      inferred: !!info.inferred,
      files: [...sections.get(role)!.entries()].map(([key, f]) => ({
        pack: f.pack,
        bank: f.bank,
        streamId: f.streamId,
        text: [...f.texts].join(' / '),
        heardBy: f.audiences.size > 1 ? 'everyone' : [...f.audiences][0],
        alsoRoles: [...(rolesOfFile.get(key) ?? [])].filter((r) => r !== role)
      }))
    }
  })
}

/** "ptl_pistol · 0x16EF0EA5" */
export function fileLabel(f: Pick<GunFile, 'bank' | 'streamId'>): string {
  return `${f.bank.replace(/\.awc$/, '')} · 0x${hex8(f.streamId)}`
}
