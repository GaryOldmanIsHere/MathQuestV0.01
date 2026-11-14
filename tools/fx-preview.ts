// A battlefield for looking at the battle's effects one at a time, with the
// dev server running: /tools/fx-preview.html. Two squads of painted figures
// face each other on the ground and under the sky asked for; a script then
// calls __fx(kind, hue) to set an effect going and __step(ms) to move time
// on by exactly that much and draw, so each moment can be caught.
//
//   ?field=plain|road|forest|mountain|water  &hour=0.4  &weather=clear|rain|snow|mist|cloudy
//   &left=fighter,knight,wizard  &right=soldier,archer,cleric  &quality=medium
//
// __fx('slash' | 'arrow' | 'spell' | 'heal' | 'cast', hue) acts from the
// left squad's first unit on the right squad's first (or the reverse with
// __fx(kind, hue, true)).

import { Engine } from '../src/render/engine';
import type { Quality } from '../src/render/quality';
import { loadWorldModels } from '../src/gfx3d/models';
import { BattleStage } from '../src/gfx3d/stage';
import type { Hue } from '../src/gfx3d/spells';
import { paintedSet } from '../src/art/sheet';
import { allClasses } from '../src/data/registry';
import { frameAction } from '../src/gfx3d/layout';
import type { Placement } from '../src/gfx3d/layout';
import type { Terrain } from '../src/core/terrain';
import type { Weather } from '../src/gfx3d/sky';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const engine = await Engine.create(canvas);
engine.setQuality((q.get('quality') ?? 'medium') as Quality);
await loadWorldModels();
engine.renderer.setAnimationLoop(null);

const byId = new Map(allClasses().map((c) => [c.id, c]));
const stage = new BattleStage();
const s = engine.settings;
stage.setField((q.get('field') ?? 'plain') as Terrain, {
  seed: 11, grass: s.grass, shadows: s.shadows, particles: s.particles, simple: s.simpleShading,
  hour: Number(q.get('hour') ?? 0.4), weather: (q.get('weather') ?? 'clear') as Weather,
});
stage.resize(engine.width, engine.height);
engine.onResize((w, h) => stage.resize(w, h));

const places = new Map<number, Placement>();
const sides: [string, 1 | -1][] = [[q.get('left') ?? 'fighter,knight,wizard', 1], [q.get('right') ?? 'soldier,archer,cleric', -1]];
let id = 1;
const first: number[] = [];
for (const [list, facing] of sides) {
  list.split(',').forEach((cls, k) => {
    const def = byId.get(cls);
    if (!def) return;
    const place: Placement = { x: -facing * (1.9 + (k === 2 ? 2 : 0) * 1.7) + (k - 1) * 1.0, z: (k - 1) * 2.4, facing, large: false };
    stage.addUnit(id, paintedSet(def), place);
    places.set(id, place);
    if (k === 0) first.push(id);
    id++;
  });
}

const frame = () => engine.render(stage);
const [a, b] = first;
stage.cut(frameAction(places.get(a)!, [places.get(b)!], stage.aspect), 0);
stage.update(16);
frame();

declare global {
  interface Window {
    __step(ms: number): void;
    __fx(kind: string, hue?: Hue, reverse?: boolean): void;
    __ready: boolean;
  }
}

window.__step = (ms: number) => {
  for (let t = 0; t < ms; t += 16) stage.update(Math.min(16, ms - t));
  frame();
};

window.__fx = (kind: string, hue: Hue = 'physical', reverse = false) => {
  const [from, to] = reverse ? [b, a] : [a, b];
  const facing = places.get(from)!.facing;
  const hit = () => {
    stage.play(to, 'hit');
    stage.flash(to);
    stage.recoil(to);
  };
  if (kind === 'slash') {
    stage.highlight(from);
    stage.advance(from, [places.get(to)!.x, places.get(to)!.z], 300, () => {
      const { hit: at } = stage.timing(from, 'attack');
      stage.play(from, 'attack');
      stage.tween(at, () => {}, () => {
        stage.spells.slash(to, hue, facing, true);
        hit();
        stage.hitStop(80);
        stage.punch(1);
        stage.quake(0.2);
      });
    });
  } else if (kind === 'arrow') {
    stage.play(from, 'attack');
    stage.spells.arrow(from, to, 380, hit, hue);
  } else if (kind === 'cast') {
    const { total } = stage.timing(from, 'cast');
    stage.play(from, 'cast');
    stage.spells.glyph(from, hue, total + 250);
    stage.spells.gather(from, hue, total * 0.6);
  } else if (kind === 'spell') {
    stage.spells.spell(from, to, hue, hit);
  } else if (kind === 'heal') {
    stage.spells.heal(to);
  }
};

window.__ready = true;
