// Bottom status bar: cursor coordinates (DD/DMS/UTM), elevation, camera altitude, FPS, notices.
import { formatCoords } from '../globe/coords';
import { useStatus } from '../globe/statusStore';
import { useSettings } from '../settings/settingsStore';

function formatAltitude(m: number | null): string {
  if (m === null) return 'n/a';
  return m >= 10000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function StatusBar() {
  const { cursor, elevation, cameraHeight, fps, terrainLoaded, notice } = useStatus();
  const coordFormat = useSettings((s) => s.coordFormat);
  const showFps = useSettings((s) => s.showFps);

  return (
    <footer className="statusbar" aria-label="Status bar">
      <span className="coords" title="Cursor position">
        {cursor ? formatCoords(coordFormat, cursor.lat, cursor.lon) : '—'}
      </span>
      <span title="Terrain elevation under the cursor">
        Elev: {terrainLoaded && elevation !== null ? `${Math.round(elevation)} m` : 'n/a'}
      </span>
      <span title="Camera altitude">Alt: {formatAltitude(cameraHeight)}</span>
      {showFps && <span>FPS: {fps ?? '…'}</span>}
      {notice && (
        <span className="notice" role="status">
          {notice}
        </span>
      )}
    </footer>
  );
}
