# Gun Soundpack Maker

A desktop app for building **server-side FiveM gun sound packs**. Load GTA V's original weapon sound banks, swap in your own gunshots, and export a resource you can drop into your server. You don't need CodeWalker round-trips, and you don't hand-edit sample counts in XML.

## What it does

- **Imports the original sound banks** (`.awc`), exported with OpenIV or CodeWalker. Encrypted banks can be imported through CodeWalker's **Export XML** (`.awc.xml` plus its wav folder), which also brings readable stream names.
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

The app never ships Rockstar's files. Export your own copies once and they stay in the app's library.

1. In **OpenIV** or **CodeWalker**, open `x64/audio/sfx/WEAPONS_PLAYER.rpf` and export the gun banks you want.
2. Open `x64/audio/sfx/RESIDENT.rpf` and export `weapons.awc`.
3. Click **Import .awc…**, or drag the files onto the window.
4. If the app reports a file as encrypted, use CodeWalker's **Export XML** on it instead. Then import the `.awc.xml` with **Import CodeWalker XML…**, keeping the wav folder CodeWalker created next to it.

## Installing a pack on a server

1. Export the resource into your server's `resources` folder.
2. Add `ensure <resource_name>` to `server.cfg`.
3. Restart the server. Players download the sounds when they join.

Test with a second client so you hear both your own shots and other players' shots.

## Development

Requires Node 22.

```sh
npm install
npm run dev          # run the app with hot reload
npm test             # unit tests (Vitest)
npm run typecheck
npm run test:e2e     # builds, then runs the Electron smoke test (Playwright); use xvfb-run on headless Linux
npm run dist:win     # Windows installer + portable exe in release/
```

To run the optional real-file round-trip tests, point `AWC_SAMPLES_DIR` at a folder of `.awc` files. These files are never committed.

### Layout

| Path | Contents |
| --- | --- |
| `src/core/` | Pure TypeScript with no Electron or DOM dependencies, fully unit-tested |
| `src/core/awc/` | AWC reader/writer, peak data, IMA ADPCM decoding, stream replacement, CodeWalker XML import |
| `src/core/dsp.ts` | Shaping pipeline (trim, fades, normalise, windowed-sinc resampling, dithered 16-bit) |
| `src/core/build.ts` | Turns a project plus templates into the resource files |
| `src/main/` | Electron main process: dialogs, template library, project files, export |
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
