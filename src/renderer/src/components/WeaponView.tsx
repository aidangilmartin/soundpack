import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { decodeStreamPcm } from '@core/awc/replace'
import { getFormat } from '@core/awc/types'
import { shapeAudio } from '@core/dsp'
import { hex8 } from '@core/hash'
import { bankKey, findAssignment, type Project, type StreamRef } from '@core/project'
import { DEFAULT_SHOT_ROLES, newPlanState, planBurst, planShot, seededRng, SUPPRESSED_SHOT_ROLES, type Voice } from '@core/soundgraph'
import {
  audienceVariants,
  fireRate,
  GROUP_LABELS,
  ROLE_LABELS,
  ROLE_ORDER,
  weaponLabel,
  weaponParts,
  type Role,
  type Weapon,
  type WeaponIndex,
  type WeaponPart
} from '@core/weapons'
import { player } from '../audio'
import { fmtDuration, refKey, streamName, type LoadedTemplate, type SourceEntry } from '../model'
import { mixdown, renderPreview, toFloat, type Environment, type ResolvedWave } from '../preview'
import { Waveform } from './Waveform'

interface Props {
  index: WeaponIndex
  weapon: Weapon
  templates: Map<string, LoadedTemplate>
  ensureBank: (pack: string, bank: string) => void
  project: Project
  sources: Map<string, SourceEntry>
  labels: Record<string, string>
  selection: StreamRef[]
  focus: StreamRef | null
  playing: string | null
  sameForEveryone: boolean
  onSameForEveryone: (v: boolean) => void
  onSelect: (refs: StreamRef[], focus: StreamRef | null) => void
  onPlayPart: (ref: StreamRef, which: 'original' | 'new') => void
  onDropFiles: (files: File[], refs: StreamRef[]) => void
  onError: (message: string) => void
}

type Audience = 'player' | 'others'

const toRef = (p: WeaponPart): StreamRef => ({ pack: p.pack, file: p.bank, streamId: p.streamId })

