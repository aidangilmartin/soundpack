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
            <b>Find your game.</b> On first launch the app finds (or asks for) your GTA V folder and reads every gun and its sounds from the
            game files, using CodeWalker's library and the decryption keys in your own <span className="mono">gta5.exe</span>. Nothing in
            the game folder changes. Run <b>Scan game again</b> after a game update.
          </li>
          <li>
            <b>Pick a gun.</b> Its sounds are grouped the way the game uses them: the gunshot, the distant report, the echo/tail, suppressed
            shots and shell casings. <b>Your gun</b> is what you hear; <b>Others hear</b> is what other players and NPCs hear.
          </li>
          <li>
            <b>Replace sounds.</b> Select a part (or “Select all”), add a WAV/MP3/OGG/FLAC and assign it — or drop the file straight onto a
            part. With “Same sound for everyone” on, other players hear your new sound too. Trim, fade, normalize and resample on the right.
          </li>
          <li>
            <b>Preview.</b> ▶ Original and ▶ Yours play the full gunshot the way the game builds it: every layer, random variation, level,
            pitch, delay and filter from the game's sound data, single or as a burst at the gun's fire rate. The environment
            (outdoors/indoors) is an approximation of the game's reverb, so the preview is close but not identical to in-game.
          </li>
          <li>
            <b>Export.</b> The app rebuilds the game's sound archives with your sounds — <span className="mono">WEAPONS_PLAYER.rpf</span>{' '}
            (your gun) and <span className="mono">RESIDENT.rpf</span> (other players and NPCs) — into a folder you choose. Drag them into{' '}
            <span className="mono">%localappdata%\FiveM\FiveM.app\mods</span> for FiveM, or{' '}
            <span className="mono">GTA V\mods\x64\audio\sfx</span> for single player with OpenIV. Don't overwrite the originals in the game
            folder.
          </li>
        </ol>
        <p className="small muted">
          Everything you don't change is copied over from your game unchanged. Change both your gun and what others hear, or other players
          may still hear vanilla shots. Always test in-game with a second client.
        </p>
        <p className="small muted">Your projects (.gunpack) keep your own audio files, never game files.</p>
        <p className="small muted">
          Game files are read with CodeWalker by dexyfex (github.com/dexyfex/CodeWalker), bundled with this app. See THIRD_PARTY_NOTICES.md.
        </p>
      </div>
    </div>
  )
}
