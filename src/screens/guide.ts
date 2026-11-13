import { button, el, fill } from '../ui/dom';
import { icon } from '../ui/icons';
import type { IconName } from '../ui/icons';

// The first campaign's guide: a small card on the map that names the next
// thing to try, and moves on when the player has done it. It never stops the
// game, can be skipped, and once finished or skipped does not come back
// (kept in this browser).

/** What the player has just done, as the map tells the guide. */
export type GuideEvent = 'select' | 'order' | 'capture' | 'battle' | 'army' | 'inspect' | 'pause';

export interface GuideStep {
  title: string;
  icon: IconName;
  text: string;
  /** Any of these moves the guide on; with none, the player dismisses the step. */
  until: GuideEvent[];
}

export const GUIDE: GuideStep[] = [
  { title: 'Choose a squad', icon: 'people', text: 'Click one of your squads at Fort Melchor, or press 1. Squads standing together are chosen in turn.', until: ['select'] },
  { title: 'Give it a march', icon: 'flag', text: 'Click a town, or any ground, to send it there. M lists every stronghold. Roads are quickest; hills and woods are slow.', until: ['order'] },
  { title: 'Take a stronghold', icon: 'castle', text: 'A squad that reaches a stronghold takes it, once no one is left to dispute it. Squads that meet fight. Each stronghold you hold pays 50 goth a day.', until: ['capture', 'battle'] },
  { title: 'Look over the army', icon: 'shield', text: 'Organize (O) is where squads are formed. The front rank takes the blows, each row changes how a unit fights, and tactics choose whom a squad strikes first. Recruits, gear and the shop are there too.', until: ['army'] },
  { title: 'Know the enemy', icon: 'skull', text: 'Click an enemy squad to see who is in it and how a fight is likely to go. P holds the clock while you think; orders can still be given.', until: ['inspect', 'pause'] },
  { title: 'Win the realm', icon: 'crown', text: 'Hold Castle Verlaine for a day and the realm is yours. Lose Fort Melchor for a day and it is over, so do not leave it bare. Squads rest and mend on your own strongholds. The campaign is kept each day: Continue takes it up again.', until: [] },
];

/** The step that follows `step` on `event`: the next one if the event is what the step waits for, else the same. */
export function guideAfter(step: number, event: GuideEvent): number {
  return GUIDE[step]?.until.includes(event) ? step + 1 : step;
}

const KEY = 'palatinus.guide';

function finished(): boolean {
  try {
    return localStorage.getItem(KEY) === 'done';
  } catch {
    return false;
  }
}

/** The guide's card. `root` is empty once the guide is over (or was, before this campaign). */
export class Guide {
  readonly root = el('div', { class: 'guide panel', ui: 'guide', role: 'note', 'aria-live': 'polite' });
  private step = finished() ? GUIDE.length : 0;

  constructor() {
    this.draw();
  }

  /** The player did something: move on, if it is what the step waited for. */
  note(event: GuideEvent): void {
    const next = guideAfter(this.step, event);
    if (next === this.step) return;
    this.step = next;
    this.draw();
  }

  private end(): void {
    this.step = GUIDE.length;
    try {
      localStorage.setItem(KEY, 'done');
    } catch {
      // Without storage the guide returns next time; no harm.
    }
    this.draw();
  }

  private draw(): void {
    const s = GUIDE[this.step];
    this.root.hidden = !s;
    if (!s) {
      fill(this.root);
      return;
    }
    const last = this.step === GUIDE.length - 1;
    fill(this.root,
      el('div', { class: 'guide-head' }, icon(s.icon, 20), el('h3', {}, s.title), el('span', { class: 'guide-count' }, `${this.step + 1} / ${GUIDE.length}`)),
      el('p', {}, s.text),
      el('div', { class: 'guide-foot' },
        last ? null : button('Skip the guide', () => this.end(), { ui: 'guide-skip', class: 'btn-quiet' }),
        last ? button('Understood', () => this.end(), { ui: 'guide-done', class: 'btn-primary' }) : null,
      ),
    );
  }
}
