// Generates test data. Run with: node test-data/generate.ts [fixtures|big|all]
//   fixtures: the binary / special-byte fixtures in test-data/fixtures (KMZ, PNG, BOM file)
//   big:      large files in test-data/generated (git-ignored) for performance work:
//             big-lines.kml (~1M vertices, 20k LineStrings), big-points.kml (200k points x 8
//             attributes), big-polys.kmz (10k polygons with holes), mixed.geojson
import { mkdirSync, writeFileSync, openSync, writeSync, closeSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mulberry32, png, zip } from './lib.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const fixtures = here('./fixtures/');
const generated = here('./generated/');
const mode = process.argv[2] ?? 'all';

// ---------- fixtures ----------
function makeFixtures() {
  mkdirSync(fixtures, { recursive: true });

  // 96x96 gradient with a border, used as a ground overlay image.
  const overlay = png(96, 96, (x, y) => {
    const edge = x < 3 || y < 3 || x > 92 || y > 92;
    return edge
      ? [0, 0, 0, 255]
      : [Math.round((x / 95) * 255), Math.round((y / 95) * 255), 160, 255];
  });
  writeFileSync(fixtures + 'overlay.png', overlay);

  // A tiny coloured marker used as a KMZ-embedded icon.
  const marker = (r: number, g: number, b: number) =>
    png(32, 32, (x, y) => {
      const d = Math.hypot(x - 15.5, y - 15.5);
      return d < 13 ? [r, g, b, 255] : d < 15 ? [0, 0, 0, 255] : [0, 0, 0, 0];
    });
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>KMZ with relative icons</name>
  <Style id="a"><IconStyle><scale>1.2</scale><Icon><href>files/marker-a.png</href></Icon></IconStyle></Style>
  <Style id="b"><IconStyle><scale>1.2</scale><Icon><href>files/marker-b.png</href></Icon></IconStyle></Style>
  <Style id="remote"><IconStyle><Icon><href>http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png</href></Icon></IconStyle></Style>
  <Placemark><name>Icon A</name><styleUrl>#a</styleUrl><Point><coordinates>-121.70,37.80</coordinates></Point></Placemark>
  <Placemark><name>Icon B</name><styleUrl>#b</styleUrl><Point><coordinates>-121.68,37.80</coordinates></Point></Placemark>
  <Placemark><name>Remote icon (falls back to a plain marker)</name><styleUrl>#remote</styleUrl><Point><coordinates>-121.66,37.80</coordinates></Point></Placemark>
  <GroundOverlay><name>Embedded overlay</name><Icon><href>files/overlay.png</href></Icon>
    <LatLonBox><north>37.86</north><south>37.82</south><east>-121.64</east><west>-121.72</west></LatLonBox></GroundOverlay>
</Document></kml>`;
  writeFileSync(
    fixtures + 'icons.kmz',
    zip([
      { name: 'doc.kml', data: Buffer.from(kml) },
      { name: 'files/marker-a.png', data: marker(220, 40, 40) },
      { name: 'files/marker-b.png', data: marker(40, 80, 220) },
      { name: 'files/overlay.png', data: overlay },
    ]),
  );

  // UTF-8 BOM + kml: prefix + CRLF + whitespace inside <coordinates>.
  const bom =
    '﻿<?xml version="1.0" encoding="UTF-8"?>\r\n' +
    '<kml:kml xmlns:kml="http://www.opengis.net/kml/2.2">\r\n' +
    '<kml:Document><kml:name>BOM, kml: prefix, CRLF</kml:name>\r\n' +
    '<kml:Placemark><kml:name>Prefixed</kml:name>\r\n' +
    '<kml:Point><kml:coordinates>\r\n  -122.00,37.80,0\r\n</kml:coordinates></kml:Point></kml:Placemark>\r\n' +
    '</kml:Document></kml:kml>\r\n';
  writeFileSync(fixtures + 'prefixed-bom-crlf.kml', bom, 'utf8');
  console.log('fixtures written to', fixtures);
}

// ---------- big files ----------
class Out {
  fd: number;
  buf: string[] = [];
  size = 0;
  constructor(path: string) {
    this.fd = openSync(path, 'w');
  }
  write(s: string) {
    this.buf.push(s);
    this.size += s.length;
    if (this.size > 1 << 20) this.flush();
  }
  flush() {
    writeSync(this.fd, this.buf.join(''));
    this.buf = [];
    this.size = 0;
  }
  close() {
    this.flush();
    closeSync(this.fd);
  }
}

const KML_HEAD =
  '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>\n';
const KML_TAIL = '</Document></kml>\n';
const f = (n: number, d = 6) => n.toFixed(d);

function bigLines() {
  const rnd = mulberry32(1);
  const o = new Out(generated + 'big-lines.kml');
  o.write(KML_HEAD + '<name>big-lines</name>\n');
  const colors = ['ff0000ff', 'ff00a5ff', 'ff00ff00', 'ffff0000', 'ffff00ff'];
  colors.forEach((c, i) =>
    o.write(
      `<Style id="s${i}"><LineStyle><color>${c}</color><width>${1 + (i % 3)}</width></LineStyle></Style>\n`,
    ),
  );
  const LINES = 20000;
  const VERTS = 50; // 20k x 50 = 1M vertices
  const classes = ['highway', 'arterial', 'local', 'trail'];
  for (let i = 0; i < LINES; i++) {
    let lon = -125 + rnd() * 58;
    let lat = 25 + rnd() * 23;
    let heading = rnd() * Math.PI * 2;
    let coords = '';
    for (let v = 0; v < VERTS; v++) {
      coords += `${f(lon)},${f(lat)},${(rnd() * 300).toFixed(1)} `;
      heading += (rnd() - 0.5) * 0.6;
      lon += Math.cos(heading) * 0.01;
      lat += Math.sin(heading) * 0.01;
    }
    o.write(
      `<Placemark><name>Line ${i}</name><styleUrl>#s${i % 5}</styleUrl>` +
        `<ExtendedData><Data name="road_id"><value>R${100000 + i}</value></Data>` +
        `<Data name="class"><value>${classes[i % 4]}</value></Data>` +
        `<Data name="lanes"><value>${1 + (i % 6)}</value></Data>` +
        `<Data name="length_km"><value>${(rnd() * 40).toFixed(2)}</value></Data></ExtendedData>` +
        `<LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>\n`,
    );
  }
  o.write(KML_TAIL);
  o.close();
}

