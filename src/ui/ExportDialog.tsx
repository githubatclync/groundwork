// Export dialog: pick a layer (My Places or any imported layer) and a format, then choose where to
// save. The Rust side writes the file; notes list anything the chosen format cannot preserve.
import { useEffect, useState } from 'react';
import {
  EXPORT_FORMATS,
  chooseExportPath,
  exportImportedLayer,
  exportUserLayer,
  type ExportFormatId,
  type ExportReport,
} from '../io/export';
import { useLayers } from '../layers/layerStore';
import { useUserLayer } from '../layers/userLayerStore';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const layers = useLayers((s) => s.layers);
  const userFeatures = useUserLayer((s) => s.features);
  const [target, setTarget] = useState<string>(
    userFeatures.length > 0 ? 'user' : (layers[0]?.id ?? ''),
  );
  const [format, setFormat] = useState<ExportFormatId>('kmz');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ExportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const options = [
    ...(userFeatures.length > 0
      ? [{ id: 'user', label: `My Places (${userFeatures.length} features)` }]
      : []),
    ...layers.map((l) => ({
      id: l.id,
      label: `${l.name} (${l.featureCount.toLocaleString()} features)`,
    })),
  ];
  const name =
    target === 'user' ? 'My Places' : (layers.find((l) => l.id === target)?.name ?? 'layer');

  const run = async () => {
    setError(null);
    setReport(null);
    try {
      const path = await chooseExportPath(name, format);
      if (!path) return;
      setBusy(true);
      setReport(
        target === 'user'
          ? await exportUserLayer('My Places', useUserLayer.getState().features, path)
          : await exportImportedLayer(target, path),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Export"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>Export layer</h2>
        {options.length === 0 ? (
          <p className="muted">Nothing to export yet. Open a file or draw some features first.</p>
        ) : (
          <>
            <label className="field">
              <span>Layer</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="formats">
              <legend>Format</legend>
              {EXPORT_FORMATS.map((f) => (
                <label key={f.id} className="field-inline">
                  <input
                    type="radio"
                    name="format"
                    checked={format === f.id}
                    onChange={() => setFormat(f.id)}
                  />
                  <span>
                    <strong>{f.label}</strong> <small className="muted">{f.note}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          </>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {report && (
          <div role="status" className="export-result">
            Saved {report.features.toLocaleString()} features to <code>{report.path}</code>
            {report.notes.map((n, i) => (
              <div key={i} className="muted small">
                {n}
              </div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" disabled={busy || options.length === 0} onClick={() => void run()}>
            {busy ? 'Exporting…' : 'Export…'}
          </button>
        </div>
      </div>
    </div>
  );
}
