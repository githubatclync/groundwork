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

| Command                           | What it does                                                         |
| --------------------------------- | -------------------------------------------------------------------- |
| `npm run tauri dev`               | Run the desktop app in dev mode                                      |
| `npm run tauri build`             | Production installer                                                 |
| `npm run dev`                     | Frontend only, in a browser at http://localhost:1420                 |
| `npm test`                        | Vitest unit tests                                                    |
| `cargo test` (in `src-tauri/`)    | Rust unit tests                                                      |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                    |
| `npm run generate:data`           | Generate fixtures and the large test files in `test-data/generated/` |
| `npm run bench`                   | Import each large file through the Rust importer and print timings   |

## Notes

- Cesium's `Workers`, `Assets`, `Widgets`, and `ThirdParty` are copied to `/cesium` by a small plugin in `vite.config.ts`; `CESIUM_BASE_URL` is set there.
- No API keys are bundled. Provider keys are entered in Settings and stored locally in the app data folder (`settings.json`).
- OSM tiles: attribution is always shown; no bulk prefetching or offline caching.
- Offline basemaps: add a raster `.mbtiles` file in Settings. `node --no-warnings test-data/make-test-mbtiles.ts` generates a small synthetic one (`test-data/test-tiles.mbtiles`, git-ignored) for testing.

## Opening files

Drag KML, KMZ, GeoJSON, or GPX files onto the window, use **Open…**, or pass paths on the command line
(`groundwork.exe file.kml`, which also covers the OS "Open with…" menu). Importing runs in Rust (streaming
parser); geometry reaches the frontend as one binary buffer (layout in `src-tauri/src/binary.rs`).

## Notes on rendering

- Layers are drawn with batched Cesium primitives. Geometry is added in chunks across animation frames,
  sorted along a Hilbert curve so off-screen chunks are culled.
- Lines have levels of detail (Douglas-Peucker at pixel-scale tolerances), built on demand as the camera rises.
- Icons and overlay images inside a KMZ (or next to a KML) are served through the `kmz://` URI protocol.
  Images hosted online are never downloaded (offline-first); such icons fall back to a plain marker.
- In development builds, `window.__viewer` exposes the Cesium viewer for automated checks.

## Drawing, editing, and saving

- **Draw** points, lines, and polygons into the "My Places" layer (toolbar: Point / Line / Polygon). Double-click or Enter
  finishes, Escape cancels. **Edit** vertices: drag a handle, click a midpoint handle to insert a vertex, Alt-click a vertex to
  delete it. Name, description, color/width/fill/icon, and custom attributes are edited in the right panel.
- **Undo / redo** with Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z (100 steps; a vertex drag or a burst of typing is one step).
- **Make editable copy** (the pencil on an imported layer) converts up to 10,000 features into My Places.
- **Export** (toolbar) writes any layer as KMZ, KML, or GeoJSON. KMZ bundles icons and overlay images; KML cannot, and says so.
  Exports keep the folder tree, styles, and ExtendedData. The built-in point icons come from `test-data/make-builtin-icons.ts`.

## Exporting images and tables

- **Export image…** saves the current view as a PNG at 1×, 2×, or 4× the screen resolution (the scene itself is re-rendered at
  that resolution, so imagery and points stay sharp). Optional title, scale bar, north arrow, and legend; the basemap
  attribution is always included. If the full size is more than the GPU can render, the scale is reduced and the dialog says so.
- **CSV: this view / all rows** (in the attribute table) writes the name and every attribute column, UTF-8 with a byte-order
  mark so Excel reads it correctly. "This view" respects the current sort, search, and filters.
