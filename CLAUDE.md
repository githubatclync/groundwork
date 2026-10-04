# Groundwork (working title)

Local-first desktop globe for viewing, measuring and editing your own geodata (a Google Earth Pro
replacement). Tauri 2 + Rust backend, React 18 + TypeScript (strict) + Vite + CesiumJS frontend.
The full spec is `groundwork_spec.md`; `README.md` describes user-facing features.

## Status
Milestones M0-M7 are done and committed, plus an optional OSM Buildings toggle. Not built, by
decision: "download area for offline" (offline = user-supplied `.mbtiles` only). Open: the final app
name and a real icon (current icon is a generated placeholder). The OSM Buildings toggle has never
been tried with a real ion token. Project save/reopen, the CSV dialog and dark mode were only
verified by unit tests, not by hand in the app.

## Rules from the owner
- Add no dependencies beyond spec Section 3 without asking (ureq was approved for Nominatim).
- Ask before deciding spec open questions (name/icon, offline download, 3D Tiles scope).
- Commit style: short subject, body optional, end with
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- OSM tiles: always show attribution, never bulk-prefetch or cache them.

## Commands (Windows; cargo is not on the bash PATH, add `%USERPROFILE%\.cargo\bin`)
- `npm run dev` / `npm run tauri dev`; `npm test` (Vitest); `npm run lint`; `npx tsc --noEmit`
- `cargo test` in `src-tauri`; `npm run bench`; `npm run generate:data` (large test files)
- `npm run tauri build` makes the MSI and NSIS installers under `src-tauri/target/release/bundle/`
- Run `npx prettier --write src` before lint; CI-style check order: tsc, lint, vitest, cargo test.

## Architecture notes that are not obvious from the code
- Geometry goes Rust to JS as one binary buffer (32-byte header "GWG1"; coords f64, offsets/ids u32,
  types/flags u8) via `tauri::ipc::Response`. PNG export sends raw bytes with a percent-encoded path header.
- Rendering uses batched Cesium Primitives: Hilbert-curve chunk ordering (Z-order was worse),
  line level-of-detail, ground primitives only when terrain is loaded, build-then-swap content.
- Custom URI schemes `mbtiles://` and `kmz://`; on Windows they are `http://<scheme>.localhost`.
- Table sorting/filtering/paging is server-side in Rust. `@tanstack/react-table` is pinned to v8.
- Projects (`.groundwork.json`): sources stored relative to the project file; user-drawn layer is
  inline GeoJSON; NetworkLink-derived child layers are not saved (they are re-derived).
- Shortcuts live in one table (`src/ui/shortcuts.ts`) that drives both the key handler and the `?` overlay.
- Place search hits Nominatim only on Enter and only online; coordinate parsing works offline.

## Gotchas
- **Shell escaping:** the Bash tool collapses backslashes and runs backticks. Do not put Windows
  paths, regexes with `\d`, or markdown code spans in shell heredocs/one-liners; use the Write/Edit
  tools. In tests and source, build backslashes with `String.fromCharCode(92)` / `char::from(92u8)`.
- Prettier and `cargo fmt` reflow code, which silently breaks string-replace edit scripts. Prefer Edit.
- Never let tests write into the working directory (an export test once did); use temp dirs.
- Cesium typings lack `ContextLimits`; `src/globe/capture.ts` uses a typed shim.
- Dev builds expose `window.__viewer` for automation. The release exe can be driven with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and a CDP client; capture the
  app window with `PrintWindow`, not a full-screen grab.
- Performance reference: 1M-vertex lines needed Hilbert chunking + LOD to hold frame rate.
