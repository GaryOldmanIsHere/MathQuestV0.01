import Phaser from 'phaser';
import { buildClassTextures, buildUnitTextures } from '../gfx/pixels';
import { buildTerrainTextures } from '../gfx/terrain';
import { allClasses, installDataset } from '../data/registry';
import { convertDataset } from '../ob64/convert';
import type { Ob64Data } from '../ob64/decode';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    loadExtractedData().finally(() => {
      buildUnitTextures(this);
      buildClassTextures(this, allClasses());
      buildTerrainTextures(this);
      this.scene.start('Title');
    });
  }
}

/**
 * Use the Ogre Battle 64 tables if they have been extracted from the player's
 * own ROM (npm run extract:ob64). Without them, or if they cannot be read, the
 * game stays on its built-in originals.
 */
async function loadExtractedData(): Promise<void> {
  try {
    const res = await fetch('ob64/data.json', { cache: 'no-store' });
    // The dev server answers a missing file with the app's index page.
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return;
    installDataset(convertDataset((await res.json()) as Ob64Data));
  } catch (err) {
    console.warn('Ogre Battle 64 data present but unreadable; using built-in classes.', err);
  }
}
