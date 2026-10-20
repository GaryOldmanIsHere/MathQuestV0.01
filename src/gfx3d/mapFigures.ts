import type { ClassDef } from '../core/types';
import type { SpriteImage, SpriteSet } from './sprites';
import { frameAt } from './sprites';
import type { MapFigure } from './world';
import { ob64SpriteSet } from './ob64Sprites';
import { paintedSet } from '../art/sheet';

// The figure a squad shows on the campaign map: its leader, standing or on
// the march, turned the way it is going.

/** How tall a leader stands on the map, in world units (a tile is one). */
export const FIGURE_HEIGHT = 1.5;

/** Which way a screen octant (0 right, 2 toward the camera, 4 left, 6 away) faces, or neither. */
export function sideOf(screenOctant: number): 'left' | 'right' | null {
  if (screenOctant === 3 || screenOctant === 4 || screenOctant === 5) return 'left';
  if (screenOctant === 7 || screenOctant === 0 || screenOctant === 1) return 'right';
  return null;
}

/**
 * A figure from one standing drawing that faces `faces`: flipped to face the
 * way the squad marches, and bobbing a pixel in step while it marches.
 */
export function stillFigure(image: SpriteImage, width: number, height: number, faces: 'left' | 'right'): MapFigure {
  let facing = faces;
  return {
    pixelsPerUnit: height / FIGURE_HEIGHT,
    frame(screenOctant, ms, moving) {
      facing = sideOf(screenOctant) ?? facing;
      const bob = moving && Math.floor(ms / 170) % 2 === 1 ? 1 : 0;
      return { image, anchorX: width / 2, anchorY: height - bob, mirror: facing !== faces };
    },
  };
}

/**
 * A figure from a full sprite set, as Ogre Battle 64 walks its units over
 * the map: seen from the front while it comes toward the camera and from
 * behind while it goes away, turned to the side it heads for, walking when
 * it marches and at ease when it halts. `scale` enlarges it (great beasts).
 */
export function setFigure(set: SpriteSet, scale = 1): MapFigure {
  const front = set.views.find((v) => v.seen === 'front') ?? set.views[0];
  const back = set.views.find((v) => v.seen === 'back') ?? front;
  let view = front;
  let facing: 'left' | 'right' = front.faces;
  return {
    pixelsPerUnit: (set.pixelsPerUnit * 1.55) / FIGURE_HEIGHT / scale,
    frame(screenOctant, ms, moving) {
      if (screenOctant >= 1 && screenOctant <= 3) view = front;
      else if (screenOctant >= 5 && screenOctant <= 7) view = back;
      facing = sideOf(screenOctant) ?? facing;
      const f = frameAt(view.anims[moving ? 'walk' : 'idle'], ms).frame;
      return { image: f.image, normal: f.normal, anchorX: f.anchorX, anchorY: f.anchorY, mirror: view.faces !== facing };
    },
  };
}

const cache = new Map<string, MapFigure>();

/**
 * A class's figure on the map: Ogre Battle 64's walking figure in its
 * side's colours when its sprites are prepared, else the class painted in
 * full.
 */
export function mapFigureFor(def: ClassDef, side: 'player' | 'enemy'): MapFigure {
  const key = `${def.id}|${side}`;
  let f = cache.get(key);
  if (!f) {
    const set = ob64SpriteSet(def, side) ?? paintedSet(def);
    f = setFigure(set, def.size === 2 ? set.largeScale : 1);
    cache.set(key, f);
  }
  return f;
}
