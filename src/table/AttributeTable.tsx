// Bottom drawer: a virtualized, sortable, filterable table of the active layer's attributes.
// Rows are paged from Rust; sorting and filtering run there too (TanStack Table manages the
// header/sort state, TanStack Virtual renders only the visible rows).
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import { currentViewBounds, onCameraSettled, zoomToBounds } from '../globe/camera';
import {
  EMPTY_VIEW,
  findRow,
  getFeature,
  type AttrRow,
  type ColumnFilter,
  type FilterOp,
  type ViewSpec,
} from '../io/attributes';
import type { Bounds } from '../io/types';
import { useLayers, type Layer } from '../layers/layerStore';
import { useSelection } from '../selection/selectionStore';
import { useUi } from '../ui/uiStore';
import { useAttributeRows } from './useAttributeRows';

const ROW_HEIGHT = 26;
const NO_ROWS: AttrRow[] = [];

const OPS: { op: FilterOp; label: string }[] = [
  { op: 'contains', label: 'contains' },
  { op: 'eq', label: '=' },
  { op: 'gt', label: '>' },
  { op: 'lt', label: '<' },
];

/** Debounces a fast-changing value (typing) before it reaches the Rust query. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function TableBody({ layer }: { layer: Layer }) {
  const columns = layer.manifest.columns;
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalText, setGlobalText] = useState('');
  const [colFilters, setColFilters] = useState<Record<string, { op: FilterOp; value: string }>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [inView, setInView] = useState(false);
  const [viewBounds, setViewBounds] = useState<Bounds | null>(null);
  const selection = useSelection((s) => s.selection);

  const debouncedGlobal = useDebounced(globalText, 250);
  const debouncedFilters = useDebounced(colFilters, 250);

  // "Show only features in view": follow the camera, debounced.
  useEffect(() => {
    if (!inView) {
      setViewBounds(null);
      return;
    }
    setViewBounds(currentViewBounds());
    return onCameraSettled(() => setViewBounds(currentViewBounds()));
  }, [inView]);

  const spec: ViewSpec = useMemo(() => {
    const filters: ColumnFilter[] = Object.entries(debouncedFilters)
      .filter(([, f]) => f.value.trim() !== '')
      .map(([column, f]) => ({ column, op: f.op, value: f.value }));
    const s = sorting[0];
    return {
      ...EMPTY_VIEW,
      sort: s ? { column: s.id, desc: s.desc } : null,
      global: debouncedGlobal.trim() || null,
      filters,
      bounds: inView ? viewBounds : null,
    };
  }, [sorting, debouncedGlobal, debouncedFilters, inView, viewBounds]);

  const rows = useAttributeRows(layer.id, spec);

  const defs = useMemo<ColumnDef<AttrRow>[]>(
    () => [
      // Accessors make the columns sortable; the cells themselves are rendered from paged rows.
      { id: 'name', header: 'Name', accessorFn: (r) => r.cells[0], sortDescFirst: false },
      ...columns.map((c, i) => ({
        id: c.name,
        header: c.name,
        accessorFn: (r: AttrRow) => r.cells[i + 1],
        sortDescFirst: false,
      })),
    ],
    [columns],
  );
  const table = useReactTable({
    data: NO_ROWS, // rows are paged from Rust, so the table instance only manages headers and sorting
    columns: defs,
    state: { sorting },
    onSortingChange: setSorting,
    manualSorting: true,
    enableMultiSort: false,
    getCoreRowModel: getCoreRowModel(),
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const items = virtualizer.getVirtualItems();
  const first = items[0]?.index ?? 0;
  const last = items[items.length - 1]?.index ?? 0;
  const { ensureRange } = rows;
  useEffect(() => {
    if (rows.total > 0) ensureRange(first, last);
  }, [first, last, rows.total, rows.version, ensureRange]);

  // A feature picked on the globe scrolls its row into view.
  useEffect(() => {
    if (!selection || selection.source !== 'globe' || selection.layerId !== layer.id) return;
    let cancelled = false;
    void findRow(layer.id, spec, selection.featureId).then((index) => {
      if (!cancelled && index !== null) virtualizer.scrollToIndex(index, { align: 'center' });
    });
    return () => {
      cancelled = true;
    };
    // Only re-run when the selection changes, not on every filter keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  const select = (row: AttrRow) => {
    useSelection.getState().select(layer.id, row.featureId, 'table');
    void getFeature(layer.id, row.featureId)
      .then((d) => zoomToBounds(d.bounds))
      .catch(() => undefined);
  };

  const template = `minmax(190px, 1.4fr) repeat(${columns.length}, minmax(130px, 1fr))`;
  const minWidth = 190 + columns.length * 130;

  return (
    <>
      <div className="table-toolbar">
        <input
          type="search"
          placeholder="Search all columns…"
          aria-label="Search all columns"
          value={globalText}
          onChange={(e) => setGlobalText(e.target.value)}
        />
        <button type="button" aria-pressed={showFilters} onClick={() => setShowFilters((v) => !v)}>
          Column filters
        </button>
        <label className="field-inline">
          <input type="checkbox" checked={inView} onChange={(e) => setInView(e.target.checked)} />
          Only features in view
        </label>
        <span className="muted count">
          {rows.total.toLocaleString()} of {layer.featureCount.toLocaleString()} rows
        </span>
      </div>
      {rows.error && (
        <div className="error banner" role="alert">
          {rows.error}
        </div>
      )}
      <div className="table-scroll" ref={scrollRef}>
        <div style={{ minWidth }}>
          <div className="thead" style={{ gridTemplateColumns: template }} role="row">
            {table.getHeaderGroups()[0].headers.map((h) => {
              const dir = h.column.getIsSorted();
              return (
                <button
                  type="button"
                  key={h.id}
                  className="th"
                  role="columnheader"
                  aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
                  onClick={h.column.getToggleSortingHandler()}
                  title="Click to sort"
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                  <span className="sort-mark">
                    {dir === 'asc' ? ' ▲' : dir === 'desc' ? ' ▼' : ''}
                  </span>
                </button>
              );
            })}
          </div>
          {showFilters && (
            <div className="thead filter-row" style={{ gridTemplateColumns: template }}>
              {[{ name: 'name', type: 'string' as const }, ...columns].map((c) => {
                const f = colFilters[c.name] ?? { op: 'contains' as FilterOp, value: '' };
                const ops = c.type === 'number' ? OPS : OPS.slice(0, 2);
                const set = (patch: Partial<typeof f>) =>
                  setColFilters((prev) => ({ ...prev, [c.name]: { ...f, ...patch } }));
                return (
                  <div key={c.name} className="filter-cell">
                    <select
                      aria-label={`${c.name} filter operator`}
                      value={f.op}
                      onChange={(e) => set({ op: e.target.value as FilterOp })}
                    >
                      {ops.map((o) => (
                        <option key={o.op} value={o.op}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`${c.name} filter`}
                      value={f.value}
                      onChange={(e) => set({ value: e.target.value })}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {items.map((item) => {
              const row = rows.getRow(item.index);
              const selected =
                !!row && selection?.layerId === layer.id && selection.featureId === row.featureId;
              return (
                <div
                  key={item.key}
                  role="row"
                  aria-selected={selected}
                  className={`tr${selected ? ' selected' : ''}${item.index % 2 ? ' odd' : ''}`}
                  style={{
                    gridTemplateColumns: template,
                    height: ROW_HEIGHT,
                    transform: `translateY(${item.start}px)`,
                  }}
                  onClick={() => row && select(row)}
                  onDoubleClick={() => {
                    if (!row) return;
                    select(row);
                    useUi.getState().setDetailsOpen(true);
                  }}
                >
                  {row ? (
                    row.cells.map((cell, i) => (
                      <span key={i} className="td" title={cell ?? ''}>
                        {cell}
                      </span>
                    ))
                  ) : (
                    <span className="td muted">…</span>
                  )}
                </div>
              );
            })}
          </div>
          {rows.total === 0 && <p className="muted empty">No rows match.</p>}
        </div>
      </div>
    </>
  );
}

export function AttributeTable() {
  const layers = useLayers((s) => s.layers);
  const activeId = useLayers((s) => s.activeLayerId);
  const setActive = useLayers((s) => s.setActiveLayer);
  const height = useUi((s) => s.tableHeight);
  const setHeight = useUi((s) => s.setTableHeight);
  const setOpen = useUi((s) => s.setTableOpen);
  const layer = layers.find((l) => l.id === activeId) ?? null;

  // Drag the handle to resize the drawer.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const move = (ev: PointerEvent) =>
      setHeight(Math.min(window.innerHeight * 0.75, startH + (startY - ev.clientY)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <section className="table-drawer" style={{ height }} aria-label="Attribute table">
      <div
        className="resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize attribute table"
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') setHeight(height + 20);
          if (e.key === 'ArrowDown') setHeight(height - 20);
        }}
      />
      <div className="table-title">
        <strong>Attributes</strong>
        {layers.length > 1 && (
          <select
            aria-label="Layer"
            value={activeId ?? ''}
            onChange={(e) => setActive(e.target.value)}
          >
            {layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        {layers.length === 1 && <span className="muted">{layers[0].name}</span>}
        <span className="spacer" />
        <button type="button" onClick={() => setOpen(false)} aria-label="Close attribute table">
          ✕
        </button>
      </div>
      {layer ? (
        <TableBody key={layer.id} layer={layer} />
      ) : (
        <p className="muted empty">Open a file to see its attributes.</p>
      )}
    </section>
  );
}
