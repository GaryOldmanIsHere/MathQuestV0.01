import Phaser from 'phaser';
import { drawPanel, makeButton, FONT } from '../gfx/ui';
import { resetState } from '../core/state';
import { allClasses, datasetLabel, datasetSource } from '../data/registry';
import { unitIcon } from '../gfx/unitIcon';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create(): void {
    const { width: W, height: H } = this.scale;

    // night-sky backdrop with drifting banner of class sprites
    this.add.rectangle(W / 2, H / 2, W, H, 0x0c1024);
    for (let i = 0; i < 70; i++) {
      const x = (i * 97) % W;
      const y = (i * 53) % (H / 2);
      this.add.rectangle(x, y, 1, 1, 0xd8d8e8, 0.5 + ((i * 31) % 40) / 100);
    }
    this.add.rectangle(W / 2, H - 60, W, 120, 0x141a30);

    // A parade of the active roster: the originals, or the classes extracted from the ROM.
    const parade = allClasses().filter((c) => c.playable).slice(0, 36);
    parade.forEach((c, i) => {
      unitIcon(this, 40 + (i % 12) * 62, H - 92 + Math.floor(i / 12) * 46, c.palette, 32).setAlpha(0.9);
    });

    this.add
      .text(W / 2, 120, 'PALATINUS', {
        fontFamily: FONT, fontSize: '58px', color: '#f0e8c0', fontStyle: 'bold',
        stroke: '#3a2a10', strokeThickness: 8,
      })
      .setOrigin(0.5);
    this.add
      .text(W / 2, 175, '— TACTICS —', {
        fontFamily: FONT, fontSize: '22px', color: '#c8b458', fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.add
      .text(W / 2, 215, 'A real-time strategy RPG in the spirit of the classics', {
        fontFamily: FONT, fontSize: '13px', color: '#8890a8',
      })
      .setOrigin(0.5);
    const authentic = datasetSource() === 'ob64';
    this.add
      .text(W / 2, 240, `Class data: ${datasetLabel()} · ${allClasses().length} classes`, {
        fontFamily: FONT, fontSize: '11px', color: authentic ? '#90d890' : '#68708a',
      })
      .setOrigin(0.5);

    drawPanel(this, W / 2 - 130, 280, 260, 130);
    makeButton(this, W / 2 - 110, 300, 220, 40, 'NEW CAMPAIGN', () => {
      resetState();
      this.scene.start('Overworld');
    });
    this.add
      .text(W / 2, 370, 'March your squads. Liberate the towns.\nTake Castle Verlaine.', {
        fontFamily: FONT, fontSize: '12px', color: '#a8b0c8', align: 'center',
      })
      .setOrigin(0.5);
  }
}
