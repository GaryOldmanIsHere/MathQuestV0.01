import type { GameState } from './state';
import type { MapNode, Squad } from './types';
import { squadMemberIds } from './squad';
import { haltSquad, strongholdAt } from './movement';

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
