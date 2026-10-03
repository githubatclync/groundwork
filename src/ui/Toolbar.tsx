// Top toolbar: files and projects, basemap, search, measure/draw tools, undo/redo, exports, settings.
import { availability } from '../globe/basemaps';
import { pickGeodataFiles } from '../io/import';
import { openPaths } from '../layers/openPaths';
import { useUserLayer } from '../layers/userLayerStore';
import { useTool, type Tool } from '../tools/toolStore';
import { ProjectMenu } from './ProjectMenu';
import { SearchBox } from './SearchBox';
import { useUi } from './uiStore';
import {
  allBasemaps,
  resolveActiveBasemap,
  selectKeys,
  useSettings,
} from '../settings/settingsStore';

export function Toolbar({
  onOpenSettings,
  onExport,
  onExportImage,
  onHelp,
}: {
  onOpenSettings: () => void;
  onExport: () => void;
  onExportImage: () => void;
  onHelp: () => void;
}) {
  const settings = useSettings();
  const keys = selectKeys(settings);
  const active = resolveActiveBasemap(settings.basemapId, settings.mbtiles, keys);

  const tool = useTool((s) => s.tool);
  const canUndo = useUserLayer((s) => s.past.length > 0);
  const canRedo = useUserLayer((s) => s.future.length > 0);
  const setTool = useTool((s) => s.setTool);
  const tableOpen = useUi((s) => s.tableOpen);
  const setTableOpen = useUi((s) => s.setTableOpen);

  const open = async () => {
    const paths = await pickGeodataFiles();
    if (paths.length) await openPaths(paths);
  };

  return (
    <header className="toolbar" role="toolbar" aria-label="Main toolbar">
      <strong className="brand">Groundwork</strong>
      <button type="button" onClick={() => void open()}>
        Open…
      </button>
      <ProjectMenu />
      <label className="field-inline">
        Basemap
        <select
          value={active.id}
          onChange={(e) => void settings.update({ basemapId: e.target.value })}
        >
          {allBasemaps(settings.mbtiles).map((b) => {
            const a = availability(b, keys);
            return (
              <option key={b.id} value={b.id} disabled={!a.available}>
                {b.name}
                {a.reason ? ` (${a.reason})` : ''}
              </option>
            );
          })}
        </select>
      </label>
      <div className="tool-group" role="group" aria-label="Measure tools">
        {(
          [
            ['measure-distance', 'Distance'],
            ['measure-path', 'Path'],
            ['measure-area', 'Area'],
          ] as [Tool, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tool === id}
            title={`Measure ${label.toLowerCase()}`}
            onClick={() => setTool(tool === id ? 'none' : id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="tool-group" role="group" aria-label="Draw tools">
        {(
          [
            ['draw-point', 'Point', 'Draw a point'],
            ['draw-line', 'Line', 'Draw a line'],
            ['draw-polygon', 'Polygon', 'Draw a polygon'],
            ['edit', 'Edit', 'Edit vertices of the selected feature'],
          ] as [Tool, string, string][]
        ).map(([id, label, title]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tool === id}
            title={title}
            onClick={() => setTool(tool === id ? 'none' : id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="tool-group" role="group" aria-label="History">
        <button
          type="button"
          title="Undo (Ctrl+Z)"
          disabled={!canUndo}
          onClick={() => useUserLayer.getState().undo()}
        >
          Undo
        </button>
        <button
          type="button"
          title="Redo (Shift+Ctrl+Z)"
          disabled={!canRedo}
          onClick={() => useUserLayer.getState().redo()}
        >
          Redo
        </button>
      </div>
      <SearchBox />
      <span className="spacer" />
      <button type="button" onClick={onExportImage}>
        Export image…
      </button>
      <button type="button" onClick={onExport}>
        Export…
      </button>
      <button type="button" aria-pressed={tableOpen} onClick={() => setTableOpen(!tableOpen)}>
        Table
      </button>
      <button type="button" onClick={onOpenSettings}>
        Settings
      </button>
      <button
        type="button"
        onClick={onHelp}
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts"
      >
        ?
      </button>
    </header>
  );
}
