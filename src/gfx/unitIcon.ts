import { unitImage, unitImageUrl } from './unitImages';

/**
 * A unit's picture at a given height on screen, whatever the art: the
 * 12x16 pixel originals and Ogre Battle 64's larger sprites alike are scaled
 * to fit, keeping their proportions and their crisp pixels. Large units come
 * out larger because their art is.
 */
export function unitIcon(palette: string, height: number): HTMLImageElement {
  const src = unitImage(palette);
  const h = src.height || 16;
  // The originals are all 16 tall; extracted art varies, so it is measured
  // against a standing soldier of 56 pixels rather than its own height.
  // Great beasts come out larger, but never more than a third again as tall.
  const scale = h <= 16 ? height / 16 : Math.min(height / 56, (height * 1.35) / h);
  const img = document.createElement('img');
  img.src = unitImageUrl(palette);
  img.alt = '';
  img.className = 'unit-icon';
  img.width = Math.round(src.width * scale);
  img.height = Math.round(h * scale);
  return img;
}
