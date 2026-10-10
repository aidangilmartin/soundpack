import { useState } from 'react'
import type { BuildResult } from '@core/build'
import { sanitizeResourceName } from '@core/manifest'
import type { Project } from '@core/project'
import type { ExportMode } from '@shared/ipc'
import { fmtBytes } from '../model'

interface Props {
  project: Project
  onChange: (patch: Partial<Project>) => void
  onBuild: () => Promise<BuildResult>
  onSave: (result: BuildResult, mode: ExportMode) => Promise<string | null>
  onClose: () => void
}

export function ExportDialog({ project, onChange, onBuild, onSave, onClose }: Props) {
  const [mode, setMode] = useState<ExportMode>('folder')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BuildResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const build = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      // let the "Building…" state paint before the synchronous work starts
      await new Promise((r) => setTimeout(r, 30))
      setResult(await onBuild())
    } catch (e) {
      setResult(null)
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    if (!result) return
    setBusy(true)
    try {
      const path = await onSave(result, mode)
      if (path) setSaved(path)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const edit = (patch: Partial<Project>): void => {
    setResult(null)
    setSaved(null)
    onChange(patch)
  }

  const total = result?.files.reduce((n, f) => n + f.bytes.byteLength, 0) ?? 0

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Export resource">
      <div className="modal">
        <header>
          <h2>Export FiveM resource</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="grid2">
          <label className="field">
            <span>Resource name</span>
            <input value={project.resourceName} onChange={(e) => edit({ resourceName: e.target.value })} />
            {sanitizeResourceName(project.resourceName) !== project.resourceName && (
              <small className="muted">Folder will be “{sanitizeResourceName(project.resourceName)}”</small>
            )}
          </label>
          <label className="field">
            <span>Author</span>
            <input value={project.author} onChange={(e) => edit({ author: e.target.value })} />
          </label>
          <label className="field">
            <span>Description</span>
            <input value={project.description} onChange={(e) => edit({ description: e.target.value })} />
          </label>
          <label className="field">
            <span>Version</span>
            <input value={project.resourceVersion} onChange={(e) => edit({ resourceVersion: e.target.value })} />
          </label>
        </div>
        <fieldset className="row gap">
          <legend className="small muted">Output</legend>
          <label>
            <input type="radio" checked={mode === 'folder'} onChange={() => setMode('folder')} /> Folder (pick your server's resources
            folder)
          </label>
          <label>
            <input type="radio" checked={mode === 'zip'} onChange={() => setMode('zip')} /> .zip
          </label>
        </fieldset>

        {error && <p className="error">{error}</p>}

        {result && (
          <div className="build-result">
            <p>
              <b>{result.resourceName}</b> · {result.files.length} files · {fmtBytes(total)}
            </p>
            <ul className="small">
              {result.banks.map((b) => (
                <li key={`${b.pack}/${b.file}`} className="mono">
                  audio/sfx/{b.pack}/{b.file} — {b.replaced} replaced{b.silenced ? `, ${b.silenced} silenced` : ''}
                </li>
              ))}
            </ul>
            {result.warnings.length > 0 && (
              <ul className="warnings small">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {saved && (
          <p className="ok">
            Saved to <span className="mono">{saved}</span>.{' '}
            <button className="btn subtle small" onClick={() => void window.api.showInFolder(saved)}>
              Show
            </button>
            <br />
            <span className="small muted">
              Add <span className="mono">ensure {result?.resourceName}</span> to server.cfg and restart. Test with a second player to hear
              other people's shots.
            </span>
          </p>
        )}

        <footer className="row gap end">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          {!result ? (
            <button className="btn primary" onClick={build} disabled={busy}>
              {busy ? 'Building…' : 'Build'}
            </button>
          ) : (
            <button className="btn primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : mode === 'zip' ? 'Save .zip…' : 'Save folder…'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
