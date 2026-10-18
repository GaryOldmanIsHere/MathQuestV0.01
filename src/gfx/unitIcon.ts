import type Phaser from 'phaser';

/**
 * A unit's picture at a given height on screen, whatever the art: the
 * 12x16 pixel originals and Ogre Battle 64's larger sprites alike are scaled
 * to fit, keeping their proportions. Large units come out larger because
 * their art is.
 */
export function unitIcon(scene: Phaser.Scene, x: number, y: number, palette: string, height: number): Phaser.GameObjects.Image {
  const img = scene.add.image(x, y, `unit-${palette}`);
  const h = img.height || 16;
  // The originals are all 16 tall; extracted art varies, so it is measured
  // against a standing soldier of 56 pixels rather than its own height.
  const scale = h <= 16 ? height / 16 : height / 56;
  return img.setScale(scale);
}
