# SPEC.md — Groundwork

*A local-first desktop globe for viewing, measuring, and editing your own geodata. Built as a replacement for the Google Earth Pro desktop workflows that the web version can't handle.*

> **Instructions for Claude Code:** Read this whole file before writing any code. Build one milestone at a time (Section 10). After each milestone, do three things: run the tests, run the app, and check every acceptance criterion for that milestone. Then stop and summarize what works and what doesn't before starting the next one. Don't add dependencies beyond those listed in Section 3 without asking me first. Commit to git after each milestone.

---

## 1. Problem and goals

Google Earth Pro desktop stops being downloadable on June 25, 2027. The web version has three problems for heavy users:

- It caps imports at about 250k vertices.
- It displays attribute data poorly.
- It can't work with local files offline.

Groundwork is **not** a Google Earth clone. It doesn't try to match Google's imagery, Street View, or historical imagery. It's the best tool for putting **your own data** on a 3D globe.

**Goals, in priority order:**

1. **Big files.** Open KML/KMZ files with 1M+ vertices and stay interactive. Target: 30+ fps while panning a 1M-vertex polyline dataset on a mid-range laptop.
2. **Attributes.** Show ExtendedData and SchemaData in a real, sortable, searchable table. Clicking a table row selects the feature on the map, and clicking a feature selects its row.
3. **Offline.** Everything except online basemaps works with no network. Users can supply their own offline basemaps as MBTiles.
4. **Measuring.** Geodesic distance, path length, polygon area, and heading.
5. **Simple editing.** Add and edit points, lines, and polygons, then save as KML/KMZ. Saved files must open correctly in Google Earth Pro.
6. **Export.** High-resolution PNG export with a scale bar, north arrow, and attribution.

**Non-goals for v1:** Street View, historical imagery, flight simulator, tours/movie maker, NetworkLink auto-refresh, time animation, accounts, cloud sync, and telemetry of any kind.

---

## 2. Target platforms

- macOS 12+ (native Apple Silicon and Intel), Windows 10/11, and Ubuntu 22.04+.
- Primary dev target: whichever OS this repo is running on. Keep the code cross-platform. No OS-specific APIs outside Tauri.

---

## 3. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Shell | **Tauri 2** | Small binaries and a native file system. Rust backend. |
| Frontend | **React 18 + TypeScript (strict) + Vite** | |
| Globe | **CesiumJS** (latest 1.x) | Apache-2.0. Configure Vite to copy Cesium's `Workers`, `Assets`, `Widgets`, and `ThirdParty` into the build, and set `CESIUM_BASE_URL`. |
| State | **Zustand** | |
| Table | **TanStack Table + TanStack Virtual** | Must virtualize. Datasets can have 100k+ rows. |
| UI | Plain CSS modules or Tailwind | Keep it light. No heavy component library. |
| HTML sanitizing | **DOMPurify** | For KML `<description>` balloons. |
| Geodesy | Cesium's `EllipsoidGeodesic` / `EllipsoidRhumbLine`, plus **geographiclib-geodesic** (JS) for polygon area | |
| Rust: XML | **quick-xml** (streaming reader) | Never load the full DOM for large files. |
| Rust: KMZ | **zip** | |
| Rust: MBTiles | **rusqlite** (bundled feature) | |
| Rust: misc | **serde**, **thiserror**, **anyhow** | |
| Tauri plugins | `dialog`, `fs`, `store` (for settings) | |
| Tests | **Vitest** (frontend), `cargo test` (Rust), **Playwright** (one smoke test, optional) | |

**Prerequisites to check and document in README:** Node 20+, Rust stable (via rustup), and the Tauri system dependencies:

- macOS: Xcode Command Line Tools
- Windows: WebView2 and MSVC build tools
- Linux: webkit2gtk-4.1 and related packages

---

## 4. Architecture

