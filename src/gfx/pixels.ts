import Phaser from 'phaser';
import type { ClassDef } from '../core/types';

// Hand-authored 12x16 chibi sprite templates + per-class palette swaps,
// rendered into textures at boot. All art is original, in an N64-era
// pixel style. Symbols: . transparent, o outline, s skin, e eye,
// h hair/helm, a armor primary, b trim, w weapon metal, x wood, d shield.

export type Template = string[];

const WARRIOR: Template = [
  '....oooo....',
  '..ohhhhhho..',
  '..ohssssho..',
  '..osseesso..',
  '...osssso...',
  '....oooo..w.',
  '..oaaaaao.w.',
  '.doaabbao.w.',
  '.ddaabbao.w.',
  '.ddaaaaao.x.',
  '.doaaaaao...',
  '..oaaaaao...',
  '...oa.ao....',
  '...oa.ao....',
  '..oo...oo...',
  '..oo...oo...',
];

const HEAVY: Template = [
  '....oooo....',
  '...ohhhho...',
  '..ohhhhhho..',
  '..ohseesho..',
  '...osssso...',
  '..dddooo.w..',
  '.dddaaaao.w.',
  '.dbdaabao.w.',
  '.dddaabao.w.',
  '.dbdaaaao.x.',
  '.dddaaaao...',
  '..oaaaaao...',
  '...oa.ao....',
  '...oa.ao....',
  '..oo...oo...',
  '..oo...oo...',
];

const ROGUE: Template = [
  '....oooo....',
  '...ohhhhho..',
  '..ohhhhhho..',
  '..ohseesho..',
  '...obbbbo...',
  '....oooo....',
  '.w.oaaaao.w.',
  '.w.oabbao.w.',
  '.xoaabbaox..',
  '..oaaaaao...',
  '..oaaaaao...',
  '..oaaaaao...',
  '...oa.ao....',
  '...oa.ao....',
  '..oo...oo...',
  '..oo...oo...',
];

const ROBE: Template = [
  '.....ohho...',
  '....ohhho...',
  '...ohhhhho..',
  '..ohhhhhhho.',
  '..oosseesoo.',
  '...ossssso..',
  '....oooo..x.',
  '..oaaaaao.x.',
  '.oaabbbaaox.',
  '.oaabbbaaox.',
  '.oaaaaaaaox.',
  '.oaaaaaaao..',
  '.oaaaaaaao..',
  '.oaaaaaaao..',
  '.ooaaaaaoo..',
  '..ooooooo...',
];

const DRESS: Template = [
  '....oooo....',
  '..ohhhhhho..',
  '.ohhhhhhhho.',
  '.ohsseessho.',
  '.ohossssoho.',
  '..h.oooo.h..',
  '..oaabbao.x.',
  '..oaabbao.x.',
  '.oaaaaaaaox.',
  '.oaaaaaaaox.',
  '.oaaaaaaao..',
  'oaaaaaaaaao.',
  'oaaaaaaaaao.',
  'oaaaaaaaaao.',
  '.ooaaaaaoo..',
  '..ooooooo...',
];

const ARCHER_T: Template = [
  '....oooo....',
  '..ohhhhhho..',
  '.ohhhhhhhho.',
  '.ohsseessho.',
  '..oossssoo..',
  '....oooo.x..',
  '..oaaaao.x..',
  '..oabbaox...',
  '..oabbao.x..',
  '..oaaaao.x..',
  '..oaaaaao.x.',
  '..oaaaaao...',
  '...oa.ao....',
  '...oa.ao....',
  '..oo...oo...',
  '..oo...oo...',
];

const BEAST: Template = [
  '............',
  '............',
  '.oo.........',
  'ohho....oo..',
  'ohhoooooaao.',
  'oheaaaaaaao.',
  'ohsaaaaaaao.',
  '.oaaaaaaaao.',
  '.oaaaaaaaox.',
  '.oaaaaaaao..',
  '..oaaaaao...',
  '..oa..oao...',
  '..oa..oao...',
  '..oo..oo....',
  '.oo...oo....',
  '............',
];

