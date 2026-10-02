// URLs for the app's custom URI schemes (mbtiles://, kmz://). Windows webviews serve custom
// schemes over http://<scheme>.localhost, other platforms use <scheme>://localhost.
const isWindows = () => /Windows/i.test(navigator.userAgent);

export function customSchemeUrl(scheme: string, path: string, windows = isWindows()): string {
  const clean = path.replace(/^\/+/, '');
  return windows ? `http://${scheme}.localhost/${clean}` : `${scheme}://localhost/${clean}`;
}

/** URL of a file embedded in (or next to) an imported KML/KMZ layer. */
export function layerResourceUrl(layerId: string, href: string, windows = isWindows()): string {
  const encoded = href.split('/').map(encodeURIComponent).join('/');
  return customSchemeUrl('kmz', `${layerId}/${encoded}`, windows);
}
