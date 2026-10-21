import type { GameState } from './state';
import type { MapNode, Squad } from './types';
import { squadMemberIds } from './squad';
import { haltSquad, strongholdAt } from './movement';
import { SLOTS, unequip } from './items';

// Rest between battles. A squad standing on one of its own strongholds
// recovers a little each day; at its own headquarters the fallen rise again.
// Anywhere else, only supplies help.

export const REST_HEAL = 0.15;
export const RISE_AT_HQ = 0.25;

function isHome(node: MapNode, sq: Squad): boolean {
  return node.kind === (sq.side === 'player' ? 'hq-player' : 'hq-enemy');
}

export function restSquads(st: GameState): void {
  for (const sq of st.squads) {
    if (sq.moving) continue;
    const node = strongholdAt(st.nodes, sq.x, sq.y);
    if (!node || node.owner !== sq.side) continue;
    for (const id of squadMemberIds(sq)) {
      const c = st.chars.get(id)!;
      if (c.hp > 0) c.hp = Math.min(c.stats.hp, c.hp + Math.max(1, Math.round(c.stats.hp * REST_HEAL)));
      else if (isHome(node, sq)) c.hp = Math.max(1, Math.round(c.stats.hp * RISE_AT_HQ));
    }
  }
}

/** Carry a squad straight home (a Quit Gate, a Homeward Feather). */
export function rallyHome(st: GameState, sq: Squad): void {
  const home = st.nodes.find((n) => isHome(n, sq));
  if (!home) return;
  haltSquad(sq);
  sq.x = home.x;
  sq.y = home.y;
  sq.nodeId = home.id;
}

/**
 * Release a member from the army: its gear goes back to the stores and its
 * places in the formation come free, so a recruit can take them. A squad's
 * leader cannot be dismissed (choose another leader first).
 */
export function dismissMember(st: GameState, sq: Squad, charId: number): boolean {
  if (charId === sq.leaderId || !sq.grid.includes(charId)) return false;
  const c = st.chars.get(charId);
  if (c) for (const slot of SLOTS) if (c.gear[slot]) unequip(c, slot, st.inventory);
  sq.grid = sq.grid.map((id) => (id === charId ? null : id));
  st.chars.delete(charId);
  return true;
}

/** Make a standing member the squad's leader. */
export function makeLeader(st: GameState, sq: Squad, charId: number): boolean {
  const c = st.chars.get(charId);
  if (!c || c.hp <= 0 || !sq.grid.includes(charId)) return false;
  sq.leaderId = charId;
  return true;
}
