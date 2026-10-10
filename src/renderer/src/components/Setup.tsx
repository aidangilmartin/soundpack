import { useEffect, useState } from 'react'
import type { GameSettings, ScanReport } from '@shared/ipc'
import { cleanError } from '../model'

interface Props {
  /** "welcome" fills the window on first launch; "rescan" is a dialog. */
  mode: 'welcome' | 'rescan'
  onDone: (report: ScanReport) => void
  onClose?: () => void
}

export function Setup({ mode, onDone, onClose }: Props) {
  const [settings, setSettings] = useState<GameSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.getGameSettings().then(setSettings)
    return window.api.onGameProgress(setProgress)
  }, [])

  const browse = async (): Promise<void> => {
    setError(null)
    try {
      setSettings(await window.api.setGtaPath())
    } catch (e) {
      setError(cleanError(e))
    }
  }

  const scan = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setProgress('Starting')
    try {
      const report = await window.api.scanGame()
      if (report.weapons === 0) throw new Error('No guns were found in this GTA V folder. Is it a complete install?')
      onDone(report)
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(false)
    }
  }

  const card = (
    <div className={mode === 'welcome' ? 'setup-card' : 'modal'} role={mode === 'rescan' ? 'dialog' : undefined} aria-label="Set up">
      <header>
        <h2>{mode === 'welcome' ? 'Welcome to Gun Soundpack Maker' : 'Scan GTA V again'}</h2>
        {onClose && (
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>
            ✕
          </button>
        )}
      </header>
      <p className="muted">
        {mode === 'welcome'
          ? 'First, point the app at your GTA V install. It reads every gun and its sounds straight from the game files — nothing in your game folder is changed.'
          : 'Re-reads every gun and its sounds, for example after a game update.'}
      </p>

      {settings && !settings.bridgeAvailable && (
        <p className="error">
          The game-file bridge isn't built. Run <span className="mono">npm run build:bridge</span> (needs the .NET 8 SDK), then restart the
          app.
        </p>
      )}

      <div className="path-row">
        <div>
          <span className="field-title">GTA V folder</span>
          <span className="mono small path">{settings?.gtaPath ?? 'Not found automatically'}</span>
          {settings && (
            <span className={settings.gtaValid ? 'ok small' : 'error small'}>
              {settings.gtaValid
                ? '✓ gta5.exe found'
                : settings.gtaPath
                  ? '✕ gta5.exe is not in this folder'
                  : 'Choose the folder that contains gta5.exe'}
            </span>
          )}
        </div>
        <button className="btn" onClick={() => void browse()} disabled={busy}>
          Browse…
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <footer className="row gap end">
        {busy && <span className="muted small grow">{progress || 'Working…'}</span>}
        {onClose && (
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        )}
        <button className="btn primary" onClick={() => void scan()} disabled={!settings?.gtaValid || !settings.bridgeAvailable || busy}>
          {busy ? 'Scanning…' : mode === 'welcome' ? 'Find my guns' : 'Scan'}
        </button>
      </footer>
      {mode === 'welcome' && (
        <p className="muted small">
          Uses CodeWalker by dexyfex to read the game's archives, with the decryption keys from your own gta5.exe. The first scan takes a
          moment.
        </p>
      )}
    </div>
  )

  return mode === 'welcome' ? <div className="setup">{card}</div> : <div className="modal-backdrop">{card}</div>
}
