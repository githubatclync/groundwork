// Loads attribute rows from Rust in fixed-size pages on demand. The table only ever holds the
// pages near the viewport; sorting and filtering happen in Rust and arrive as a new `spec`.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAttributes, viewKey, type AttrRow, type ViewSpec } from '../io/attributes';

export const PAGE_SIZE = 200;

export interface AttributeRows {
  /** Rows in the whole (filtered) view. */
  total: number;
  /** Changes whenever new rows arrive, so consumers re-render. */
  version: number;
  error: string | null;
  getRow: (index: number) => AttrRow | undefined;
  /** Requests the pages covering rows [first, last]. */
  ensureRange: (first: number, last: number) => void;
}

export function useAttributeRows(layerId: string | null, spec: ViewSpec): AttributeRows {
  const key = layerId ? `${layerId}|${viewKey(spec)}` : '';
  const [total, setTotal] = useState(0);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pages = useRef(new Map<number, AttrRow[]>());
  const inflight = useRef(new Set<number>());
  const generation = useRef(0);
  const specRef = useRef(spec);
  specRef.current = spec;

  const fetchPage = useCallback(
    (page: number) => {
      if (!layerId || pages.current.has(page) || inflight.current.has(page)) return;
      const gen = generation.current;
      inflight.current.add(page);
      getAttributes(layerId, specRef.current, page * PAGE_SIZE, PAGE_SIZE)
        .then((res) => {
          if (gen !== generation.current) return; // the view changed while this was in flight
          pages.current.set(page, res.rows);
          inflight.current.delete(page);
          setTotal(res.total);
          setVersion((v) => v + 1);
        })
        .catch((e: unknown) => {
          if (gen !== generation.current) return;
          inflight.current.delete(page);
          setError(e instanceof Error ? e.message : String(e));
        });
    },
    [layerId],
  );

  // A new layer or view invalidates everything; the first page loads immediately.
  useEffect(() => {
    generation.current++;
    pages.current = new Map();
    inflight.current = new Set();
    setError(null);
    if (!layerId) {
      setTotal(0);
      return;
    }
    fetchPage(0);
  }, [key, layerId, fetchPage]);

  const getRow = useCallback((index: number) => {
    return pages.current.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE];
  }, []);

  const ensureRange = useCallback(
    (first: number, last: number) => {
      for (let p = Math.floor(first / PAGE_SIZE); p <= Math.floor(last / PAGE_SIZE); p++) {
        fetchPage(p);
      }
    },
    [fetchPage],
  );

  return { total, version, error, getRow, ensureRange };
}
