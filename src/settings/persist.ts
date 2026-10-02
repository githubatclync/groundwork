// Persistence backend for settings. Uses the Tauri store plugin (app data dir) when running in
// the desktop shell, and falls back to localStorage when the frontend runs in a plain browser.
import type { Store } from '@tauri-apps/plugin-store';

const FILE = 'settings.json';
const LS_PREFIX = 'groundwork.settings.';

export const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = import('@tauri-apps/plugin-store').then(({ load }) =>
      load(FILE, { defaults: {}, autoSave: false }),
    );
  }
  return storePromise;
}

export async function loadAll(): Promise<Record<string, unknown>> {
  if (inTauri()) {
    const store = await getStore();
    const entries = await store.entries<unknown>();
    return Object.fromEntries(entries);
  }
  const out: Record<string, unknown> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LS_PREFIX))
        out[k.slice(LS_PREFIX.length)] = JSON.parse(localStorage.getItem(k) ?? 'null');
    }
  } catch {
    /* storage unavailable: start with defaults */
  }
  return out;
}

export async function saveValues(values: Record<string, unknown>): Promise<void> {
  if (inTauri()) {
    const store = await getStore();
    for (const [k, v] of Object.entries(values)) await store.set(k, v);
    await store.save();
    return;
  }
  try {
    for (const [k, v] of Object.entries(values))
      localStorage.setItem(LS_PREFIX + k, JSON.stringify(v));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}
