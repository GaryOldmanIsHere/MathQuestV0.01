import type { ClassDef } from '../core/types';

// The Ogre Battle 64 class structure: two trainable base classes (Fighter for
// men, Amazon for women) branch by level, charisma, and alignment into the
// classic tree, with elite third tiers. Requirements follow the original
// guides where known and stay data-driven so they can be tuned in one place.
//
// Alignment: 0 = fully Chaotic, 100 = fully Lawful (as in the original).

const s = (hp: number, str: number, vit: number, int: number, men: number, agi: number) => ({
  hp, str, vit, int, men, agi,
});

export const CLASSES: Record<string, ClassDef> = {
  // ------------------------------------------------------------------
  // MALE LINE
  // ------------------------------------------------------------------
  fighter: {
    id: 'fighter', name: 'Fighter', gender: 'M', tier: 1,
    desc: 'A young soldier trained in the sword. The root of every male class.',
    base: s(52, 14, 12, 6, 6, 10), growth: s(5, 2.2, 2.0, 0.8, 0.9, 1.5),
    attacks: {
      front: { name: 'Sword Slash', type: 'melee', count: 2, power: 1.0, target: 'one' },
      mid: { name: 'Sword Slash', type: 'melee', count: 1, power: 1.0, target: 'one' },
      back: { name: 'Sword Slash', type: 'melee', count: 1, power: 0.8, target: 'one' },
    },
    promotesTo: [
      { classId: 'wizard', level: 4, cha: 50, aliMin: 10, aliMax: 60 },
      { classId: 'knight', level: 5, cha: 50, aliMin: 50 },
      { classId: 'beast-tamer', level: 5, cha: 50, aliMin: 25, aliMax: 65 },
      { classId: 'doll-master', level: 5, cha: 50, aliMin: 30, aliMax: 70 },
      { classId: 'phalanx', level: 5, aliMin: 35, aliMax: 75 },
      { classId: 'berserker', level: 6, cha: 50, aliMax: 49 },
      { classId: 'ninja', level: 6, aliMax: 49 },
      { classId: 'fencer', level: 7, cha: 55, aliMin: 40, aliMax: 60 },
    ],
    moveType: 'foot', preferredRow: 'front', sprite: 'humanoid', palette: 'fighter',
  },
  knight: {
    id: 'knight', name: 'Knight', gender: 'M', tier: 2,
    desc: 'A lawful warrior in plate armor, sworn to protect.',
    base: s(66, 18, 17, 8, 10, 11), growth: s(6, 2.6, 2.5, 1.0, 1.3, 1.6),
    attacks: {
      front: { name: 'Long Sword', type: 'melee', count: 2, power: 1.15, target: 'one' },
      mid: { name: 'Long Sword', type: 'melee', count: 2, power: 1.0, target: 'one' },
      back: { name: 'Long Sword', type: 'melee', count: 1, power: 0.9, target: 'one' },
    },
    promotesTo: [{ classId: 'paladin', level: 15, cha: 60, aliMin: 60 }],
    moveType: 'foot', preferredRow: 'front', sprite: 'humanoid', palette: 'knight',
  },
  paladin: {
    id: 'paladin', name: 'Paladin', gender: 'M', tier: 3,
    desc: 'A holy knight whose blade shines with divine light.',
    base: s(84, 24, 22, 12, 16, 13), growth: s(7, 3.0, 2.8, 1.4, 1.8, 1.8),
    attacks: {
      front: { name: 'Holy Blade', type: 'melee', count: 3, power: 1.2, target: 'one', element: 'holy' },
      mid: { name: 'Holy Blade', type: 'melee', count: 2, power: 1.1, target: 'one', element: 'holy' },
      back: { name: 'Healing Light', type: 'heal', count: 1, power: 1.2, target: 'allies', element: 'holy' },
    },
    promotesTo: [],
    moveType: 'foot', preferredRow: 'front', sprite: 'humanoid', palette: 'paladin',
  },
  berserker: {
    id: 'berserker', name: 'Berserker', gender: 'M', tier: 2,
    desc: 'A chaotic warrior who trades defense for raw fury.',
    base: s(70, 21, 14, 6, 7, 12), growth: s(7, 3.0, 2.0, 0.7, 0.9, 1.7),
    attacks: {
      front: { name: 'Wild Axe', type: 'melee', count: 2, power: 1.4, target: 'one' },
      mid: { name: 'Wild Axe', type: 'melee', count: 1, power: 1.3, target: 'one' },
      back: { name: 'Axe Throw', type: 'ranged', count: 1, power: 1.0, target: 'one' },
    },
    promotesTo: [{ classId: 'black-knight', level: 15, aliMax: 40 }],
    moveType: 'foot', preferredRow: 'front', sprite: 'humanoid', palette: 'berserker',
  },
  'black-knight': {
    id: 'black-knight', name: 'Black Knight', gender: 'M', tier: 3,
    desc: 'A dread knight cloaked in darkness. Fear marches with him.',
    base: s(88, 27, 20, 10, 12, 13), growth: s(8, 3.4, 2.6, 1.2, 1.4, 1.8),
    attacks: {
      front: { name: 'Dark Blade', type: 'melee', count: 3, power: 1.3, target: 'one', element: 'dark' },
      mid: { name: 'Dark Blade', type: 'melee', count: 2, power: 1.2, target: 'one', element: 'dark' },
      back: { name: 'Dread Wave', type: 'magic', count: 1, power: 1.1, target: 'row', element: 'dark' },
    },
    promotesTo: [],
    moveType: 'foot', preferredRow: 'front', sprite: 'humanoid', palette: 'blackknight',
  },
  phalanx: {
    id: 'phalanx', name: 'Phalanx', gender: 'M', tier: 2,
    desc: 'A living fortress behind a tower shield.',
    base: s(74, 15, 24, 5, 9, 7), growth: s(8, 2.0, 3.4, 0.6, 1.2, 0.8),
    attacks: {
      front: { name: 'Shield Bash', type: 'melee', count: 1, power: 1.2, target: 'one' },
      mid: { name: 'Spear Thrust', type: 'melee', count: 1, power: 1.0, target: 'one' },
      back: { name: 'Spear Thrust', type: 'melee', count: 1, power: 0.8, target: 'one' },
    },
    promotesTo: [{ classId: 'cataphract', level: 12, aliMin: 30, aliMax: 70 }],
    moveType: 'foot', preferredRow: 'front', sprite: 'humanoid', palette: 'phalanx',
  },
  cataphract: {
    id: 'cataphract', name: 'Cataphract', gender: 'M', tier: 3,
    desc: 'Heavy shock armor; his lance pierces whole ranks.',
    base: s(92, 22, 30, 6, 11, 8), growth: s(9, 2.8, 3.8, 0.7, 1.4, 0.9),
    attacks: {
      front: { name: 'Piercing Lance', type: 'melee', count: 2, power: 1.2, target: 'row' },
      mid: { name: 'Piercing Lance', type: 'melee', count: 1, power: 1.1, target: 'row' },
      back: { name: 'Lance Hurl', type: 'ranged', count: 1, power: 0.9, target: 'one' },
    },
    promotesTo: [],
    moveType: 'foot', preferredRow: 'front', sprite: 'humanoid', palette: 'cataphract',
  },
  ninja: {
    id: 'ninja', name: 'Ninja', gender: 'M', tier: 2,
    desc: 'A shadow that strikes from any rank.',
    base: s(58, 16, 12, 10, 9, 17), growth: s(5, 2.3, 1.7, 1.3, 1.1, 2.4),
    attacks: {
      front: { name: 'Twin Kodachi', type: 'melee', count: 2, power: 1.0, target: 'one' },
      mid: { name: 'Shuriken', type: 'ranged', count: 2, power: 0.9, target: 'one' },
      back: { name: 'Shuriken', type: 'ranged', count: 2, power: 0.85, target: 'one' },
    },
    promotesTo: [{ classId: 'ninja-master', level: 18, aliMax: 45 }],
    moveType: 'fast', preferredRow: 'mid', sprite: 'humanoid', palette: 'ninja',
  },
  'ninja-master': {
    id: 'ninja-master', name: 'Ninja Master', gender: 'M', tier: 3,
    desc: 'Master of shadow arts and forbidden ninjutsu.',
    base: s(72, 20, 15, 16, 13, 22), growth: s(6, 2.7, 2.0, 1.9, 1.4, 2.8),
    attacks: {
      front: { name: 'Twin Kodachi', type: 'melee', count: 3, power: 1.1, target: 'one' },
      mid: { name: 'Ninjutsu: Gale', type: 'magic', count: 1, power: 1.2, target: 'row' },
      back: { name: 'Ninjutsu: Gale', type: 'magic', count: 1, power: 1.1, target: 'row' },
    },
    promotesTo: [],
    moveType: 'fast', preferredRow: 'mid', sprite: 'humanoid', palette: 'ninjamaster',
  },
  fencer: {
    id: 'fencer', name: 'Fencer', gender: 'M', tier: 2,
    desc: 'A duelist devoted to the pure way of the sword.',
    base: s(62, 18, 13, 8, 9, 15), growth: s(6, 2.6, 1.8, 1.0, 1.1, 2.1),
    attacks: {
      front: { name: 'Rapier Flurry', type: 'melee', count: 2, power: 1.1, target: 'one' },
      mid: { name: 'Rapier Flurry', type: 'melee', count: 2, power: 1.0, target: 'one' },
      back: { name: 'Lunge', type: 'melee', count: 1, power: 0.9, target: 'one' },
    },
    promotesTo: [{ classId: 'sword-master', level: 16, aliMin: 40, aliMax: 60 }],
    moveType: 'foot', preferredRow: 'front', sprite: 'humanoid', palette: 'fencer',
  },
  'sword-master': {
    id: 'sword-master', name: 'Sword Master', gender: 'M', tier: 3,
    desc: 'The blade perfected. Nothing wasted, nothing survives.',
    base: s(78, 25, 17, 12, 13, 20), growth: s(7, 3.2, 2.2, 1.4, 1.5, 2.6),
    attacks: {
      front: { name: 'Iainuki', type: 'melee', count: 3, power: 1.3, target: 'one' },
      mid: { name: 'Iainuki', type: 'melee', count: 3, power: 1.15, target: 'one' },
      back: { name: 'Sword Wave', type: 'magic', count: 1, power: 1.0, target: 'row' },
    },
    promotesTo: [],
    moveType: 'foot', preferredRow: 'front', sprite: 'humanoid', palette: 'swordmaster',
  },
  wizard: {
    id: 'wizard', name: 'Wizard', gender: 'M', tier: 2,
    desc: 'A student of elemental magic. Frail, but his spells rake whole ranks.',
    base: s(46, 8, 8, 18, 14, 9), growth: s(4, 1.0, 1.2, 2.6, 1.9, 1.2),
    attacks: {
      front: { name: 'Staff', type: 'melee', count: 1, power: 0.6, target: 'one' },
      mid: { name: 'Fireball', type: 'magic', count: 1, power: 1.0, target: 'one', element: 'fire' },
      back: { name: 'Fireball', type: 'magic', count: 1, power: 1.0, target: 'row', element: 'fire' },
    },
    promotesTo: [{ classId: 'mage', level: 9, aliMin: 10, aliMax: 60 }],
    moveType: 'foot', preferredRow: 'back', sprite: 'humanoid', palette: 'wizard',
  },
  mage: {
    id: 'mage', name: 'Mage', gender: 'M', tier: 2,
    desc: 'A wizard grown into real power over the elements.',
    base: s(54, 9, 10, 24, 18, 10), growth: s(5, 1.1, 1.3, 3.0, 2.2, 1.3),
    attacks: {
      front: { name: 'Staff', type: 'melee', count: 1, power: 0.6, target: 'one' },
      mid: { name: 'Thunderbolt', type: 'magic', count: 1, power: 1.1, target: 'row', element: 'thunder' },
      back: { name: 'Thunderbolt', type: 'magic', count: 1, power: 1.2, target: 'row', element: 'thunder' },
    },
    promotesTo: [{ classId: 'sorcerer', level: 18, aliMax: 50 }],
    moveType: 'foot', preferredRow: 'back', sprite: 'humanoid', palette: 'mage',
  },
  sorcerer: {
    id: 'sorcerer', name: 'Sorcerer', gender: 'M', tier: 3,
    desc: 'His forbidden words unmake everything before him.',
    base: s(62, 10, 12, 32, 24, 11), growth: s(5, 1.2, 1.5, 3.6, 2.6, 1.4),
    attacks: {
      front: { name: 'Staff', type: 'melee', count: 1, power: 0.6, target: 'one' },
      mid: { name: 'Nightmare', type: 'magic', count: 1, power: 1.1, target: 'all', element: 'dark' },
      back: { name: 'Nightmare', type: 'magic', count: 1, power: 1.2, target: 'all', element: 'dark' },
    },
    promotesTo: [],
    moveType: 'foot', preferredRow: 'back', sprite: 'humanoid', palette: 'sorcerer',
  },
  'beast-tamer': {
    id: 'beast-tamer', name: 'Beast Tamer', gender: 'M', tier: 2,
    desc: 'His whip commands beasts — and stings men.',
    base: s(64, 17, 15, 9, 9, 11), growth: s(6, 2.4, 2.1, 1.1, 1.1, 1.5),
    attacks: {
      front: { name: 'Beast Whip', type: 'melee', count: 2, power: 1.1, target: 'one' },
      mid: { name: 'Beast Whip', type: 'melee', count: 1, power: 1.0, target: 'one' },
      back: { name: 'Whip Crack', type: 'melee', count: 1, power: 0.8, target: 'one' },
    },
    promotesTo: [{ classId: 'dragon-tamer', level: 10, aliMin: 25, aliMax: 65 }],
    moveType: 'foot', preferredRow: 'front', sprite: 'humanoid', palette: 'beasttamer',
  },
  'dragon-tamer': {
    id: 'dragon-tamer', name: 'Dragon Tamer', gender: 'M', tier: 2,
    desc: 'A tamer whose will even dragons obey.',
    base: s(72, 20, 18, 11, 11, 12), growth: s(7, 2.7, 2.4, 1.3, 1.3, 1.6),
    attacks: {
      front: { name: 'Dragon Whip', type: 'melee', count: 2, power: 1.2, target: 'one' },
      mid: { name: 'Dragon Whip', type: 'melee', count: 2, power: 1.0, target: 'one' },
      back: { name: 'Whip Crack', type: 'melee', count: 1, power: 0.9, target: 'one' },
    },
    promotesTo: [{ classId: 'dragon-master', level: 20, aliMin: 25, aliMax: 65 }],
    moveType: 'foot', preferredRow: 'front', sprite: 'humanoid', palette: 'dragontamer',
  },
  'dragon-master': {
    id: 'dragon-master', name: 'Dragon Master', gender: 'M', tier: 3,
    desc: 'Lord of dragons; his lash carries their fury.',
    base: s(86, 25, 22, 14, 14, 14), growth: s(8, 3.1, 2.7, 1.5, 1.5, 1.8),
    attacks: {
      front: { name: 'Dragon Lash', type: 'melee', count: 3, power: 1.25, target: 'one' },
      mid: { name: 'Dragon Lash', type: 'melee', count: 2, power: 1.1, target: 'one' },
      back: { name: 'Dragon Roar', type: 'magic', count: 1, power: 1.0, target: 'row', element: 'fire' },
    },
    promotesTo: [],
    moveType: 'foot', preferredRow: 'front', sprite: 'humanoid', palette: 'dragonmaster',
  },
  'doll-master': {
    id: 'doll-master', name: 'Doll Master', gender: 'M', tier: 2,
    desc: 'A puppeteer whose marionettes fight in his stead.',
    base: s(56, 11, 11, 16, 13, 10), growth: s(5, 1.4, 1.5, 2.2, 1.7, 1.3),
    attacks: {
      front: { name: 'Doll Claw', type: 'melee', count: 1, power: 0.9, target: 'one' },
      mid: { name: 'Doll Dance', type: 'magic', count: 2, power: 0.8, target: 'one' },
      back: { name: 'Doll Dance', type: 'magic', count: 2, power: 0.9, target: 'one' },
    },
    promotesTo: [{ classId: 'enchanter', level: 14, aliMin: 30, aliMax: 70 }],
    moveType: 'foot', preferredRow: 'back', sprite: 'humanoid', palette: 'dollmaster',
  },
  enchanter: {
    id: 'enchanter', name: 'Enchanter', gender: 'M', tier: 3,
    desc: 'He winds souls like clockwork and sets them loose.',
    base: s(66, 12, 13, 24, 18, 11), growth: s(6, 1.5, 1.7, 2.9, 2.1, 1.4),
    attacks: {
      front: { name: 'Doll Claw', type: 'melee', count: 1, power: 0.9, target: 'one' },
      mid: { name: 'Phantom Waltz', type: 'magic', count: 1, power: 1.1, target: 'row' },
      back: { name: 'Phantom Waltz', type: 'magic', count: 1, power: 1.2, target: 'row' },
    },
    promotesTo: [],
    moveType: 'foot', preferredRow: 'back', sprite: 'humanoid', palette: 'enchanter',
  },

  // ------------------------------------------------------------------
  // FEMALE LINE
  // ------------------------------------------------------------------
  amazon: {
    id: 'amazon', name: 'Amazon', gender: 'F', tier: 1,
    desc: 'A warrior maiden with sword and sling. The root of every female class.',
    base: s(48, 12, 10, 8, 8, 12), growth: s(4, 2.0, 1.8, 1.1, 1.1, 1.7),
    attacks: {
      front: { name: 'Short Sword', type: 'melee', count: 2, power: 0.95, target: 'one' },
      mid: { name: 'Sling', type: 'ranged', count: 1, power: 0.85, target: 'one' },
      back: { name: 'Sling', type: 'ranged', count: 1, power: 0.8, target: 'one' },
    },
    promotesTo: [
      { classId: 'cleric', level: 4, cha: 50, aliMin: 60 },
      { classId: 'valkyrie', level: 5, cha: 50, aliMin: 35 },
      { classId: 'archer', level: 5, aliMin: 30, aliMax: 70 },
      { classId: 'witch', level: 5, cha: 50, aliMax: 65 },
      { classId: 'sorceress', level: 6, aliMax: 50 },
    ],
    moveType: 'foot', preferredRow: 'front', sprite: 'humanoid', palette: 'amazon',
  },
  valkyrie: {
    id: 'valkyrie', name: 'Valkyrie', gender: 'F', tier: 2,
    desc: 'A spear-maiden blessed by the heavens.',
    base: s(60, 16, 14, 11, 12, 13), growth: s(5, 2.4, 2.1, 1.4, 1.5, 1.8),
    attacks: {
      front: { name: 'Valkyrie Spear', type: 'melee', count: 2, power: 1.1, target: 'one' },
      mid: { name: 'Valkyrie Spear', type: 'melee', count: 2, power: 1.0, target: 'one' },
      back: { name: 'Spear Throw', type: 'ranged', count: 1, power: 0.9, target: 'one' },
    },
    promotesTo: [{ classId: 'freya', level: 15, cha: 60, aliMin: 55 }],
    moveType: 'foot', preferredRow: 'front', sprite: 'humanoid', palette: 'valkyrie',
  },
  freya: {
    id: 'freya', name: 'Freya', gender: 'F', tier: 3,
    desc: 'A war-goddess made flesh; lightning rides her spear.',
    base: s(76, 22, 18, 16, 17, 16), growth: s(6, 2.9, 2.4, 1.8, 1.9, 2.1),
    attacks: {
      front: { name: 'Divine Spear', type: 'melee', count: 3, power: 1.2, target: 'one', element: 'thunder' },
      mid: { name: 'Divine Spear', type: 'melee', count: 2, power: 1.15, target: 'one', element: 'thunder' },
      back: { name: 'Thunder Lance', type: 'magic', count: 1, power: 1.1, target: 'row', element: 'thunder' },
    },
    promotesTo: [],
    moveType: 'foot', preferredRow: 'front', sprite: 'humanoid', palette: 'freya',
  },
  archer: {
    id: 'archer', name: 'Archer', gender: 'F', tier: 2,
    desc: 'Her arrows fall harder the farther back she stands.',
    base: s(54, 15, 11, 9, 9, 15), growth: s(4, 2.3, 1.6, 1.1, 1.1, 2.1),
    attacks: {
      front: { name: 'Dagger', type: 'melee', count: 1, power: 0.8, target: 'one' },
      mid: { name: 'Long Bow', type: 'ranged', count: 2, power: 1.0, target: 'one' },
      back: { name: 'Long Bow', type: 'ranged', count: 3, power: 1.0, target: 'one' },
    },
    promotesTo: [{ classId: 'diana', level: 14, aliMin: 35, aliMax: 75 }],
    moveType: 'foot', preferredRow: 'back', sprite: 'humanoid', palette: 'archer',
  },
  diana: {
    id: 'diana', name: 'Diana', gender: 'F', tier: 3,
    desc: 'The huntress of the moon. Her volley blots the sky.',
    base: s(68, 20, 14, 12, 12, 19), growth: s(5, 2.8, 1.9, 1.4, 1.4, 2.5),
    attacks: {
      front: { name: 'Dagger', type: 'melee', count: 2, power: 0.9, target: 'one' },
      mid: { name: 'Moon Bow', type: 'ranged', count: 3, power: 1.1, target: 'one' },
      back: { name: 'Moon Bow', type: 'ranged', count: 4, power: 1.1, target: 'one' },
    },
    promotesTo: [],
    moveType: 'foot', preferredRow: 'back', sprite: 'humanoid', palette: 'diana',
  },
  cleric: {
    id: 'cleric', name: 'Cleric', gender: 'F', tier: 2,
    desc: 'A healer whose prayers mend wounds mid-battle.',
    base: s(50, 8, 9, 15, 18, 9), growth: s(4, 1.0, 1.3, 2.0, 2.4, 1.2),
    attacks: {
      front: { name: 'Mace', type: 'melee', count: 1, power: 0.7, target: 'one' },
      mid: { name: 'Heal', type: 'heal', count: 1, power: 1.2, target: 'allies', element: 'holy' },
      back: { name: 'Heal', type: 'heal', count: 1, power: 1.3, target: 'allies', element: 'holy' },
    },
    promotesTo: [{ classId: 'priest', level: 12, aliMin: 65 }],
    moveType: 'foot', preferredRow: 'back', sprite: 'humanoid', palette: 'cleric',
  },
  priest: {
    id: 'priest', name: 'Priest', gender: 'F', tier: 3,
    desc: 'Her benediction restores the ranks and scourges the unholy.',
    base: s(60, 9, 11, 20, 26, 10), growth: s(5, 1.1, 1.5, 2.4, 3.0, 1.3),
    attacks: {
      front: { name: 'Mace', type: 'melee', count: 1, power: 0.7, target: 'one' },
      mid: { name: 'Banish', type: 'magic', count: 1, power: 1.0, target: 'row', element: 'holy' },
      back: { name: 'Great Heal', type: 'heal', count: 1, power: 1.6, target: 'allies', element: 'holy' },
    },
    promotesTo: [],
    moveType: 'foot', preferredRow: 'back', sprite: 'humanoid', palette: 'priest',
  },
  witch: {
    id: 'witch', name: 'Witch', gender: 'F', tier: 2,
    desc: 'Her hexes tangle minds and slow blades.',
    base: s(48, 7, 8, 17, 14, 11), growth: s(4, 0.9, 1.2, 2.3, 1.8, 1.4),
    attacks: {
      front: { name: 'Broom Swat', type: 'melee', count: 1, power: 0.6, target: 'one' },
      mid: { name: 'Hex', type: 'magic', count: 1, power: 0.9, target: 'row', element: 'dark' },
      back: { name: 'Hex', type: 'magic', count: 1, power: 1.0, target: 'row', element: 'dark' },
    },
    promotesTo: [],
    moveType: 'foot', preferredRow: 'back', sprite: 'humanoid', palette: 'witch',
  },
  sorceress: {
    id: 'sorceress', name: 'Sorceress', gender: 'F', tier: 2,
    desc: 'A caster of killing frost.',
    base: s(46, 7, 8, 19, 15, 10), growth: s(4, 0.9, 1.2, 2.7, 1.9, 1.3),
    attacks: {
      front: { name: 'Dagger', type: 'melee', count: 1, power: 0.6, target: 'one' },
      mid: { name: 'Ice Storm', type: 'magic', count: 1, power: 1.0, target: 'row', element: 'ice' },
      back: { name: 'Ice Storm', type: 'magic', count: 1, power: 1.1, target: 'row', element: 'ice' },
    },
    promotesTo: [{ classId: 'siren', level: 15, aliMax: 50 }],
    moveType: 'foot', preferredRow: 'back', sprite: 'humanoid', palette: 'sorceress',
  },
  siren: {
    id: 'siren', name: 'Siren', gender: 'F', tier: 3,
    desc: 'Her song is the last sound her enemies hear.',
    base: s(56, 8, 10, 28, 20, 12), growth: s(4, 1.0, 1.3, 3.3, 2.3, 1.5),
    attacks: {
      front: { name: 'Dagger', type: 'melee', count: 1, power: 0.6, target: 'one' },
      mid: { name: 'Fatal Aria', type: 'magic', count: 1, power: 1.0, target: 'all', element: 'ice' },
      back: { name: 'Fatal Aria', type: 'magic', count: 1, power: 1.1, target: 'all', element: 'ice' },
    },
    promotesTo: [],
    moveType: 'foot', preferredRow: 'back', sprite: 'humanoid', palette: 'siren',
  },

  // ------------------------------------------------------------------
  // MONSTERS (enemy ranks, tamable in spirit)
  // ------------------------------------------------------------------
  hellhound: {
    id: 'hellhound', name: 'Hellhound', gender: 'X', tier: 2,
    desc: 'A burning beast that hunts in packs.',
    base: s(70, 18, 13, 6, 8, 16), growth: s(6, 2.5, 1.8, 0.7, 1.0, 2.1),
    attacks: {
      front: { name: 'Flame Fang', type: 'melee', count: 2, power: 1.1, target: 'one', element: 'fire' },
      mid: { name: 'Flame Fang', type: 'melee', count: 1, power: 1.0, target: 'one', element: 'fire' },
      back: { name: 'Howl', type: 'magic', count: 1, power: 0.6, target: 'one', element: 'fire' },
    },
    promotesTo: [{ classId: 'cerberus', level: 14, aliMax: 55 }],
    moveType: 'fast', preferredRow: 'front', sprite: 'beast', palette: 'hellhound',
  },
  cerberus: {
    id: 'cerberus', name: 'Cerberus', gender: 'X', tier: 3,
    desc: 'Three heads, one hunger.',
    base: s(90, 24, 17, 8, 10, 19), growth: s(7, 3.0, 2.2, 0.9, 1.2, 2.4),
    attacks: {
      front: { name: 'Triple Fang', type: 'melee', count: 3, power: 1.15, target: 'one', element: 'fire' },
      mid: { name: 'Triple Fang', type: 'melee', count: 2, power: 1.1, target: 'one', element: 'fire' },
      back: { name: 'Hell Howl', type: 'magic', count: 1, power: 0.8, target: 'row', element: 'fire' },
    },
    promotesTo: [],
    moveType: 'fast', preferredRow: 'front', sprite: 'beast', palette: 'cerberus',
  },
  skeleton: {
    id: 'skeleton', name: 'Skeleton', gender: 'X', tier: 2,
    desc: 'Rattling bones that refuse the grave.',
    base: s(60, 16, 14, 4, 4, 10), growth: s(5, 2.2, 2.0, 0.5, 0.5, 1.3),
    attacks: {
      front: { name: 'Bone Sword', type: 'melee', count: 2, power: 1.0, target: 'one', element: 'dark' },
      mid: { name: 'Bone Sword', type: 'melee', count: 1, power: 0.9, target: 'one', element: 'dark' },
      back: { name: 'Bone Throw', type: 'ranged', count: 1, power: 0.7, target: 'one' },
    },
    promotesTo: [],
    moveType: 'foot', preferredRow: 'front', sprite: 'humanoid', palette: 'skeleton',
  },
  ghost: {
    id: 'ghost', name: 'Ghost', gender: 'X', tier: 2,
    desc: 'A cold whisper that drinks the living.',
    base: s(50, 6, 8, 16, 16, 12), growth: s(4, 0.8, 1.1, 2.2, 2.2, 1.5),
    attacks: {
      front: { name: 'Chill Touch', type: 'magic', count: 1, power: 1.0, target: 'one', element: 'dark' },
      mid: { name: 'Chill Touch', type: 'magic', count: 1, power: 1.0, target: 'one', element: 'dark' },
      back: { name: 'Moan', type: 'magic', count: 1, power: 0.9, target: 'row', element: 'dark' },
    },
    promotesTo: [],
    moveType: 'fly', preferredRow: 'mid', sprite: 'ghost', palette: 'ghost',
  },
  golem: {
    id: 'golem', name: 'Golem', gender: 'X', tier: 2,
    desc: 'Animate stone. Slow, and nearly unbreakable.',
    base: s(95, 20, 30, 2, 12, 5), growth: s(9, 2.5, 3.8, 0.3, 1.4, 0.6),
    attacks: {
      front: { name: 'Stone Fist', type: 'melee', count: 1, power: 1.5, target: 'one' },
      mid: { name: 'Stone Fist', type: 'melee', count: 1, power: 1.3, target: 'one' },
      back: { name: 'Boulder', type: 'ranged', count: 1, power: 1.0, target: 'one' },
    },
    promotesTo: [],
    moveType: 'foot', preferredRow: 'front', sprite: 'golem', palette: 'golem',
  },
  wyvern: {
    id: 'wyvern', name: 'Wyvern', gender: 'X', tier: 2,
    desc: 'A young drake riding the wind.',
    base: s(76, 19, 15, 9, 10, 14), growth: s(7, 2.6, 2.0, 1.0, 1.2, 1.8),
    attacks: {
      front: { name: 'Talon Dive', type: 'melee', count: 2, power: 1.15, target: 'one' },
      mid: { name: 'Talon Dive', type: 'melee', count: 1, power: 1.05, target: 'one' },
      back: { name: 'Wind Gust', type: 'magic', count: 1, power: 0.8, target: 'one' },
    },
    promotesTo: [{ classId: 'red-dragon', level: 16, aliMax: 60 }],
    moveType: 'fly', preferredRow: 'front', sprite: 'dragon', palette: 'wyvern',
  },
  'red-dragon': {
    id: 'red-dragon', name: 'Red Dragon', gender: 'X', tier: 3,
    desc: 'An elder fire dragon. Cities remember its shadow.',
    base: s(105, 26, 22, 14, 14, 15), growth: s(9, 3.2, 2.7, 1.5, 1.6, 1.9),
    attacks: {
      front: { name: 'Dragon Claw', type: 'melee', count: 2, power: 1.3, target: 'one' },
      mid: { name: 'Fire Breath', type: 'magic', count: 1, power: 1.2, target: 'row', element: 'fire' },
      back: { name: 'Fire Breath', type: 'magic', count: 1, power: 1.1, target: 'row', element: 'fire' },
    },
    promotesTo: [],
    moveType: 'fly', preferredRow: 'front', sprite: 'dragon', palette: 'reddragon',
  },
};

export function classOf(id: string): ClassDef {
  const c = CLASSES[id];
  if (!c) throw new Error(`Unknown class: ${id}`);
  return c;
}
