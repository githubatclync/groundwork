// Keyboard shortcuts for tools: Escape cancels the current measurement (a second Escape leaves
// the tool), and Enter finishes a path or area.
import { useEffect } from 'react';
import { useMeasure } from './measureStore';
import { measureModeOf, useTool } from './toolStore';

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

export function useToolKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mode = measureModeOf(useTool.getState().tool);
      if (!mode) return;
      if (e.key === 'Escape') {
        if (useMeasure.getState().points.length > 0) useMeasure.getState().reset();
        else useTool.getState().setTool('none');
      } else if (e.key === 'Enter') {
        useMeasure.getState().finish(mode);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
