// Left panel: imported layers, import progress, import errors, and per-layer warnings.
// (Folder tree, opacity, and reordering arrive in M3.)
import { useState } from 'react';
import { zoomToBounds } from '../globe/camera';
import { removeLayer } from '../layers/layerManager';
import { useLayers, type ImportJob, type Layer } from '../layers/layerStore';

const PHASE_LABEL: Record<ImportJob['phase'], string> = {
  reading: 'Reading file…',
  transferring: 'Loading geometry…',
  rendering: 'Drawing…',
};

function JobRow({ job }: { job: ImportJob }) {
  const determinate = job.phase === 'rendering';
  return (
    <li className="job">
      <div>
        <strong>{job.name}</strong> <span className="muted">{PHASE_LABEL[job.phase]}</span>
      </div>
      <progress
        max={1}
        value={determinate ? job.progress : undefined}
        aria-label={`Importing ${job.name}`}
      />
    </li>
  );
}

function LayerRow({ layer }: { layer: Layer }) {
  const setVisible = useLayers((s) => s.setVisible);
  const [showWarnings, setShowWarnings] = useState(false);
  const warningTotal = layer.warnings.reduce((n, w) => n + w.count, 0);

  return (
    <li className="layer">
      <div className="layer-head">
        <label className="layer-name" title={layer.sourcePath}>
          <input
            type="checkbox"
            checked={layer.visible}
            onChange={(e) => setVisible(layer.id, e.target.checked)}
          />
          <span>{layer.name}</span>
        </label>
        {warningTotal > 0 && (
          <button
            type="button"
            className="badge"
            aria-expanded={showWarnings}
            title="Show import warnings"
            onClick={() => setShowWarnings((v) => !v)}
          >
            ⚠ {warningTotal}
          </button>
        )}
        <button type="button" title="Zoom to layer" onClick={() => zoomToBounds(layer.bounds)}>
          ⌖
        </button>
        <button type="button" title="Remove layer" onClick={() => removeLayer(layer.id)}>
          ✕
        </button>
      </div>
      <div className="muted layer-meta">
        {layer.featureCount.toLocaleString()} features ·{' '}
        {layer.manifest.vertexCount.toLocaleString()} vertices ·{' '}
        {layer.manifest.format.toUpperCase()} · parse {layer.manifest.elapsedMs} ms
        {layer.loadMs !== undefined && <> · total {(layer.loadMs / 1000).toFixed(1)} s</>}
      </div>
      {showWarnings && (
        <ul className="warnings">
          {layer.warnings.map((w) => (
            <li key={w.kind}>
              <strong>{w.kind}</strong> ×{w.count}
              <div className="muted">{w.message}</div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function LayersPanel() {
  const { layers, jobs, errors, dismissError } = useLayers();
  return (
    <aside className="left-panel" aria-label="Layers">
      <h2>Layers</h2>
      {errors.map((e) => (
        <div key={e.id} className="error banner" role="alert">
          <span>{e.message}</span>
          <button type="button" onClick={() => dismissError(e.id)} aria-label="Dismiss error">
            ✕
          </button>
        </div>
      ))}
      <ul className="plain stack">
        {jobs.map((j) => (
          <JobRow key={j.id} job={j} />
        ))}
        {layers.map((l) => (
          <LayerRow key={l.id} layer={l} />
        ))}
      </ul>
      {layers.length === 0 && jobs.length === 0 && (
        <p className="muted">Drop a KML, KMZ, GeoJSON, or GPX file on the window, or use Open.</p>
      )}
    </aside>
  );
}
