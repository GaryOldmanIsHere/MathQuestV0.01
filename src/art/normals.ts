import type { SpriteImage } from '../gfx3d/sprites';

// A normal map for a drawing that came without one (Ogre Battle 64's own
// sprites, the old pixel art): the drawing treated as a cushion, rounded
// from its outline inward, so the scene's light still shades it from the
// side it comes from.

const made = new WeakMap<object, HTMLCanvasElement>();

export function outlineNormals(image: SpriteImage): HTMLCanvasElement {
  const known = made.get(image);
  if (known) return known;
  const w = (image as HTMLCanvasElement).width;
  const h = (image as HTMLCanvasElement).height;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const sctx = src.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(image as CanvasImageSource, 0, 0);
  const alpha = sctx.getImageData(0, 0, w, h).data;
  // Height: how far each pixel lies from the outline, softened.
  let height = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) height[k] = alpha[k * 4 + 3] > 127 ? 1 : 0;
  const radius = Math.max(1, Math.round(Math.min(w, h) / 24));
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            n++;
            if (xx >= 0 && yy >= 0 && xx < w && yy < h) sum += height[yy * w + xx];
          }
        }
        next[y * w + x] = sum / n;
      }
    }
    height = next;
  }
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(w, h);
  const at = (x: number, y: number) => height[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      // The slope of the cushion; up in the picture is up in the map (green).
      const sx = (at(x - 1, y) - at(x + 1, y)) * 1.6;
      const sy = (at(x, y + 1) - at(x, y - 1)) * 1.6;
      const l = Math.hypot(sx, sy, 1);
      img.data[o] = (sx / l * 0.5 + 0.5) * 255;
      img.data[o + 1] = (sy / l * 0.5 + 0.5) * 255;
      img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[o + 3] = alpha[o + 3];
    }
  }
  octx.putImageData(img, 0, 0);
  made.set(image, out);
  return out;
}
