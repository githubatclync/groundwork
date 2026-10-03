// "Project" menu: open, save, save as, and recently used projects.
import { useEffect, useRef, useState } from 'react';
import { openPaths } from '../layers/openPaths';
import { basename, dirname } from '../project/paths';
import { PROJECT_SUFFIX } from '../project/projectFile';
import { saveProject } from '../project/projectManager';
import { useProject } from '../project/projectStore';
import { useSettings } from '../settings/settingsStore';

export function ProjectMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const recent = useSettings((s) => s.recentProjects);
  const current = useProject((s) => s.path);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const run = (fn: () => unknown) => () => {
    setOpen(false);
    void fn();
  };
  const openProjectDialog = async () => {
    const { open: pick } = await import('@tauri-apps/plugin-dialog');
    const chosen = await pick({
      multiple: false,
      filters: [{ name: 'Groundwork project', extensions: ['json'] }],
    });
    if (typeof chosen === 'string') await openPaths([chosen]);
  };

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={current ?? 'Unsaved project'}
      >
        Project ▾
      </button>
      {open && (
        <div className="menu-popover" role="menu">
          <button type="button" role="menuitem" onClick={run(openProjectDialog)}>
            Open project…
          </button>
          <button type="button" role="menuitem" onClick={run(() => saveProject(false))}>
            Save project <kbd>Ctrl+S</kbd>
          </button>
          <button type="button" role="menuitem" onClick={run(() => saveProject(true))}>
            Save project as…
          </button>
          {recent.length > 0 && <div className="menu-label">Recent projects</div>}
          {recent.map((p) => (
            <button
              key={p}
              type="button"
              role="menuitem"
              title={p}
              onClick={run(() => openPaths([p]))}
            >
              {basename(p).replace(PROJECT_SUFFIX, '')}{' '}
              <span className="muted small">{dirname(p)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