```
groundwork/
├── SPEC.md
├── README.md
├── package.json
├── vite.config.ts
├── src/                      # React frontend
│   ├── main.tsx
│   ├── App.tsx
│   ├── globe/                # Cesium viewer setup, basemaps, picking, camera
│   ├── layers/               # layer store, renderers (primitive + entity paths)
│   ├── table/                # attribute table
│   ├── tools/                # measure, draw/edit, export
│   ├── io/                   # calls into Rust, binary decoding, KML writer
│   ├── settings/
│   └── ui/                   # panels, toolbar, dialogs
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       ├── commands.rs       # Tauri commands
│       ├── kml/              # streaming parser, style resolution, KMZ handling
│       ├── geojson.rs
│       ├── gpx.rs
│       ├── mbtiles.rs        # custom URI protocol: mbtiles://<id>/{z}/{x}/{y}
│       └── binary.rs         # compact geometry encoding
└── test-data/
    ├── generate.ts           # script that generates large test files
    └── fixtures/             # small hand-written KML/KMZ covering each feature
```

### 4.1 Data flow for file import

1. The user drags a file onto the window or uses File → Open. The frontend calls the Rust command `import_file(path)`.
2. Rust streams the file:
   - **KMZ:** unzip `doc.kml` (or the first `.kml` at the root). Keep the archive open so embedded icons and overlays can be served.
   - **Parse:** use quick-xml as an event stream.
   - **Build:** produce a **feature table** and a **geometry buffer**.
3. Rust returns a lightweight **layer manifest** as JSON. It contains:
   - the folder tree
   - the feature count
   - resolved styles
   - the attribute schema (column names and types)
   - parse warnings
   - bounds
4. The frontend then requests geometry as **binary**. Use a `tauri::ipc::Response` with raw bytes, not JSON. Layout:
   - a header
   - a `Float64Array` of lon/lat/alt triples
   - a `Uint32Array` of offsets per part/ring
   - a `Uint32Array` of feature IDs
   - a `Uint8Array` of geometry type codes
5. The frontend requests attributes in pages (`get_attributes(layer_id, offset, limit, sort, filter)`). Sorting and filtering happen in Rust so the UI never holds 500k attribute rows as JS objects.
6. Embedded KMZ resources (icons, ground overlay images) are served through a custom URI protocol: `kmz://<layer_id>/<path>`.

### 4.2 Rendering strategy (this is the core performance decision)

- **Static imported layers → Cesium Primitive API, batched.** Use the Entity API only for small editable layers.
  - Points: `PointPrimitiveCollection`, or `BillboardCollection` when an icon style exists.
  - Lines: one `Primitive` with batched `PolylineGeometry` instances (or `GroundPolylinePrimitive` for clampToGround), batched per style.
  - Polygons: batched `PolygonGeometry` instances in a `Primitive`, or `GroundPrimitive` for clampToGround. Draw outlines separately.
  - Labels: `LabelCollection`. Only show labels below a camera-height threshold, or when the feature count in view is under about 2,000.
- **Picking:** each geometry instance's `id` is `{layerId, featureId}`. Selection highlights by updating per-instance color attributes. Don't rebuild the primitive.
- **Batching:** if a single layer has more than 50k features, split it into chunks of about 10k instances so the initial build doesn't freeze the UI. Build chunks across animation frames and show a progress bar.
- **User-drawn layer → Entity API,** because it needs easy editing.

### 4.3 State (Zustand)

- `layers`: an ordered list of `{id, name, sourcePath, visible, opacity, tree, styleMap, bounds, featureCount, warnings, editable}`
- `selection`: `{layerId, featureId} | null`
- `tool`: `'none' | 'measure-distance' | 'measure-path' | 'measure-area' | 'draw-point' | 'draw-line' | 'draw-polygon' | 'edit'`
- `basemap`: the active provider ID, plus overlay toggles
- `settings`: persisted through the Tauri store plugin

---

## 5. File format support

### 5.1 KML/KMZ, required for v1

- **Containers:** `Document`, `Folder`, and nested folders. The folder tree mirrors into the layer panel, and each folder has its own visibility checkbox.
- **Geometry:** `Placemark` with `Point`, `LineString`, `LinearRing`, `Polygon` (outer and inner boundaries), and `MultiGeometry` (nested).
- **Geometry options:** `altitudeMode` (`clampToGround` is the default, plus `relativeToGround` and `absolute`), `extrude`, and `tessellate`.
- **Styles:**
  - `Style` and `StyleMap` (normal/highlight), both inline and shared (`styleUrl="#id"`).
  - `IconStyle` (href, scale, color, heading), `LabelStyle` (color, scale), `LineStyle` (color, width), and `PolyStyle` (color, fill, outline).
  - **KML colors are `aabbggrr` hex.** Write a unit test for this conversion.
