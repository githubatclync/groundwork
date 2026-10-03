// Right panel for the user layer: hints while drawing, and the edit form (name, description,
// style, custom attributes) for the selected feature. Every field change is one undo step; rapid
// typing in a field is coalesced.
import { zoomToBounds } from '../globe/camera';
import {
  BUILTIN_ICONS,
  useUserLayer,
  type BuiltinIcon,
  type UserFeature,
} from '../layers/userLayerStore';
import { drawKindOf } from '../tools/draftStore';
import { useTool } from '../tools/toolStore';

const HINT: Record<string, string> = {
  'draw-point': 'Click the globe to place a point.',
  'draw-line': 'Click to add vertices. Double-click or press Enter to finish; Escape cancels.',
  'draw-polygon': 'Click the corners. Double-click or press Enter to finish; Escape cancels.',
  edit: 'Click a feature to select it. Drag a handle to move a vertex; click a small midpoint handle to insert one; Alt-click a vertex to delete it.',
};

function bounds(f: UserFeature): [number, number, number, number] {
  const lons = f.coords.map((c) => c[0]);
  const lats = f.coords.map((c) => c[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

export function PlaceEditor() {
  const tool = useTool((s) => s.tool);
  const features = useUserLayer((s) => s.features);
  const selectedId = useUserLayer((s) => s.selectedId);
  const update = useUserLayer((s) => s.update);
  const remove = useUserLayer((s) => s.remove);
  const f = features.find((x) => x.id === selectedId) ?? null;
  const hint = HINT[tool];

  if (!f) {
    if (!hint) return null;
    return (
      <aside className="right-panel" aria-label="Drawing">
        <div className="panel-head">
          <h2>{drawKindOf(tool) ? `Draw ${drawKindOf(tool)}` : 'Edit'}</h2>
          <button
            type="button"
            onClick={() => useTool.getState().setTool('none')}
            aria-label="Leave tool"
          >
            ✕
          </button>
        </div>
        <p className="muted">{hint}</p>
      </aside>
    );
  }

  const set = (patch: Partial<Omit<UserFeature, 'id'>>, field: string) =>
    update(f.id, patch, `${f.id}:${field}`);
  const setStyle = (patch: Partial<UserFeature['style']>, field: string) =>
    set({ style: { ...f.style, ...patch } }, `style-${field}`);
  const setAttr = (i: number, pair: [string, string]) =>
    set({ attrs: f.attrs.map((a, j) => (j === i ? pair : a)) }, 'attrs');

  return (
    <aside className="right-panel place-editor" aria-label="Edit feature">
      <div className="panel-head">
        <h2>{f.name || 'Untitled'}</h2>
        <button
          type="button"
          onClick={() => useUserLayer.getState().select(null)}
          aria-label="Close editor"
        >
          ✕
        </button>
      </div>
      <div className="muted">
        My Places · {f.kind} · {f.coords.length} vertices
      </div>
      {hint && <p className="muted small">{hint}</p>}

      <label className="field">
        <span>Name</span>
        <input value={f.name} onChange={(e) => set({ name: e.target.value }, 'name')} />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea
          rows={3}
          value={f.description}
          onChange={(e) => set({ description: e.target.value }, 'description')}
        />
      </label>

      <h3>Style</h3>
      <div className="style-grid">
        <label>
          Color
          <input
            type="color"
            value={f.style.color}
            onChange={(e) => setStyle({ color: e.target.value }, 'color')}
          />
        </label>
        {f.kind !== 'point' && (
          <label>
            Width {f.style.width}px
            <input
              type="range"
              min={1}
              max={12}
              value={f.style.width}
              onChange={(e) => setStyle({ width: Number(e.target.value) }, 'width')}
            />
          </label>
        )}
        {f.kind === 'polygon' && (
          <label>
            Fill {Math.round(f.style.fillOpacity * 100)}%
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(f.style.fillOpacity * 100)}
              onChange={(e) => setStyle({ fillOpacity: Number(e.target.value) / 100 }, 'fill')}
            />
          </label>
        )}
        {f.kind === 'point' && (
          <>
            <label>
              Icon
              <select
                value={f.style.icon ?? ''}
                onChange={(e) =>
                  setStyle({ icon: (e.target.value || null) as BuiltinIcon | null }, 'icon')
                }
              >
                <option value="">Default marker</option>
                {BUILTIN_ICONS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Size {f.style.scale.toFixed(1)}×
              <input
                type="range"
                min={5}
                max={30}
                value={Math.round(f.style.scale * 10)}
                onChange={(e) => setStyle({ scale: Number(e.target.value) / 10 }, 'scale')}
              />
            </label>
          </>
        )}
      </div>

      <h3>Attributes</h3>
      {f.attrs.map(([k, v], i) => (
        <div className="attr-row" key={i}>
          <input
            aria-label="Attribute name"
            placeholder="name"
            value={k}
            onChange={(e) => setAttr(i, [e.target.value, v])}
          />
          <input
            aria-label="Attribute value"
            placeholder="value"
            value={v}
            onChange={(e) => setAttr(i, [k, e.target.value])}
          />
          <button
            type="button"
            aria-label="Remove attribute"
            onClick={() => set({ attrs: f.attrs.filter((_, j) => j !== i) }, 'attrs-remove')}
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" onClick={() => set({ attrs: [...f.attrs, ['', '']] }, 'attrs-add')}>
        Add attribute
      </button>

      <div className="measure-actions">
        {tool !== 'edit' && (
          <button type="button" onClick={() => useTool.getState().setTool('edit')}>
            Edit vertices
          </button>
        )}
        <button type="button" onClick={() => zoomToBounds(bounds(f))}>
          Zoom to
        </button>
        <button type="button" onClick={() => remove(f.id)}>
          Delete
        </button>
      </div>
    </aside>
  );
}
