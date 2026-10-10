# Gun Soundpack Maker

A desktop app for building **server-side FiveM gun sound packs**. Load GTA V's original weapon sound banks, swap in your own gunshots, and export a resource you can drop into your server. You don't need CodeWalker round-trips, and you don't hand-edit sample counts in XML.

## What it does

- **Finds your game on first launch.** It locates GTA V (from FiveM's settings or the usual Steam, Rockstar and Epic folders) or asks you for the folder. Then it reads every gun and its sounds straight from the game files, using [CodeWalker](https://github.com/dexyfex/CodeWalker)'s library, which is bundled with the app. Nothing in your game folder is changed.
- **Lists every gun**, grouped by type and shown with its in-game name. Pick one to see its sounds grouped the way the game uses them:
  - the gunshot
  - the distant report
  - the echo/tail
  - suppressed shots
  - shell casings
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
- **Exports a FiveM resource** as a folder or a `.zip`:

  ```
  my_gunpack/
    fxmanifest.lua
    README.txt
    audio/sfx/weapons_player/ptl_pistol.awc
    audio/sfx/resident/weapons.awc
  ```

  The manifest lists every bank and registers each folder with `data_file 'AUDIO_WAVEPACK' 'audio/sfx/<pack>'`. Only banks you changed are included, and untouched sounds inside them are copied byte for byte.
- **Saves projects** as `.gunpack` files. They hold your settings and your own source audio, never game files.
- **Sound banks tab (advanced).** Every bank in your library, stream by stream, with manual `.awc` and CodeWalker XML import.

## Which banks to replace

| Bank | Used for |
| --- | --- |
| `audio/sfx/weapons_player/*.awc` (e.g. `ptl_pistol.awc`, `smg_smg.awc`, `sht_pump.awc`) | Your own gun, as you hear it |
| `audio/sfx/resident/weapons.awc` | Shared weapon sounds: NPCs and other players' gunfire |

Replace both. Packs that skip `resident/weapons.awc` are the ones where "only the shooter hears the new sounds".

Bank names marked **?** in the app are inferred from file names. Listen to confirm.

## First launch

1. The app looks for GTA V. Confirm the folder or click **Browse…** to pick the one containing `gta5.exe`.
2. Click **Find my guns**. The app scans the game once. It:
   - reads `weapons.meta`, the audio metadata and the sound banks;
   - extracts the gun banks (unencrypted) into its library;
   - remembers which sounds belong to which gun.
3. Pick a gun and start replacing sounds.

After a game update, the app notices the change and offers **Scan game again**.

The app never ships Rockstar's files. Like CodeWalker, it reads the decryption keys from your own `gta5.exe`.

## Installing a pack on a server

1. Export the resource into your server's `resources` folder.
2. Add `ensure <resource_name>` to `server.cfg`.
3. Restart the server. Players download the sounds when they join.

Test with a second client so you hear both your own shots and other players' shots.

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
  - `scan` builds the weapon index and extracts the gun banks.
  - `list` and `extract` work on banks directly.
  - All commands output JSON.
- **Building.** `npm run build:bridge` fetches CodeWalker's source at a pinned commit into `bridge/.codewalker/` (git-ignored) and builds CodeWalker.Core. It then publishes the bridge, with CodeWalker inside, as a self-contained executable in `resources/bridge/`, which electron-builder packages.
- **What `scan` produces:**
  - `weapons.meta` → `<Audio>` item → `ItemAudioSettings` (player and NPC variants) → `WeaponSettings` (FireSound, ReportSound, EchoSound, …).
  - The full sound graph behind each of those (Multitrack, Randomized, Envelope, … down to `SimpleSound{ContainerName, FileName}`).
  - Container names resolved to banks via joaat(`<pack>/<bank>`).
- **The preview** (`src/core/soundgraph.ts` → `src/renderer/src/preview.ts`) plans each shot from that graph and renders it with Web Audio.
- **Tests.** The bridge integration and Electron tests build a fake GTA V folder with unencrypted RPF archives (`make-test-game`). It contains AWC-encrypted banks (with a test key), audio metadata built from `tests/fixtures/game/*.rel.xml`, and a `weapons.meta`. The tests skip themselves when the bridge isn't built.

**CodeWalker licensing.** CodeWalker's source is released "for educational purposes only" and has no open-source license. It is bundled here for convenience; get permission from dexyfex before redistributing the app. See `THIRD_PARTY_NOTICES.md`.

### Layout

| Path | Contents |
| --- | --- |
| `src/core/` | Pure TypeScript with no Electron or DOM dependencies, fully unit-tested |
| `src/core/awc/` | AWC reader/writer, peak data, IMA ADPCM decoding, stream replacement, CodeWalker XML import |
| `src/core/dsp.ts` | Shaping pipeline (trim, fades, normalise, windowed-sinc resampling, dithered 16-bit) |
| `src/core/build.ts` | Turns a project plus templates into the resource files |
| `src/main/` | Electron main process: dialogs, template library, project files, export, CodeWalker bridge runner |
| `bridge/` | .NET 8 CodeWalker bridge: scans the game (weapons, sound graphs, banks) and extracts banks |
| `src/core/weapons.ts`, `src/core/soundgraph.ts` | Weapon index, gun parts, and the in-game shot planner |
| `src/preload/` | `window.api` bridge (context isolation, sandboxed renderer) |
| `src/renderer/` | React UI |

### AWC format notes

The format knowledge comes from [CodeWalker](https://github.com/dexyfex/CodeWalker)'s `AwcFile.cs` and was checked against real gun packs. The writer reproduces their layout byte for byte:

- Header, then stream table, then chunk table.
- Chunk bodies are ordered: format chunks, then peaks, then markers, then 16-byte-aligned audio data.
- Streams are sorted by id.

When a stream is replaced, the app:

- writes 16-bit PCM
- sets the real sample count and rate
- rebuilds the peak values
- keeps the stream's id, loop settings, markers and unknown chunks.
