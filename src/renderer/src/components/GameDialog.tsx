import { useEffect, useMemo, useState } from 'react'
import { lookupBank } from '@core/catalog'
import { bankKey } from '@core/project'
import type { GameBank, GameSettings, ImportReport, LibraryTemplate } from '@shared/ipc'
import { cleanError, fmtBytes } from '../model'

interface Props {
  library: LibraryTemplate[]
  onImported: (report: ImportReport) => Promise<void>
  onClose: () => void
}

const CODEWALKER_URL = 'https://github.com/dexyfex/CodeWalker'

/** Gun banks are preselected; other resident banks (ambience, vehicles, …) are listed but left off. */
const preselect = (b: GameBank): boolean => b.pack === 'weapons_player' || (b.pack === 'resident' && b.file === 'weapons.awc')

export function GameDialog({ library, onImported, onClose }: Props) {
  const [settings, setSettings] = useState<GameSettings | null>(null)
  const [banks, setBanks] = useState<GameBank[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'list' | 'extract' | null>(null)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<ImportReport | null>(null)

  useEffect(() => {
    void window.api.getGameSettings().then(setSettings)
    return window.api.onGameProgress(setProgress)
  }, [])

  const inLibrary = useMemo(() => new Set(library.map((t) => bankKey(t.pack, t.file))), [library])
  const ready = !!settings?.gtaValid && !!settings.codewalkerValid && settings.bridgeAvailable

  const choose = async (kind: 'gta' | 'codewalker'): Promise<void> => {
    setError(null)
    try {
      setSettings(await window.api.setGamePath(kind))
      setBanks(null)
    } catch (e) {
      setError(cleanError(e))
    }
  }

  const find = async (): Promise<void> => {
    setBusy('list')
    setError(null)
    setDone(null)
    setProgress('')
    try {
      const r = await window.api.listGameBanks()
      setBanks(r.banks)
      setSelected(new Set(r.banks.filter(preselect).map((b) => bankKey(b.pack, b.file))))
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(null)
    }
  }

  const extract = async (): Promise<void> => {
    setBusy('extract')
    setError(null)
    setProgress('')
    try {
      const report = await window.api.extractGameBanks([...selected])
      setDone(report)
      await onImported(report)
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(null)
    }
  }

  const toggle = (key: string): void =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const groups = banks
    ? (['weapons_player', 'resident'] as const).map((pack) => ({ pack, items: banks.filter((b) => b.pack === pack) }))
    : []

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Extract from GTA V">
      <div className="modal wide">
        <header>
          <h2>Extract from GTA V</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <p className="muted small">
          Reads the original gun sound banks straight from your game with CodeWalker and adds them to your library. Nothing is changed in
          your game folder.
        </p>

        {settings && !settings.bridgeAvailable && (
          <p className="error">
            The CodeWalker bridge isn't built. Run <span className="mono">npm run build:bridge</span> (needs the .NET 8 SDK), then restart
            the app.
          </p>
        )}

        <div className="path-row">
          <div>
            <span className="field-title">GTA V folder</span>
            <span className="mono small path">{settings?.gtaPath ?? 'Not found'}</span>
            {settings && (
              <span className={settings.gtaValid ? 'ok small' : 'error small'}>
                {settings.gtaValid ? '✓ gta5.exe found' : '✕ choose the folder with gta5.exe'}
              </span>
            )}
          </div>
          <button className="btn" onClick={() => void choose('gta')} disabled={!!busy}>
            Browse…
          </button>
        </div>
        <div className="path-row">
          <div>
            <span className="field-title">CodeWalker folder</span>
            <span className="mono small path">{settings?.codewalkerPath ?? 'Not set'}</span>
            {settings && (
              <span className={settings.codewalkerValid ? 'ok small' : 'error small'}>
                {settings.codewalkerValid
                  ? settings.codewalkerIsDevBuild
                    ? '✓ using the development build from npm run build:bridge'
                    : '✓ CodeWalker.Core.dll found'
                  : '✕ choose the folder you extracted CodeWalker into'}
              </span>
            )}
            <span className="muted small">
              Don't have it?{' '}
              <a
                href={CODEWALKER_URL}
                onClick={(e) => {
                  e.preventDefault()
                  void window.api.openExternal(CODEWALKER_URL)
                }}
              >
                Download CodeWalker
              </a>{' '}
              — the app uses its library to decrypt the game files.
            </span>
          </div>
          <button className="btn" onClick={() => void choose('codewalker')} disabled={!!busy}>
            Browse…
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        {banks && (
          <div className="game-banks">
            <div className="row gap small">
              <span>
                {selected.size} of {banks.length} selected
              </span>
              <button
                className="btn subtle small"
                onClick={() => setSelected(new Set(banks.filter(preselect).map((b) => bankKey(b.pack, b.file))))}
              >
                Gun banks
              </button>
              <button className="btn subtle small" onClick={() => setSelected(new Set())}>
                None
              </button>
            </div>
            {groups.map(
              (g) =>
                g.items.length > 0 && (
                  <section key={g.pack}>
                    <h4>
                      {g.pack === 'weapons_player'
                        ? 'Your gun (weapons_player)'
                        : 'Shared banks (resident) — weapons.awc is how others hear you'}
                    </h4>
                    <ul>
                      {g.items.map((b) => {
                        const key = bankKey(b.pack, b.file)
                        const info = lookupBank(b.file, b.pack)
                        return (
                          <li key={key}>
                            <label>
                              <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} />
                              <span>{info?.label ?? b.file.replace(/\.awc$/, '')}</span>
                              <span className="mono muted small">{b.file}</span>
                              <span className="muted small">{fmtBytes(b.size)}</span>
                              {inLibrary.has(key) && <span className="badge">in library</span>}
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )
            )}
          </div>
        )}

        {done && (
          <p className={done.errors.length ? 'error' : 'ok'}>
            Extracted {done.imported.length} bank{done.imported.length === 1 ? '' : 's'}.
            {done.errors.length > 0 && ` ${done.errors.length} failed: ${done.errors.map((e) => `${e.name} (${e.message})`).join('; ')}`}
          </p>
        )}

        <footer className="row gap end">
          {busy && <span className="muted small grow">{progress || 'Working…'}</span>}
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className={`btn${banks ? '' : ' primary'}`} onClick={() => void find()} disabled={!ready || !!busy}>
            {busy === 'list' ? 'Reading game files…' : banks ? 'Refresh list' : 'Find gun banks'}
          </button>
          {banks && (
            <button className="btn primary" onClick={() => void extract()} disabled={!selected.size || !!busy}>
              {busy === 'extract' ? 'Extracting…' : `Extract ${selected.size} bank${selected.size === 1 ? '' : 's'}`}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
