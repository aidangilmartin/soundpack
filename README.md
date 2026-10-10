# Gun Soundpack Maker

A desktop app for building **server-side FiveM gun sound packs**. Load GTA V's original weapon sound banks, swap in your own gunshots, and export a resource you can drop into your server. You don't need CodeWalker round-trips, and you don't hand-edit sample counts in XML.

## What it does

- **Extracts the original sound banks straight from your GTA V install.** It uses [CodeWalker](https://github.com/dexyfex/CodeWalker)'s library to read and decrypt `WEAPONS_PLAYER.rpf` and `RESIDENT.rpf`, so you don't need to export anything by hand. You can still import `.awc` files or CodeWalker **Export XML** output (`.awc.xml` plus its wav folder) manually.
- **Lets you audition every stream.** Banks only store numeric ids, so you find the shot bodies and tails by ear. Press Space to listen, sort by length, and give streams your own labels.
- **Replaces streams** with WAV, MP3, OGG, FLAC or M4A, one stream at a time or many at once. A stereo file fills an L/R stream pair automatically. You can also silence streams or reset them.
- **Shapes the audio:**
  - trim leading silence so shots fire instantly
  - start offset and max length
  - fades, gain and peak normalisation
  - resampling (keeps the original stream's rate by default)
  - headroom override
  - waveform preview and A/B listening against the original
- **Exports a FiveM resource** as a folder or a `.zip`:

  ```
  my_gunpack/
    fxmanifest.lua
    README.txt
    audio/sfx/weapons_player/smg_smg.awc
    audio/sfx/resident/weapons.awc
  ```

  The manifest lists every bank and registers each folder with `data_file 'AUDIO_WAVEPACK' 'audio/sfx/<pack>'`. Only banks you changed are included, and untouched streams inside them are copied byte for byte.
- **Saves projects** as `.gunpack` files. They hold your settings and your own source audio, never game files.

## Which banks to replace

| Bank | Used for |
| --- | --- |
| `audio/sfx/weapons_player/*.awc` (e.g. `ptl_pistol.awc`, `smg_smg.awc`, `sht_pump.awc`) | Your own gun, as you hear it |
| `audio/sfx/resident/weapons.awc` | Shared weapon sounds: NPCs and other players' gunfire |

Replace both. Packs that skip `resident/weapons.awc` are the ones where "only the shooter hears the new sounds".

Bank names marked **?** in the app are inferred from file names. Listen to confirm.

## Getting the original banks

The app never ships Rockstar's files or CodeWalker. It reads the banks from your own game, using your own copy of CodeWalker.

1. Download [CodeWalker](https://github.com/dexyfex/CodeWalker) and extract it somewhere.
2. Click **Extract from GTA V…**.
3. Check the GTA V folder. The app finds it automatically from FiveM's settings or the usual Steam, Rockstar and Epic folders. Otherwise pick the folder that contains `gta5.exe`.
4. Pick your CodeWalker folder (the one containing `CodeWalker.Core.dll`).
5. Click **Find gun banks**, keep the gun banks selected, and click **Extract**.

Like CodeWalker itself, the app reads the decryption keys from your `gta5.exe`. Nothing in your game folder is changed. If the game has a newer copy of an archive inside `update/update.rpf`, that copy is used.

If you'd rather export by hand, **Import .awc…** and **Import XML…** still work with files from OpenIV or CodeWalker.

## Installing a pack on a server

1. Export the resource into your server's `resources` folder.
2. Add `ensure <resource_name>` to `server.cfg`.
3. Restart the server. Players download the sounds when they join.

Test with a second client so you hear both your own shots and other players' shots.

## Development

Requires Node 22. Extracting from the game also needs the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) and git, to build the CodeWalker bridge.

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

`bridge/` is a small .NET 8 command-line program the app runs to read game archives (`list` and `extract` commands, JSON output).

- **Building.** `npm run build:bridge` fetches CodeWalker's source at a pinned commit into `bridge/.codewalker/` (git-ignored) and builds CodeWalker.Core. It then publishes the bridge as a self-contained executable in `resources/bridge/`, which electron-builder packages.
- **CodeWalker is not bundled.** CodeWalker's source is released "for educational purposes only", so `CodeWalker.Core.dll` is a compile-time reference only. At runtime the bridge loads it, and its SharpDX dependencies, from the user's CodeWalker folder.
- **In development** the app falls back to the CodeWalker.Core built in `bridge/.codewalker/runtime`.
- **Tests.** The bridge integration and Electron tests build a fake GTA V folder with unencrypted RPF archives (`make-test-game`), including AWC-encrypted banks using a test key. They skip themselves when the bridge isn't built.

### Layout

| Path | Contents |
| --- | --- |
| `src/core/` | Pure TypeScript with no Electron or DOM dependencies, fully unit-tested |
| `src/core/awc/` | AWC reader/writer, peak data, IMA ADPCM decoding, stream replacement, CodeWalker XML import |
| `src/core/dsp.ts` | Shaping pipeline (trim, fades, normalise, windowed-sinc resampling, dithered 16-bit) |
| `src/core/build.ts` | Turns a project plus templates into the resource files |
| `src/main/` | Electron main process: dialogs, template library, project files, export, CodeWalker bridge runner |
| `bridge/` | .NET 8 CodeWalker bridge that lists and extracts banks from the game's RPF archives |
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