function bigPoints() {
  const rnd = mulberry32(2);
  const o = new Out(generated + 'big-points.kml');
  o.write(KML_HEAD + '<name>big-points</name>\n');
  o.write(
    '<Style id="p"><IconStyle><color>ff0080ff</color><scale>0.6</scale></IconStyle></Style>\n',
  );
  const types = ['school', 'hospital', 'park', 'store', 'station', 'library'];
  const states = ['CA', 'OR', 'WA', 'NV', 'AZ', 'TX', 'NY', 'FL'];
  for (let i = 0; i < 200000; i++) {
    const lon = -125 + rnd() * 58;
    const lat = 25 + rnd() * 23;
    o.write(
      `<Placemark><name>Site ${i}</name><styleUrl>#p</styleUrl><ExtendedData>` +
        `<Data name="site_id"><value>S${i}</value></Data>` +
        `<Data name="type"><value>${types[i % 6]}</value></Data>` +
        `<Data name="state"><value>${states[Math.floor(rnd() * 8)]}</value></Data>` +
        `<Data name="capacity"><value>${Math.floor(rnd() * 5000)}</value></Data>` +
        `<Data name="rating"><value>${(1 + rnd() * 4).toFixed(2)}</value></Data>` +
        `<Data name="year_built"><value>${1900 + Math.floor(rnd() * 125)}</value></Data>` +
        `<Data name="owner"><value>Owner ${Math.floor(rnd() * 500)}</value></Data>` +
        `<Data name="active"><value>${rnd() > 0.2}</value></Data>` +
        `</ExtendedData><Point><coordinates>${f(lon)},${f(lat)},0</coordinates></Point></Placemark>\n`,
    );
  }
  o.write(KML_TAIL);
  o.close();
}

function ring(cx: number, cy: number, r: number, n: number, rnd: () => number): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.8 + rnd() * 0.2);
    pts.push(`${f(cx + Math.cos(a) * rr)},${f(cy + Math.sin(a) * rr)},0`);
  }
  pts.push(pts[0]);
  return pts.join(' ');
}

