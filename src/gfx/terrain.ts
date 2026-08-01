import Phaser from 'phaser';
import { rng } from '../data/names';

// Procedural 16x16 terrain tiles and stronghold icons, drawn once at boot.

const T = 16;

function makeTile(scene: Phaser.Scene, key: string, draw: (ctx: CanvasRenderingContext2D) => void, w = T, h = T): void {
  if (scene.textures.exists(key)) return;
  const canvas = scene.textures.createCanvas(key, w, h);
  if (!canvas) return;
  draw(canvas.getContext());
  canvas.refresh();
}

function speckle(ctx: CanvasRenderingContext2D, colors: string[], count: number, w = T, h = T): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    ctx.fillRect(Math.floor(rng() * w), Math.floor(rng() * h), 1, 1);
  }
}

export function buildTerrainTextures(scene: Phaser.Scene): void {
  makeTile(scene, 'tile-grass', (ctx) => {
    ctx.fillStyle = '#4a7a3a';
    ctx.fillRect(0, 0, T, T);
    speckle(ctx, ['#568a44', '#406a32', '#5e9448'], 26);
  });
  makeTile(scene, 'tile-forest', (ctx) => {
    ctx.fillStyle = '#35592b';
    ctx.fillRect(0, 0, T, T);
    speckle(ctx, ['#2b4a22', '#417036', '#243e1d'], 30);
    ctx.fillStyle = '#2b4a22';
    ctx.fillRect(3, 3, 4, 4);
    ctx.fillRect(9, 8, 4, 4);
  });
  makeTile(scene, 'tile-mountain', (ctx) => {
    ctx.fillStyle = '#6a6055';
    ctx.fillRect(0, 0, T, T);
    speckle(ctx, ['#7a7065', '#5a5048', '#88807a'], 24);
    ctx.fillStyle = '#88807a';
    ctx.beginPath();
    ctx.moveTo(2, 13); ctx.lineTo(7, 4); ctx.lineTo(12, 13);
    ctx.fill();
    ctx.fillStyle = '#d8d8dc';
    ctx.fillRect(6, 4, 2, 2);
  });
  makeTile(scene, 'tile-water', (ctx) => {
    ctx.fillStyle = '#2a4a7a';
    ctx.fillRect(0, 0, T, T);
    speckle(ctx, ['#345a8c', '#22406a', '#3c6494'], 20);
  });
  makeTile(scene, 'tile-road', (ctx) => {
    ctx.fillStyle = '#9a8a68';
    ctx.fillRect(0, 0, T, T);
    speckle(ctx, ['#a89878', '#8a7a58', '#b0a080'], 18);
  });

  // Stronghold icons
  makeTile(scene, 'icon-town', (ctx) => {
    ctx.fillStyle = '#c8b898';
    ctx.fillRect(4, 12, 8, 8);
    ctx.fillStyle = '#e0d0b0';
    ctx.fillRect(6, 14, 4, 6);
    ctx.fillStyle = '#a04a38';
    ctx.beginPath();
    ctx.moveTo(2, 12); ctx.lineTo(8, 5); ctx.lineTo(14, 12);
    ctx.fill();
    ctx.fillStyle = '#3a2a20';
    ctx.fillRect(7, 16, 2, 4);
  }, 16, 20);

  makeTile(scene, 'icon-fort', (ctx) => {
    ctx.fillStyle = '#8a8278';
    ctx.fillRect(2, 8, 12, 12);
    ctx.fillStyle = '#a8a098';
    ctx.fillRect(3, 9, 10, 10);
    ctx.fillStyle = '#8a8278';
    for (let x = 2; x < 14; x += 3) ctx.fillRect(x, 5, 2, 4);
    ctx.fillStyle = '#3a3430';
    ctx.fillRect(6, 13, 4, 7);
  }, 16, 20);

  makeTile(scene, 'icon-castle', (ctx) => {
    ctx.fillStyle = '#787068';
    ctx.fillRect(1, 9, 14, 11);
    ctx.fillStyle = '#989088';
    ctx.fillRect(2, 10, 12, 9);
    ctx.fillStyle = '#787068';
    ctx.fillRect(1, 4, 3, 6);
    ctx.fillRect(12, 4, 3, 6);
    ctx.fillRect(6, 2, 4, 8);
    ctx.fillStyle = '#2a2420';
    ctx.fillRect(6, 14, 4, 6);
  }, 16, 20);

  // ownership flags
  for (const [key, color] of [
    ['flag-player', '#4a6ae0'],
    ['flag-enemy', '#d04838'],
    ['flag-neutral', '#b8b0a0'],
  ] as const) {
    makeTile(scene, key, (ctx) => {
      ctx.fillStyle = '#5a4a3a';
      ctx.fillRect(1, 0, 1, 10);
      ctx.fillStyle = color;
      ctx.fillRect(2, 0, 6, 4);
    }, 9, 10);
  }
}
