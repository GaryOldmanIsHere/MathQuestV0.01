import * as THREE from 'three';

// The day's light and the weather's rules over the campaign map, as data:
// what the light is at each hour, what each weather does, which hour it is
// on a campaign day, and what the weather is. Drawn by atmosphere.ts.

export type Weather = 'clear' | 'cloudy' | 'rain' | 'snow' | 'mist';

/** The light at one hour of the day. */
export interface Hour {
  at: number;
  /** The sun's (or moon's) height above the horizon, radians. */
  elevation: number;
  sun: number;
  sunPower: number;
  sky: number;
  ground: number;
  fill: number;
  zenith: number;
  horizon: number;
}

/**
 * The day, hour by hour (0 midnight, 0.5 noon): night in moonlight, a warm
 * dawn, the white light of noon, a golden evening, then dusk.
 */
export const HOURS: Hour[] = [
  { at: 0.0, elevation: 0.9, sun: 0x8ea4e0, sunPower: 0.55, sky: 0x41558c, ground: 0x1e2a30, fill: 0.75, zenith: 0x0b1430, horizon: 0x26365e },
  { at: 0.2, elevation: 0.7, sun: 0x8ea4e0, sunPower: 0.5, sky: 0x41558c, ground: 0x1e2a30, fill: 0.75, zenith: 0x111c40, horizon: 0x2e3f6a },
  { at: 0.26, elevation: 0.12, sun: 0xffa060, sunPower: 1.1, sky: 0xb0a0c0, ground: 0x4a4038, fill: 0.85, zenith: 0x5a74b0, horizon: 0xf0a878 },
  { at: 0.34, elevation: 0.55, sun: 0xffe0b8, sunPower: 1.8, sky: 0xd8e4f8, ground: 0x4a5a3a, fill: 1.0, zenith: 0x5a8ed8, horizon: 0xc8dcf0 },
  { at: 0.5, elevation: 1.05, sun: 0xfff4e4, sunPower: 2.1, sky: 0xf0f4ff, ground: 0x4a5a3a, fill: 1.05, zenith: 0x4a86e0, horizon: 0xbcd6f0 },
  { at: 0.66, elevation: 0.6, sun: 0xffe2b0, sunPower: 1.9, sky: 0xe8e8f4, ground: 0x4e5636, fill: 1.0, zenith: 0x5a8ad8, horizon: 0xd8d8e0 },
  { at: 0.74, elevation: 0.14, sun: 0xff9048, sunPower: 1.25, sky: 0xc8a8b8, ground: 0x4a3a30, fill: 0.85, zenith: 0x48609c, horizon: 0xf09858 },
  { at: 0.8, elevation: 0.5, sun: 0x9aa8e0, sunPower: 0.5, sky: 0x5a5a90, ground: 0x2a2a30, fill: 0.75, zenith: 0x1c2450, horizon: 0x5a4a6a },
  { at: 1.0, elevation: 0.9, sun: 0x8ea4e0, sunPower: 0.55, sky: 0x41558c, ground: 0x1e2a30, fill: 0.75, zenith: 0x0b1430, horizon: 0x26365e },
];

/** What each kind of weather does to the light and the air. */
export const WEATHER: Record<Weather, { sun: number; grey: number; clouds: number; rain: number; snow: number; fog: number; wind: number }> = {
  clear: { sun: 1, grey: 0, clouds: 0.35, rain: 0, snow: 0, fog: 0, wind: 0.5 },
  cloudy: { sun: 0.55, grey: 0.45, clouds: 1, rain: 0, snow: 0, fog: 0.15, wind: 0.75 },
  rain: { sun: 0.35, grey: 0.7, clouds: 1, rain: 1, snow: 0, fog: 0.35, wind: 1 },
  snow: { sun: 0.5, grey: 0.55, clouds: 0.8, rain: 0, snow: 1, fog: 0.4, wind: 0.45 },
  mist: { sun: 0.6, grey: 0.4, clouds: 0.3, rain: 0, snow: 0, fog: 1, wind: 0.15 },
};

/** How many campaign days one turn of day and night takes. */
export const DAYS_PER_CYCLE = 6;

/**
 * The hour over the map (0 midnight, 0.5 noon) `progress` days into the
 * campaign: it opens in the morning, and night falls about every sixth day.
 */
export function hourOf(progress: number): number {
  return (0.3 + progress / DAYS_PER_CYCLE) % 1;
}

/**
 * The weather on a campaign day: it holds for three days at a time, mostly
 * fair; the campaign always opens under a clear sky.
 */
export function weatherOn(day: number, seed = 1): Weather {
  const spell = Math.floor((day - 1) / 3);
  if (spell === 0) return 'clear';
  const r = Math.abs(Math.sin(spell * 91.17 + seed * 13.3) * 43758.5453) % 1;
  return r < 0.45 ? 'clear' : r < 0.7 ? 'cloudy' : r < 0.85 ? 'rain' : r < 0.93 ? 'mist' : 'snow';
}

/** The light at an hour, between the hours set down above. */
export function hourLight(hour: number): Omit<Hour, 'at'> {
  const h = ((hour % 1) + 1) % 1;
  let i = 0;
  while (i < HOURS.length - 2 && HOURS[i + 1].at <= h) i++;
  const a = HOURS[i];
  const b = HOURS[i + 1];
  const t = THREE.MathUtils.smoothstep(h, a.at, b.at);
  const c = (x: number, y: number) => new THREE.Color(x).lerp(new THREE.Color(y), t).getHex();
  const n = (x: number, y: number) => x + (y - x) * t;
  return {
    elevation: n(a.elevation, b.elevation),
    sun: c(a.sun, b.sun),
    sunPower: n(a.sunPower, b.sunPower),
    sky: c(a.sky, b.sky),
    ground: c(a.ground, b.ground),
    fill: n(a.fill, b.fill),
    zenith: c(a.zenith, b.zenith),
    horizon: c(a.horizon, b.horizon),
  };
}
