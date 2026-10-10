import { useState } from 'react'
import { prettyType } from '@core/fields'
import type { IdCode } from '@core/idpack'
import { nameOf, type Audience, type SoundMap, type StreamUsage, type UseDescription, type UseRoot } from '@core/usage'

interface Props {
  map: SoundMap
  usage: StreamUsage
  code?: IdCode
  /** Guns the weapon list has, to offer "Open …". */
  weaponNames: Set<string>
  /** The gun already open (no "Open" button for it). */
  currentWeapon?: string | null
  onOpenWeapon: (weapon: string) => void
}

const AUDIENCE: Record<Audience, { label: string; title: string }> = {
  you: { label: 'Your gun', title: 'Heard when you fire (WEAPONS_PLAYER / player variant).' },
  others: { label: 'Others hear', title: 'How other players and NPCs sound (RESIDENT / NPC variant).' },
  anim: { label: 'Animation', title: 'Played by an animation tag (e.g. a reload).' },
  code: { label: 'Code or script', title: 'Nothing in the game data refers to it: the game code or a script plays it by name.' },
  other: { label: 'Game object', title: 'Played by another kind of game object.' }
}

const SHOWN = 8

function rootLine(map: SoundMap, r: UseRoot): string {
  switch (r.kind) {
    case 'game': {
      const type = map.owners[String(r.owner)]?.type ?? 'Missing'
      return `${prettyType(type)} ${nameOf(map, r.owner)} → ${r.field}`
    }
    case 'anim':
      return `Animation ${r.dict} / ${r.clip}, ${nameOf(map, r.tag)} tag at ${Math.round(r.phase * 100)}%`
    case 'soundset':
      return `Sound set ${nameOf(map, r.set)}, entry "${nameOf(map, r.entry)}" (played by name)`
    case 'code':
      return `Played by name by game code or a script`
  }
}

function UseItem({
  map,
  d,
  root,
  weaponNames,
  currentWeapon,
  onOpenWeapon
}: { map: SoundMap; d: UseDescription; root: UseRoot } & Pick<Props, 'weaponNames' | 'currentWeapon' | 'onOpenWeapon'>) {
  const gun = d.weapons.find((w) => weaponNames.has(w.weapon) && w.weapon !== currentWeapon)
  return (
    <li className="use">
      <div className="use-head">
        <span className={`badge aud-${d.audience}`} title={AUDIENCE[d.audience].title}>
          {AUDIENCE[d.audience].label}
        </span>
        <span>
          <b>{d.who}</b> · {d.what}
        </span>
      </div>
      {d.when.length > 0 && <div className="small">{d.when.join(' · ')}</div>}
      {d.meaning && (
        <div className="small muted">
          {d.meaning}
          {d.inferred && (
            <span title="The game data links the sound to this field; when exactly it plays comes from the field's name. The ID pack confirms it in game.">
              {' '}
              (from the field name)
            </span>
          )}
        </div>
      )}
      <details className="use-path">
        <summary className="small muted">Exact path in the game data</summary>
        <ol className="small mono">
          <li>{rootLine(map, root)}</li>
          {d.path.map((p, i) => (
            <li key={i}>
              {p.type} {p.name}
              {p.note ? ` — ${p.note}` : ''}
              {p.detail ? ` (${p.detail})` : ''}
            </li>
          ))}
        </ol>
      </details>
      {gun && (
        <button className="btn subtle small" onClick={() => onOpenWeapon(gun.weapon)}>
          Open {gun.label}
        </button>
      )}
    </li>
  )
}

/** "What it's for": every way the game data plays the selected stream. */
export function UsagePanel({ map, usage, code, weaponNames, currentWeapon, onOpenWeapon }: Props) {
  const [all, setAll] = useState(false)
  const shown = all ? usage.descriptions : usage.descriptions.slice(0, SHOWN)
  return (
    <section className="panel usage">
      <h4>What it's for</h4>
      {code && (
        <p className="small muted">
          ID pack code: <b>“{code.code}”</b>
        </p>
      )}
      {usage.status === 'unused' && (
        <p className="small">Nothing in the game data plays this file. It is probably unused; the ID pack can confirm it.</p>
      )}
      {usage.status === 'unknown' && <p className="small muted">This stream isn't in the sound map. Scan the game again to map it.</p>}
      {shown.length > 0 && (
        <ul className="uses">
          {shown.map((d, i) => (
            <UseItem
              key={i}
              map={map}
              d={d}
              root={usage.uses[usage.descriptions.indexOf(d)].root}
              weaponNames={weaponNames}
              currentWeapon={currentWeapon}
              onOpenWeapon={onOpenWeapon}
            />
          ))}
        </ul>
      )}
      {!all && usage.descriptions.length > SHOWN && (
        <button className="btn subtle small" onClick={() => setAll(true)}>
          Show all {usage.descriptions.length} uses
        </button>
      )}
      {usage.more && (
        <p className="small muted">The game reaches this sound in even more ways; only the first {usage.uses.length} are listed.</p>
      )}
    </section>
  )
}