- **Content:** `name`, `description` (HTML, sanitized), `visibility`, and `open`.
- **Attributes:** `ExtendedData` with `Data name/value` and `SchemaData` / `SimpleData`, plus `Schema` / `SimpleField` type hints.
- **Overlays:** `GroundOverlay` with `LatLonBox` (including rotation), where the image comes from the KMZ or a local relative path.
- **Unsupported elements:** `NetworkLink`, `ScreenOverlay`, `PhotoOverlay`, `Model`, `gx:Track`, `TimeStamp`, `TimeSpan`, and `Region`. Skip them gracefully and record a warning (element name and count) that the UI shows per layer. For `NetworkLink` to a **local relative file**, import that file as a child layer. That's a nice-to-have in M2 and required by M7.
- **Robustness:** handle files with missing namespaces, the `kml:` prefix, BOMs, CRLF line endings, and whitespace or newlines inside `<coordinates>`. Silently drop malformed coordinates and count them in the warnings.

### 5.2 Other import formats

- **GeoJSON:** FeatureCollection, Feature, and all geometry types. Properties become attributes. Use a streaming parse if the file is over 50 MB.
- **GPX:** waypoints become points, and tracks and routes become lines. Extensions go into attributes.
- **CSV with lat/lon columns:** auto-detect common column names (`lat`, `latitude`, `y`, `lon`, `lng`, `longitude`, `x`) and show a confirm dialog with the detected columns. This is in M7.

### 5.3 Export

- **KML/KMZ writer, in TypeScript or Rust (your choice):**
  - Writes the user-drawn layer, or any imported layer.
  - Preserves the folder tree, styles, and ExtendedData.
  - KMZ bundles referenced icons.
  - Output must open in Google Earth Pro. Verify the structure against the KML 2.2 schema basics.
- **GeoJSON** export of any layer.
- **CSV export** of the attribute table, either the current filtered view or all rows.

---

## 6. Basemaps and terrain

The settings screen has a **Basemap** list. Each provider is defined in `src/globe/basemaps.ts` as a config object with these fields:

- `id`
- `name`
- `type` (`'xyz' | 'wmts' | 'cesium-ion' | 'mbtiles'`)
- `url`
- `requiresKey`
- `attribution`
- `maxZoom`

Ship with:

1. **OpenStreetMap standard.** This is the default and needs no key. Follow the OSM tile usage policy:
   - send a valid User-Agent
   - **no bulk prefetching or offline caching of OSM tiles**
   - show attribution
2. **Cesium ion imagery and World Terrain.** Requires the user's own free ion token, which they paste into settings. Disabled until a token is set.
3. **Esri World Imagery.** Requires the user's own ArcGIS API key. Show Esri's attribution.
4. **Mapbox Satellite.** Requires the user's own token.
5. **Sentinel-2 cloudless (EOX).** Optional. Show the license note in the UI: the 2016 vintage is CC BY 4.0, and later vintages are non-commercial.
6. **Local MBTiles.** The user picks a `.mbtiles` file. Rust serves tiles via `mbtiles://<id>/{z}/{x}/{y}` (handle the TMS y-flip). Raster PNG/JPEG/WebP only for v1. **This is the fully offline basemap path.**

**Terrain:** default to a smooth ellipsoid with no terrain. Use Cesium World Terrain when an ion token is set. Elevation readouts and terrain-relative measurements show "n/a" when no terrain is loaded.

**Attribution:** always visible in the bottom-right corner and always included in exported images.

**Do not hardcode any API keys or tokens.** Store keys in the Tauri store, in the app's data directory.

---

## 7. Features and UI

### 7.1 Layout

- **Left panel:** Layers. The tree has checkboxes, an opacity slider per layer, zoom-to-layer, remove, a warnings badge, and drag to reorder.
- **Center:** the globe.
- **Bottom drawer (resizable):** the attribute table for the selected layer.
- **Right panel (contextual):** the selected feature's details, the measurement results, and the edit form.
- **Top toolbar:**
  - Open
  - Save Project
  - basemap picker
  - measure tools (distance, path, area)
  - draw tools (point, line, polygon)
  - Export Image
  - a search box that only geocodes when online
  - Settings