const GHOST_T: Template = [
  '............',
  '....oooo....',
  '..ohaaaaho..',
  '..oaaaaaao..',
  '.oaeaaaeao..',
  '.oaaaaaaao..',
  '.oaabbbaao..',
  '.oaaaaaaao..',
  '.oaaaaaaao..',
  '.oaaaaaaao..',
  '..oaaaaao...',
  '..oa.aa.o...',
  '...o.aa.o...',
  '....o..o....',
  '............',
  '............',
];

const GOLEM_T: Template = [
  '...oooooo...',
  '..oaaaaaao..',
  '..oaeaaeao..',
  '..oaaaaaao..',
  '.ooaabbaaoo.',
  'oaaoaaaaoaao',
  'oaaoaaaaoaao',
  'oaaoabbaoaao',
  'oaaoaaaaoaao',
  '.o.oaaaao.o.',
  '...oaaaao...',
  '..oaaoaaao..',
  '..oaao.aao..',
  '..oaao.aao..',
  '.ooaao.aaoo.',
  '.oooo..oooo.',
];

const DRAGON_T: Template = [
  '..oo........',
  '.ohho.......',
  'ohhhoo......',
  'oheho.......',
  '.ohhoo..oo..',
  '..ohaooaao..',
  '..oaaaaaao..',
  '.oaabbbaaao.',
  '.oaabbbaaao.',
  'oaaoaaaaoaao',
  'oao.oaaao.oa',
  '....oaaao...',
  '...oaa.aao..',
  '...oa...ao..',
  '..oo....oo..',
  '............',
];

// A rider on horseback (the horse in the wood colour), for cavalry.
const RIDER_T: Template = [
  '....oooo....',
  '...ohhhho..w',
  '...ohseso..w',
  '....osso...w',
  '...oaaaao..w',
  '..oaabbaao.w',
  '..oaaaaaaoox',
  'oo.oaaaaoxxo',
  'oxooxxxxxxxo',
  '.oxxxxxxxxo.',
  '..oxxxxxxxo.',
  '..oxo...oxo.',
  '..oxo...oxo.',
  '..oxo...oxo.',
  '.oo.....oo..',
  '............',
];

// Something from the sea: tentacles and a staring eye.
const SEA_T: Template = [
  '............',
  '....oooo....',
  '...oaaaao...',
  '..oaaaaaao..',
  '..oaeaaeao..',
  '..oaaaaaao..',
  '..oabbbbao..',
  '...oaaaao...',
  '..oaoaaoao..',
  '.oaooaaooao.',
  '.oao.oo.oao.',
  'oao..oo..oao',
  'oo..oaao..oo',
  '....oaao....',
  '.....oo.....',
  '............',
];

export const TEMPLATES: Record<string, Template> = {
  warrior: WARRIOR,
  heavy: HEAVY,
  rogue: ROGUE,
  robe: ROBE,
  dress: DRESS,
  archer: ARCHER_T,
  beast: BEAST,
  ghost: GHOST_T,
  golem: GOLEM_T,
  dragon: DRAGON_T,
  rider: RIDER_T,
  sea: SEA_T,
};

export interface Palette {
  o: string; s: string; e: string; h: string;
  a: string; b: string; w: string; x: string; d: string;
}

const BASE: Palette = {
  o: '#1a1028', s: '#f0c8a0', e: '#20182c', h: '#6b4a2b',
  a: '#4a5a8c', b: '#c8b458', w: '#c8d0e0', x: '#8a5a2c', d: '#7a6a4a',
};

function pal(p: Partial<Palette>): Palette {
  return { ...BASE, ...p };
}

