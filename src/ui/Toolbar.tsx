// Top toolbar: Open, basemap picker, and Settings. More tools arrive in later milestones.
import { availability } from '../globe/basemaps';
import { pickGeodataFiles } from '../io/import';
import { openFiles } from '../layers/layerManager';
import {
  allBasemaps,
  resolveActiveBasemap,
  selectKeys,
  useSettings,
} from '../settings/settingsStore';

export function Toolbar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const settings = useSettings();
  const keys = selectKeys(settings);
  const active = resolveActiveBasemap(settings.basemapId, settings.mbtiles, keys);

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
      <span className="spacer" />
      <button type="button" onClick={onOpenSettings}>
        Settings
      </button>
    </header>
  );
}
