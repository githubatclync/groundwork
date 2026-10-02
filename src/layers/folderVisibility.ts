// Effective folder visibility: a folder is shown only if it and all its ancestors are visible.
import type { FolderNode } from '../io/types';

/** Maps folder id to whether it is effectively visible. */
export function effectiveFolderVisibility(root: FolderNode): Map<number, boolean> {
  const out = new Map<number, boolean>();
  const walk = (node: FolderNode, parentVisible: boolean) => {
    const visible = parentVisible && node.visible;
    out.set(node.id, visible);
    node.children.forEach((c) => walk(c, visible));
  };
  walk(root, true);
  return out;
}
