import type { MapNode, Squad } from '../core/types';
import type { Terrain } from '../core/terrain';
import { COLS, MAP_H, MAP_W, ROWS, TILE, terrainAtTile } from '../core/terrain';
import { strongholdAt } from '../core/movement';
import { squadMemberIds } from '../core/squad';
import { getState } from '../core/state';
import { classOf } from '../data/registry';
import type { Weather } from '../gfx3d/sky';
import { unitIcon } from '../gfx/unitIcon';
import { el, fill, hpColour } from '../ui/dom';
import { icon } from '../ui/icons';
import type { IconName } from '../ui/icons';

// The campaign map's instruments, laid over the land: the day, the hour and
// the weather (top left); the treasury and the strongholds held (top right);
// the army's squads, each with its leader, its orders and its strength
// (down the left, a click to choose one); and a small map of the whole
// realm with the view marked on it (a click to look there).

/** What the map tells the instruments each time they are drawn. */
export interface HudState {
  hour: number;
  weather: Weather;
  selected: Squad | null;
  /** Squads now fighting, regrouping after a rout. */
  fighting: Set<number>;
  regrouping: Set<number>;
  /** The view's centre (map pixels) and its distance, for the small map. */
  view: { x: number; y: number; distance: number };
}

export interface HudActions {
  choose(sq: Squad): void;
  lookAt(x: number, y: number): void;
}

const HOURS: [number, string, IconName][] = [
  [0.22, 'Night', 'moon'], [0.3, 'Dawn', 'dawn'], [0.45, 'Morning', 'sun'], [0.58, 'Midday', 'sun'],
  [0.72, 'Afternoon', 'sun'], [0.8, 'Dusk', 'dawn'], [1.01, 'Night', 'moon'],
];
const WEATHER_WORD: Record<Weather, [string, IconName]> = {
  clear: ['Clear', 'sun'], cloudy: ['Cloudy', 'cloud'], rain: ['Rain', 'rain'], snow: ['Snow', 'snow'], mist: ['Mist', 'mist'],
};

/** The name of an hour (0 midnight, 0.5 noon) and its icon. */
export function hourName(hour: number): [string, IconName] {
  const h = ((hour % 1) + 1) % 1;
  const [, name, ic] = HOURS.find(([until]) => h < until)!;
  return [name, ic];
}

/** A squad's strength: the share of its members' health left, 0 to 1. */
export function strengthOf(sq: Squad): number {
  const st = getState();
  const members = squadMemberIds(sq).map((id) => st.chars.get(id)!).filter(Boolean);
  return members.reduce((s, c) => s + Math.max(0, c.hp), 0) / Math.max(1, members.reduce((s, c) => s + c.stats.hp, 0));
}

/**
 * The strongholds a squad may be sent to by keyboard (see the map's march
 * list): all but the one it stands at, nearest first, each with how far it
 * lies as the crow flies, in tiles.
 */
export function marchChoices(sq: Squad, nodes: readonly MapNode[]): { node: MapNode; tiles: number }[] {
  return nodes
    .map((node) => ({ node, d: Math.hypot(node.x - sq.x, node.y - sq.y) }))
    .filter((c) => c.d >= 50)
    .sort((a, b) => a.d - b.d)
    .map(({ node, d }) => ({ node, tiles: Math.max(1, Math.round(d / TILE)) }));
}

/** Who holds a stronghold, in words. */
export const OWNER_LABEL: Record<MapNode['owner'], string> = { player: 'Yours', enemy: 'Enemy', neutral: 'Unclaimed' };

/** What a squad is about, in a few words, and the icon for it. */
export function orders(sq: Squad, nodes: MapNode[], s: Pick<HudState, 'fighting' | 'regrouping'>): { text: string; icon: IconName; tone: '' | 'is-fighting' | 'is-resting' } {
  if (s.fighting.has(sq.id)) return { text: 'In battle', icon: 'sword', tone: 'is-fighting' };
  if (s.regrouping.has(sq.id)) return { text: 'Regrouping', icon: 'rest', tone: 'is-resting' };
  if (sq.moving && sq.targetX !== null && sq.targetY !== null) {
    const to = strongholdAt(nodes, sq.targetX, sq.targetY);
    return { text: to ? `Marching on ${to.name}` : 'Marching', icon: 'march', tone: '' };
  }
  const at = strongholdAt(nodes, sq.x, sq.y);
  if (at) return { text: `Holding ${at.name}`, icon: 'castle', tone: '' };
  return { text: 'Halted', icon: 'flag', tone: '' };
}

