import Phaser from 'phaser';
import { buildUnitTextures } from '../gfx/pixels';
import { buildTerrainTextures } from '../gfx/terrain';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    buildUnitTextures(this);
    buildTerrainTextures(this);
    this.scene.start('Title');
  }
}
