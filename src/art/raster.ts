// A small pixel canvas for painting figures as an HD-2D game draws its
// sprites: each pixel knows not only its colour but which way its surface
// faces, so the same drawing yields a picture and a normal map, and the 3D
// scene can light the sprite as it lights the land.
//
// Shapes are drawn as solids: a sphere-like ellipse (a head, a shoulder), a
// tapered capsule (a limb, a blade), a flat plate (a shield, a cloak). Each
// sets the pixels it covers that lie nearer than what is already there, with
// the surface's facing at that pixel. Then the silhouette is outlined, and
// lines are drawn where one part stands in front of another.

/** A colour slot: which of a figure's palette colours a pixel takes. */
export type Slot = number;

export interface ShapeOptions {
  /** Metal, enamel, gems: these catch a glint of the light. */
  shine?: boolean;
  /** How far the surface bulges toward the viewer, as a share of the shape's size (0 flat, 1 round). */
  round?: number;
}

/** Light for the colours painted into the sprite itself (from the upper left, in front). */
const PAINT_LIGHT = normalize3([-0.45, -0.6, 0.66]);

export class Raster {
  readonly slot: Uint8Array;
  readonly depth: Float32Array;
  /** The surface's facing: x right, y down (as the pixels run), z toward the viewer. */
  readonly nx: Float32Array;
  readonly ny: Float32Array;
  readonly nz: Float32Array;
  /** Which part a pixel belongs to (lines are drawn between parts). */
  readonly part: Uint16Array;
  readonly shine: Uint8Array;
  /** 1 on the outline round the silhouette, 2 on a line between parts. */
  readonly line: Uint8Array;
  private currentPart = 1;

  constructor(readonly w: number, readonly h: number) {
    const n = w * h;
    this.slot = new Uint8Array(n);
    this.depth = new Float32Array(n).fill(-Infinity);
    this.nx = new Float32Array(n);
    this.ny = new Float32Array(n);
    this.nz = new Float32Array(n);
    this.part = new Uint16Array(n);
    this.shine = new Uint8Array(n);
    this.line = new Uint8Array(n);
  }

  /** Begin a new part: shapes drawn from here on are outlined against the parts before. */
  beginPart(): void {
    this.currentPart++;
  }

  filled(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.slot[y * this.w + x] !== 0;
  }

