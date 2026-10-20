import type { App, Screen } from '../app/app';
import type { View } from '../render/engine';
import { newCampaign } from '../core/state';
import { buildTerrainGrid } from '../core/terrain';
import { allClasses, datasetLabel, datasetSource } from '../data/registry';
import { WorldStage, worldDetail } from '../gfx3d/world';
import { OVERVIEW } from '../gfx3d/worldMap';
import { unitIcon } from '../gfx/unitIcon';
import { button, el } from '../ui/dom';
import { icon } from '../ui/icons';
import { openSettings } from './settings';

// The title: the realm itself turning slowly behind the game's name, a parade
// of the classes at hand, and the way into a new campaign.

export class TitleScreen implements Screen {
  readonly name = 'Title' as const;
  readonly root: HTMLElement;
  private world = new WorldStage();

  constructor(app: App, onNewCampaign: () => void) {
    const nodes = newCampaign().nodes;
    this.world.build(buildTerrainGrid(nodes), nodes, worldDetail(app.engine.settings));
    this.world.setView({ ...OVERVIEW, distance: OVERVIEW.distance * 0.72, pitch: 0.62 }, true);
    // A clear evening, the sun low and golden.
    this.world.setHour(0.69);
    this.world.setWeather('clear', true);

    const authentic = datasetSource() === 'ob64';
    const parade = allClasses().filter((c) => c.playable).slice(0, 24);
    const start = button('New campaign', onNewCampaign, { ui: 'new-campaign', class: 'btn-primary' });
    start.prepend(icon('flag', 20));
    const settings = button('Settings', () => openSettings(app, this.root), { ui: 'title-settings' });
    settings.prepend(icon('gear', 18));
    // The parade steps along, each in its own time.
    const marchers = parade.map((c, k) => {
      const figure = unitIcon(c.palette, 44);
      figure.style.animationDelay = `${-(k * 0.37) % 1.6}s`;
      return figure;
    });

    this.root = el('div', { class: 'screen title-screen', ui: 'title' },
      el('div', { class: 'title-card' },
        el('h1', { class: 'title-name' }, 'Palatinus'),
        el('div', { class: 'title-sub' }, 'Tactics'),
        el('p', { class: 'title-tag' }, 'A real-time strategy RPG in the spirit of the classics'),
        el('div', { class: 'title-menu panel' }, start, settings),
        el('p', { class: 'title-brief' }, 'March your squads. Liberate the towns. Take Castle Verlaine.'),
        el('div', { class: `title-data ${authentic ? 'is-authentic' : ''}`, ui: 'dataset' },
          `Class data: ${datasetLabel()} · ${allClasses().length} classes`),
      ),
      el('div', { class: 'parade', 'aria-hidden': 'true' }, ...marchers),
    );
  }

  view(): View {
    return this.world;
  }

  update(ms: number): void {
    // The realm turns slowly under the title.
    this.world.turn(ms * 0.00004);
    this.world.update(ms);
  }

  resize(w: number, h: number): void {
    this.world.resize(w, h);
  }

  dispose(): void {
    this.world.dispose();
  }
}
