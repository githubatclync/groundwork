// Global keyboard shortcuts (see ui/shortcuts.ts for the table). Escape, Enter, Delete, and undo/redo
// live in tools/useToolKeys. Single-key shortcuts are ignored while typing in a field.
import { useEffect } from 'react';
import { pickGeodataFiles } from '../io/import';
import { openPaths } from '../layers/openPaths';
import { saveProject } from '../project/projectManager';
import { useTool } from '../tools/toolStore';
import { matchShortcut, toolOfShortcut } from './shortcuts';
import { useUi } from './uiStore';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.isContentEditable)
  );
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const hasMod = e.ctrlKey || e.metaKey;
      // Ctrl/Cmd combinations work everywhere except inside text fields (where they edit text).
      if (isTyping(e.target) && !hasMod) return;
      const id = matchShortcut(e);
      if (!id) return;
      e.preventDefault();
      const ui = useUi.getState();
      const tool = toolOfShortcut(id);
      if (tool) {
        const t = useTool.getState();
        t.setTool(t.tool === tool ? 'none' : tool);
        return;
      }
      switch (id) {
        case 'open':
          void pickGeodataFiles().then((paths) => (paths.length ? openPaths(paths) : undefined));
          break;
        case 'save':
          void saveProject(false);
          break;
        case 'saveAs':
          void saveProject(true);
          break;
        case 'export':
          ui.setDialog('export');
          break;
        case 'exportImage':
          ui.setDialog('image');
          break;
        case 'table':
          ui.setTableOpen(!ui.tableOpen);
          break;
        case 'search':
          document.querySelector<HTMLInputElement>('input[data-search]')?.focus();
          break;
        case 'help':
          ui.setDialog(ui.dialog === 'shortcuts' ? null : 'shortcuts');
          break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