export function WeaponView(props: Props) {
  const { index, weapon, templates, project, sources, labels, selection, focus, playing } = props
  const [audience, setAudience] = useState<Audience>('player')
  const [env, setEnv] = useState<Environment>('outdoor')
  const [burst, setBurst] = useState(false)
  const [suppressed, setSuppressed] = useState(false)
  const [seed, setSeed] = useState(1)
  const [busy, setBusy] = useState<string | null>(null)
  const [last, setLast] = useState<{ which: 'original' | 'yours'; samples: Float32Array; approximations: string[] } | null>(null)
  const [dropRole, setDropRole] = useState<string | null>(null)
  const originals = useRef(new Map<string, ResolvedWave>())
  const shaped = useRef(new Map<string, ResolvedWave>())

  const variants = useMemo(() => audienceVariants(index, weapon), [index, weapon])
  const variant = audience === 'others' && variants.others ? variants.others : variants.player
  const parts = useMemo(() => (variant ? weaponParts(index, variant) : []), [index, variant])
  const hasSuppressed = !!variant?.roles.suppressed

  useEffect(() => {
    setLast(null)
    setSuppressed(false)
    setAudience('player')
  }, [weapon.name])

  // load every bank this weapon uses (both audiences)
  useEffect(() => {
    const banks = new Set<string>()
    for (const v of weapon.variants) for (const p of weaponParts(index, v)) banks.add(`${p.pack}\n${p.bank}`)
    for (const b of banks) {
      const [pack, bank] = b.split('\n')
      props.ensureBank(pack, bank)
    }
  }, [index, weapon])

  const byRole = useMemo(() => {
    const m = new Map<Role, WeaponPart[]>()
    for (const p of parts) m.set(p.role, [...(m.get(p.role) ?? []), p])
    return ROLE_ORDER.filter((r) => m.has(r)).map((r) => ({ role: r, parts: m.get(r)! }))
  }, [parts])
  const ordered = byRole.flatMap((g) => g.parts.map(toRef))
  // the game sometimes reuses one wave in several parts; replacing it changes all of them
  const rolesOf = useMemo(() => {
    const m = new Map<string, Role[]>()
    for (const p of parts) m.set(refKey(toRef(p)), [...(m.get(refKey(toRef(p))) ?? []), p.role])
    return m
  }, [parts])
  const selected = new Set(selection.map(refKey))

  const resolve =
    (which: 'original' | 'yours') =>
    (v: Voice): ResolvedWave | null => {
      const c = index.containers[String(v.container)]
      if (!c) return null
      const ref = { pack: c.pack, file: c.bank, streamId: v.file }
      const t = templates.get(bankKey(c.pack, c.bank))
      const stream = t?.byId.get(v.file)
      const fmt = stream ? getFormat(stream) : undefined
      if (!stream || !fmt) return null
      if (which === 'yours') {
        const a = findAssignment(project, ref)
        if (a?.action === 'silence') return null
        const src = a?.action === 'replace' && a.sourceId ? sources.get(a.sourceId) : undefined
        if (a && src) {
          const key = `${refKey(ref)}|${a.sourceId}|${JSON.stringify(a.shape)}|${fmt.sampleRate}`
          let w = shaped.current.get(key)
          if (!w) {
            const s = shapeAudio(src.audio, a.shape, fmt.sampleRate)
            const headroom = a.shape.headroom === 'template' ? fmt.headroom : a.shape.headroom
            w = { samples: toFloat(s.pcm), sampleRate: s.sampleRate, gainDb: -headroom / 100 }
            shaped.current.set(key, w)
          }
          return w
        }
      }
      let w = originals.current.get(refKey(ref))
      if (!w) {
        const { pcm, sampleRate } = decodeStreamPcm(stream)
        w = { samples: toFloat(pcm), sampleRate, gainDb: -fmt.headroom / 100 }
        originals.current.set(refKey(ref), w)
      }
      return w
    }

  const preview = async (which: 'original' | 'yours'): Promise<void> => {
    if (!variant) return
    const tag = `preview:${weapon.name}:${which}`
    if (playing === tag) return player.stop()
    setBusy(which)
    try {
      // the same seed for both, so original and yours pick the same random variations
      const state = newPlanState(seededRng(seed))
      const roles = suppressed ? SUPPRESSED_SHOT_ROLES : DEFAULT_SHOT_ROLES
      const voices = burst
        ? planBurst(index, variant, state, 5, weapon.timeBetweenShots, roles)
        : planShot(index, variant, state, { roles })
      const buffer = await renderPreview(voices, resolve(which), env)
      if (!buffer) {
        props.onError(
          which === 'yours' ? 'Everything in this shot is silenced.' : "This gun's sound banks aren't in your library. Scan the game again."
        )
        return
      }
      player.playBuffer(tag, buffer)
      setLast({ which, samples: mixdown(buffer), approximations: [...state.approximations] })
    } catch (e) {
      props.onError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const click = (e: MouseEvent, ref: StreamRef): void => {
    const k = refKey(ref)
    if (e.shiftKey && focus) {
      const a = ordered.findIndex((r) => refKey(r) === refKey(focus))
      const b = ordered.findIndex((r) => refKey(r) === k)
      if (a >= 0 && b >= 0) return props.onSelect(ordered.slice(Math.min(a, b), Math.max(a, b) + 1), focus)
    }
    if (e.ctrlKey || e.metaKey) {
      return props.onSelect(selected.has(k) ? selection.filter((r) => refKey(r) !== k) : [...selection, ref], ref)
    }
    props.onSelect([ref], ref)
  }

  const drop = (e: DragEvent, refs: StreamRef[]): void => {
    e.preventDefault()
    e.stopPropagation()
    setDropRole(null)
    const files = [...e.dataTransfer.files]
    if (files.length) props.onDropFiles(files, refs)
  }

  const rpm = fireRate(weapon)
  const changedHere = parts.filter((p) => findAssignment(project, toRef(p))).length

  return (
    <section className="bank-view weapon-view">
      <header className="bank-header">
        <div>
          <h2>{weaponLabel(weapon)}</h2>
          <p className="muted small">
            {GROUP_LABELS[weapon.group] ?? weapon.group} · <span className="mono">{weapon.name}</span>
            {rpm ? ` · ${rpm} rounds/min` : ''} · {parts.length} sound parts{changedHere ? ` · ${changedHere} changed` : ''}
          </p>
        </div>
        {variants.others && (
          <div className="segmented" role="tablist" aria-label="Whose gunshot">
            <button
              role="tab"
              aria-selected={audience === 'player'}
              className={audience === 'player' ? 'on' : ''}
              onClick={() => setAudience('player')}
            >
              Your gun
            </button>
            <button
              role="tab"
              aria-selected={audience === 'others'}
              className={audience === 'others' ? 'on' : ''}
              onClick={() => setAudience('others')}
            >
              Others hear
            </button>
          </div>
        )}
      </header>

      <div className="preview-bar">
        <div className="row gap">
          <button
            className={`btn${playing === `preview:${weapon.name}:original` ? ' playing' : ''}`}
            onClick={() => void preview('original')}
            disabled={!!busy}
          >
            {busy === 'original' ? 'Rendering…' : '▶ Original'}
          </button>
          <button
            className={`btn primary${playing === `preview:${weapon.name}:yours` ? ' playing' : ''}`}
            onClick={() => void preview('yours')}
            disabled={!!busy}
          >
            {busy === 'yours' ? 'Rendering…' : '▶ Yours'}
          </button>
          <button className="btn subtle" onClick={() => setSeed((s) => s + 1)} title="Pick a different set of the game's random variations">
            🎲 Variation
          </button>
          <span className="segmented small" role="radiogroup" aria-label="Shots">
            <button className={!burst ? 'on' : ''} onClick={() => setBurst(false)} aria-pressed={!burst}>
              Single
            </button>
            <button className={burst ? 'on' : ''} onClick={() => setBurst(true)} aria-pressed={burst}>
              Burst ×5
            </button>
          </span>
          <label className="small">
            <select value={env} onChange={(e) => setEnv(e.target.value as Environment)} aria-label="Environment">
              <option value="outdoor">Outdoors</option>
              <option value="indoor">Indoors</option>
              <option value="dry">Dry (no environment)</option>
            </select>
          </label>
          {hasSuppressed && (
            <label className="small row gap">
              <input type="checkbox" checked={suppressed} onChange={(e) => setSuppressed(e.target.checked)} /> Suppressor
            </label>
          )}
        </div>
        {last && (
          <Waveform
            samples={last.samples}
            tone={last.which === 'yours' ? 'new' : 'original'}
            label={last.which === 'yours' ? 'Yours' : 'Original'}
            height={56}
          />
        )}
        <p className="muted small">
          Layers, random variations, levels, pitch, delays and filters come from the game's own sound data
          {burst && rpm ? `, at ${rpm} rounds/min` : ''}. The environment is an approximation of the game's reverb.
          {last && last.approximations.length > 0 && ` Approximated: ${last.approximations.join(', ')}.`}
        </p>
      </div>

      <div className="toolbar">
        <label className="small row gap">
          <input type="checkbox" checked={props.sameForEveryone} onChange={(e) => props.onSameForEveryone(e.target.checked)} />
          Same sound for everyone (also replace the matching part of {audience === 'player' ? 'what others hear' : 'your own gun'})
        </label>
      </div>

      <div className="table-wrap">
        {byRole.length === 0 && (
          <p className="muted pad">No sounds for this gun were found in your library. Try scanning the game again.</p>
        )}
        {byRole.map(({ role, parts: rp }) => {
          const refs = rp.map(toRef)
          return (
            <section
              key={role}
              className={`role-group${dropRole === role ? ' drop' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDropRole(role)
              }}
              onDragLeave={() => setDropRole((r) => (r === role ? null : r))}
              onDrop={(e) => drop(e, refs)}
            >
              <div className="role-header">
                <h3>{ROLE_LABELS[role]}</h3>
                <span className="muted small">
                  {rp.length} {rp.length === 1 ? 'sound' : 'sounds'}
                  {rp.length > 1 && role !== 'shellCasing' ? ' · the game layers and randomizes these' : ''}
                </span>
                <button className="btn subtle small" onClick={() => props.onSelect(refs, refs[0])}>
                  Select all
                </button>
              </div>
              <table className="streams">
                <tbody>
                  {rp.map((p) => {
                    const ref = toRef(p)
                    const k = refKey(ref)
                    const t = templates.get(bankKey(p.pack, p.bank))
                    const summary = t?.summaries.find((s) => s.id === p.streamId)
                    const a = findAssignment(project, ref)
                    const src = a?.sourceId ? sources.get(a.sourceId) : undefined
                    const tagOrig = `orig:${bankKey(p.pack, p.bank)}:${p.streamId}`
                    const tagNew = `new:${bankKey(p.pack, p.bank)}:${p.streamId}`
                    return (
                      <tr
                        key={k}
                        className={`${selected.has(k) ? 'selected' : ''}${focus && refKey(focus) === k ? ' focus' : ''}`}
                        onClick={(e) => click(e, ref)}
                        onDoubleClick={() => props.onPlayPart(ref, 'original')}
                        onDrop={(e) => drop(e, selected.has(k) ? selection : [ref])}
                      >
                        <td className="col-play">
                          <button
                            className={`icon-btn${playing === tagOrig ? ' playing' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              props.onPlayPart(ref, 'original')
                            }}
                            aria-label="Play original"
                            disabled={!summary}
                          >
                            {playing === tagOrig ? '■' : '▶'}
                          </button>
                        </td>
                        <td className="name-cell">
                          {t ? streamName(t, p.streamId, labels) : `0x${hex8(p.streamId)}`}
                          {(rolesOf.get(k)?.length ?? 0) > 1 && (
                            <span
                              className="badge"
                              title={`The game also uses this sound for: ${rolesOf
                                .get(k)!
                                .filter((r) => r !== role)
                                .map((r) => ROLE_LABELS[r])
                                .join(', ')}`}
                            >
                              shared
                            </span>
                          )}
                        </td>
                        <td className="muted small mono">
                          {p.pack}/{p.bank.replace(/\.awc$/, '')}
                        </td>
                        <td className="col-num">{summary ? fmtDuration(summary.duration) : t ? '—' : '…'}</td>
                        <td>
                          <div className="status-cell">
                            {!t && <span className="badge warn">bank not loaded</span>}
                            {a?.action === 'silence' && <span className="badge warn">Silenced</span>}
                            {a?.action === 'replace' && (
                              <>
                                <button
                                  className={`icon-btn small${playing === tagNew ? ' playing' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    props.onPlayPart(ref, 'new')
                                  }}
                                  aria-label="Play replacement"
                                >
                                  {playing === tagNew ? '■' : '▶'}
                                </button>
                                <span className="badge accent" title={src?.info.fileName}>
                                  {src?.info.fileName ?? 'missing audio'}
                                  {a.shape.channel !== 'mix' ? ` (${a.shape.channel === 'left' ? 'L' : 'R'})` : ''}
                                </span>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          )
        })}
      </div>
    </section>
  )
}
