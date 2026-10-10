import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { decodeStreamPcm } from '@core/awc/replace'
import { getFormat } from '@core/awc/types'
import { ChannelMode, shapeAudio, ShapeSettings } from '@core/dsp'
import { hex8 } from '@core/hash'
import { pairOf } from '@core/pairs'
import { bankKey, type ProjectBank } from '@core/project'
import { assignmentMap, fmtDuration, labelKey, LoadedTemplate, pairsFor, SourceEntry, streamName } from '../model'
import { Waveform } from './Waveform'

interface Props {
  template: LoadedTemplate
  bank: ProjectBank | undefined
  selection: number[]
  focusId: number | null
  labels: Record<string, string>
  sources: Map<string, SourceEntry>
  playing: string | null
  onPlay: (id: number, which: 'original' | 'new') => void
  onAssign: (sourceId: string, ids: number[]) => void
  onAddSources: () => Promise<SourceEntry[]>
  onDropFiles: (files: File[], ids: number[]) => void
  onSilence: (ids: number[]) => void
  onReset: (ids: number[]) => void
  onShape: (ids: number[], patch: Partial<ShapeSettings>) => void
  onChannel: (id: number, channel: ChannelMode) => void
  onLink: (left: number, right: number) => void
  onUnlink: (id: number) => void
  onLabel: (id: number, label: string) => void
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field" title={hint}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function NumberInput(props: {
  value: number
  min?: number
  max?: number
  step?: number
  unit?: string
  onChange: (v: number) => void
  label: string
}) {
  const [text, setText] = useState(String(props.value))
  useEffect(() => setText(String(props.value)), [props.value])
  const commit = (): void => {
    const v = Number(text)
    if (!Number.isFinite(v)) return setText(String(props.value))
    const clamped = Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, v))
    setText(String(clamped))
    if (clamped !== props.value) props.onChange(clamped)
  }
  return (
    <span className="num-input">
      <input
        type="number"
        value={text}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        aria-label={props.label}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      {props.unit && <span className="unit">{props.unit}</span>}
    </span>
  )
}

