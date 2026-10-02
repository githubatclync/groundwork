// Zustand store for persisted settings (keys, basemap choice, display options) and the
// runtime list of open MBTiles basemaps. Business logic lives here, not in components.
import { create } from 'zustand';
import {
  BASEMAPS,
  OSM_ID,
  availability,
  mbtilesBasemap,
  mbtilesBasemapId,
  type BasemapConfig,
  type Keys,
  type MbtilesEntry,
} from '../globe/basemaps';
import type { CoordFormat } from '../globe/coords';
import type { AreaUnit, UnitSystem } from '../tools/units';
import { closeMbtiles, openMbtiles, pickMbtilesFile } from '../io/mbtiles';
import { inTauri, loadAll, saveValues } from './persist';

export interface PersistedSettings extends Keys {
  coordFormat: CoordFormat;
  unitSystem: UnitSystem;
  areaUnit: AreaUnit;
  showFps: boolean;
  basemapId: string;
  mbtilesPaths: string[];
}

export const DEFAULT_SETTINGS: PersistedSettings = {
  ionToken: '',
  esriKey: '',
  mapboxToken: '',
  coordFormat: 'dd',
  unitSystem: 'metric',
  areaUnit: 'auto',
  showFps: false,
  basemapId: OSM_ID,
  mbtilesPaths: [],
};

/** Keeps only values of the right type so a hand-edited or old settings file can't break startup. */
export function sanitizeSettings(raw: Record<string, unknown>): PersistedSettings {
  const d = DEFAULT_SETTINGS;
  const str = (k: keyof PersistedSettings) =>
    typeof raw[k] === 'string' ? (raw[k] as string) : (d[k] as string);
  const fmt = raw.coordFormat;
  return {
    ionToken: str('ionToken'),
    esriKey: str('esriKey'),
    mapboxToken: str('mapboxToken'),
    coordFormat: fmt === 'dd' || fmt === 'dms' || fmt === 'utm' ? fmt : d.coordFormat,
    unitSystem:
      raw.unitSystem === 'metric' || raw.unitSystem === 'imperial' || raw.unitSystem === 'nautical'
        ? raw.unitSystem
        : d.unitSystem,
    areaUnit:
      raw.areaUnit === 'auto' || raw.areaUnit === 'hectares' || raw.areaUnit === 'acres'
        ? raw.areaUnit
        : d.areaUnit,
    showFps: typeof raw.showFps === 'boolean' ? raw.showFps : d.showFps,
    basemapId: str('basemapId'),
    mbtilesPaths: Array.isArray(raw.mbtilesPaths)
      ? raw.mbtilesPaths.filter((p): p is string => typeof p === 'string')
      : [],
  };
}

interface SettingsState extends PersistedSettings {
  loaded: boolean;
  /** MBTiles files known to the app (open ones have a runtimeId). */
  mbtiles: MbtilesEntry[];
  /** Human-readable problems from loading settings or MBTiles files. */
  problems: string[];
  init: () => Promise<void>;
  update: (patch: Partial<PersistedSettings>) => Promise<void>;
  addMbtiles: () => Promise<void>;
  removeMbtiles: (path: string) => Promise<void>;
  dismissProblems: () => void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,
  mbtiles: [],
  problems: [],

  init: async () => {
    if (get().loaded) return;
    const settings = sanitizeSettings(await loadAll().catch(() => ({})));
    const mbtiles: MbtilesEntry[] = [];
    const problems: string[] = [];
    const keptPaths: string[] = [];
    if (inTauri()) {
      for (const path of settings.mbtilesPaths) {
        try {
          mbtiles.push(await openMbtiles(path));
          keptPaths.push(path);
        } catch (e) {
          problems.push(message(e));
        }
      }
    }
    set({ ...settings, mbtilesPaths: keptPaths, mbtiles, problems, loaded: true });
    if (keptPaths.length !== settings.mbtilesPaths.length) {
      await saveValues({ mbtilesPaths: keptPaths }).catch(() => undefined);
    }
  },

  update: async (patch) => {
    set(patch);
    await saveValues(patch).catch((e) =>
      set({ problems: [`Could not save settings: ${message(e)}`] }),
    );
  },

  addMbtiles: async () => {
    try {
      const path = await pickMbtilesFile();
      if (!path) return;
      if (get().mbtiles.some((m) => m.path === path)) {
        await get().update({ basemapId: mbtilesBasemapId(path) });
        return;
      }
      const entry = await openMbtiles(path);
      const mbtilesPaths = [...get().mbtilesPaths, path];
      set({ mbtiles: [...get().mbtiles, entry] });
      await get().update({ mbtilesPaths, basemapId: mbtilesBasemapId(path) });
    } catch (e) {
      set({ problems: [message(e)] });
    }
  },

  removeMbtiles: async (path) => {
    const entry = get().mbtiles.find((m) => m.path === path);
    if (entry?.runtimeId) await closeMbtiles(entry.runtimeId).catch(() => undefined);
    const patch: Partial<PersistedSettings> = {
      mbtilesPaths: get().mbtilesPaths.filter((p) => p !== path),
    };
    if (get().basemapId === mbtilesBasemapId(path)) patch.basemapId = OSM_ID;
    set({ mbtiles: get().mbtiles.filter((m) => m.path !== path) });
    await get().update(patch);
  },

  dismissProblems: () => set({ problems: [] }),
}));

export const selectKeys = (s: Keys): Keys => ({
  ionToken: s.ionToken,
  esriKey: s.esriKey,
  mapboxToken: s.mapboxToken,
});

/** All selectable basemaps: built-in providers followed by the user's MBTiles files. */
export function allBasemaps(mbtiles: MbtilesEntry[]): BasemapConfig[] {
  return [...BASEMAPS, ...mbtiles.map(mbtilesBasemap)];
}

/** The basemap to show: the saved choice if it is usable, otherwise OSM. */
export function resolveActiveBasemap(
  basemapId: string,
  mbtiles: MbtilesEntry[],
  keys: Keys,
): BasemapConfig {
  const all = allBasemaps(mbtiles);
  const wanted = all.find((b) => b.id === basemapId);
  if (wanted && availability(wanted, keys).available) return wanted;
  return BASEMAPS[0];
}
