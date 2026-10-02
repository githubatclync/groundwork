// Right panel: details of the selected feature (geometry summary, attributes, description).
// The description HTML is sanitized and shown in a sandboxed, script-less iframe.
import { useEffect, useMemo, useState } from 'react';
import { getFeature, type FeatureDetail } from '../io/attributes';
import { useLayers } from '../layers/layerStore';
import { useSelection } from '../selection/selectionStore';
import { descriptionDocument, sanitizeDescription } from './descriptionHtml';
import { useSettings } from '../settings/settingsStore';
import { formatArea, formatDistance } from '../tools/units';
import { useUi } from './uiStore';

export function FeatureDetails() {
  const selection = useSelection((s) => s.selection);
  const layer = useLayers((s) => s.layers.find((l) => l.id === selection?.layerId));
  const setOpen = useUi((s) => s.setDetailsOpen);
  const unitSystem = useSettings((s) => s.unitSystem);
  const areaUnit = useSettings((s) => s.areaUnit);
  const [detail, setDetail] = useState<FeatureDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selection) return;
    let cancelled = false;
    setError(null);
    getFeature(selection.layerId, selection.featureId)
      .then((d) => !cancelled && setDetail(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [selection]);

  const srcDoc = useMemo(
    () =>
      detail?.description && selection
        ? descriptionDocument(sanitizeDescription(detail.description, selection.layerId))
        : null,
    [detail, selection],
  );

  if (!selection) return null;
  const g = detail?.geometry;

  return (
    <aside className="right-panel" aria-label="Feature details">
      <div className="panel-head">
        <h2>{detail?.name || `Feature ${selection.featureId}`}</h2>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close details">
          ✕
        </button>
      </div>
      {layer && <div className="muted">{layer.name}</div>}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {g && (
        <section>
          <h3>Geometry</h3>
          <dl className="kv">
            <dt>Type</dt>
            <dd>{g.kind}</dd>
            <dt>Vertices</dt>
            <dd>{g.vertexCount.toLocaleString()}</dd>
            {g.lengthM !== null && (
              <>
                <dt>Length</dt>
                <dd>{formatDistance(g.lengthM, unitSystem)}</dd>
              </>
            )}
            {g.perimeterM !== null && (
              <>
                <dt>Perimeter</dt>
                <dd>{formatDistance(g.perimeterM, unitSystem)}</dd>
              </>
            )}
            {g.areaM2 !== null && (
              <>
                <dt>Area</dt>
                <dd>{formatArea(g.areaM2, unitSystem, areaUnit)}</dd>
              </>
            )}
          </dl>
        </section>
      )}
      {detail && detail.attrs.length > 0 && (
        <section>
          <h3>Attributes</h3>
          <dl className="kv">
            {detail.attrs.map(([k, v]) => (
              <div key={k} className="kv-row">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {srcDoc && (
        <section>
          <h3>Description</h3>
          <iframe
            className="description"
            title="Feature description"
            sandbox=""
            srcDoc={srcDoc}
            referrerPolicy="no-referrer"
          />
        </section>
      )}
    </aside>
  );
}
