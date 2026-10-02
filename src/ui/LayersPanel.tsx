// Left panel: imported layers with a folder tree (per-folder visibility), opacity, warnings,
// import progress, and import errors. (Drag-to-reorder arrives later.)
import { useState } from 'react';
import { zoomToBounds } from '../globe/camera';
import type { FolderNode } from '../io/types';
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

function FolderRow({ layerId, node, depth }: { layerId: string; node: FolderNode; depth: number }) {
  const [open, setOpen] = useState(node.open);
  const setFolderVisible = useLayers((s) => s.setFolderVisible);
  const hasChildren = node.children.length > 0;
  return (
    <li>
      <div className="folder-row" style={{ paddingLeft: depth * 14 }}>
        {hasChildren ? (
          <button
            type="button"
            className="twisty"
            aria-label={open ? 'Collapse folder' : 'Expand folder'}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="twisty" />
        )}
        <label>
          <input
            type="checkbox"
            checked={node.visible}
            onChange={(e) => setFolderVisible(layerId, node.id, e.target.checked)}
          />
          <span className="folder-name">{node.name}</span>
          <span className="muted"> {node.featureCount > 0 ? `(${node.featureCount})` : ''}</span>
        </label>
      </div>
      {open && hasChildren && (
        <ul className="plain tree">
          {node.children.map((c) => (
            <FolderRow key={c.id} layerId={layerId} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function LayerRow({ layer, active }: { layer: Layer; active: boolean }) {
  const setVisible = useLayers((s) => s.setVisible);
  const setOpacity = useLayers((s) => s.setOpacity);
  const setActive = useLayers((s) => s.setActiveLayer);
  const [showWarnings, setShowWarnings] = useState(false);
  const warningTotal = layer.warnings.reduce((n, w) => n + w.count, 0);
  const root = layer.tree;
  const hasTree = root.children.length > 0;

  return (
    <li
      className={`layer${active ? ' active' : ''}`}
      aria-current={active ? 'true' : undefined}
      onClick={() => setActive(layer.id)}
    >
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
      <label className="opacity-row">
        <span className="muted">Opacity</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(layer.opacity * 100)}
          aria-label={`${layer.name} opacity`}
          onChange={(e) => setOpacity(layer.id, Number(e.target.value) / 100)}
        />
        <span className="muted opacity-value">{Math.round(layer.opacity * 100)}%</span>
      </label>
      {!root.visible && (
        <ul className="plain tree">
          <FolderRow layerId={layer.id} node={{ ...root, children: [] }} depth={0} />
        </ul>
      )}
      {hasTree && (
        <ul className="plain tree" aria-label={`${layer.name} folders`}>
          {root.children.map((c) => (
            <FolderRow key={c.id} layerId={layer.id} node={c} depth={0} />
          ))}
        </ul>
      )}
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
  const { layers, jobs, errors, dismissError, activeLayerId } = useLayers();
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
          <LayerRow key={l.id} layer={l} active={l.id === activeLayerId} />
        ))}
      </ul>
      {layers.length === 0 && jobs.length === 0 && (
        <p className="muted">Drop a KML, KMZ, GeoJSON, or GPX file on the window, or use Open.</p>
      )}
    </aside>
  );
}
