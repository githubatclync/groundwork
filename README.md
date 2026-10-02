# Groundwork

A local-first desktop globe for viewing, measuring, and editing your own geodata
(working title). Built with Tauri 2, React 18, TypeScript, and CesiumJS.

## Prerequisites

- **Node 20+**
- **Rust stable** via [rustup](https://rustup.rs) (Windows: `winget install Rustlang.Rustup`)
- Tauri system dependencies:
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Windows:** WebView2 runtime (preinstalled on Win 10/11) and MSVC build tools (Visual Studio Build Tools, "Desktop development with C++")
  - **Linux:** `webkit2gtk-4.1`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `build-essential`

## Setup

```sh
npm install
npm run tauri dev     # desktop app with hot reload
```

## Scripts

| Command | What it does |
|---|---|
| `npm run tauri dev` | Run the desktop app in dev mode |
| `npm run tauri build` | Production installer |
| `npm run dev` | Frontend only, in a browser at http://localhost:1420 |
| `npm test` | Vitest unit tests |
| `cargo test` (in `src-tauri/`) | Rust unit tests |
| `npm run lint` / `npm run format` | ESLint / Prettier |

## Notes

- Cesium's `Workers`, `Assets`, `Widgets`, and `ThirdParty` are copied to `/cesium` by a small plugin in `vite.config.ts`; `CESIUM_BASE_URL` is set there.
- No API keys are bundled. Provider keys are entered in Settings and stored locally in the app data folder (`settings.json`).
- OSM tiles: attribution is always shown; no bulk prefetching or offline caching.
- Offline basemaps: add a raster `.mbtiles` file in Settings. `node --no-warnings test-data/make-test-mbtiles.ts` generates a small synthetic one (`test-data/test-tiles.mbtiles`, git-ignored) for testing.
