// Keyboard shortcuts: one table drives both the `?` help overlay and the key handler, so the two
// cannot disagree. `matchShortcut` is pure and unit-tested; entries without a matcher are handled
// elsewhere (tools/useToolKeys) and listed here for documentation.
import type { Tool } from '../tools/toolStore';

export type ShortcutId =
  | 'open'
  | 'save'
  | 'saveAs'
  | 'export'
  | 'exportImage'
  | 'table'
  | 'search'
  | 'help'
  | `tool:${Exclude<Tool, 'none'>}`
  | 'undo'
  | 'redo'
  | 'finish'
  | 'cancel'
  | 'delete';

export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface Shortcut {
  id: ShortcutId;
  group: 'Files' | 'Tools' | 'View' | 'Editing';
  keys: string;
  description: string;
  match?: (e: KeyEventLike) => boolean;
}

const mod = (e: KeyEventLike) => e.ctrlKey || e.metaKey;
const ctrl =
  (key: string, shift = false) =>
  (e: KeyEventLike) =>
    mod(e) && !e.altKey && e.shiftKey === shift && e.key.toLowerCase() === key;
const plain = (key: string) => (e: KeyEventLike) =>
  !mod(e) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === key;

const TOOL_KEYS: [string, Exclude<Tool, 'none'>, string][] = [
  ['1', 'measure-distance', 'Measure distance'],
  ['2', 'measure-path', 'Measure path'],
  ['3', 'measure-area', 'Measure area'],
  ['4', 'draw-point', 'Draw a point'],
  ['5', 'draw-line', 'Draw a line'],
  ['6', 'draw-polygon', 'Draw a polygon'],
  ['7', 'edit', 'Edit vertices'],
];

export const SHORTCUTS: Shortcut[] = [
  {
    id: 'open',
    group: 'Files',
    keys: 'Ctrl+O',
    description: 'Open files or a project',
    match: ctrl('o'),
  },
  { id: 'save', group: 'Files', keys: 'Ctrl+S', description: 'Save project', match: ctrl('s') },
  {
    id: 'saveAs',
    group: 'Files',
    keys: 'Ctrl+Shift+S',
    description: 'Save project as…',
    match: ctrl('s', true),
  },
  {
    id: 'export',
    group: 'Files',
    keys: 'Ctrl+E',
    description: 'Export a layer (KMZ, KML, GeoJSON)',
    match: ctrl('e'),
  },
  {
    id: 'exportImage',
    group: 'Files',
    keys: 'Ctrl+Shift+E',
    description: 'Export the view as an image',
    match: ctrl('e', true),
  },
  ...TOOL_KEYS.map(([key, tool, description]): Shortcut => ({
    id: `tool:${tool}`,
    group: 'Tools',
    keys: key,
    description,
    match: plain(key),
  })),
  {
    id: 'table',
    group: 'View',
    keys: 'T',
    description: 'Show or hide the attribute table',
    match: plain('t'),
  },
  {
    id: 'search',
    group: 'View',
    keys: '/',
    description: 'Focus the search box',
    match: (e) => !mod(e) && !e.altKey && e.key === '/',
  },
  {
    id: 'help',
    group: 'View',
    keys: '?',
    description: 'Show this help',
    match: (e) => !mod(e) && !e.altKey && e.key === '?',
  },
  { id: 'undo', group: 'Editing', keys: 'Ctrl+Z', description: 'Undo' },
  { id: 'redo', group: 'Editing', keys: 'Shift+Ctrl+Z  or  Ctrl+Y', description: 'Redo' },
  {
    id: 'finish',
    group: 'Editing',
    keys: 'Enter  or  double-click',
    description: 'Finish a path, area, line, or polygon',
  },
  {
    id: 'cancel',
    group: 'Editing',
    keys: 'Esc',
    description: 'Cancel the current action; press again to leave the tool',
  },
  {
    id: 'delete',
    group: 'Editing',
    keys: 'Delete',
    description: 'Delete the selected drawn feature',
  },
];

/** The shortcut an event triggers, or null. Only entries with a matcher can be returned. */
export function matchShortcut(e: KeyEventLike): ShortcutId | null {
  return SHORTCUTS.find((s) => s.match?.(e))?.id ?? null;
}

/** The tool a `tool:*` shortcut id selects. */
export function toolOfShortcut(id: ShortcutId): Exclude<Tool, 'none'> | null {
  return id.startsWith('tool:') ? (id.slice(5) as Exclude<Tool, 'none'>) : null;
}
