// Right panel while a measure tool is active: live results, unit options, and "Save as feature".
import { useMemo, useState } from 'react';
import { useUserLayer } from '../layers/userLayerStore';
import { useSettings } from '../settings/settingsStore';
import { compassPoint } from '../tools/geodesy';
import { MIN_POINTS, measure } from '../tools/measure';
import { useMeasure } from '../tools/measureStore';
import { measurementToFeature } from '../tools/saveMeasurement';
import { measureModeOf, useTool } from '../tools/toolStore';
import {
  AREA_UNITS,
  UNIT_SYSTEMS,
  formatArea,
  formatDistance,
  type AreaUnit,
  type UnitSystem,
} from '../tools/units';

const TITLE = { distance: 'Measure distance', path: 'Measure path', area: 'Measure area' };
const HINT = {
  distance: 'Click two points on the globe.',
  path: 'Click points along the path. Double-click or press Enter to finish.',
  area: 'Click the corners of the area. Double-click or press Enter to finish.',
};

export function MeasurePanel() {
  const tool = useTool((s) => s.tool);
  const mode = measureModeOf(tool);
  const { points, cursor, finished } = useMeasure();
  const unitSystem = useSettings((s) => s.unitSystem);
  const areaUnit = useSettings((s) => s.areaUnit);
  const update = useSettings((s) => s.update);
  const [savedName, setSavedName] = useState<string | null>(null);

  const live = useMemo(
    () => (mode ? measure(mode, finished || !cursor ? points : [...points, cursor]) : null),
    [mode, points, cursor, finished],
  );
  if (!mode || !live) return null;

  const canSave = points.length >= MIN_POINTS[mode];
  const save = () => {
    if (!canSave) return;
    const m = measure(mode, points);
    const feature = measurementToFeature(m, unitSystem, areaUnit);
    useUserLayer.getState().addFeature(feature);
    useMeasure.getState().reset();
    setSavedName(feature.name);
  };

  return (
    <aside className="right-panel" aria-label="Measurement">
      <div className="panel-head">
        <h2>{TITLE[mode]}</h2>
        <button
          type="button"
          onClick={() => useTool.getState().setTool('none')}
          aria-label="Close measure tool"
        >
          ✕
        </button>
      </div>
      <p className="muted">{HINT[mode]}</p>

      <div className="measure-units">
        <select
          aria-label="Unit system"
          value={unitSystem}
          onChange={(e) => void update({ unitSystem: e.target.value as UnitSystem })}
        >
          {UNIT_SYSTEMS.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
        {mode === 'area' && (
          <select
            aria-label="Area unit"
            value={areaUnit}
            onChange={(e) => void update({ areaUnit: e.target.value as AreaUnit })}
          >
            {AREA_UNITS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <section aria-live="polite">
        {points.length === 0 && <p className="muted">No points yet.</p>}
        {mode === 'area' ? (
          <dl className="kv big">
            <dt>Area</dt>
            <dd>
              {live.areaM2 !== null && points.length + (cursor ? 1 : 0) >= 3
                ? formatArea(live.areaM2, unitSystem, areaUnit)
                : '—'}
            </dd>
            <dt>Perimeter</dt>
            <dd>{live.points.length >= 2 ? formatDistance(live.totalM, unitSystem) : '—'}</dd>
          </dl>
        ) : (
          <dl className="kv big">
            <dt>{mode === 'distance' ? 'Distance' : 'Total length'}</dt>
            <dd>{live.points.length >= 2 ? formatDistance(live.totalM, unitSystem) : '—'}</dd>
            {mode === 'distance' && live.initialAzimuth !== null && (
              <>
                <dt>Heading</dt>
                <dd>
                  {live.initialAzimuth.toFixed(1)}° {compassPoint(live.initialAzimuth)}
                </dd>
                <dt>Arrival</dt>
                <dd>
                  {live.finalAzimuth?.toFixed(1)}° {compassPoint(live.finalAzimuth ?? 0)}
                </dd>
              </>
            )}
          </dl>
        )}
        {mode !== 'distance' && live.segments.length > 0 && (
          <>
            <h3>Segments</h3>
            <ol className="segments">
              {live.segments.map((s, i) => (
                <li key={i}>
                  {formatDistance(s.lengthM, unitSystem)}{' '}
                  <span className="muted">
                    {s.azimuth.toFixed(0)}° {compassPoint(s.azimuth)}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
        <p className="muted small">Elevation-based measurements are n/a without terrain.</p>
      </section>

      <div className="measure-actions">
        {mode !== 'distance' && !finished && (
          <button
            type="button"
            disabled={!canSave}
            onClick={() => useMeasure.getState().finish(mode)}
          >
            Finish
          </button>
        )}
        <button type="button" disabled={!canSave} onClick={save}>
          Save as feature
        </button>
        <button
          type="button"
          disabled={points.length === 0}
          onClick={() => useMeasure.getState().reset()}
        >
          Clear
        </button>
      </div>
      {savedName && <p className="muted small">Saved “{savedName}” to My Places.</p>}
    </aside>
  );
}
