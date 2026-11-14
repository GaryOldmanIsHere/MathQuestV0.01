import type { ClassDef } from '../core/types';
import type { SpriteSet } from './sprites';
import { ob64SpriteSet } from './ob64Sprites';
import { paintedSet } from '../art/sheet';

// Which sprite set a unit is drawn with in battle: Ogre Battle 64's own, in
// its side's colours, when they were extracted and prepared; otherwise the
// class painted in full (src/art/).

export function spriteSetFor(def: ClassDef, side: 'player' | 'enemy' = 'player'): SpriteSet {
  return ob64SpriteSet(def, side) ?? paintedSet(def);
}