- **Status bar:**
  - cursor lat/lon, in selectable format: DD, DMS, or UTM
  - elevation, if terrain is loaded
  - camera altitude
  - FPS (debug toggle)

### 7.2 Attribute table

- Virtualized rows. Columns come from the schema plus `name`.
- Sort by clicking a column header. Sorting runs in Rust.
- Global text filter, and an optional per-column filter (contains, =, >, < for numbers).
- Clicking a row flies the camera to the feature and selects it. Double-click opens its details.
- Selecting a feature on the globe scrolls the table to that row and highlights it.
- "Show only features in view" toggle. Debounce this filter on camera move.
- Export the current view to CSV.

### 7.3 Feature details

- Name, the attribute key/value list, and geometry info (type, vertex count, length or area).
- The KML description HTML, rendered inside a **sandboxed iframe** (`sandbox=""` with no scripts) after DOMPurify. Images inside the description only load from the KMZ, `data:` URLs, or https.

### 7.4 Measurement

- **Distance:** two clicks give the geodesic distance and the initial heading.
- **Path:** multiple clicks, double-click to finish. Shows total and segment lengths.
- **Area:** a polygon gives the geodesic area (use geographiclib) and the perimeter.
- **Units:** metric or imperial toggle, plus nautical miles and acres/hectares options.
- Results show in the right panel, with a "Save as feature" button that adds the measurement to the user layer.
- The Escape key cancels.

### 7.5 Drawing and editing (user layer: "My Places")

- Draw points, lines, and polygons by clicking. Double-click or Enter finishes, and Escape cancels.
- Edit mode: drag the vertices of the selected feature. Click the midpoint handle to insert a vertex, and Alt/Option-click to delete one.
- The edit form covers name, description (plain text), style (color, width, icon from a small built-in set), and custom key/value attributes.
- Undo/redo with Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z. Keep a history of at least 50 steps.
- Any imported layer can be converted to editable ("Make editable copy") **only if it has 10k features or fewer**. Show a warning if it's larger.

### 7.6 Image export

- Export the current view to PNG at 1×, 2×, or 4× the screen resolution. Render offscreen with `preserveDrawingBuffer`, and tile if needed.
- Optional overlays: title text, scale bar, north arrow, legend (visible layers with their style swatches), and attribution (always on).

### 7.7 Projects

- A `.groundwork.json` file stores:
  - the layer list (source paths, stored relative to the project file when possible)
  - visibility, opacity, and order
  - the camera position
  - the basemap
  - the user layer, inline as GeoJSON
- Re-opening a project re-imports its source files. If a source file is missing, show a "locate file…" prompt.
- Recent projects list on the start screen.

### 7.8 Search (online only)

- Use Nominatim with a proper User-Agent and at most 1 request per second. Debounce typing, and only search on Enter.
- The search box also accepts raw coordinates in any of these forms: `lat, lon`, DMS, or UTM.
- When offline, only coordinate input works, and the box says so.

---

## 8. Non-functional requirements

- **Performance budgets**, measured on the generated test files:
  - Import a 50 MB / 1M-vertex KML to first render in **8 seconds or less**.
  - Panning and zooming at **30 fps or more** with that layer visible.
  - Attribute table with 200k rows: scrolling stays smooth, and sort takes **under 1 second**.
  - App cold start **under 3 seconds**.
- **Memory:** under 1.5 GB RAM with the 1M-vertex file loaded.
- **Privacy:** no telemetry and no analytics. The only network calls are to basemap and terrain providers the user enabled, and to Nominatim when the user searches.
- **Errors:** never crash on a bad file. Show a readable error with the file name, the line or element where possible, and what was skipped.
- **Accessibility:** keyboard-reachable toolbar, visible focus states, and a light/dark theme that follows the OS.

---

## 9. Testing

- **Rust unit tests** (`cargo test`), with one test for each item:
  - KML color conversion
  - style and StyleMap resolution
  - shared vs. inline styles
  - MultiGeometry flattening
  - inner rings
  - ExtendedData vs. SchemaData
  - malformed coordinates
  - KMZ with relative icons
  - GroundOverlay parsing
  - MBTiles y-flip
