import type { GameState } from './state';
import type { Character } from './types';
import { setNextCharId } from './character';
import { setNextSquadId } from './squad';
import { claimName, resetNames } from '../data/names';
import { datasetSource, hasClass, hasItemDef } from '../data/registry';

// The campaign, written down and read back: one save, kept in the browser,
// made as the days pass and after each battle. A save belongs to the data
// set it was played on (the built-in classes, or Ogre Battle 64's), and one
// that no longer fits the game is set aside rather than half-loaded.

const VERSION = 1;

interface SaveFile {
  version: number;
  dataset: string;
  savedAt: number;
  /** How far into the current day the campaign was, in seconds. */
  dayTimer: number;
  state: Omit<GameState, 'chars'> & { chars: Character[] };
}

/** What the title shows of a save, without loading it. */
export interface SaveSummary {
  day: number;
  held: number;
  strongholds: number;
  squads: number;
  savedAt: number;
}

/** The campaign as text. */
export function serialize(st: GameState, dayTimer = 0, now = Date.now()): string {
  const file: SaveFile = {
    version: VERSION, dataset: datasetSource(), savedAt: now, dayTimer,
    state: { ...st, chars: [...st.chars.values()] },
  };
  return JSON.stringify(file);
}

/**
 * A campaign read back from text, or null if it is not one this game can
 * take up: unreadable, from another version or data set, over, or naming a
 * class or item the game no longer has.
 */
export function deserialize(text: string | null): { state: GameState; dayTimer: number; summary: SaveSummary } | null {
  if (!text) return null;
  let file: SaveFile;
  try {
    file = JSON.parse(text) as SaveFile;
  } catch {
    return null;
  }
  const s = file?.state;
  if (!s || file.version !== VERSION || file.dataset !== datasetSource()) return null;
  if (s.phase !== 'playing' || !Array.isArray(s.chars) || !Array.isArray(s.squads) || !Array.isArray(s.nodes)) return null;
  const chars = new Map(s.chars.map((c) => [c.id, c]));
  for (const c of chars.values()) {
    if (!hasClass(c.classId)) return null;
    for (const id of Object.values(c.gear ?? {})) if (id && !hasItemDef(id)) return null;
  }
  for (const id of Object.keys(s.inventory ?? {})) if (!hasItemDef(id)) return null;
  for (const sq of s.squads) {
    if (!chars.has(sq.leaderId) || sq.grid.length !== 9 || sq.grid.some((id) => id !== null && !chars.has(id))) return null;
  }
  const state: GameState = { ...s, chars };
  return {
    state, dayTimer: Number(file.dayTimer) || 0,
    summary: {
      day: s.day, held: s.nodes.filter((n) => n.owner === 'player').length, strongholds: s.nodes.length,
      squads: s.squads.filter((q) => q.side === 'player').length, savedAt: file.savedAt,
    },
  };
}

/** Make a loaded campaign safe to play on: new soldiers and squads get fresh numbers and names. */
export function adopt(state: GameState): void {
  setNextCharId(Math.max(0, ...state.chars.keys()) + 1);
  setNextSquadId(Math.max(0, ...state.squads.map((q) => q.id)) + 1);
  resetNames();
  for (const c of state.chars.values()) claimName(c.name);
}

const KEY = 'palatinus.save';

/** Keep the campaign in this browser. False if it could not be kept (storage full or shut). */
export function saveCampaign(st: GameState, dayTimer = 0): boolean {
  if (st.phase !== 'playing') {
    clearSave();
    return false;
  }
  try {
    localStorage.setItem(KEY, serialize(st, dayTimer));
    return true;
  } catch {
    return false;
  }
}

/** The kept campaign, if there is one this game can take up. */
export function loadCampaign(): ReturnType<typeof deserialize> {
  try {
    return deserialize(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing kept, nothing to clear.
  }
}
