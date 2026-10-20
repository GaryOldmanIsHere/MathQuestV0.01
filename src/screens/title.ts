import type { App, Screen } from '../app/app';
import type { View } from '../render/engine';
import { QUALITIES, saveQuality } from '../render/quality';
import type { Quality } from '../render/quality';
import { newCampaign } from '../core/state';
import { buildTerrainGrid } from '../core/terrain';
import { allClasses, datasetLabel, datasetSource } from '../data/registry';
import { WorldStage } from '../gfx3d/world';
import { OVERVIEW } from '../gfx3d/worldMap';
import { unitIcon } from '../gfx/unitIcon';
import { button, el } from '../ui/dom';

// The title: the realm itself turning slowly behind the game's name, a parade
// of the classes at hand, and the way into a new campaign.

const QUALITY_LABEL: Record<Quality, string> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' };

export class TitleScreen implements Screen {
  readonly name = 'Title' as const;
  readonly root: HTMLElement;
  private world = new WorldStage();

  constructor(app: App, onNewCampaign: () => void) {
    const nodes = newCampaign().nodes;
    this.world.build(buildTerrainGrid(nodes), nodes);
    this.world.setView({ ...OVERVIEW, distance: OVERVIEW.distance * 0.72, pitch: 0.62 }, true);

    const authentic = datasetSource() === 'ob64';
    const parade = allClasses().filter((c) => c.playable).slice(0, 24);
    const quality = el('select', {
      class: 'select', ui: 'quality', 'aria-label': 'Graphics quality',
      on: {
        change: (e) => {
          const q = (e.target as HTMLSelectElement).value as Quality;
          app.engine.setQuality(q);
          saveQuality(q);
        },
      },
    }, ...QUALITIES.map((q) => el('option', { value: q, selected: q === app.engine.currentQuality ? '' : undefined }, QUALITY_LABEL[q])));

    this.root = el('div', { class: 'screen title-screen', ui: 'title' },
      el('div', { class: 'title-card' },
        el('h1', { class: 'title-name' }, 'Palatinus'),
        el('div', { class: 'title-sub' }, 'Tactics'),
        el('p', { class: 'title-tag' }, 'A real-time strategy RPG in the spirit of the classics'),
        el('div', { class: 'title-actions' },
          button('New campaign', onNewCampaign, { ui: 'new-campaign', class: 'btn-primary' }),
        ),
        el('p', { class: 'title-brief' }, 'March your squads. Liberate the towns. Take Castle Verlaine.'),
        el('div', { class: `title-data ${authentic ? 'is-authentic' : ''}`, ui: 'dataset' },
          `Class data: ${datasetLabel()} · ${allClasses().length} classes`),
        el('label', { class: 'title-quality' }, 'Graphics', quality),
      ),
      el('div', { class: 'parade', 'aria-hidden': 'true' }, ...parade.map((c) => unitIcon(c.palette, 40))),
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
