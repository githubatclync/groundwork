// Export Image dialog: resolution (1x / 2x / 4x of the screen), optional title, scale bar, north
// arrow, and legend. The attribution is always included and cannot be turned off.
import { useEffect, useState } from 'react';
import { previewSize } from '../globe/capture';
import { getViewer } from '../globe/viewerRegistry';
import { choosePngPath, savePng } from '../io/csv';
import { renderExportImage, type ImageExportOptions, type ImageScale } from '../tools/imageExport';

const SCALES: ImageScale[] = [1, 2, 4];

export function ImageExportDialog({ onClose }: { onClose: () => void }) {
  const [scale, setScale] = useState<ImageScale>(2);
  const [title, setTitle] = useState('');
  const [scaleBar, setScaleBar] = useState(true);
  const [northArrow, setNorthArrow] = useState(true);
  const [legend, setLegend] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = status !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const viewer = getViewer();
  const size = viewer ? previewSize(viewer, scale) : null;

  const run = async () => {
    setError(null);
    setResult(null);
    try {
      const path = await choosePngPath(title.trim() || 'Groundwork view');
      if (!path) return;
      const opts: ImageExportOptions = { scale, title, scaleBar, northArrow, legend };
      setStatus('Preparing…');
      const img = await renderExportImage(opts, setStatus);
      setStatus('Saving…');
      await savePng(img.blob, path);
      setResult(
        `Saved ${img.width} × ${img.height} px (${(img.blob.size / 1e6).toFixed(1)} MB) to ${path}` +
          (img.clamped
            ? ` — reduced to ${img.effectiveScale.toFixed(2)}× because the full size exceeds what this GPU can render.`
            : ''),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus(null);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Export image"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>Export image</h2>
        <p className="muted">Saves the current view as a PNG.</p>

        <fieldset className="formats">
          <legend>Resolution</legend>
          {SCALES.map((s) => (
            <label key={s} className="field-inline">
              <input
                type="radio"
                name="scale"
                checked={scale === s}
                disabled={busy}
                onChange={() => setScale(s)}
              />
              <span>
                {s}× screen resolution
                {viewer && (
                  <small className="muted">
                    {' '}
                    {previewSize(viewer, s).width} × {previewSize(viewer, s).height} px
                    {previewSize(viewer, s).clamped ? ' (limited by GPU)' : ''}
                  </small>
                )}
              </span>
            </label>
          ))}
        </fieldset>

        <label className="field">
          <span>Title (optional)</span>
          <input
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Shown at the top of the image"
          />
        </label>

        <fieldset className="formats">
          <legend>Overlays</legend>
          <label className="field-inline">
            <input
              type="checkbox"
              checked={scaleBar}
              disabled={busy}
              onChange={(e) => setScaleBar(e.target.checked)}
            />
            Scale bar
          </label>
          <label className="field-inline">
            <input
              type="checkbox"
              checked={northArrow}
              disabled={busy}
              onChange={(e) => setNorthArrow(e.target.checked)}
            />
            North arrow
          </label>
          <label className="field-inline">
            <input
              type="checkbox"
              checked={legend}
              disabled={busy}
              onChange={(e) => setLegend(e.target.checked)}
            />
            Legend (visible layers)
          </label>
          <label className="field-inline">
            <input type="checkbox" checked disabled readOnly />
            Attribution <small className="muted">(always included)</small>
          </label>
        </fieldset>

        {size?.clamped && (
          <p className="muted small">
            The full size is more than this GPU can render, so the image will be {size.width} ×{' '}
            {size.height} px.
          </p>
        )}
        {status && (
          <p role="status" aria-live="polite">
            {status}
          </p>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {result && (
          <div role="status" className="export-result">
            {result}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
          <button type="button" disabled={busy || !viewer} onClick={() => void run()}>
            {busy ? 'Working…' : 'Export PNG…'}
          </button>
        </div>
      </div>
    </div>
  );
}
