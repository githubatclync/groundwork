// Toolbar search: coordinates (DD, DMS, UTM) always work; place names need an internet connection
// and are looked up only when Enter is pressed (never while typing).
import { useEffect, useRef, useState } from 'react';
import { flyToBbox, flyToPoint } from '../globe/camera';
import { formatCoords } from '../globe/coords';
import { geocode, type Place } from '../io/geocode';
import { useSearch } from '../search/searchStore';
import { useSettings } from '../settings/settingsStore';
import { parseCoordinates } from '../tools/coordParse';

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function SearchBox() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [results, setResults] = useState<Place[]>([]);
  const online = useOnline();
  const coordFormat = useSettings((s) => s.coordFormat);
  const setMarker = useSearch((s) => s.setMarker);
  const inputRef = useRef<HTMLInputElement>(null);

  const go = (lon: number, lat: number, label: string, bbox?: Place['bbox']) => {
    setMarker({ lon, lat, label });
    if (bbox) flyToBbox(bbox);
    else flyToPoint(lon, lat);
  };

  const clear = () => {
    setResults([]);
    setMessage(null);
    setMarker(null);
  };

  const search = async () => {
    const q = text.trim();
    setResults([]);
    setMessage(null);
    if (!q) {
      setMarker(null);
      return;
    }
    const coord = parseCoordinates(q);
    if (coord) {
      go(coord.lon, coord.lat, formatCoords(coordFormat, coord.lat, coord.lon));
      setMessage(`Coordinates (${coord.format.toUpperCase()})`);
      return;
    }
    if (!online) {
      setMessage(
        'You are offline: only coordinates can be searched (for example 40.7484, -73.9857).',
      );
      return;
    }
    setBusy(true);
    try {
      const found = await geocode(q);
      if (found.length === 0) setMessage('No places found.');
      else if (found.length === 1)
        go(found[0].lon, found[0].lat, found[0].name.split(',')[0], found[0].bbox);
      else setResults(found);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="search-box">
      <input
        ref={inputRef}
        type="search"
        data-search="true"
        aria-label="Search places or coordinates"
        placeholder={online ? 'Search place or coordinates' : 'Offline: coordinates only'}
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void search();
          else if (e.key === 'Escape') {
            clear();
            setText('');
            inputRef.current?.blur();
          }
        }}
      />
      {(message || results.length > 0 || busy) && (
        <div className="search-popover" role="status" aria-live="polite">
          {busy && <div className="muted">Searching…</div>}
          {message && (
            <div className={message.startsWith('Coordinates') ? 'muted' : ''}>{message}</div>
          )}
          {results.length > 0 && (
            <ul className="plain" aria-label="Search results">
              {results.map((p, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      go(p.lon, p.lat, p.name.split(',')[0], p.bbox);
                      setResults([]);
                    }}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
