// Place search through the Rust geocoder (Nominatim, proper User-Agent, 1 request per second).
import { invoke } from '@tauri-apps/api/core';
import type { Bounds } from './types';

export interface Place {
  name: string;
  lat: number;
  lon: number;
  bbox: Bounds | null;
}

export const geocode = (query: string) => invoke<Place[]>('geocode', { query });