function bigPolys() {
  const rnd = mulberry32(3);
  let kml = KML_HEAD + '<name>big-polys</name>\n';
  kml +=
    '<Style id="n"><PolyStyle><color>7f00aa00</color></PolyStyle><LineStyle><color>ff005500</color><width>1</width></LineStyle></Style>\n';
  kml +=
    '<Style id="h"><PolyStyle><color>7f0000ff</color></PolyStyle><LineStyle><color>ff0000ff</color><width>2</width></LineStyle></Style>\n';
  kml +=
    '<StyleMap id="m"><Pair><key>normal</key><styleUrl>#n</styleUrl></Pair><Pair><key>highlight</key><styleUrl>#h</styleUrl></Pair></StyleMap>\n';
  for (let i = 0; i < 10000; i++) {
    const cx = -125 + rnd() * 58;
    const cy = 25 + rnd() * 23;
    const r = 0.02 + rnd() * 0.08;
    const holes = i % 3 === 0 ? 2 : i % 3 === 1 ? 1 : 0;
    let inner = '';
    for (let h = 0; h < holes; h++) {
      inner += `<innerBoundaryIs><LinearRing><coordinates>${ring(cx + (h - 0.5) * r * 0.5, cy, r * 0.2, 12, rnd)}</coordinates></LinearRing></innerBoundaryIs>`;
    }
    kml +=
      `<Placemark><name>Parcel ${i}</name><styleUrl>#m</styleUrl>` +
      `<ExtendedData><Data name="parcel_id"><value>P${i}</value></Data><Data name="area"><value>${(r * 1000).toFixed(1)}</value></Data></ExtendedData>` +
      `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ring(cx, cy, r, 24, rnd)}</coordinates></LinearRing></outerBoundaryIs>${inner}</Polygon></Placemark>\n`;
  }
  kml += KML_TAIL;
  writeFileSync(generated + 'big-polys.kmz', zip([{ name: 'doc.kml', data: Buffer.from(kml) }]));
}

function mixedGeoJson() {
  const rnd = mulberry32(4);
  const features: unknown[] = [];
  for (let i = 0; i < 3000; i++) {
    const lon = -125 + rnd() * 58;
    const lat = 25 + rnd() * 23;
    const props = {
      name: `Feature ${i}`,
      kind: ['a', 'b', 'c'][i % 3],
      value: Math.round(rnd() * 1000),
      flag: rnd() > 0.5,
    };
    let geometry: unknown;
    if (i % 3 === 0) geometry = { type: 'Point', coordinates: [lon, lat] };
    else if (i % 3 === 1) {
      const c: number[][] = [];
      for (let v = 0; v < 10; v++) c.push([lon + v * 0.01, lat + Math.sin(v) * 0.01]);
      geometry = { type: 'LineString', coordinates: c };
    } else {
      const r = 0.03;
      const outer = ring(lon, lat, r, 12, rnd)
        .split(' ')
        .map((p) => p.split(',').slice(0, 2).map(Number));
      const hole = ring(lon, lat, r / 3, 8, rnd)
        .split(' ')
        .map((p) => p.split(',').slice(0, 2).map(Number));
      geometry = { type: 'Polygon', coordinates: [outer, hole] };
    }
    features.push({ type: 'Feature', properties: props, geometry });
  }
  writeFileSync(
    generated + 'mixed.geojson',
    JSON.stringify({ type: 'FeatureCollection', features }),
  );
}

function makeBig() {
  mkdirSync(generated, { recursive: true });
  for (const [name, fn] of [
    ['big-lines.kml', bigLines],
    ['big-points.kml', bigPoints],
    ['big-polys.kmz', bigPolys],
    ['mixed.geojson', mixedGeoJson],
  ] as const) {
    const t = performance.now();
    fn();
    const mb = statSync(generated + name).size / 1e6;
    console.log(
      `${name.padEnd(16)} ${mb.toFixed(1).padStart(7)} MB  ${((performance.now() - t) / 1000).toFixed(1)}s`,
    );
  }
}

if (mode === 'fixtures' || mode === 'all') makeFixtures();
if (mode === 'big' || mode === 'all') makeBig();
