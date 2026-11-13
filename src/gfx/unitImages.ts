// Every class's picture, by its palette key: Palatinus's pixel art, painted
// at boot, or Ogre Battle 64's portrait where its sprites were extracted. The
// menus, the map and the battlefield all draw units from here.

const images = new Map<string, HTMLCanvasElement>();
const urls = new Map<string, string>();
/** How many pixels tall a standing soldier is in each picture's art. */
const standing = new Map<string, number>();

/** Keep a picture for a palette key, replacing any before it. */
export function setUnitImage(palette: string, canvas: HTMLCanvasElement, soldier = 56): void {
  images.set(palette, canvas);
  standing.set(palette, soldier);
  urls.delete(palette);
}

/** How tall a standing soldier is drawn in the art a picture comes from, in its pixels. */
export function soldierHeight(palette: string): number {
  return standing.get(palette) ?? 56;
}

export function hasUnitImage(palette: string): boolean {
  return images.has(palette);
}

/** A class's picture. Painted at boot for every class; an empty one if missing. */
export function unitImage(palette: string): HTMLCanvasElement {
  let img = images.get(palette);
  if (!img) {
    img = document.createElement('canvas');
    img.width = 12;
    img.height = 16;
    images.set(palette, img);
  }
  return img;
}

/** The picture as an image address, for the interface. */
export function unitImageUrl(palette: string): string {
  let url = urls.get(palette);
  if (!url) {
    url = unitImage(palette).toDataURL();
    urls.set(palette, url);
  }
  return url;
}
