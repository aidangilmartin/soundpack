import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { decodeStreamPcm } from '@core/awc/replace'
import { getFormat } from '@core/awc/types'
import { buildResource, type BuildResult } from '@core/build'
import { DEFAULT_SHAPE, shapeAudio, type ChannelMode, type ShapeSettings } from '@core/dsp'
import {
  addSource,
  assignSource,
  bankKey,
  clearStreams,
  findBank,
  linkPair,
  newProject,
  parseProject,
  serializeProject,
  setChannel,
  silenceStreams,
  unlinkPair,
  updateShape,
  type Project
} from '@core/project'
import type { AudioData } from '@core/wav'
import type { ExportMode, ImportReport, LibraryTemplate, PickedFile } from '@shared/ipc'
import { decodeAudio, player } from './audio'
import { BankView } from './components/BankView'
import { ExportDialog } from './components/ExportDialog'
import { GameDialog } from './components/GameDialog'
import { HelpDialog } from './components/HelpDialog'
import { Inspector } from './components/Inspector'
import { Sidebar } from './components/Sidebar'
import { bankItems, labelKey, loadTemplate, pairsFor, type BankItem, type LoadedTemplate, type SourceEntry } from './model'

type Toast = { kind: 'info' | 'error'; text: string }

const AUDIO_RE = /\.(wav|mp3|ogg|flac|m4a|aac|opus|webm)$/i