// template used per palette key, plus color overrides
export const CLASS_ART: Record<string, { template: string; palette: Palette }> = {
  fighter:      { template: 'warrior', palette: pal({ a: '#7a5a3a', b: '#a88a4a', h: '#6b4a2b' }) },
  knight:       { template: 'warrior', palette: pal({ a: '#5a7ab8', b: '#d0d8e8', h: '#b8c4d8' }) },
  paladin:      { template: 'warrior', palette: pal({ a: '#e8e4d0', b: '#d8b84a', h: '#e8d888', w: '#f0e8a0' }) },
  berserker:    { template: 'warrior', palette: pal({ a: '#a04a38', b: '#682a20', h: '#c87838', d: '#5a4a3a' }) },
  blackknight:  { template: 'warrior', palette: pal({ a: '#38304a', b: '#8a3a5a', h: '#28203a', w: '#b090c8' }) },
  phalanx:      { template: 'heavy',   palette: pal({ a: '#6a7a8a', b: '#48586a', h: '#8a98a8', d: '#98a8b8' }) },
  cataphract:   { template: 'heavy',   palette: pal({ a: '#8a6a3a', b: '#c8a858', h: '#a88848', d: '#c8b878' }) },
  ninja:        { template: 'rogue',   palette: pal({ a: '#3a3a52', b: '#8a2a3a', h: '#2a2a3e', w: '#a8b0c0' }) },
  ninjamaster:  { template: 'rogue',   palette: pal({ a: '#58283a', b: '#c89838', h: '#38182a', w: '#e0d8b0' }) },
  fencer:       { template: 'rogue',   palette: pal({ a: '#4a8a6a', b: '#d8d0b0', h: '#c8a868', w: '#d0d8e0' }) },
  swordmaster:  { template: 'rogue',   palette: pal({ a: '#e0e0e8', b: '#4a6a9a', h: '#d8d8e0', w: '#a0e0e8' }) },
  wizard:       { template: 'robe',    palette: pal({ a: '#3a4a9a', b: '#c8b458', h: '#2a3a7a' }) },
  mage:         { template: 'robe',    palette: pal({ a: '#6a3a9a', b: '#d0a848', h: '#4a2a7a' }) },
  sorcerer:     { template: 'robe',    palette: pal({ a: '#2a2a3a', b: '#9a4ae0', h: '#1a1a2c' }) },
  beasttamer:   { template: 'warrior', palette: pal({ a: '#8a6a2a', b: '#5a8a3a', h: '#3a2a1a', w: '#a87848' }) },
  dragontamer:  { template: 'warrior', palette: pal({ a: '#3a8a7a', b: '#c8a838', h: '#2a4a3a', w: '#a87848' }) },
  dragonmaster: { template: 'warrior', palette: pal({ a: '#1a6a8a', b: '#e0b838', h: '#0a3a4a', w: '#e0c878' }) },
  dollmaster:   { template: 'robe',    palette: pal({ a: '#7a4a5a', b: '#e0c8a0', h: '#5a3a4a' }) },
  enchanter:    { template: 'robe',    palette: pal({ a: '#38686a', b: '#e0d098', h: '#284a4a' }) },
  amazon:       { template: 'archer',  palette: pal({ a: '#a86a4a', b: '#e0c088', h: '#c8a038' }) },
  valkyrie:     { template: 'warrior', palette: pal({ a: '#c8d0e8', b: '#5a7ab8', h: '#e8d878', w: '#e8f0f8' }) },
  freya:        { template: 'warrior', palette: pal({ a: '#f0e8c8', b: '#d8a838', h: '#f0e090', w: '#f8f0a8' }) },
  archer:       { template: 'archer',  palette: pal({ a: '#4a7a3a', b: '#a8c858', h: '#a87838' }) },
  diana:        { template: 'archer',  palette: pal({ a: '#38506a', b: '#c8d8e8', h: '#d8d8e8' }) },
  cleric:       { template: 'dress',   palette: pal({ a: '#e8e8e0', b: '#5a8ab8', h: '#d8c890' }) },
  priest:       { template: 'dress',   palette: pal({ a: '#f0ecd8', b: '#d8b848', h: '#f0e8c0' }) },
  witch:        { template: 'robe',    palette: pal({ a: '#5a2a6a', b: '#e08838', h: '#3a1a4a' }) },
  sorceress:    { template: 'dress',   palette: pal({ a: '#8a3a9a', b: '#d8c8e8', h: '#c88ae0' }) },
  siren:        { template: 'dress',   palette: pal({ a: '#3a6a9a', b: '#a0e0e8', h: '#68c8d8' }) },
  skeleton:     { template: 'warrior', palette: pal({ a: '#d8d8c8', b: '#a8a898', h: '#e8e8d8', s: '#e8e8d8', w: '#b8b8a8' }) },
  hellhound:    { template: 'beast',   palette: pal({ a: '#8a3a2a', b: '#e08838', h: '#6a2a1a', s: '#e0e0e0' }) },
  cerberus:     { template: 'beast',   palette: pal({ a: '#4a2a3a', b: '#e04828', h: '#381a2a', s: '#e0e0e0' }) },
  ghost:        { template: 'ghost',   palette: pal({ a: '#b8d0e0', b: '#7898b8', e: '#2a4a6a' }) },
  golem:        { template: 'golem',   palette: pal({ a: '#9a9488', b: '#6a8a5a', e: '#e0b838' }) },
  wyvern:       { template: 'dragon',  palette: pal({ a: '#5a8a4a', b: '#c8d088', h: '#3a5a2a', e: '#e0b838' }) },
  reddragon:    { template: 'dragon',  palette: pal({ a: '#a83828', b: '#e0a838', h: '#7a2418', e: '#f0e048' }) },
};

