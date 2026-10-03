import { describe, expect, it } from 'vitest';
import { SHORTCUTS, matchShortcut, toolOfShortcut, type KeyEventLike } from './shortcuts';

const ev = (key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('shortcuts', () => {
  it('has unique ids and complete descriptions', () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
    for (const s of SHORTCUTS) {
      expect(s.description.length).toBeGreaterThan(3);
      expect(s.keys).toBeTruthy();
    }
  });

  it('matches file shortcuts with Ctrl or Cmd, and tells Shift variants apart', () => {
    expect(matchShortcut(ev('o', { ctrlKey: true }))).toBe('open');
    expect(matchShortcut(ev('O', { metaKey: true }))).toBe('open');
    expect(matchShortcut(ev('s', { ctrlKey: true }))).toBe('save');
    expect(matchShortcut(ev('S', { ctrlKey: true, shiftKey: true }))).toBe('saveAs');
    expect(matchShortcut(ev('e', { ctrlKey: true }))).toBe('export');
    expect(matchShortcut(ev('E', { ctrlKey: true, shiftKey: true }))).toBe('exportImage');
  });

  it('matches tool keys 1-7 only without modifiers', () => {
    expect(matchShortcut(ev('1'))).toBe('tool:measure-distance');
    expect(matchShortcut(ev('7'))).toBe('tool:edit');
    expect(matchShortcut(ev('1', { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(ev('1', { altKey: true }))).toBeNull();
    expect(toolOfShortcut('tool:draw-polygon')).toBe('draw-polygon');
    expect(toolOfShortcut('save')).toBeNull();
  });

  it('matches view keys', () => {
    expect(matchShortcut(ev('t'))).toBe('table');
    expect(matchShortcut(ev('T'))).toBe('table'); // Caps Lock still works
    expect(matchShortcut(ev('T', { shiftKey: true }))).toBeNull(); // Shift+T is not the shortcut
    expect(matchShortcut(ev('/'))).toBe('search');
    expect(matchShortcut(ev('?', { shiftKey: true }))).toBe('help');
  });

  it('every matchable shortcut is matched by its own event and by no other shortcut', () => {
    const samples: Record<string, KeyEventLike> = {
      open: ev('o', { ctrlKey: true }),
      save: ev('s', { ctrlKey: true }),
      saveAs: ev('s', { ctrlKey: true, shiftKey: true }),
      export: ev('e', { ctrlKey: true }),
      exportImage: ev('e', { ctrlKey: true, shiftKey: true }),
      table: ev('t'),
      search: ev('/'),
      help: ev('?', { shiftKey: true }),
    };
    for (const s of SHORTCUTS.filter((x) => x.match)) {
      const e = s.id.startsWith('tool:') ? ev(s.keys) : samples[s.id];
      expect(e, s.id).toBeDefined();
      const hits = SHORTCUTS.filter((x) => x.match?.(e)).map((x) => x.id);
      expect(hits, s.id).toEqual([s.id]);
    }
  });

  it('documents the editing shortcuts handled elsewhere', () => {
    const documented = SHORTCUTS.filter((s) => !s.match).map((s) => s.id);
    expect(documented).toEqual(
      expect.arrayContaining(['undo', 'redo', 'finish', 'cancel', 'delete']),
    );
    expect(matchShortcut(ev('z', { ctrlKey: true }))).toBeNull(); // undo is handled by useToolKeys
  });

  it('ignores ordinary typing', () => {
    for (const k of ['a', 'x', ' ', 'Enter', 'Escape', '8', '0'])
      expect(matchShortcut(ev(k))).toBeNull();
  });
});
