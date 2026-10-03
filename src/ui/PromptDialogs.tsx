// Dialogs behind the prompt store: "Locate file…" for a missing project source, and the CSV
// column confirmation (detected latitude/longitude columns with a preview of the data).
import { useState } from 'react';
import { GEODATA_EXTENSIONS } from '../io/import';
import { basename } from '../project/paths';
import { usePrompts } from './promptStore';

export function LocateDialog() {
  const locate = usePrompts((s) => s.locate);
  const close = usePrompts((s) => s.closeLocate);
  if (!locate) return null;

  const finish = (path: string | null) => {
    locate.resolve(path);
    close();
  };
  const pick = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const ext = locate.path.split('.').pop()?.toLowerCase() ?? '';
    const chosen = await open({
      multiple: false,
      title: `Locate ${basename(locate.path)}`,
      filters: [
        { name: basename(locate.path), extensions: [ext || '*'] },
        { name: 'Geodata', extensions: GEODATA_EXTENSIONS },
      ],
    });
    if (typeof chosen === 'string') finish(chosen);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Locate file">
        <h2>File not found</h2>
        <p>
          The project refers to <strong>{basename(locate.path)}</strong>, but it is no longer there:
        </p>
        <p className="muted path">{locate.path}</p>
        <div className="modal-actions">
          <button type="button" onClick={() => finish(null)}>
            Skip this layer
          </button>
          <button type="button" onClick={() => void pick()}>
            Locate file…
          </button>
        </div>
      </div>
    </div>
  );
}

export function CsvImportDialog() {
  const prompt = usePrompts((s) => s.csv);
  const close = usePrompts((s) => s.closeCsv);
  const [lat, setLat] = useState<number | null | undefined>(undefined);
  const [lon, setLon] = useState<number | null | undefined>(undefined);
  if (!prompt) return null;
  const { inspection } = prompt;
  const latCol = lat === undefined ? inspection.latCol : lat;
  const lonCol = lon === undefined ? inspection.lonCol : lon;
  const valid = latCol !== null && lonCol !== null && latCol !== lonCol;

  const finish = (choice: { latCol: number; lonCol: number } | null) => {
    prompt.resolve(choice);
    close();
    setLat(undefined);
    setLon(undefined);
  };
  const columnSelect = (label: string, value: number | null, set: (v: number | null) => void) => (
    <label className="field">
      <span>{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))}
      >
        <option value="">Choose a column…</option>
        {inspection.headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `(column ${i + 1})`}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="modal-backdrop">
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Import CSV points">
        <h2>Import points from CSV</h2>
        <p className="muted">
          {basename(prompt.path)} · delimiter “
          {inspection.delimiter === '\t' ? 'tab' : inspection.delimiter}” ·{' '}
          {inspection.latCol !== null && inspection.lonCol !== null
            ? 'latitude and longitude columns were detected'
            : 'latitude and longitude columns could not be detected, please choose them'}
        </p>
        <div className="csv-columns">
          {columnSelect('Latitude column', latCol, setLat)}
          {columnSelect('Longitude column', lonCol, setLon)}
        </div>
        <div className="csv-preview" role="region" aria-label="Data preview">
          <table>
            <thead>
              <tr>
                {inspection.headers.map((h, i) => (
                  <th key={i} className={i === latCol || i === lonCol ? 'picked' : undefined}>
                    {h}
                    {i === latCol ? ' (lat)' : i === lonCol ? ' (lon)' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inspection.sample.map((row, r) => (
                <tr key={r}>
                  {inspection.headers.map((_, i) => (
                    <td key={i} className={i === latCol || i === lonCol ? 'picked' : undefined}>
                      {row[i] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {latCol !== null && lonCol !== null && latCol === lonCol && (
          <div className="error" role="alert">
            Latitude and longitude must be different columns.
          </div>
        )}
        <div className="modal-actions">
          <button type="button" onClick={() => finish(null)}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid}
            onClick={() => valid && finish({ latCol: latCol as number, lonCol: lonCol as number })}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
