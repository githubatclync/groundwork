// Top toolbar: Open, basemap picker, and Settings. More tools arrive in later milestones.
import { availability } from '../globe/basemaps';
import { pickGeodataFiles } from '../io/import';
import { openFiles } from '../layers/layerManager';
import { useUserLayer } from '../layers/userLayerStore';
import { useTool, type Tool } from '../tools/toolStore';
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
}: {
  onOpenSettings: () => void;
  onExport: () => void;
  onExportImage: () => void;
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
    if (paths.length) await openFiles(paths);
  };

  return (
    <header className="toolbar" role="toolbar" aria-label="Main toolbar">
      <strong className="brand">Groundwork</strong>
      <button type="button" onClick={() => void open()}>
        Open…
      </button>
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
    </header>
  );
}
