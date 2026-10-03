// Settings dialog: provider keys, local MBTiles files, and display options.
import { useEffect } from 'react';
import { BASEMAPS, type KeySetting } from '../globe/basemaps';
import type { CoordFormat } from '../globe/coords';
import { useSettings } from '../settings/settingsStore';

const KEY_FIELDS: { setting: KeySetting; label: string; hint: string }[] = [
  { setting: 'ionToken', label: 'Cesium ion token', hint: 'Enables ion imagery and World Terrain' },
  { setting: 'esriKey', label: 'ArcGIS API key', hint: 'Enables Esri World Imagery' },
  { setting: 'mapboxToken', label: 'Mapbox token', hint: 'Enables Mapbox Satellite' },
];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const s = useSettings();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>Settings</h2>

        <section>
          <h3>Provider keys</h3>
          <p className="muted">Stored only on this computer, in the app&apos;s data folder.</p>
          {KEY_FIELDS.map((f) => (
            <label key={f.setting} className="field">
              <span>
                {f.label} <small className="muted">{f.hint}</small>
              </span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={s[f.setting]}
                onChange={(e) => void s.update({ [f.setting]: e.target.value })}
              />
            </label>
          ))}
        </section>

        <section>
          <h3>Local MBTiles (offline basemaps)</h3>
          <ul className="plain">
            {s.mbtiles.map((m) => (
              <li key={m.path}>
                <span title={m.path}>
                  {m.name}{' '}
                  <small className="muted">
                    z{m.minZoom}–{m.maxZoom}
                  </small>
                </span>
                <button type="button" onClick={() => void s.removeMbtiles(m.path)}>
                  Remove
                </button>
              </li>
            ))}
            {s.mbtiles.length === 0 && <li className="muted">No files added.</li>}
          </ul>
          <button type="button" onClick={() => void s.addMbtiles()}>
            Add .mbtiles file…
          </button>
          {s.problems.length > 0 && (
            <div className="error" role="alert">
              {s.problems.map((p, i) => (
                <div key={i}>{p}</div>
              ))}
              <button type="button" onClick={s.dismissProblems}>
                Dismiss
              </button>
            </div>
          )}
        </section>

        <section>
          <h3>Display</h3>
          <label className="field-inline">
            Coordinate format
            <select
              value={s.coordFormat}
              onChange={(e) => void s.update({ coordFormat: e.target.value as CoordFormat })}
            >
              <option value="dd">Decimal degrees</option>
              <option value="dms">Degrees / minutes / seconds</option>
              <option value="utm">UTM</option>
            </select>
          </label>
          <label className="field-inline">
            <input
              type="checkbox"
              checked={s.showFps}
              onChange={(e) => void s.update({ showFps: e.target.checked })}
            />
            Show FPS in status bar
          </label>
          <label className="field-inline">
            <input
              type="checkbox"
              checked={s.osmBuildings}
              disabled={!s.ionToken.trim()}
              onChange={(e) => void s.update({ osmBuildings: e.target.checked })}
            />
            3D buildings (Cesium OSM Buildings)
            <small className="muted">
              {' '}
              Online only; needs a Cesium ion token. Uses a network connection while viewing.
            </small>
          </label>
        </section>

        <section>
          <h3>Basemap notes</h3>
          <ul className="plain notes">
            {BASEMAPS.filter((b) => b.note).map((b) => (
              <li key={b.id}>
                <strong>{b.name}:</strong> {b.note}
              </li>
            ))}
          </ul>
        </section>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
