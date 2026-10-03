// Path helpers for project files: store sources relative to the project file when possible (so a
// project and its data can be moved together), and resolve them again on load. Pure string logic
// that understands Windows drive letters and both slash styles.

const toSlashes = (p: string) => p.replace(/\\/g, '/');

/** True for `C:/x`, `/x`, or `//server/share`. */
export function isAbsolute(p: string): boolean {
  const s = toSlashes(p);
  return /^[a-zA-Z]:\//.test(s) || s.startsWith('/');
}

/** `root` is lowercased for comparison; `display` keeps the original drive-letter case for output. */
function splitRoot(p: string): { root: string; display: string; parts: string[] } {
  const s = toSlashes(p);
  const drive = /^([a-zA-Z]:)\/?/.exec(s);
  const display = drive ? drive[1] : s.startsWith('/') ? '/' : '';
  const root = display.toLowerCase();
  const rest = drive ? s.slice(drive[0].length) : s.replace(/^\/+/, '');
  return { root, display, parts: rest.split('/').filter((x) => x !== '' && x !== '.') };
}

function collapse(parts: string[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else out.push('..');
    } else out.push(part);
  }
  return out;
}

/** Directory part of a path (forward slashes), without a trailing slash. */
export function dirname(p: string): string {
  const s = toSlashes(p);
  const i = s.lastIndexOf('/');
  return i <= 0 ? (i === 0 ? '/' : '') : s.slice(0, i);
}

export function basename(p: string): string {
  const s = toSlashes(p);
  return s.slice(s.lastIndexOf('/') + 1);
}

/**
 * The path of `target` relative to the folder holding `projectFile`, with forward slashes. Returns
 * null when there is no relative form (different drives or roots), so the caller keeps it absolute.
 */
export function relativeTo(projectFile: string, target: string): string | null {
  if (!isAbsolute(target) || !isAbsolute(projectFile)) return null;
  const from = splitRoot(dirname(projectFile));
  const to = splitRoot(target);
  if (from.root !== to.root) return null;
  const a = collapse(from.parts);
  const b = collapse(to.parts);
  const same = (x: string, y: string) =>
    from.root === '/' ? x === y : x.toLowerCase() === y.toLowerCase();
  let i = 0;
  while (i < a.length && i < b.length && same(a[i], b[i])) i++;
  const rel = [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
  return rel || '.';
}

/**
 * Resolves a stored source against the project file's folder. Absolute paths pass through. The
 * result uses the project file's own slash style so it looks native in dialogs.
 */
export function resolveSource(projectFile: string, source: string): string {
  const useBackslash = projectFile.includes('\\');
  const out = (s: string) => (useBackslash ? s.replace(/\//g, '\\') : s);
  if (isAbsolute(source)) return out(toSlashes(source));
  const base = splitRoot(dirname(projectFile));
  const parts = collapse([...base.parts, ...splitRoot(source).parts]);
  const prefix = base.root === '/' ? '/' : base.display ? `${base.display}/` : '';
  return out(prefix + parts.join('/'));
}