export function Inspector(props: Props) {
  const { template, bank, selection, focusId, sources, playing } = props
  const [sourceId, setSourceId] = useState<string>('')
  const [dragging, setDragging] = useState(false)
  const assignments = useMemo(() => assignmentMap(bank), [bank])
  const pairs = useMemo(() => pairsFor(template, bank), [template, bank])
  const sourceList = [...sources.values()]

  useEffect(() => {
    if (sources.has(sourceId)) return
    const last = [...sources.values()].pop()
    setSourceId(last ? last.info.id : '')
  }, [sources, sourceId])

  const focus = focusId !== null && selection.includes(focusId) ? focusId : (selection[0] ?? null)
  const stream = focus !== null ? template.byId.get(focus) : undefined
  const fmt = stream ? getFormat(stream) : undefined
  const assignment = focus !== null ? assignments.get(focus) : undefined
  const replaceSel = selection.filter((id) => assignments.get(id)?.action === 'replace')
  const shapeOwner = assignment?.action === 'replace' ? assignment : replaceSel.length ? assignments.get(replaceSel[0]) : undefined
  const shape = shapeOwner?.shape

  const original = useMemo(() => {
    if (!stream || selection.length !== 1) return null
    try {
      return decodeStreamPcm(stream)
    } catch {
      return null
    }
  }, [stream, selection.length])

  const preview = useMemo(() => {
    if (selection.length !== 1 || !assignment || assignment.action !== 'replace' || !fmt) return null
    const src = assignment.sourceId ? sources.get(assignment.sourceId) : undefined
    if (!src) return null
    try {
      return shapeAudio(src.audio, assignment.shape, fmt.sampleRate)
    } catch (e) {
      return { error: (e as Error).message }
    }
  }, [assignment, fmt, sources, selection.length])

  if (selection.length === 0) {
    return (
      <aside className="inspector">
        <div className="inspector-empty muted">
          <p>Select one or more streams to replace them.</p>
          <p className="small">
            Tip: sort by “longest” — gunshot bodies and tails are usually the longest streams. Press Space to audition.
          </p>
        </div>
      </aside>
    )
  }

  const pair = focus !== null ? pairOf(pairs, focus) : undefined
  const manualPair = focus !== null && bank?.manualPairs.some((p) => p.left === focus || p.right === focus)
  const name = focus !== null ? streamName(template, focus, props.labels) : ''
  const label = focus !== null ? (props.labels[labelKey(template.pack, template.file, focus)] ?? '') : ''
  const src = assignment?.sourceId ? sources.get(assignment.sourceId) : undefined

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    const files = [...e.dataTransfer.files]
    if (files.length) props.onDropFiles(files, selection)
  }

  const set = (patch: Partial<ShapeSettings>): void => props.onShape(replaceSel, patch)

  return (
    <aside className="inspector">
      <section className="panel">
        {selection.length === 1 && focus !== null ? (
          <>
            <h3 title={`0x${hex8(focus)}`}>{name}</h3>
            <Field label="Label" hint="Your own name for this stream, saved on this computer">
              <input
                key={focus}
                defaultValue={label}
                placeholder={template.names[focus] ?? 'e.g. shot close 1'}
                onBlur={(e) => e.target.value !== label && props.onLabel(focus, e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </Field>
            {fmt && (
              <p className="muted small">
                {fmtDuration(fmt.samples / fmt.sampleRate)} · {fmt.sampleRate} Hz · {fmt.codec === 4 ? 'ADPCM' : 'PCM'} · headroom{' '}
                {fmt.headroom}
              </p>
            )}
            <div className="wave-row">
              <button
                className={`icon-btn${playing === `orig:${bankKey(template.pack, template.file)}:${focus}` ? ' playing' : ''}`}
                onClick={() => props.onPlay(focus, 'original')}
                aria-label="Play original"
              >
                {playing === `orig:${bankKey(template.pack, template.file)}:${focus}` ? '■' : '▶'}
              </button>
              <Waveform samples={original?.pcm ?? null} label="Original" />
            </div>
          </>
        ) : (
          <h3>{selection.length} streams selected</h3>
        )}
      </section>

      <section
        className={`panel drop-zone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <h4>Replace with</h4>
        <div className="row gap">
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} aria-label="Sound to assign" disabled={!sourceList.length}>
            {!sourceList.length && <option value="">No sounds added yet</option>}
            {sourceList.map((s) => (
              <option key={s.info.id} value={s.info.id}>
                {s.info.fileName} ({s.info.channels === 1 ? 'mono' : 'stereo'}, {fmtDuration(s.info.durationMs / 1000)})
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={!sourceId} onClick={() => props.onAssign(sourceId, selection)}>
            Assign{selection.length > 1 ? ` to ${selection.length}` : ''}
          </button>
        </div>
        <div className="row gap">
          <button
            className="btn"
            onClick={async () => {
              const added = await props.onAddSources()
              if (added.length) setSourceId(added[added.length - 1].info.id)
            }}
          >
            Add sound…
          </button>
          <button className="btn" onClick={() => props.onSilence(selection)} title="Replace with a tiny silent sound">
            Silence
          </button>
          <button className="btn subtle" onClick={() => props.onReset(selection)} disabled={!selection.some((id) => assignments.has(id))}>
            Reset to original
          </button>
        </div>
        <p className="muted small">Or drop an audio file here (WAV, MP3, OGG, FLAC). Stereo files fill L/R pairs automatically.</p>
      </section>

      {shape && (
        <section className="panel">
          <h4>Shaping{replaceSel.length > 1 ? ` · ${replaceSel.length} streams` : ''}</h4>
          {selection.length === 1 && src && src.info.channels > 1 && !pair && (
            <Field label="Channel">
              <select value={shape.channel} onChange={(e) => props.onChannel(focus!, e.target.value as ChannelMode)}>
                <option value="mix">Mix to mono</option>
                <option value="left">Left only</option>
                <option value="right">Right only</option>
              </select>
            </Field>
          )}
          <div className="grid2">
            <Field label="Trim silence" hint="Start the sound at its first loud sample so shots fire instantly">
              <span className="row gap">
                <input
                  type="checkbox"
                  checked={shape.trimSilence}
                  onChange={(e) => set({ trimSilence: e.target.checked })}
                  aria-label="Trim leading silence"
                />
                <NumberInput
                  label="Trim threshold"
                  value={shape.trimThresholdDb}
                  min={-90}
                  max={0}
                  unit="dB"
                  onChange={(v) => set({ trimThresholdDb: v })}
                />
              </span>
            </Field>
            <Field label="Start offset">
              <NumberInput
                label="Start offset"
                value={shape.startOffsetMs}
                min={0}
                max={10000}
                unit="ms"
                onChange={(v) => set({ startOffsetMs: v })}
              />
            </Field>
            <Field label="Max length" hint="0 keeps the full sound">
              <NumberInput
                label="Max length"
                value={shape.maxLengthMs}
                min={0}
                max={30000}
                step={10}
                unit="ms"
                onChange={(v) => set({ maxLengthMs: v })}
              />
            </Field>
            <Field label="Fade in">
              <NumberInput label="Fade in" value={shape.fadeInMs} min={0} max={5000} unit="ms" onChange={(v) => set({ fadeInMs: v })} />
            </Field>
            <Field label="Fade out">
              <NumberInput label="Fade out" value={shape.fadeOutMs} min={0} max={10000} unit="ms" onChange={(v) => set({ fadeOutMs: v })} />
            </Field>
            <Field label="Normalize" hint="Scale so the loudest peak hits this level">
              <span className="row gap">
                <input
                  type="checkbox"
                  checked={shape.normalize}
                  onChange={(e) => set({ normalize: e.target.checked })}
                  aria-label="Normalize"
                />
                <NumberInput
                  label="Normalize level"
                  value={shape.normalizeDb}
                  min={-40}
                  max={0}
                  step={0.5}
                  unit="dB"
                  onChange={(v) => set({ normalizeDb: v })}
                />
              </span>
            </Field>
            <Field label="Gain">
              <NumberInput label="Gain" value={shape.gainDb} min={-40} max={24} step={0.5} unit="dB" onChange={(v) => set({ gainDb: v })} />
            </Field>
            <Field label="Sample rate" hint="'Original' keeps the rate of the sound being replaced">
              <select
                value={String(shape.sampleRate)}
                onChange={(e) => set({ sampleRate: e.target.value === 'template' ? 'template' : Number(e.target.value) })}
              >
                <option value="template">Original{fmt && selection.length === 1 ? ` (${fmt.sampleRate} Hz)` : ''}</option>
                <option value="32000">32000 Hz</option>
                <option value="44100">44100 Hz</option>
                <option value="48000">48000 Hz</option>
              </select>
            </Field>
            <Field
              label="Headroom"
              hint="Per-wave level value stored by the game (millibels). 'Original' keeps the replaced sound's value."
            >
              <span className="row gap">
                <select
                  value={shape.headroom === 'template' ? 'template' : 'custom'}
                  onChange={(e) => set({ headroom: e.target.value === 'template' ? 'template' : (fmt?.headroom ?? 0) })}
                >
                  <option value="template">Original</option>
                  <option value="custom">Custom</option>
                </select>
                {shape.headroom !== 'template' && (
                  <NumberInput
                    label="Headroom"
                    value={shape.headroom}
                    min={-2000}
                    max={2000}
                    step={10}
                    unit="mB"
                    onChange={(v) => set({ headroom: v })}
                  />
                )}
              </span>
            </Field>
          </div>
        </section>
      )}

      {preview && focus !== null && (
        <section className="panel">
          <h4>Result</h4>
          {'error' in preview ? (
            <p className="error">{preview.error}</p>
          ) : (
            <>
              <div className="wave-row">
                <button
                  className={`icon-btn${playing === `new:${bankKey(template.pack, template.file)}:${focus}` ? ' playing' : ''}`}
                  onClick={() => props.onPlay(focus, 'new')}
                  aria-label="Play result"
                >
                  {playing === `new:${bankKey(template.pack, template.file)}:${focus}` ? '■' : '▶'}
                </button>
                <Waveform samples={preview.pcm} tone="new" label="New" />
              </div>
              <p className="muted small">
                {fmtDuration(preview.durationMs / 1000)} · {preview.sampleRate} Hz · peak {preview.peakDb.toFixed(1)} dBFS
                {preview.clipped > 0 && <span className="error"> · clips on {preview.clipped} samples</span>}
              </p>
            </>
          )}
        </section>
      )}

      <section className="panel">
        <h4>Stereo pair</h4>
        {pair ? (
          <p className="small">
            {pair.side === 'left' ? 'Left' : 'Right'} side of a pair with{' '}
            <b>{streamName(template, pair.side === 'left' ? pair.pair.right : pair.pair.left, props.labels)}</b>.
            {manualPair && (
              <button className="btn subtle small" onClick={() => props.onUnlink(focus!)}>
                Unlink
              </button>
            )}
          </p>
        ) : selection.length === 2 ? (
          <button className="btn" onClick={() => props.onLink(selection[0], selection[1])}>
            Link as L/R pair ({streamName(template, selection[0], props.labels)} = left)
          </button>
        ) : (
          <p className="muted small">Select two streams to link them as a left/right pair.</p>
        )}
      </section>
    </aside>
  )
}
