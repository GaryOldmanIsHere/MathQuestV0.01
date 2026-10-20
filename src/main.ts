// The fonts' Latin letters only (all the game writes in).
import '@fontsource/cinzel/latin-500.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/alegreya-sans/latin-400.css';
import '@fontsource/alegreya-sans/latin-500.css';
import '@fontsource/alegreya-sans/latin-700.css';
import './ui/styles.css';
import { App } from './app/app';
import { Engine } from './render/engine';
import { getState, resetState } from './core/state';
import { allClasses, classOf, installDataset, itemOf } from './data/registry';
import { canEquip, shopRank, shopStock, SLOTS } from './core/items';
import { allPromotions, availablePromotions } from './core/character';
import { convertDataset } from './ob64/convert';
import { withExpansion } from './expansion';
import type { Ob64Data } from './ob64/decode';
import { loadOb64Sprites } from './gfx3d/ob64Sprites';
import { loadWorldModels } from './gfx3d/models';
import { paintPortraits } from './art/sheet';
import { buildClassImages, buildUnitImages } from './gfx/pixels';
import { exposeDebug } from './debug';
import { TitleScreen } from './screens/title';
import { MapScreen } from './screens/map';
import { BattleScreen } from './screens/battle';
import { OrganizeScreen } from './screens/organize';
import type { ScreenName } from './app/app';

// Boot: the renderer first (WebGPU, or WebGL2 where the browser lacks it),
// then the class data, the units' art and the world's models, then the title.

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
    installDataset(withExpansion(convertDataset((await res.json()) as Ob64Data)));
  } catch (err) {
    console.warn('Ogre Battle 64 data present but unreadable; using built-in classes.', err);
  }
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  const loading = document.getElementById('loading');

  let engine: Engine;
  try {
    engine = await Engine.create(canvas);
  } catch (err) {
    console.error(err);
    if (loading) loading.textContent = 'This browser cannot draw the game (it needs WebGPU or WebGL2).';
    return;
  }
  const models = loadWorldModels();
  await loadExtractedData();
  await loadOb64Sprites();
  await models;
  // Painted portraits first; the pixel art fills in for any kind not painted.
  paintPortraits(allClasses());
  buildUnitImages();
  buildClassImages(allClasses());

  const app = new App(engine, ui);
  const toTitle = () => app.show(new TitleScreen(app, newCampaign));
  const toMap = () => app.show(new MapScreen(app, {
    battle: (attackerId, defenderId, field, done) => app.open(new BattleScreen(app, { attackerId, defenderId, field }, done)),
    organize: () => app.open(new OrganizeScreen(app)),
    title: toTitle,
  }));
  function newCampaign(): void {
    resetState();
    toMap();
  }

  exposeForTests(app, engine);
  toTitle();
  loading?.remove();
  app.start();
}

/** For the automated playthrough (with ?debug): the game, its state, and every battle's outcome. */
function exposeForTests(app: App, engine: Engine): void {
  const battles: unknown[] = [];
  app.on('battle-done', (p) => battles.push(p));
  exposeDebug('app', app);
  // The screens, by the names the playthrough asks after.
  exposeDebug('game', {
    scene: {
      isActive: (name: ScreenName) => app.isActive(name),
      isPaused: (name: ScreenName) => app.isPaused(name),
      getScene: (name: ScreenName) => app.screen(name),
    },
  });
  exposeDebug('state', getState);
  exposeDebug('battles', battles);
  exposeDebug('itemOf', itemOf);
  exposeDebug('classOf', classOf);
  // The rules a player weighs at the army screen, so the playthrough's quartermaster can plan as one.
  exposeDebug('rules', { SLOTS, canEquip, shopRank, shopStock, allPromotions, availablePromotions });
  // For the long-run check: how many geometries and textures the graphics card holds.
  exposeDebug('gpu', () => engine.memory());
  exposeDebug('engine', engine);
}

void boot();
