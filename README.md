# Gun Soundpack Maker

A desktop app for making **GTA V / FiveM gun sound packs**. It reads every gun's sounds from your game, lets you swap in your own gunshots with an in-game-style preview, and rebuilds `WEAPONS_PLAYER.rpf` and `RESIDENT.rpf`. You drag the two files into your mods folder, with no OpenIV or CodeWalker round-trips.

## What it does

- **Finds your game on first launch.** It locates GTA V (from FiveM's settings or the usual Steam, Rockstar and Epic folders) or asks you for the folder. Then it reads every gun and its sounds straight from the game files, using [CodeWalker](https://github.com/dexyfex/CodeWalker)'s library, which is bundled with the app. Nothing in your game folder is changed.
- **Lists every gun**, grouped by type and shown with its in-game name. Pick one to see its sounds grouped the way the game uses them:
  - the gunshot
  - the distant report
  - the echo/tail
  - suppressed shots
  - shell casings
  - every other sound field of the gun, folded below: handling (heft, rattle, reload, cover…), melee and impacts, and the slow-motion versions
- **Shows your gun and what others hear separately.** **Your gun** is what the shooter hears; **Others hear** is what other players and NPCs hear. With **Same sound for everyone** on, one assignment covers both.
- **Previews the full gunshot.**
  - ▶ Original and ▶ Yours play it the way the game builds it, from the game's own sound data: every layer, random variation, level, pitch, delay, filter and envelope.
  - It plays a single shot, or a burst at the gun's real fire rate.
  - The outdoor and indoor reverb is an approximation, so the preview is close to the game but not identical.
- **Replaces sounds** with WAV, MP3, OGG, FLAC or M4A. Drop a file onto a part or assign it to a selection. A stereo file fills an L/R stream pair automatically. You can also silence or reset sounds.
- **Shapes the audio:**
  - trim leading silence so shots fire instantly
  - start offset and max length
  - fades, gain and peak normalisation
  - resampling (keeps the original rate by default)
  - headroom override
- **Exports rebuilt game archives**, ready to drag and drop:

  ```
  my_gunpack/
    WEAPONS_PLAYER.rpf   your own gun's sounds
    RESIDENT.rpf         shared sounds: other players and NPCs
    README.txt           where to put them
  ```

  The app rebuilds each archive from your own game: every file is copied over, with your changed sound banks swapped in. Only archives with changes are written. They're OPEN (unencrypted) archives, the standard format for mod folders.
- **Shows what every sound is for.** Select any sound and **What it's for** lists every way the game plays it, traced through the game's audio data. For each one it shows:
  - **who triggers it:** which gun (and whether it's your gun or what others hear), or an explosion, an animation tag, or game code/scripts;
  - **which part it is:** gunshot, distant report, echo, reload, slow-mo…;
  - **when it plays:** close range or distant (with the crossfade distances), which random variation and how often, which layer, left or right channel, which branch of a condition;
  - **the exact path** in the data, from the game object down to the file.
- **Identify sounds in game.** **Identify in game…** builds a test pack where every sound says its code, such as "pistol 4". Install it, play, and type what you hear into **What did I hear?** to jump to that sound. This confirms the data in game, and also catches sounds the game code or scripts play by name, which no data file explains. Without a Windows voice, the sounds beep their number instead.
- **Saves projects** as `.gunpack` files. They hold your settings and your own source audio, never game files.
- **Sound banks tab.** Every bank of both archives, labelled with what uses it (banks no gun uses load from the game when you open them). Each sound has a **Used for** column; filter by what you're after (e.g. "echo") or show only the unused ones. Manual `.awc` and CodeWalker XML import still work.

## Which banks to replace

| Bank | Used for |
| --- | --- |
| `WEAPONS_PLAYER.rpf` → `*.awc` (e.g. `ptl_pistol.awc`, `smg_smg.awc`, `sht_pump.awc`) | Your own gun, as you hear it |
| `RESIDENT.rpf` → `weapons.awc` | Shared weapon sounds: NPCs and other players' gunfire |

Replace both. If you only change `WEAPONS_PLAYER.rpf`, other players and NPCs still sound vanilla. **Same sound for everyone** in the weapon view takes care of this.

After a scan, the Sound banks tab labels every bank from the game data, so there's no guessing. Without a scan, bank names marked **?** are inferred from file names.

## How the app knows what a sound is for

The game decides what to play through its audio data:
- **Game objects** (`dat151`) such as a weapon's `WeaponSettings` name a sound for each job: `FireSound`, `ReportSound`, `EchoSound`, `HeftSound`, `ReloadSounds`, `SlowMoFireSound`, and so on (about 50 fields per weapon).
- **Sounds** (`dat54`) form a graph down to the audio files. Each step says when its children play: a crossfade picks near or far by distance, a random pick has weights, a stereo sound has a left and a right, an If chooses a branch.

The scan follows every stream in both archives back up that graph to whatever triggers it. It records the conditions on the way, and reads weapon animation tags (reload clicks…).

Some sounds aren't referenced by any data: the game code or a script plays them by name. The app shows those as "Code or script" (or "Unused" if nothing plays the file at all). The ID pack settles them in game.

Meanings marked "(from the field name)" come from CodeWalker's names for the fields. The data proves the sound is wired to that field, and the ID pack shows exactly when it plays.

Hashes show as `0x…` when their name isn't known. To get more readable names, drop a list of known names (one per line) into the app's data folder as `names.txt` and scan again.

## First launch

1. The app looks for GTA V. Confirm the folder or click **Browse…** to pick the one containing `gta5.exe`.
2. Click **Find my guns**. The app scans the game once. It:
   - reads `weapons.meta`, the audio metadata and the sound banks;
   - extracts the gun banks (unencrypted) into its library;
   - remembers which sounds belong to which gun;
   - maps what every sound in both archives is for.
3. Pick a gun and start replacing sounds.

After a game update, the app notices the change and offers **Scan game again**.

The app never ships Rockstar's files. Like CodeWalker, it reads the decryption keys from your own `gta5.exe`.

## Installing the pack

- **FiveM:** drag `WEAPONS_PLAYER.rpf` and `RESIDENT.rpf` into `%localappdata%\FiveM\FiveM.app\mods`. To find it: right-click FiveM, choose *Open file location*, then open `FiveM.app\mods`; create the folder if it's missing.
- **Single player (OpenIV):** put both files in `<GTA V>\mods\x64\audio\sfx`. This needs OpenIV.asi.
- **Don't overwrite the originals** in `<GTA V>\x64\audio\sfx`. The exported archives are unencrypted mod archives, and FiveM refuses to start with modified archives in the game folder.
- **To go back to vanilla,** delete the files from the mods folder.

Some servers run in pure mode and block client mods. Test with a second player so you hear both your own shots and other players' shots.

## Development

Requires Node 22, plus the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) and git to build the game-file bridge.

```sh
npm install
npm run build:bridge # build the CodeWalker bridge (once, and after changing bridge/)
npm run dev          # run the app with hot reload
npm test             # unit tests (Vitest)
npm run typecheck
npm run test:e2e     # builds, then runs the Electron smoke test (Playwright); use xvfb-run on headless Linux
npm run dist:win     # Windows installer + portable exe in release/
```

Electron (v42+) no longer downloads its binary during install, so this project runs Electron's `install-electron` command on `npm install` and before `npm run dev`/`npm start`. If you still see `Error: Electron uninstall`, run `npx install-electron` once, or delete `node_modules/electron` and reinstall.

To run the optional real-file round-trip tests, point `AWC_SAMPLES_DIR` at a folder of `.awc` files. These files are never committed.

### CodeWalker bridge

`bridge/` is a small .NET 8 command-line program the app runs to read the game.

- **Commands:**
  - `scan` builds the weapon index and the sound usage map, and extracts the gun banks.
  - `build-rpf` rebuilds `WEAPONS_PLAYER.rpf`/`RESIDENT.rpf` as fresh OPEN archives. It copies every original file (decrypted) and swaps in the replaced banks, then reads the result back to verify it.
  - `list` and `extract` work on banks directly.
  - `speak` turns phrases into WAV files with the Windows voices (System.Speech), for the ID pack. It returns `no-tts` elsewhere.
  - All commands output JSON.
- **Building.** `npm run build:bridge` fetches CodeWalker's source at a pinned commit into `bridge/.codewalker/` (git-ignored) and builds CodeWalker.Core. It then publishes the bridge, with CodeWalker inside, as a self-contained executable in `resources/bridge/`, which electron-builder packages.
- **What `scan` produces:**
  - `weapons.meta` → `<Audio>` item → `ItemAudioSettings` (player and NPC variants) → `WeaponSettings` (FireSound, ReportSound, EchoSound, …).
  - The full sound graph behind each of those (Multitrack, Randomized, Envelope, … down to `SimpleSound{ContainerName, FileName}`).
  - Container names resolved to banks via joaat(`<pack>/<bank>`).
  - `sound-map.json` (`bridge/Usage.cs`) records:
    - every stream of every `weapons_player`/`resident` bank, with the sounds that play it (SimpleSound, GranularSound channel, AutomationSound MIDI);
    - every ancestor in the sound graph, with its parents and slots and the settings that pick a child (crossfade distances, weights, If/Switch variables, sound set entries…);
    - the game objects whose fields name those sounds, found by reflection over CodeWalker's `dat151` types;
    - animation clip tags in weapon `.ycd` files that name a sound or a sound set entry.

    `src/core/usage.ts` walks it from a stream to every trigger and puts each path into words. `src/core/idpack.ts` builds the ID pack's codes, labels and legend.
- **The preview** (`src/core/soundgraph.ts` → `src/renderer/src/preview.ts`) plans each shot from that graph and renders it with Web Audio.
- **Tests.** The bridge integration and Electron tests build a fake GTA V folder with unencrypted RPF archives (`make-test-game`). It contains AWC-encrypted banks (with a test key), audio metadata built from `tests/fixtures/game/*.rel.xml` (crossfades, stereo pairs, If branches, sound sets, an explosion, a code-only sound), a `weapons.meta` and a weapon clip dictionary with an audio tag. The tests skip themselves when the bridge isn't built.

**CodeWalker licensing.** CodeWalker's source is released "for educational purposes only" and has no open-source license. It is bundled here for convenience; get permission from dexyfex before redistributing the app. See `THIRD_PARTY_NOTICES.md`.

### Layout

| Path | Contents |
| --- | --- |
| `src/core/` | Pure TypeScript with no Electron or DOM dependencies, fully unit-tested |
| `src/core/awc/` | AWC reader/writer, peak data, IMA ADPCM decoding, stream replacement, CodeWalker XML import |
| `src/core/dsp.ts` | Shaping pipeline (trim, fades, normalise, windowed-sinc resampling, dithered 16-bit) |
| `src/core/build.ts` | Applies a project to the template banks (the bridge then packs them into `.rpf` archives) |
| `src/main/` | Electron main process: dialogs, template library, project files, export, CodeWalker bridge runner |
| `bridge/` | .NET 8 CodeWalker bridge: scans the game (weapons, sound graphs, the usage map, banks), extracts and rebuilds archives, speaks ID labels |
| `src/core/usage.ts`, `src/core/fields.ts` | What every stream is for, and what each game-object sound field means |
| `src/core/idpack.ts`, `src/main/idPack.ts` | The in-game ID pack: codes, spoken/beep labels, bank building within the original size, legend |
| `src/core/weapons.ts`, `src/core/soundgraph.ts` | Weapon index, gun parts, and the in-game shot planner |
| `src/preload/` | `window.api` bridge (context isolation, sandboxed renderer) |
| `src/renderer/` | React UI |

### AWC format notes

The format knowledge comes from [CodeWalker](https://github.com/dexyfex/CodeWalker)'s `AwcFile.cs` and was checked against real gun packs. The writer reproduces their layout byte for byte:

- Header, then stream table, then chunk table.
- Chunk bodies are ordered: format chunks, then peaks, then markers, then 16-byte-aligned audio data.
- Streams are sorted by id.

When a stream is replaced, the app:

- writes 16-bit PCM (IMA ADPCM for ID-pack labels, so banks stay within their original size)
- sets the real sample count and rate
- rebuilds the peak values
- keeps the stream's id, loop settings, markers and unknown chunks.
