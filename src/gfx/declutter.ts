// Screen labels (names over units) kept from sitting on one another. A
// label that would cover one already placed moves up, a line at a time,
// until it is clear; the lowest labels are placed first, so the units
// nearest the camera keep their labels where they belong.

export interface LabelBox {
  /** Centre x, top y, width and height, in screen pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: LabelBox, b: LabelBox, pad: number) =>
  Math.abs(a.x - b.x) * 2 < a.w + b.w + pad * 2 && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/**
 * The y each label should stand at so that none overlaps another (at most
 * `tries` lines moved). Only the first `movable` boxes may move; the rest
 * are fixed in place, and the movable ones keep clear of them.
 */
export function declutter(boxes: LabelBox[], pad = 1, tries = 6, movable = boxes.length): number[] {
  const order = boxes.map((_, i) => i).filter((i) => i < movable).sort((a, b) => boxes[b].y - boxes[a].y);
  const placed: LabelBox[] = boxes.slice(movable);
  const out = boxes.map((b) => b.y);
  for (const i of order) {
    const box = { ...boxes[i] };
    for (let k = 0; k < tries && placed.some((p) => overlaps(box, p, pad)); k++) box.y -= box.h + pad;
    placed.push(box);
    out[i] = box.y;
  }
  return out;
}