export function App() {
  const [library, setLibrary] = useState<LibraryTemplate[]>([])
  const [loaded, setLoaded] = useState<Map<string, LoadedTemplate>>(new Map())
  const [loadErrors, setLoadErrors] = useState<Map<string, string>>(new Map())
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [selection, setSelection] = useState<number[]>([])
  const [focusId, setFocusId] = useState<number | null>(null)
  const [project, setProjectState] = useState<Project>(newProject)
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [sources, setSources] = useState<Map<string, SourceEntry>>(new Map())
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [playing, setPlaying] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [dialog, setDialog] = useState<'export' | 'help' | 'game' | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const notify = useCallback((kind: Toast['kind'], text: string) => {
    setToast({ kind, text })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), kind === 'error' ? 9000 : 4500)
  }, [])

  const setProject = useCallback((fn: (p: Project) => Project) => {
    setProjectState(fn)
    setDirty(true)
  }, [])

  useEffect(() => player.subscribe(setPlaying), [])
  useEffect(() => {
    void window.api.listTemplates().then(setLibrary)
    void window.api.getLabels().then(setLabels)
  }, [])

  const items = useMemo(() => bankItems(library, project), [library, project])
  const activeItem = items.find((i) => i.key === activeKey) ?? null
  const activeTemplate = activeKey ? (loaded.get(activeKey) ?? null) : null
  const activeBank = activeItem ? findBank(project, activeItem.pack, activeItem.file) : undefined

  const ensureLoaded = useCallback(
    async (pack: string, file: string): Promise<LoadedTemplate> => {
      const key = bankKey(pack, file)
      const cached = loaded.get(key)
      if (cached) return cached
      const t = loadTemplate(pack, file, await window.api.readTemplate(pack, file))
      setLoaded((m) => new Map(m).set(key, t))
      return t
    },
    [loaded]
  )

  // load the active bank's template
  useEffect(() => {
    if (!activeItem?.template || loaded.has(activeItem.key) || loadErrors.has(activeItem.key)) return
    ensureLoaded(activeItem.pack, activeItem.file).catch((e: Error) => setLoadErrors((m) => new Map(m).set(activeItem.key, e.message)))
  }, [activeItem, loaded, loadErrors, ensureLoaded])

  const selectBank = (item: BankItem): void => {
    if (item.key !== activeKey) {
      setSelection([])
      setFocusId(null)
    }
    setActiveKey(item.key)
  }

  const refreshLibrary = async (): Promise<LibraryTemplate[]> => {
    const list = await window.api.listTemplates()
    setLibrary(list)
    return list
  }

  const handleReport = async (report: ImportReport): Promise<void> => {
    if (report.imported.length) {
      const keys = report.imported.map((t) => bankKey(t.pack, t.file))
      setLoaded((m) => {
        const next = new Map(m)
        keys.forEach((k) => next.delete(k))
        return next
      })
      setLoadErrors((m) => {
        const next = new Map(m)
        keys.forEach((k) => next.delete(k))
        return next
      })
      await refreshLibrary()
      setActiveKey(keys[0])
      setSelection([])
      setFocusId(null)
    }
    if (report.errors.length) {
      notify('error', report.errors.map((e) => `${e.name}: ${e.message}`).join('\n'))
    } else if (report.imported.length) {
      const extra = report.warnings.length ? ` (${report.warnings.length} warning${report.warnings.length > 1 ? 's' : ''})` : ''
      notify('info', `Imported ${report.imported.map((t) => t.file).join(', ')}${extra}`)
    }
  }

  const importAwc = async (paths?: string[]): Promise<void> => handleReport(await window.api.importAwcFiles(paths))
  const importCodeWalker = async (paths?: string[]): Promise<void> => handleReport(await window.api.importCodeWalkerFolders(paths))

  const addSourceFiles = async (files: PickedFile[]): Promise<SourceEntry[]> => {
    const added: SourceEntry[] = []
    for (const f of files) {
      try {
        const audio = await decodeAudio(f.name, f.bytes)
        const frames = audio.channels[0]?.length ?? 0
        const info = {
          id: crypto.randomUUID(),
          fileName: f.name,
          channels: audio.channels.length,
          sampleRate: audio.sampleRate,
          durationMs: (frames / audio.sampleRate) * 1000
        }
        added.push({ info, bytes: f.bytes, audio })
      } catch (e) {
        notify('error', (e as Error).message)
      }
    }
    if (added.length) {
      setSources((m) => {
        const next = new Map(m)
        added.forEach((s) => next.set(s.info.id, s))
        return next
      })
      setProject((p) => added.reduce((acc, s) => addSource(acc, s.info), p))
    }
    return added
  }

  const pickSources = async (): Promise<SourceEntry[]> => addSourceFiles(await window.api.pickAudioFiles())

  const assign = (sourceId: string, ids: number[], sourceOverride?: SourceEntry): void => {
    if (!activeItem || !activeTemplate) return
    const src = sourceOverride ?? sources.get(sourceId)
    if (!src) return
    const editable = ids.filter((id) => activeTemplate.summaries.find((s) => s.id === id)?.editable)
    if (!editable.length) return notify('error', 'None of the selected streams can be replaced.')
    const pairs = pairsFor(activeTemplate, activeBank)
    // keep the shaping of the focused stream when re-assigning, so tweaks aren't lost
    const prev = activeBank?.assignments.find((a) => a.streamId === focusId && a.action === 'replace')?.shape
    setProject((p) => assignSource(p, activeItem.pack, activeItem.file, editable, src.info, prev ?? DEFAULT_SHAPE, pairs))
  }

  const dropFilesOnStreams = async (files: File[], ids: number[]): Promise<void> => {
    const audio = files.filter((f) => AUDIO_RE.test(f.name))
    if (!audio.length) return notify('error', 'Drop an audio file (WAV, MP3, OGG, FLAC).')
    const picked = await window.api.readFiles(audio.map((f) => window.api.pathForFile(f)))
    const [first] = await addSourceFiles(picked)
    if (first) assign(first.info.id, ids, first)
  }

  const onWindowDrop = async (e: DragEvent): Promise<void> => {
    e.preventDefault()
    const files = [...e.dataTransfer.files]
    const paths = files.map((f) => window.api.pathForFile(f))
    const awc = paths.filter((p) => /\.awc$/i.test(p))
    const xml = paths.filter((p) => /\.xml$/i.test(p))
    const audio = paths.filter((p) => AUDIO_RE.test(p))
    const other = files.filter((f, i) => !awc.includes(paths[i]) && !xml.includes(paths[i]) && !audio.includes(paths[i]) && f.type === '')
    if (awc.length) await importAwc(awc)
    if (xml.length) await importCodeWalker(xml)
    if (other.length) await importCodeWalker(other.map((f) => window.api.pathForFile(f))) // folders
    if (audio.length) {
      const added = await addSourceFiles(await window.api.readFiles(audio))
      if (added.length) notify('info', `Added ${added.map((s) => s.info.fileName).join(', ')}. Select streams and press Assign.`)
    }
  }

  const play = (id: number, which: 'original' | 'new'): void => {
    if (!activeTemplate || !activeItem) return
    const tag = `${which === 'original' ? 'orig' : 'new'}:${activeItem.key}:${id}`
    const stream = activeTemplate.byId.get(id)
    if (!stream) return
    try {
      if (which === 'original') {
        const { pcm, sampleRate } = decodeStreamPcm(stream)
        player.toggle(tag, pcm, sampleRate)
        return
      }
      const a = activeBank?.assignments.find((x) => x.streamId === id)
      const src = a?.sourceId ? sources.get(a.sourceId) : undefined
      const fmt = getFormat(stream)
      if (!a || !src || !fmt) return
      const shaped = shapeAudio(src.audio, a.shape, fmt.sampleRate)
      player.toggle(tag, shaped.pcm, shaped.sampleRate)
    } catch (e) {
      notify('error', (e as Error).message)
    }
  }

  const confirmDiscard = (): boolean => !dirty || window.confirm('Discard unsaved changes to this project?')

  const newProj = (): void => {
    if (!confirmDiscard()) return
    setProjectState(newProject())
    setSources(new Map())
    setProjectPath(null)
    setDirty(false)
    setSelection([])
  }

  const openProj = async (): Promise<void> => {
    if (!confirmDiscard()) return
    try {
      const opened = await window.api.openProject()
      if (!opened) return
      const p = parseProject(opened.json)
      const map = new Map<string, SourceEntry>()
      for (const s of opened.sources) {
        const info = p.sources.find((x) => x.id === s.id)
        if (!info) continue
        try {
          map.set(s.id, { info, bytes: s.bytes, audio: await decodeAudio(s.fileName, s.bytes) })
        } catch (e) {
          notify('error', (e as Error).message)
        }
      }
      setProjectState(p)
      setSources(map)
      setProjectPath(opened.path)
      setDirty(false)
      setSelection([])
      const first = p.banks[0]
      if (first) setActiveKey(bankKey(first.pack, first.file))
      const missing = p.banks.filter((b) => !library.some((t) => bankKey(t.pack, t.file) === bankKey(b.pack, b.file)))
      if (missing.length) notify('error', `Import these templates to edit or export: ${missing.map((b) => b.file).join(', ')}`)
    } catch (e) {
      notify('error', (e as Error).message)
    }
  }

  const saveProj = async (saveAs = false): Promise<void> => {
    try {
      const used = project.sources.filter((s) => sources.has(s.id))
      const path = await window.api.saveProject(
        serializeProject({ ...project, sources: used }),
        used.map((s) => ({ id: s.id, fileName: s.fileName, bytes: sources.get(s.id)!.bytes })),
        saveAs ? null : projectPath
      )
      if (path) {
        setProjectPath(path)
        setDirty(false)
        notify('info', `Saved ${path}`)
      }
    } catch (e) {
      notify('error', (e as Error).message)
    }
  }

  const build = async (): Promise<BuildResult> => {
    const templates = new Map<string, LoadedTemplate['awc']>()
    const names = new Map<string, Record<number, string>>()
    for (const b of project.banks.filter((x) => x.assignments.length)) {
      const t = await ensureLoaded(b.pack, b.file).catch(() => {
        throw new Error(`Import ${b.pack}/${b.file} before exporting.`)
      })
      templates.set(bankKey(b.pack, b.file), t.awc)
      const n: Record<number, string> = { ...t.names }
      for (const a of b.assignments) {
        const l = labels[labelKey(b.pack, b.file, a.streamId)]
        if (l) n[a.streamId] = l
      }
      names.set(bankKey(b.pack, b.file), n)
    }
    const audio = new Map<string, AudioData>([...sources].map(([id, s]) => [id, s.audio]))
    return buildResource({ project, templates, sources: audio, names })
  }

  const saveExport = async (result: BuildResult, mode: ExportMode): Promise<string | null> =>
    window.api.exportResource(result.resourceName, result.files, mode)

  const setLabel = async (id: number, text: string): Promise<void> => {
    if (!activeItem) return
    const key = labelKey(activeItem.pack, activeItem.file, id)
    await window.api.setLabel(key, text || null)
    setLabels(await window.api.getLabels())
  }

  const removeTemplate = async (): Promise<void> => {
    if (!activeItem) return
    if (!window.confirm(`Remove ${activeItem.file} from your template library? Your project keeps its assignments.`)) return
    await window.api.removeTemplate(activeItem.pack, activeItem.file)
    setLoaded((m) => {
      const n = new Map(m)
      n.delete(activeItem.key)
      return n
    })
    await refreshLibrary()
  }

  const changePack = async (pack: string): Promise<void> => {
    if (!activeItem || pack === activeItem.pack) return
    try {
      const t = await window.api.setTemplatePack(activeItem.pack, activeItem.file, pack)
      await refreshLibrary()
      setActiveKey(bankKey(t.pack, t.file))
    } catch (e) {
      notify('error', (e as Error).message)
    }
  }

  const bankOp = (fn: (p: Project, pack: string, file: string) => Project): void => {
    if (!activeItem) return
    setProject((p) => fn(p, activeItem.pack, activeItem.file))
  }

  const projectTitle = projectPath ? projectPath.split(/[\\/]/).pop() : 'Untitled project'
  const changedCount = project.banks.reduce((n, b) => n + b.assignments.length, 0)

  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${projectTitle} — Gun Soundpack Maker`
  }, [dirty, projectTitle])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveProj(e.shiftKey)
      }
      if (e.key === 'Escape') player.stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={(e) => void onWindowDrop(e)}>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◉
          </span>
          Gun Soundpack Maker
        </div>
        <div className="project-name muted">
          {projectTitle}
          {dirty ? ' •' : ''}
        </div>
        <div className="row gap">
          <button className="btn subtle" onClick={newProj}>
            New
          </button>
          <button className="btn subtle" onClick={() => void openProj()}>
            Open…
          </button>
          <button className="btn subtle" onClick={() => void saveProj()} title="Ctrl+S">
            Save
          </button>
          <button className="btn subtle" onClick={() => void saveProj(true)} title="Ctrl+Shift+S">
            Save as…
          </button>
          <button className="btn subtle" onClick={() => setDialog('help')}>
            Help
          </button>
          <button className="btn primary" onClick={() => setDialog('export')} disabled={changedCount === 0}>
            Export{changedCount ? ` (${changedCount})` : ''}
          </button>
        </div>
      </header>

      <main className="workspace">
        <Sidebar
          items={items}
          activeKey={activeKey}
          onSelect={selectBank}
          onExtractFromGame={() => setDialog('game')}
          onImportAwc={() => void importAwc()}
          onImportCodeWalker={() => void importCodeWalker()}
        />
        {activeItem ? (
          <BankView
            item={activeItem}
            template={activeTemplate}
            loadError={loadErrors.get(activeItem.key) ?? null}
            bank={activeBank}
            labels={labels}
            sources={sources}
            selection={selection}
            focusId={focusId}
            playing={playing}
            onSelect={(ids, focus) => {
              setSelection(ids)
              setFocusId(focus)
            }}
            onPlay={play}
            onDropFiles={(files, ids) => void dropFilesOnStreams(files, ids)}
            onExtractFromGame={() => setDialog('game')}
            onImportAwc={() => void importAwc()}
            onImportCodeWalker={() => void importCodeWalker()}
            onRemoveTemplate={() => void removeTemplate()}
            onChangePack={(pack) => void changePack(pack)}
          />
        ) : (
          <section className="bank-view empty-state">
            <h2>Build a gun sound pack</h2>
            <p>
              Pull the original gun sound banks from your GTA V install, replace their sounds with your own, and export a FiveM resource.
            </p>
            <p className="muted small">Exports a server-side FiveM resource — players download the sounds when they join.</p>
            <div className="row gap">
              {library.length === 0 && (
                <button className="btn primary" onClick={() => setDialog('game')}>
                  Extract from GTA V…
                </button>
              )}
              <button className="btn" onClick={() => setDialog('help')}>
                How it works
              </button>
            </div>
          </section>
        )}
        {activeTemplate && activeItem ? (
          <Inspector
            template={activeTemplate}
            bank={activeBank}
            selection={selection}
            focusId={focusId}
            labels={labels}
            sources={sources}
            playing={playing}
            onPlay={play}
            onAssign={(id, ids) => assign(id, ids)}
            onAddSources={pickSources}
            onDropFiles={(files, ids) => void dropFilesOnStreams(files, ids)}
            onSilence={(ids) => bankOp((p, pk, f) => silenceStreams(p, pk, f, ids))}
            onReset={(ids) => bankOp((p, pk, f) => clearStreams(p, pk, f, ids))}
            onShape={(ids, patch: Partial<ShapeSettings>) => bankOp((p, pk, f) => updateShape(p, pk, f, ids, patch))}
            onChannel={(id, ch: ChannelMode) => bankOp((p, pk, f) => setChannel(p, pk, f, id, ch))}
            onLink={(l, r) => bankOp((p, pk, f) => linkPair(p, pk, f, l, r))}
            onUnlink={(id) => bankOp((p, pk, f) => unlinkPair(p, pk, f, id))}
            onLabel={(id, text) => void setLabel(id, text)}
          />
        ) : (
          <aside className="inspector" />
        )}
      </main>

      {toast && (
        <div className={`toast ${toast.kind}`} role="status" onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}

      {dialog === 'export' && (
        <ExportDialog
          project={project}
          onChange={(patch) => setProject((p) => ({ ...p, ...patch }))}
          onBuild={build}
          onSave={saveExport}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      {dialog === 'game' && <GameDialog library={library} onImported={handleReport} onClose={() => setDialog(null)} />}
    </div>
  )
}
