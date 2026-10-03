// The `?` help overlay: every keyboard shortcut, grouped. Generated from the shortcut table.
import { useEffect } from 'react';
import { SHORTCUTS } from './shortcuts';

const GROUPS = ['Files', 'Tools', 'View', 'Editing'] as const;

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === '?') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>Keyboard shortcuts</h2>
        <div className="shortcut-groups">
          {GROUPS.map((g) => (
            <section key={g}>
              <h3>{g}</h3>
              <dl className="shortcut-list">
                {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <div key={s.id} className="shortcut-row">
                    <dt>
                      <kbd>{s.keys}</kbd>
                    </dt>
                    <dd>{s.description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="muted small">
          Single-key shortcuts are ignored while typing in a text field. On macOS, Ctrl means Cmd.
        </p>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
