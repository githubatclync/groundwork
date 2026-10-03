import { describe, expect, it } from 'vitest';
import type { FolderNode } from '../io/types';
import { DEFAULT_STYLE, type UserFeature } from '../layers/userLayerStore';
import { basename, dirname, isAbsolute, relativeTo, resolveSource } from './paths';
import {
  PROJECT_VERSION,
  buildProject,
  geoJsonToUserFeatures,
  isProjectPath,
  parseProject,
  sourcePathOf,
  userFeaturesToGeoJson,
} from './projectFile';

describe('paths', () => {
  it('recognizes absolute paths in both styles', () => {
    expect(isAbsolute('C:\\data\\a.kml')).toBe(true);
    expect(isAbsolute('c:/data/a.kml')).toBe(true);
    expect(isAbsolute('/home/me/a.kml')).toBe(true);
    expect(isAbsolute('data/a.kml')).toBe(false);
    expect(isAbsolute('..\\a.kml')).toBe(false);
  });

  it('splits directory and file names', () => {
    expect(dirname('C:\\proj\\work\\p.groundwork.json')).toBe('C:/proj/work');
    expect(basename('C:\\proj\\work\\p.groundwork.json')).toBe('p.groundwork.json');
    expect(dirname('/a/b.txt')).toBe('/a');
    expect(dirname('b.txt')).toBe('');
  });

  it('computes relative paths down, up, and sideways', () => {
    const proj = 'C:\\Users\\Me\\work\\site.groundwork.json';
    expect(relativeTo(proj, 'C:\\Users\\Me\\work\\data\\a.kml')).toBe('data/a.kml');
    expect(relativeTo(proj, 'C:\\Users\\Me\\work\\a.kml')).toBe('a.kml');
    expect(relativeTo(proj, 'C:\\Users\\Me\\shared\\b.kml')).toBe('../shared/b.kml');
    expect(relativeTo(proj, 'c:/users/me/WORK/data/a.kml')).toBe('data/a.kml'); // case-insensitive drive paths
    expect(relativeTo('/home/me/p.groundwork.json', '/home/me/data/a.kml')).toBe('data/a.kml');
    expect(relativeTo('/home/me/p.groundwork.json', '/srv/x.kml')).toBe('../../srv/x.kml');
  });

  it('has no relative form across drives', () => {
    expect(relativeTo('C:\\work\\p.groundwork.json', 'D:\\data\\a.kml')).toBeNull();
    expect(relativeTo('C:\\work\\p.groundwork.json', 'data/a.kml')).toBeNull();
  });

  it('resolves stored sources and round-trips with relativeTo', () => {
    const proj = 'C:\\Users\\Me\\work\\site.groundwork.json';
    expect(resolveSource(proj, 'data/a.kml')).toBe('C:\\Users\\Me\\work\\data\\a.kml');
    expect(resolveSource(proj, '../shared/b.kml')).toBe('C:\\Users\\Me\\shared\\b.kml');
    expect(resolveSource(proj, 'D:/abs/c.kml')).toBe('D:\\abs\\c.kml');
    expect(resolveSource('/home/me/p.groundwork.json', 'data/a.kml')).toBe('/home/me/data/a.kml');
    for (const target of [
      'C:\\Users\\Me\\work\\data\\deep\\x.kml',
      'C:\\Users\\Me\\other\\y.kml',
      'C:\\z.kml',
    ]) {
      const rel = relativeTo(proj, target) as string;
      expect(resolveSource(proj, rel).toLowerCase()).toBe(target.toLowerCase());
    }
  });

  it('moving the project folder keeps relative sources valid', () => {
    const rel = relativeTo(
      'C:\\old\\proj\\p.groundwork.json',
      'C:\\old\\proj\\data\\a.kml',
    ) as string;
    expect(resolveSource('D:\\new\\place\\p.groundwork.json', rel)).toBe(
      'D:\\new\\place\\data\\a.kml',
    );
  });
});

const tree = (visible: boolean[]): FolderNode => ({
  id: 0,
  name: 'Doc',
  open: true,
  visible: visible[0],
  featureCount: 1,
  children: visible.slice(1).map((v, i) => ({
    id: i + 1,
    name: `F${i + 1}`,
    open: false,
    visible: v,
    featureCount: 0,
    children: [],
  })),
});

const feature = (over: Partial<UserFeature> = {}): UserFeature => ({
  id: 1,
  name: 'Trail',
  kind: 'line',
  coords: [
    [0, 0],
    [1, 1],
  ],
  holes: [],
  description: 'desc',
  attrs: [['k', 'v']],
  style: { ...DEFAULT_STYLE, color: '#112233', icon: 'star' },
  visible: true,
  ...over,
});

