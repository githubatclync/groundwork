// Top toolbar. M1: basemap picker and Settings button; more tools arrive in later milestones.
import { availability } from '../globe/basemaps';
import { allBasemaps, resolveActiveBasemap, selectKeys, useSettings } from '../settings/settingsStore';

export function Toolbar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const settings = useSettings();
  const keys = selectKeys(settings);
  const active = resolveActiveBasemap(settings.basemapId, settings.mbtiles, keys);

  return (
    <header className="toolbar" role="toolbar" aria-label="Main toolbar">
      <strong className="brand">Groundwork</strong>
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
