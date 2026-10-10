interface Props {
  onClose: () => void
}

export function HelpDialog({ onClose }: Props) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="How it works">
      <div className="modal help">
        <header>
          <h2>How it works</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <ol>
          <li>
            <b>Get the original sound banks.</b> Click <b>Extract from GTA V…</b>, point the app at your GTA V folder and your{' '}
            <b>CodeWalker</b> folder, and pick the banks. The app uses CodeWalker's library to read and decrypt{' '}
            <span className="mono">x64/audio/sfx/WEAPONS_PLAYER.rpf</span> (your own gun) and <span className="mono">weapons.awc</span> from{' '}
            <span className="mono">RESIDENT.rpf</span> (how other players and NPCs sound). You can also import{' '}
            <span className="mono">.awc</span> or CodeWalker <span className="mono">.awc.xml</span> exports by hand.
          </li>
          <li>
            <b>Find the streams to replace.</b> Banks only store numeric ids, so listen: select a row and press Space. Sort by “longest” to
            find shot bodies and tails. Give streams labels so you recognise them next time.
          </li>
          <li>
            <b>Assign your sounds.</b> Add WAV/MP3/OGG/FLAC files and assign them to one or many streams. Trim silence, fade, normalize and
            resample in the Shaping panel, and compare with the original.
          </li>
          <li>
            <b>Export.</b> The app writes a FiveM resource with <span className="mono">fxmanifest.lua</span> and the modified banks under{' '}
            <span className="mono">audio/sfx/…</span>. Put it in your server's resources folder and add{' '}
            <span className="mono">ensure &lt;name&gt;</span> to server.cfg.
          </li>
        </ol>
        <p className="small muted">
          Only banks you change are included; every untouched stream is copied unchanged. Replace both the weapons_player bank and
          resident/weapons.awc, or other players may still hear vanilla shots. Always test in-game with a second client.
        </p>
        <p className="small muted">Your projects (.gunpack) keep your own audio files, never game files.</p>
      </div>
    </div>
  )
}