export const SPRITE_W = 12;
export const SPRITE_H = 16;

function paint(scene: Phaser.Scene, texKey: string, art: { template: string; palette: Palette }): void {
  if (scene.textures.exists(texKey)) return;
  const tpl = TEMPLATES[art.template];
  if (!tpl) throw new Error(`missing template ${art.template}`);
  const canvas = scene.textures.createCanvas(texKey, SPRITE_W, SPRITE_H);
  if (!canvas) return;
  const ctx = canvas.getContext();
  for (let y = 0; y < tpl.length; y++) {
    const row = tpl[y];
    if (row.length !== SPRITE_W) throw new Error(`template ${art.template} row ${y} width ${row.length}`);
    for (let x = 0; x < row.length; x++) {
      const ch = row[x] as keyof Palette | '.';
      if (ch === '.') continue;
      ctx.fillStyle = art.palette[ch] ?? '#ff00ff';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  canvas.refresh();
}

/** Render every hand-made palette-swapped sprite into a texture named `unit-<key>`. */
export function buildUnitTextures(scene: Phaser.Scene): void {
  for (const [key, art] of Object.entries(CLASS_ART)) paint(scene, `unit-${key}`, art);
}

function hsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function nameHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Stand-in art for a class that has no hand-made sprite (most of Ogre Battle
 * 64's roster, until its real sprites are extracted): the template follows the
 * class's build and role, the colours a stable hash of its name.
 */
export function artFor(def: ClassDef): { template: string; palette: Palette } {
  const known = CLASS_ART[def.palette] ?? CLASS_ART[def.palette.replace(/-/g, '')];
  if (known) return known;

  const back = def.attacks.back;
  const caster = def.preferredRow === 'back' && (back?.type === 'magic' || back?.type === 'heal');
  let template: string;
  if (['dragon', 'golem', 'beast', 'ghost', 'rider', 'sea'].includes(def.sprite)) {
    template = def.sprite;
  } else if (caster) {
    template = def.gender === 'F' ? 'dress' : 'robe';
  } else if (back?.type === 'ranged') {
    template = 'archer';
  } else if (def.growth.vit > def.growth.str) {
    template = 'heavy';
  } else if (def.growth.agi >= 4) {
    template = 'rogue';
  } else {
    template = 'warrior';
  }

  const h = nameHash(def.name);
  const hue = h % 360;
  const undead = def.resist.virtue < 45 && def.resist.bane > 55;
  return {
    template,
    palette: {
      o: '#1a1028',
      s: undead ? '#d8d8c8' : def.gender === 'X' ? hsl(hue + 20, 0.25, 0.55) : '#f0c8a0',
      e: def.gender === 'X' ? '#f0d048' : '#20182c',
      h: hsl((hue + 40 + ((h >> 9) % 80)) % 360, 0.45, 0.3 + ((h >> 4) % 20) / 100),
      a: hsl(hue, 0.42, 0.42),
      b: hsl(hue + 180, 0.5, 0.62),
      w: '#c8d0e0',
      x: '#8a5a2c',
      d: hsl(hue + 30, 0.25, 0.5),
    },
  };
}

/** Make sure every class in the active dataset has a `unit-<palette>` texture. */
export function buildClassTextures(scene: Phaser.Scene, classes: ClassDef[]): void {
  for (const def of classes) paint(scene, `unit-${def.palette}`, artFor(def));
}