describe('project file', () => {
  const camera = { lon: 10, lat: 45, height: 1000, heading: 0.1, pitch: -1.2, roll: 0 };

  it('stores relative sources, states, and the camera', () => {
    const p = buildProject({
      projectPath: 'C:\\w\\p.groundwork.json',
      layers: [
        {
          sourcePath: 'C:\\w\\data\\a.kml',
          name: 'A',
          visible: false,
          opacity: 0.5,
          tree: tree([true, false, true]),
        },
        {
          sourcePath: 'D:\\x\\b.csv',
          name: 'B',
          visible: true,
          opacity: 1,
          tree: tree([true]),
          csv: { latCol: 1, lonCol: 2 },
        },
      ],
      camera,
      basemapId: 'osm',
      userFeatures: [],
      userLayerVisible: true,
      now: new Date('2026-10-03T12:00:00Z'),
    });
    expect(p.version).toBe(PROJECT_VERSION);
    expect(p.savedAt).toBe('2026-10-03T12:00:00.000Z');
    expect(p.layers[0]).toMatchObject({
      source: 'data/a.kml',
      relative: true,
      visible: false,
      opacity: 0.5,
      folders: { '0': true, '1': false, '2': true },
    });
    expect(p.layers[1]).toMatchObject({
      source: 'D:/x/b.csv',
      relative: false,
      csv: { latCol: 1, lonCol: 2 },
    });
    expect(sourcePathOf('E:\\moved\\p.groundwork.json', p.layers[0])).toBe(
      'E:\\moved\\data\\a.kml',
    );
    expect(sourcePathOf('E:\\moved\\p.groundwork.json', p.layers[1])).toBe('D:/x/b.csv');
    expect(p.camera).toEqual(camera);
  });

  it('round-trips through JSON text', () => {
    const built = buildProject({
      projectPath: '/h/p.groundwork.json',
      layers: [
        { sourcePath: '/h/a.kml', name: 'A', visible: true, opacity: 1, tree: tree([true]) },
      ],
      camera,
      basemapId: 'esri-imagery',
      userFeatures: [feature()],
      userLayerVisible: false,
    });
    const parsed = parseProject(JSON.stringify(built));
    expect(parsed.layers).toEqual(built.layers);
    expect(parsed.basemapId).toBe('esri-imagery');
    expect(parsed.userLayerVisible).toBe(false);
    expect(parsed.camera).toEqual(camera);
    const expected: Record<string, unknown> = { ...feature() };
    delete expected.id;
    expect(geoJsonToUserFeatures(parsed.userLayer)).toEqual([expected]);
  });

  it('rejects files that are not projects, with readable messages', () => {
    expect(() => parseProject('not json')).toThrow(/not JSON/);
    expect(() => parseProject('{"a":1}')).toThrow(/not a Groundwork project/);
    expect(() => parseProject('null')).toThrow(/not a Groundwork project/);
    expect(() =>
      parseProject(JSON.stringify({ format: 'groundwork-project', version: 99 })),
    ).toThrow(/newer version/);
  });

  it('sanitizes hostile or damaged content instead of trusting it', () => {
    const p = parseProject(
      JSON.stringify({
        format: 'groundwork-project',
        version: 1,
        layers: [
          {
            source: 'ok.kml',
            visible: 'nope',
            opacity: 7,
            folders: { '1': true, '2': 'x' },
            csv: { latCol: 'a' },
          },
          { source: 42 },
          null,
        ],
        camera: { lon: 1, lat: 999, height: 1, heading: 0, pitch: 0, roll: 0 },
        userLayerVisible: 'maybe',
        userLayer: {
          features: [
            { geometry: { type: 'Point', coordinates: [500, 0] } },
            { geometry: { type: 'Nope' } },
            7,
          ],
        },
      }),
    );
    expect(p.layers).toHaveLength(1);
    expect(p.layers[0]).toMatchObject({
      source: 'ok.kml',
      visible: true,
      opacity: 1,
      folders: { '1': true },
    });
    expect(p.layers[0].csv).toBeUndefined();
    expect(p.camera).toBeNull();
    expect(p.userLayer.features).toHaveLength(0);
    expect(p.userLayerVisible).toBe(true);
  });

  it('user layer GeoJSON: polygons are closed on save and opened on load, holes preserved', () => {
    const poly = feature({
      kind: 'polygon',
      coords: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      holes: [
        [
          [1, 1],
          [2, 1],
          [2, 2],
        ],
      ],
    });
    const fc = userFeaturesToGeoJson([poly]);
    const rings = fc.features[0].geometry.coordinates as number[][][];
    expect(rings[0]).toHaveLength(5);
    expect(rings[0][0]).toEqual(rings[0][4]);
    expect(rings[1]).toHaveLength(4);
    const back = geoJsonToUserFeatures(fc)[0];
    expect(back.coords).toHaveLength(4);
    expect(back.holes[0]).toHaveLength(3);
    expect(back.kind).toBe('polygon');
  });

  it('sanitizes feature styles', () => {
    const [f] = geoJsonToUserFeatures({
      features: [
        {
          properties: {
            name: 5,
            style: { color: 'red', width: 99, icon: 'rocket', fillOpacity: -3, scale: 'big' },
            attrs: [['a', 1], ['bad']],
          },
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        },
      ],
    });
    expect(f.name).toBe('');
    expect(f.style).toMatchObject({
      color: DEFAULT_STYLE.color,
      width: 12,
      icon: null,
      fillOpacity: 0,
      scale: DEFAULT_STYLE.scale,
    });
    expect(f.attrs).toEqual([['a', '1']]);
  });

  it('recognizes project paths by their suffix', () => {
    expect(isProjectPath('C:\\a\\Site.groundwork.json')).toBe(true);
    expect(isProjectPath('x.GROUNDWORK.JSON')).toBe(true);
    expect(isProjectPath('data.geojson')).toBe(false);
    expect(isProjectPath('plain.json')).toBe(false);
  });
});