- **Frontend unit tests** (Vitest): binary geometry decoding, unit conversions, coordinate parsing (DD, DMS, UTM), and a KML writer round-trip.
- **Geodesy checks:** at least 5 known distance and area cases compared to GeographicLib reference values, within 0.1%.
- **`test-data/generate.ts`** produces:
  - `big-lines.kml`: about 1M vertices across 20k LineStrings, with ExtendedData on each
  - `big-points.kml`: 200k points with 8 attributes each
  - `big-polys.kmz`: 10k polygons with holes and a shared StyleMap
  - `mixed.geojson`
- **Fixtures:** small hand-written files in `test-data/fixtures/`, one per KML feature in Section 5.1.
- **Benchmarks:** `npm run bench` imports each big file through the Rust command and prints the timings.

---

## 10. Milestones

Build these in order. Each milestone ends with a running app and passing tests.

**M0: Scaffold**
- Tauri 2, React, TypeScript, and Vite, with Cesium wired up correctly (static assets copied and `CESIUM_BASE_URL` set).
- Lint (ESLint and Prettier), the test runners, and a README with setup steps.
- ✅ `npm run tauri dev` opens a window showing a Cesium globe with OSM imagery. `npm test` and `cargo test` pass.

**M1: Globe and basemaps**
- The basemap registry, the Settings screen with key storage, the attribution widget, the status bar showing cursor coordinates (DD/DMS/UTM), and local MBTiles via the custom protocol.
- ✅ You can switch between OSM and MBTiles. Keyed providers stay disabled until a key is entered. Restarting the app keeps your settings.

**M2: Import and render**
- The Rust streaming KML/KMZ parser, the GeoJSON/GPX importers, the binary geometry transfer, the batched primitive renderer, the warnings list, and drag-and-drop.
- ✅ All fixtures render correctly with their styles. `big-lines.kml` meets the performance budgets in Section 8. Bad files show an error and don't crash the app.

**M3: Layers, selection, and attribute table**
- The layer tree with folder visibility and opacity, picking and highlighting, the paged and virtualized table with sort and filter run in Rust, two-way selection sync, and the feature details panel with the sandboxed description.
- ✅ `big-points.kml` with 200k rows meets the table budgets. Clicking a row flies to the feature, and clicking the globe selects the row.

**M4: Measurement**
- Distance, path, and area tools, unit toggles, and "Save as feature."
- ✅ The geodesy tests pass, and measured values match GeographicLib within 0.1%.

**M5: Drawing, editing, and saving**
- The "My Places" layer, the draw and edit tools, undo/redo, the KML/KMZ/GeoJSON writers, and "Make editable copy."
- ✅ Draw a few features, save as KMZ, and re-open the file in Groundwork and get the same result. The output also validates as well-formed KML 2.2. Manually check it in Google Earth Pro if it's installed.

**M6: Export and print**
- PNG export at 1–4× with the overlays (title, scale bar, north arrow, legend, attribution) and the CSV export of the table.
- ✅ A 4× export of a populated view produces a correct, high-resolution PNG with attribution.

**M7: Projects, search, and polish**
- Project save and load with relative paths, the recent projects list, Nominatim and coordinate search, CSV point import, local NetworkLink child layers, light/dark theme, keyboard shortcuts (with a `?` help overlay), and a production build (`npm run tauri build`).
- ✅ Save a project, move the folder, and re-open it: all layers load. The production installer builds and runs on the dev machine.

---

## 11. Coding conventions

- TypeScript `strict` mode. Use `any` only in Cesium interop shims, with a comment explaining why.
- Rust: no `unwrap()` outside tests. Errors are `thiserror` enums mapped to readable messages for the UI.
- Keep Cesium-specific code inside `src/globe/` and `src/layers/renderers/` so it stays isolated.
- Each module gets a short header comment explaining its job.
- Keep components small. Put business logic in stores and plain functions, not in JSX.

## 12. Open questions (ask me before deciding)

- App name and icon. "Groundwork" is a working title.
- Whether to add a "Download area for offline" feature for providers whose terms allow caching. This is not allowed for OSM.
- Whether to support 3D Tiles (for example, Cesium OSM Buildings) behind an ion token in v1.1.
