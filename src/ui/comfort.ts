// How the player likes the game to look and move, beyond the graphics
// preset: the interface's size, how much moves on screen, and how quickly
// battles play out. Kept in this browser, and applied to the page as a CSS
// variable and an attribute the style sheet reads.

export type Motion = 'system' | 'reduce' | 'full';

export interface Comfort {
  /** The interface's size, as a share of its own: 0.85 to 1.3. */
  uiScale: number;
  /** Follow the system's reduced-motion setting, or always reduce, or never. */
  motion: Motion;
  /** How fast battles play out (only how they are shown: the blows are the same). */
  battlePace: number;
}

export const UI_SCALES = [0.85, 1, 1.15, 1.3] as const;
export const BATTLE_PACES = [1, 1.5, 2] as const;
export const MOTIONS: Motion[] = ['system', 'reduce', 'full'];

export const DEFAULT_COMFORT: Comfort = { uiScale: 1, motion: 'system', battlePace: 1 };

const KEY = 'palatinus.comfort';

/** Read kept settings, anything missing or out of range taken at its default. */
export function parseComfort(text: string | null): Comfort {
  let raw: Partial<Record<keyof Comfort, unknown>> = {};
  try {
    const v: unknown = text ? JSON.parse(text) : {};
    if (v && typeof v === 'object') raw = v as typeof raw;
  } catch {
    // Unreadable: the defaults.
  }
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
  return {
    uiScale: pick(raw.uiScale, UI_SCALES, DEFAULT_COMFORT.uiScale),
    motion: pick(raw.motion, MOTIONS, DEFAULT_COMFORT.motion),
    battlePace: pick(raw.battlePace, BATTLE_PACES, DEFAULT_COMFORT.battlePace),
  };
}

let current: Comfort = load();

function load(): Comfort {
  try {
    return parseComfort(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULT_COMFORT };
  }
}

export function comfort(): Comfort {
  return current;
}

/** Change some settings, keep them, and apply them to the page. */
export function setComfort(change: Partial<Comfort>): void {
  current = parseComfort(JSON.stringify({ ...current, ...change }));
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage may be unavailable (a private window); the choice lasts the session.
  }
  applyComfort();
}

/** Whether to keep motion down: the player's choice, or else the system's. */
export function reducedMotion(c: Comfort = current): boolean {
  if (c.motion !== 'system') return c.motion === 'reduce';
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Set the page's interface size and motion to the settings. */
export function applyComfort(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(current.uiScale));
  root.dataset.motion = reducedMotion() ? 'reduce' : 'full';
}

/** Follow the system's reduced-motion setting as it changes (where the player left it to the system). */
export function watchSystemMotion(): void {
  if (typeof matchMedia !== 'function') return;
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', applyComfort);
}
