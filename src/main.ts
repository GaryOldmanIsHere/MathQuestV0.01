import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { OverworldScene } from './scenes/OverworldScene';
import { BattleScene } from './scenes/BattleScene';
import { OrganizeScene } from './scenes/OrganizeScene';
import { getState } from './core/state';
import { classOf, itemOf } from './data/registry';
import { exposeDebug } from './debug';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 800,
  height: 600,
  backgroundColor: '#0a0a12',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, TitleScene, OverworldScene, BattleScene, OrganizeScene],
});

// For the automated playthrough (with ?debug): the game, its state, and every battle's outcome.
const battles: unknown[] = [];
game.events.on('battle-done', (p: unknown) => battles.push(p));
exposeDebug('game', game);
exposeDebug('state', getState);
exposeDebug('battles', battles);
exposeDebug('itemOf', itemOf);
exposeDebug('classOf', classOf);