const GROUND: Record<Terrain, string> = { plain: '#5f8c3c', forest: '#2e5428', mountain: '#8a8274', water: '#3a6ea8', road: '#ad8d5c' };
const MINI = 0.275; // minimap pixels per map pixel

interface Card {
  root: HTMLButtonElement;
  status: HTMLElement;
  fill: HTMLElement;
}

export class MapHud {
  readonly realm: HTMLElement;
  readonly wealth: HTMLElement;
  readonly roster: HTMLElement;
  readonly minimap: HTMLElement;
  private dial = el('div', { class: 'realm-dial' });
  private day = el('div', { class: 'realm-day' });
  private sky = el('div', { class: 'realm-sky' });
  private goth = el('span', {});
  private held = el('span', {});
  private pips = el('div', { class: 'pips', 'aria-hidden': 'true' });
  private cards = new Map<number, Card>();
  private canvas: HTMLCanvasElement;
  private ground: HTMLCanvasElement;
  private shown = '';

  constructor(grid: Terrain[], private actions: HudActions) {
    this.realm = el('div', { class: 'realm panel', ui: 'realm' }, this.dial, el('div', { class: 'realm-text' }, this.day, this.sky));
    this.wealth = el('div', { class: 'wealth panel', ui: 'hud' },
      el('span', { class: 'wealth-item', 'data-tip': 'Treasury', 'data-tip-side': 'below' }, icon('coin', 20), this.goth),
      el('span', { class: 'wealth-item', 'data-tip': 'Strongholds held', 'data-tip-side': 'below' }, icon('castle', 20), this.held),
      this.pips,
    );
    this.roster = el('div', { class: 'roster', ui: 'roster', role: 'list', 'aria-label': 'Your squads' });
    // The small map: the land drawn once, the rest over it as it changes.
    this.ground = document.createElement('canvas');
    this.ground.width = Math.round(MAP_W * MINI);
    this.ground.height = Math.round(MAP_H * MINI);
    const g = this.ground.getContext('2d')!;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        g.fillStyle = GROUND[terrainAtTile(grid, col, row)];
        g.fillRect(Math.floor(col * TILE * MINI), Math.floor(row * TILE * MINI), Math.ceil(TILE * MINI), Math.ceil(TILE * MINI));
      }
    }
    this.canvas = el('canvas', { class: 'minimap', ui: 'minimap', tabindex: '0', 'aria-label': 'Map of the realm: click to look there' });
    this.canvas.width = this.ground.width * 2;
    this.canvas.height = this.ground.height * 2;
    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.actions.lookAt(((e.clientX - r.left) / r.width) * MAP_W, ((e.clientY - r.top) / r.height) * MAP_H);
    });
    this.minimap = el('div', { class: 'minimap-wrap panel' }, this.canvas);
  }

  /** Draw the instruments as things now stand. */
  update(s: HudState): void {
    const st = getState();
    // The day, the hour and the weather.
    const [hourWord, hourIcon] = hourName(s.hour);
    const [skyWord, skyIcon] = WEATHER_WORD[s.weather];
    const key = `${st.day}|${hourWord}|${s.weather}`;
    if (key !== this.shown) {
      this.shown = key;
      fill(this.dial, icon(hourIcon, 24));
      this.dial.classList.toggle('is-night', hourIcon === 'moon');
      this.day.textContent = `Day ${st.day}`;
      fill(this.sky, hourWord, el('span', { class: 'muted' }, '·'), icon(skyIcon, 15), skyWord);
    }
    // The treasury and the strongholds.
    const owned = st.nodes.filter((n) => n.owner === 'player').length;
    this.goth.textContent = `${st.goth}`;
    this.held.textContent = `${owned}/${st.nodes.length}`;
    if (this.pips.childElementCount !== st.nodes.length) fill(this.pips, ...st.nodes.map(() => el('span', { class: 'pip' })));
    st.nodes.forEach((n, k) => (this.pips.children[k] as HTMLElement).className = `pip is-${n.owner}`);
    this.drawRoster(s);
    this.drawMinimap(s);
  }

  private drawRoster(s: HudState): void {
    const st = getState();
    const mine = st.squads.filter((q) => q.side === 'player');
    for (const [id, card] of this.cards) {
      if (!mine.some((q) => q.id === id)) {
        card.root.remove();
        this.cards.delete(id);
      }
    }
    mine.forEach((sq, k) => {
      let card = this.cards.get(sq.id);
      if (!card) card = this.makeCard(sq);
      // In order, and its leader's face kept up to date.
      if (this.roster.children[k] !== card.root) this.roster.insertBefore(card.root, this.roster.children[k] ?? null);
      const leader = st.chars.get(sq.leaderId);
      const face = card.root.querySelector('.roster-face')!;
      if (leader && face.getAttribute('data-class') !== leader.classId) {
        face.setAttribute('data-class', leader.classId);
        fill(face, unitIcon(classOf(leader.classId).palette, 40));
      }
      const o = orders(sq, st.nodes, s);
      if (card.status.dataset.text !== o.text) {
        card.status.dataset.text = o.text;
        card.status.className = `roster-status ${o.tone}`;
        fill(card.status, icon(o.icon, 14), o.text);
      }
      const r = strengthOf(sq);
      card.fill.style.width = `${Math.round(r * 100)}%`;
      card.fill.style.background = hpColour(r);
      card.root.classList.toggle('is-selected', s.selected?.id === sq.id);
      const keyEl = card.root.querySelector('.roster-key')!;
      keyEl.textContent = k < 9 ? `${k + 1}` : '';
    });
  }

  private makeCard(sq: Squad): Card {
    const status = el('div', { class: 'roster-status' });
    const fillBar = el('div', { class: 'bar-fill' });
    const root = el('button', {
      type: 'button', class: 'roster-card', ui: `roster-${sq.id}`, role: 'listitem',
      on: { click: () => this.actions.choose(sq) },
    },
      el('div', { class: 'roster-face' }),
      el('div', { class: 'roster-name' }, sq.name),
      status,
      el('div', { class: 'bar' }, fillBar),
      el('span', { class: 'roster-key', 'aria-hidden': 'true' }),
    );
    const card = { root, status, fill: fillBar };
    this.cards.set(sq.id, card);
    this.roster.append(root);
    return card;
  }

  private drawMinimap(s: HudState): void {
    const st = getState();
    const g = this.canvas.getContext('2d')!;
    const k = 2 * MINI;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.ground, 0, 0, this.canvas.width, this.canvas.height);
    // Roads between the strongholds.
    g.strokeStyle = 'rgba(214, 186, 128, 0.85)';
    g.lineWidth = 2;
    const byId = new Map(st.nodes.map((n) => [n.id, n]));
    for (const n of st.nodes) {
      for (const l of n.links) {
        const o = byId.get(l);
        if (!o || l < n.id) continue;
        g.beginPath();
        g.moveTo(n.x * k, n.y * k);
        g.lineTo(o.x * k, o.y * k);
        g.stroke();
      }
    }
    // The strongholds in their owners' colours.
    for (const n of st.nodes) {
      const r = n.kind === 'town' ? 5 : 7;
      g.save();
      g.translate(n.x * k, n.y * k);
      g.rotate(Math.PI / 4);
      g.fillStyle = n.owner === 'player' ? '#7c9cff' : n.owner === 'enemy' ? '#ff7461' : '#e6c35a';
      g.strokeStyle = '#0b1020';
      g.lineWidth = 2;
      g.fillRect(-r, -r, r * 2, r * 2);
      g.strokeRect(-r, -r, r * 2, r * 2);
      g.restore();
    }
    // The squads.
    for (const sq of st.squads) {
      g.beginPath();
      g.arc(sq.x * k, sq.y * k, 4.5, 0, Math.PI * 2);
      g.fillStyle = sq.side === 'player' ? '#dfe7ff' : '#ffb0a4';
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = sq.side === 'player' ? '#3050c0' : '#a02a1a';
      g.stroke();
      if (s.selected?.id === sq.id) {
        g.beginPath();
        g.arc(sq.x * k, sq.y * k, 8, 0, Math.PI * 2);
        g.strokeStyle = '#f3dc98';
        g.stroke();
      }
    }
    // The view.
    const w = s.view.distance * TILE * 1.6 * k;
    const h = s.view.distance * TILE * 1.0 * k;
    g.strokeStyle = 'rgba(255, 246, 220, 0.9)';
    g.lineWidth = 2;
    g.setLineDash([6, 4]);
    g.strokeRect(s.view.x * k - w / 2, s.view.y * k - h / 2, w, h);
    g.setLineDash([]);
  }
}
