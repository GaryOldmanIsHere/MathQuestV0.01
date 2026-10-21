// A test hook, off unless the page is opened with `?debug`. It lets an
// automated playthrough read the campaign's state, find squads and places on
// the 3D map's screen, and (with `?speed=N`, up to 8) run the clock faster.
// Normal play never sees any of it.

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();

export const DEBUG = params.has('debug');

/** How many times faster than real time the map and battles run. */
export const SPEED = DEBUG ? Math.max(1, Math.min(8, Number(params.get('speed')) || 1)) : 1;

/** Publish something on `window.__palatinus` for the test harness. */
export function exposeDebug(name: string, value: unknown): void {
  if (!DEBUG) return;
  const w = window as unknown as { __palatinus?: Record<string, unknown> };
  (w.__palatinus ??= {})[name] = value;
}
