import type Phaser from 'phaser';
import type { ClassDef } from '../core/types';
import type { SpriteSet } from './sprites';
import { setFromStill } from './sprites';
import { ob64SpriteSet } from './ob64Sprites';

// Which sprite set a unit is drawn with in battle: Ogre Battle 64's own, in
// its side's colours, when they were extracted and prepared; otherwise one
// built from the class's single picture (Palatinus's pixel art).

const fallback = new Map<string, SpriteSet>();

export function spriteSetFor(scene: Phaser.Scene, def: ClassDef, side: 'player' | 'enemy' = 'player'): SpriteSet {
  const own = ob64SpriteSet(def, side);
  if (own) return own;
  let set = fallback.get(def.palette);
  if (!set) {
    const src = scene.textures.get(`unit-${def.palette}`).getSourceImage() as HTMLCanvasElement;
    set = setFromStill(src, src.width, src.height);
    fallback.set(def.palette, set);
  }
  return set;
}
