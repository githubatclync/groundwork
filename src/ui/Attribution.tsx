// Always-visible attribution for the active basemap (bottom-right of the globe).
import { resolveActiveBasemap, selectKeys, useSettings } from '../settings/settingsStore';

export function Attribution() {
  const settings = useSettings();
  const active = resolveActiveBasemap(settings.basemapId, settings.mbtiles, selectKeys(settings));
  return (
    <div className="attribution" aria-label="Map attribution">
      {active.attribution}
    </div>
  );
}
