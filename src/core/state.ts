import type { Character, MapNode, Squad } from './types';
import type { Inventory } from './items';
import { starterInventory } from './items';
import { claimName, resetNames } from '../data/names';
import { makeCharacter } from './character';
import { autoPlace, makeSquad } from './squad';

// Global campaign state. One instance per run; scenes read and mutate it.

export interface GameState {
  chars: Map<number, Character>;
  squads: Squad[];
  nodes: MapNode[];
  goth: number; // treasury
  /** Gear, supplies and key items held by the army, by item id. */
  inventory: Inventory;
  day: number;
  phase: 'playing' | 'victory' | 'defeat';
}

export const NODE_DEFS: Omit<MapNode, 'owner'>[] = [
  { id: 0, name: 'Fort Melchor', x: 110, y: 420, kind: 'hq-player', links: [1, 2] },
  { id: 1, name: 'Elm Vale', x: 235, y: 330, kind: 'town', links: [0, 3, 4] },
  { id: 2, name: 'Riverwatch', x: 250, y: 500, kind: 'town', links: [0, 4, 5] },
  { id: 3, name: 'Highcliff', x: 360, y: 215, kind: 'fort', links: [1, 6] },
  { id: 4, name: 'Midfield', x: 400, y: 400, kind: 'town', links: [1, 2, 6, 7] },
  { id: 5, name: 'Saltmarsh', x: 430, y: 545, kind: 'town', links: [2, 7] },
  { id: 6, name: 'Stonegate', x: 545, y: 280, kind: 'fort', links: [3, 4, 8] },
  { id: 7, name: 'Ashfield', x: 585, y: 480, kind: 'town', links: [4, 5, 8] },
  { id: 8, name: 'Castle Verlaine', x: 700, y: 350, kind: 'hq-enemy', links: [6, 7] },
];

function nodePos(nodes: MapNode[], id: number): { x: number; y: number } {
  const n = nodes.find((nd) => nd.id === id)!;
  return { x: n.x, y: n.y };
}

/** The campaign's named heroes: no recruit is ever given one of these names. */
const HEROES = ['Aldric', 'Brienne', 'Falk', 'Oswin'];

export function newCampaign(): GameState {
  resetNames();
  HEROES.forEach(claimName);
  const nodes: MapNode[] = NODE_DEFS.map((d) => ({
    ...d,
    owner: d.kind === 'hq-player' ? 'player' : d.kind === 'town' && d.id <= 2 ? 'neutral' : 'enemy',
  }));
  nodes.find((n) => n.id === 4)!.owner = 'neutral';
  nodes.find((n) => n.id === 5)!.owner = 'neutral';

  const chars = new Map<number, Character>();
  const squads: Squad[] = [];
  const reg = (c: Character) => {
    chars.set(c.id, c);
    return c;
  };

  // --- Player battalion ---
  const hq = nodePos(nodes, 0);
  {
    const leader = reg(makeCharacter('knight', 6, { name: 'Aldric', ali: 68 }));
    const sq = makeSquad('player', [], leader, 0, hq.x, hq.y, 'Azure Wing');
    [leader,
      reg(makeCharacter('fighter', 5, { ali: 55 })),
      reg(makeCharacter('fighter', 4, { ali: 45 })),
      reg(makeCharacter('cleric', 5, { ali: 70 })),
      reg(makeCharacter('wizard', 6, { ali: 40 })),
    ].forEach((c) => autoPlace(sq, c));
    squads.push(sq);
  }
  {
    const leader = reg(makeCharacter('valkyrie', 6, { name: 'Brienne', ali: 60 }));
    const sq = makeSquad('player', [], leader, 0, hq.x, hq.y, 'Silver Talon');
    [leader,
      reg(makeCharacter('amazon', 5, { ali: 50 })),
      reg(makeCharacter('archer', 6, { ali: 48 })),
      reg(makeCharacter('archer', 6, { ali: 52 })),
      reg(makeCharacter('sorceress', 6, { ali: 32 })),
    ].forEach((c) => autoPlace(sq, c));
    squads.push(sq);
  }
  {
    const leader = reg(makeCharacter('berserker', 6, { name: 'Falk', ali: 30 }));
    const sq = makeSquad('player', [], leader, 0, hq.x, hq.y, 'Grey Wolves');
    [leader,
      reg(makeCharacter('fighter', 5, { ali: 35 })),
      reg(makeCharacter('ninja', 5, { ali: 25 })),
      // A large beast: it fills two of the squad's five places.
      reg(makeCharacter('hellhound', 5, { ali: 35 })),
    ].forEach((c) => autoPlace(sq, c));
    squads.push(sq);
  }

  {
    // Cavalry from the expansion: horses outnumber the infantry, so this
    // squad rides — quick on open ground, slow in the woods.
    const leader = reg(makeCharacter('cavalier', 7, { name: 'Oswin', ali: 58, gender: 'M' }));
    const sq = makeSquad('player', [], leader, 0, hq.x, hq.y, 'Crimson Lances');
    [leader,
      reg(makeCharacter('cavalier', 5, { ali: 52 })),
      reg(makeCharacter('scout', 5, { ali: 47 })),
      reg(makeCharacter('horsebow', 5, { ali: 50 })),
      reg(makeCharacter('hospitaller', 5, { ali: 64 })),
    ].forEach((c) => autoPlace(sq, c));
    squads.push(sq);
  }

  // --- Enemy legion ---
  const enemyAt = (nodeId: number, name: string, roster: [string, number][]) => {
    const pos = nodePos(nodes, nodeId);
    const members = roster.map(([cls, lv]) => makeCharacter(cls, lv));
    const sq = makeSquad('enemy', [], members[0], nodeId, pos.x, pos.y, name);
    for (const c of members) if (autoPlace(sq, c)) reg(c);
    squads.push(sq);
  };

  enemyAt(3, 'Highcliff Garrison', [['knight', 6], ['fighter', 4], ['fighter', 4], ['wizard', 6]]);
  enemyAt(6, 'Stonegate Watch', [['phalanx', 7], ['fighter', 5], ['skeleton', 5], ['witch', 7]]);
  // Large beasts and golems fill two of a squad's five places.
  enemyAt(7, 'Ash Raiders', [['berserker', 6], ['hellhound', 5], ['sorceress', 6], ['fighter', 5]]);
  enemyAt(4, 'Border Patrol', [['soldier', 5], ['militia', 4], ['bowman', 4], ['medic', 4]]);
  enemyAt(5, 'Risen Host', [['risen-knight', 8], ['risen-soldier', 6], ['risen-archer', 6], ['risen-archmage', 7]]);
  enemyAt(8, 'Verlaine Guard', [['black-knight', 9], ['golem', 7], ['ghost', 6], ['wizard', 7]]);
  enemyAt(8, 'Dragon Wing', [['wyvern', 7], ['dragon-tamer', 7], ['archer', 6]]);

  return { chars, squads, nodes, goth: 500, inventory: starterInventory(), day: 1, phase: 'playing' };
}

// singleton
let state: GameState | null = null;
export function getState(): GameState {
  if (!state) state = newCampaign();
  return state;
}
export function resetState(): GameState {
  state = newCampaign();
  return state;
}