  private plot(x: number, y: number, z: number, slot: Slot, n: [number, number, number], shine: boolean): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const k = y * this.w + x;
    if (z < this.depth[k]) return;
    this.depth[k] = z;
    this.slot[k] = slot;
    this.nx[k] = n[0];
    this.ny[k] = n[1];
    this.nz[k] = n[2];
    this.part[k] = this.currentPart;
    this.shine[k] = shine ? 1 : 0;
  }

  /** An ellipse that bulges toward the viewer like a sphere: a head, a shoulder, a belly. */
  ellipse(cx: number, cy: number, rx: number, ry: number, z: number, slot: Slot, o: ShapeOptions = {}): void {
    const round = o.round ?? 1;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const u = (x + 0.5 - cx) / rx;
        const v = (y + 0.5 - cy) / ry;
        const d = u * u + v * v;
        if (d > 1) continue;
        const bulge = Math.sqrt(1 - d);
        const n = normalize3([u * round, v * round, bulge + (1 - round)]);
        this.plot(x, y, z + bulge * Math.min(rx, ry) * round, slot, n, !!o.shine);
      }
    }
  }

  /**
   * A tapered rod from (ax, ay), radius ra, to (bx, by), radius rb, rounded at
   * both ends: an arm, a leg, a blade, a staff. It bulges like a cylinder
   * across its length.
   */
  capsule(ax: number, ay: number, bx: number, by: number, ra: number, rb: number, z: number, slot: Slot, o: ShapeOptions = {}): void {
    const round = o.round ?? 1;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-6;
    const r = Math.max(ra, rb);
    for (let y = Math.floor(Math.min(ay, by) - r); y <= Math.ceil(Math.max(ay, by) + r); y++) {
      for (let x = Math.floor(Math.min(ax, bx) - r); x <= Math.ceil(Math.max(ax, bx) + r); x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        const cx = ax + dx * t;
        const cy = ay + dy * t;
        const rad = ra + (rb - ra) * t;
        const ox = px - cx;
        const oy = py - cy;
        const d = Math.hypot(ox, oy);
        if (d > rad || rad <= 0) continue;
        const s = d / rad;
        const bulge = Math.sqrt(1 - s * s);
        const n = normalize3([(ox / rad) * round, (oy / rad) * round, bulge + (1 - round)]);
        this.plot(x, y, z + bulge * rad * round, slot, n, !!o.shine);
      }
    }
  }

  /**
   * A flat plate (a shield, a cloak, a skirt), facing `normal`, its rim
   * bevelled `bevel` pixels so its edges catch the light.
   */
  polygon(points: [number, number][], z: number, slot: Slot, o: ShapeOptions & { normal?: [number, number, number]; bevel?: number } = {}): void {
    const face = normalize3(o.normal ?? [0, 0, 1]);
    const bevel = o.bevel ?? 1.5;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        if (!inside(points, px, py)) continue;
        // Toward the rim, the face turns outward.
        const [ex, ey, dist] = nearestEdge(points, px, py);
        const k = bevel > 0 ? Math.max(0, 1 - dist / bevel) : 0;
        const n = normalize3([face[0] + ex * k * 0.8, face[1] + ey * k * 0.8, face[2]]);
        this.plot(x, y, z, slot, n, !!o.shine);
      }
    }
  }

  /**
   * Outline the figure: a line round the silhouette, just outside it, and a
   * line inside wherever a part stands well in front of the part beside it.
   * `slotOf` gives the outline round a pixel the colour of the pixel it
   * borders (darkened when the picture is made).
   */
  outline(gap = 1.5): void {
    const { w, h } = this;
    const outer: [number, number][] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (this.slot[k] !== 0) {
          // A line between parts: this pixel lies well behind a neighbour of another part.
          for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const qx = x + ox;
            const qy = y + oy;
            if (!this.filled(qx, qy)) continue;
            const q = qy * w + qx;
            if (this.part[q] !== this.part[k] && this.depth[q] - this.depth[k] > gap) {
              this.line[k] = 2;
              break;
            }
          }
          continue;
        }
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => this.filled(x + ox, y + oy))) outer.push([x, y]);
      }
    }
    for (const [x, y] of outer) {
      // The outline takes the colour and facing of the pixel it borders, nearest first.
      let best = -1;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!this.filled(x + ox, y + oy)) continue;
        const q = (y + oy) * w + x + ox;
        if (best < 0 || this.depth[q] > this.depth[best]) best = q;
      }
      const k = y * w + x;
      this.slot[k] = this.slot[best];
      this.depth[k] = this.depth[best] - 0.01;
      this.nx[k] = this.nx[best];
      this.ny[k] = this.ny[best];
      this.nz[k] = this.nz[best];
      this.part[k] = this.part[best];
      this.line[k] = 1;
    }
  }

  /**
   * The picture: each pixel its slot's colour, shaded in three soft bands by
   * a light from the upper left (so it reads even unlit, as in a menu),
   * metal glinting, outlines dark and lines between parts darker.
   * `lit` bakes in fuller light and shade, for a picture shown flat.
   */
  rgba(palette: [number, number, number][], lit = false): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.w * this.h * 4);
    for (let k = 0; k < this.slot.length; k++) {
      const s = this.slot[k];
      if (s === 0) continue;
      const c = palette[s] ?? [255, 0, 255];
      const d = this.nx[k] * PAINT_LIGHT[0] + this.ny[k] * PAINT_LIGHT[1] + this.nz[k] * PAINT_LIGHT[2];
      let shade = lit ? 0.5 + Math.max(0, d) * 0.62 : d < 0.12 ? 0.8 : d < 0.55 ? 0.93 : 1.05;
      if (this.shine[k] && d > 0.82) shade = lit ? 1.4 : 1.32;
      if (this.line[k] === 1) shade *= 0.38;
      else if (this.line[k] === 2) shade *= 0.66;
      const o = k * 4;
      out[o] = c[0] * shade;
      out[o + 1] = c[1] * shade;
      out[o + 2] = c[2] * shade;
      out[o + 3] = 255;
    }
    return out;
  }

  /** The normal map: facing as colour (x red, up green, toward the viewer blue), alpha the silhouette. */
  normals(): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.w * this.h * 4);
    for (let k = 0; k < this.slot.length; k++) {
      const o = k * 4;
      if (this.slot[k] === 0) {
        out[o] = 128;
        out[o + 1] = 128;
        out[o + 2] = 255;
        continue;
      }
      out[o] = (this.nx[k] * 0.5 + 0.5) * 255;
      // Green runs up, as normal maps take it; the pixels run down.
      out[o + 1] = (-this.ny[k] * 0.5 + 0.5) * 255;
      out[o + 2] = (this.nz[k] * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
    return out;
  }
}

export function normalize3(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Whether a point lies within a polygon (even-odd rule). */
function inside(pts: [number, number][], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** The direction out of a polygon through its nearest edge to a point within, and how far that edge lies. */
function nearestEdge(pts: [number, number][], x: number, y: number): [number, number, number] {
  let best: [number, number, number] = [0, 0, Infinity];
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-6;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    const d = Math.hypot(x - cx, y - cy);
    if (d < best[2]) {
      const l = d || 1;
      best = [(cx - x) / l, (cy - y) / l, d];
    }
  }
  return best;
}
