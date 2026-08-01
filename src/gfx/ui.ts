import Phaser from 'phaser';

// The classic tactics-menu look: deep blue gradient panel, pale double border.

export const FONT = 'Courier New, monospace';

export const TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT,
  fontSize: '13px',
  color: '#e8e8f0',
  fontStyle: 'bold',
};

export const SMALL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT,
  fontSize: '11px',
  color: '#c8c8d8',
  fontStyle: 'bold',
};

export const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT,
  fontSize: '17px',
  color: '#f0e8c0',
  fontStyle: 'bold',
};

export function drawPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  opts?: { alpha?: number; depth?: number },
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.setDepth(opts?.depth ?? 0);
  const alpha = opts?.alpha ?? 1;
  // gradient body (stepped bands, era-appropriate)
  const top = Phaser.Display.Color.ValueToColor('#2a3a78');
  const bottom = Phaser.Display.Color.ValueToColor('#101c48');
  const bands = 8;
  for (let i = 0; i < bands; i++) {
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(top, bottom, bands - 1, i);
    g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), alpha);
    g.fillRect(x + 2, y + 2 + ((h - 4) / bands) * i, w - 4, (h - 4) / bands + 1);
  }
  // double border
  g.lineStyle(2, 0xe8e4d0, 1);
  g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  g.lineStyle(1, 0x686a8a, 1);
  g.strokeRect(x + 3, y + 3, w - 6, h - 6);
  return g;
}

export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onClick: () => void,
  depth = 0,
): { panel: Phaser.GameObjects.Graphics; text: Phaser.GameObjects.Text; zone: Phaser.GameObjects.Zone } {
  const panel = drawPanel(scene, x, y, w, h, { depth });
  const text = scene.add
    .text(x + w / 2, y + h / 2, label, TEXT_STYLE)
    .setOrigin(0.5)
    .setDepth(depth + 1);
  const zone = scene.add
    .zone(x + w / 2, y + h / 2, w, h)
    .setDepth(depth + 2)
    .setInteractive({ useHandCursor: true });
  zone.on('pointerover', () => text.setColor('#f0e090'));
  zone.on('pointerout', () => text.setColor('#e8e8f0'));
  zone.on('pointerdown', onClick);
  return { panel, text, zone };
}

export function hpColor(ratio: number): number {
  if (ratio > 0.5) return 0x58c858;
  if (ratio > 0.25) return 0xe0b838;
  return 0xd04838;
}
