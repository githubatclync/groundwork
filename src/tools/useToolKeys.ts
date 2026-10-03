// Keyboard shortcuts for tools and the user layer:
//   Escape      cancel the current measurement / drawing; a second press leaves the tool
//   Enter       finish a path, area, line, or polygon
//   Delete      delete the selected user feature
//   Ctrl/Cmd+Z  undo; Shift+Ctrl/Cmd+Z (or Ctrl+Y) redo
// Typing in a text field is left alone so the field's own undo works.
import { useEffect } from 'react';
import { useUserLayer } from '../layers/userLayerStore';
import { finishDraft } from './createFeature';
import { drawKindOf, useDraft } from './draftStore';
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
      const mod = e.ctrlKey || e.metaKey;
      const layer = useUserLayer.getState();

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) layer.redo();
        else layer.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        layer.redo();
        return;
      }

      const tool = useTool.getState().tool;
      const measureMode = measureModeOf(tool);
      const drawKind = drawKindOf(tool);

      if (e.key === 'Escape') {
        if (measureMode && useMeasure.getState().points.length > 0) useMeasure.getState().reset();
        else if (drawKind && useDraft.getState().points.length > 0) useDraft.getState().reset();
        else if (tool !== 'none') useTool.getState().setTool('none');
        else if (layer.selectedId !== null) layer.select(null);
      } else if (e.key === 'Enter') {
        if (measureMode) useMeasure.getState().finish(measureMode);
        else if (drawKind && drawKind !== 'point') finishDraft(drawKind);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && layer.selectedId !== null) {
        if (tool === 'none' || tool === 'edit') layer.remove(layer.selectedId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
