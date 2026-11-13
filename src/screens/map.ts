import type { App, Screen } from '../app/app';
import type { View } from '../render/engine';
import { getState } from '../core/state';
import type { MapNode, Squad } from '../core/types';
import { classOf, itemOf } from '../data/registry';
import { memberRow, moveSpeed, squadMemberIds, squadType, SQUAD_TYPE_LABEL } from '../core/squad';
import { addLoot, rollLoot } from '../core/items';
import { restSquads } from '../core/camp';
import { saveCampaign } from '../core/save';
import { play } from '../audio/sound';
import { Guide } from './guide';
import { unitIcon } from '../gfx/unitIcon';
import { enemyOrder, forecast, reinforce } from '../core/campaign';
import { WorldStage, worldDetail } from '../gfx3d/world';
import type { Weather } from '../gfx3d/sky';
import { hourOf, OPENING_HOUR, weatherOn } from '../gfx3d/sky';
import { mapFigureFor } from '../gfx3d/mapFigures';
import { prepareSprites } from '../gfx3d/ob64Sprites';
import { figureScale, OVERVIEW, panView, parkedAt } from '../gfx3d/worldMap';
import { declutter } from '../gfx/declutter';
import { DEBUG, exposeDebug, SPEED } from '../debug';
import { rng } from '../data/names';
import {
  CONTEST_RADIUS, haltSquad, orderTo, retreatTarget, settleOffset, snapOrder, squadsMeet, stepToward, strikeTarget, strongholdAt,
} from '../core/movement';
import type { Terrain } from '../core/terrain';
import { buildTerrainGrid, speedMultiplierAt, terrainAtPoint, TILE } from '../core/terrain';
import { button, el, hpColour } from '../ui/dom';
import { icon } from '../ui/icons';
import type { IconName } from '../ui/icons';
import type { BattleResult } from './battle';
import { MapHud, marchChoices, OWNER_LABEL, strengthOf } from './mapHud';
import { keepFocusWithin, openSettings } from './settings';

// The campaign map: squads march in real time over the 3D world, battles
// break out where they meet, strongholds change hands. The rules of the
// campaign run here, on the map's own clock (which stands still while a
// battle or the army screen is open); the interface over the world is plain
// HTML: names and strength bars over the squads, the status bar, notices.

/** Where a battle is fought: the kind of ground, and the hour and weather over it. */
export interface BattleGround {
  field: Terrain;
  hour: number;
  weather: Weather;
}

/** Where the map hands off to the screens it opens. */
export interface MapExits {
  battle(attackerId: number, defenderId: number, ground: BattleGround, done: (result: BattleResult) => void): void;
  organize(): void;
  title(): void;
}

interface SquadTag {
  root: HTMLElement;
  fill: HTMLElement;
  width: number;
}

/** How far the pointer must travel before a press becomes a drag. */
const DRAG_SLOP = 6;

/** A campaign day, in ms of the map's clock. */
const DAY_MS = 30000;
/** How long a routed squad sits out at the keep before it can fight or hold again. */
const REGROUP_MS = 12000;

/** The longest stretch of the map's clock the campaign moves in one step. */
const STEP_MS = 50;

/** For the automated playthrough: every stronghold that changed hands, and who stood near. */
/** Squads this close on the map (pixels) stand together: a click on one lists them all. */
const TOGETHER = 24;
/** How near the view comes to a squad chosen from its card or by its number. */
const FOLLOW_DISTANCE = 30;
const captures: unknown[] = [];
exposeDebug('captures', captures);

export class MapScreen implements Screen {
  readonly name = 'Overworld' as const;
  readonly root: HTMLElement;
  private world = new WorldStage();
  private tags = new Map<number, SquadTag>();
  private nodeLabels = new Map<number, { el: HTMLElement; width: number; height: number }>();
  private labels: HTMLElement;
  private toasts: HTMLElement;
  private instruments: MapHud;
  /** When the instruments were last drawn (they need not be every frame), ms. */
  private instrumentsAt = 0;
  private hint: HTMLElement;
  private guide = new Guide();
  /** The enemy squad being looked over, and how to put its sheet away. */
  private closeInspect: (() => void) | null = null;
  /** How to put away the list of squads standing together, while it is open. */
  private closeStack: (() => void) | null = null;
  /** Whether the view keeps to the chosen squad as it marches (until the player moves the view). */
  private following = false;
  /** The chosen squad's commands, set about its feet. */
  private ring: HTMLElement;
  /** The two squads in a battle now, if one is being fought. */
  private fighting = new Set<number>();
  private selected: Squad | null = null;
  private press: { x: number; y: number; lastX: number; lastY: number; button: number; dragging: boolean } | null = null;
  private held = new Set<string>();
  private battleActive = false;
  /** Set by the automated playthrough to hold the hour and weather where it put them. */
  private skyFixed = false;
  /** The hour and the weather over the map now (a battle is fought under them). */
  private sky: { hour: number; weather: Weather } = { hour: 0.3, weather: 'clear' };
  private cooldowns = new Map<number, number>(); // squad id -> map time when it may fight again
  /** Routed squads, by id, and the map time they have rested enough to stand and fight. */
  private recovering = new Map<number, number>();
  /** The map's own clock, in ms: it runs only while the map does. */
  private clock = 0;
  aiTimer = 0;
  private dayTimer = 0;
  /** The campaign's clock held (orders can still be given), and how fast it runs when not. */
  private paused = false;
  private rate = 1;
  private clockButtons: { pause: HTMLButtonElement; speed: HTMLButtonElement } | null = null;
  /** Headquarters under siege: by which side, and since when on the map's clock. */
  private sieges = new Map<number, { side: 'player' | 'enemy'; since: number }>();
  private terrain: Terrain[] = [];
  private covered = false;
  private width = 1;
  private height = 1;
  private unlisten: (() => void)[] = [];

  constructor(private app: App, private exits: MapExits, dayTimer = OPENING_HOUR * (DAY_MS / 1000)) {
    this.dayTimer = dayTimer;
    const st = getState();
    this.terrain = buildTerrainGrid(st.nodes);
    // The map in 3D, grown from the same terrain grid marching is charged on.
    this.world.build(this.terrain, st.nodes, worldDetail(app.engine.settings));
    this.world.setView(OVERVIEW, true);
    this.world.setHour(hourOf(this.dayTimer / (DAY_MS / 1000)));
    this.world.setWeather(weatherOn(st.day), true);

    this.labels = el('div', { class: 'map-labels' });
    for (const n of st.nodes) {
      const e = el('div', { class: 'node-name', ui: `node-${n.id}` }, n.name);
      this.labels.append(e);
      this.nodeLabels.set(n.id, { el: e, width: 0, height: 0 });
    }
    this.toasts = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    this.hint = el('div', { class: 'hud-hint', ui: 'hint', 'aria-live': 'polite' }, 'Select a squad, then click a stronghold to march.');
    this.instruments = new MapHud(this.terrain, {
      // A squad's card chooses it; the chosen squad's card lets it go.
      choose: (sq) => (sq === this.selected ? this.deselect() : this.chooseSquad(sq, true)),
      lookAt: (x, y) => {
        this.following = false;
        this.world.lookAt(x, y);
      },
    });
    // The chosen squad's commands: a small ring of buttons that goes where the squad goes.
    const command = (ui: string, tip: string, mark: IconName, act: () => void) => {
      const b = button('', act, { ui: `ring-${ui}`, class: 'btn-icon ring-btn', 'aria-label': tip, 'data-tip': tip });
      b.append(icon(mark, 17));
      return b;
    };
    this.ring = el('div', { class: 'squad-ring', ui: 'squad-ring', role: 'toolbar', 'aria-label': 'Commands for the chosen squad', hidden: '' },
      command('march', 'March on a stronghold (M)', 'flag', () => this.openMarchList()),
      command('halt', 'Halt here', 'shield', () => this.halt()),
      command('army', 'The army screen (O)', 'people', () => this.openOrganize()),
      command('release', 'Let the squad go (Esc)', 'close', () => this.deselect()),
    );
    const settingsButton = button('', () => openSettings(this.app, this.root), { ui: 'settings', class: 'btn-icon btn-quiet', 'aria-label': 'Settings', 'data-tip': 'Settings' });
    settingsButton.append(icon('gear', 20));
    const pauseButton = button('Pause', () => this.setPaused(!this.paused), { ui: 'pause', 'data-tip': 'Hold the clock; orders can still be given (P)' });
    const speedButton = button('1×', () => this.setRate(this.rate >= 3 ? 1 : this.rate + 1), { ui: 'speed', 'data-tip': 'How fast the campaign runs (F)', 'aria-label': 'Campaign speed' });
    this.clockButtons = { pause: pauseButton, speed: speedButton };
    const marchButton = button('March', () => this.openMarchList(), { ui: 'march', 'data-tip': 'March the chosen squad on a stronghold (M)' });
    marchButton.prepend(icon('flag', 18));
    const organizeButton = button('Organize', () => this.openOrganize(), { ui: 'organize', class: 'btn-primary', 'data-tip': 'The army screen (O)' });
    organizeButton.prepend(icon('people', 18));
    this.root = el('div', { class: 'screen map-screen', ui: 'map' },
      this.labels,
      this.instruments.realm,
      this.instruments.wealth,
      this.instruments.roster,
      this.instruments.minimap,
      el('div', { class: 'map-help' },
        el('span', {}, el('span', { class: 'kbd' }, 'Drag'), ' pan'),
        el('span', {}, el('span', { class: 'kbd' }, 'Wheel'), ' zoom'),
        el('span', {}, el('span', { class: 'kbd' }, 'Q'), el('span', { class: 'kbd' }, 'E'), ' turn'),
        el('span', {}, el('span', { class: 'kbd' }, '1'), '–', el('span', { class: 'kbd' }, '9'), ' squads'),
        el('span', {}, el('span', { class: 'kbd' }, 'M'), ' march'),
        el('span', {}, el('span', { class: 'kbd' }, 'P'), ' pause'),
        el('span', {}, el('span', { class: 'kbd' }, 'R'), ' whole map'),
      ),
      this.toasts,
      this.ring,
      this.guide.root,
      el('div', { class: 'hud panel' },
        el('span', { class: 'hud-stats', 'aria-hidden': 'true' }, icon('route', 18)),
        this.hint,
        settingsButton,
        pauseButton,
        speedButton,
        marchButton,
        organizeButton,
      ),
    );

    // Fan out squads that share a starting stronghold.
    const slots = new Map<number, number>();
    for (const sq of st.squads) {
      if (sq.moving) continue;
      const slot = slots.get(sq.nodeId) ?? 0;
      slots.set(sq.nodeId, slot + 1);
      this.settle(sq, st.nodes.find((n) => n.id === sq.nodeId)!, slot);
    }

    this.listen();
    this.prepareLeaders();
    this.syncAll();
    this.exposeForTests();
  }

  // ------------------------------------------------------------ the screen --

  view(): View {
    return this.world;
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.world.resize(w, h);
  }

  cover(covered: boolean): void {
    // While a battle or the army screen stands over the map, only the land
    // shows through; the names, bars and status bar step aside.
    this.covered = covered;
    this.root.classList.toggle('is-covered', covered);
    if (covered) {
      this.closeMarchList?.();
      this.closeInspect?.();
      this.closeStack?.();
    }
    this.press = null;
    this.held.clear();
    if (!covered) {
      this.syncAll();
      this.prepareLeaders();
      this.save();
    }
  }

  dispose(): void {
    for (const off of this.unlisten) off();
    this.unlisten = [];
    this.world.dispose();
  }

  /** Hold or release the campaign's clock. While held, squads can still be chosen and given orders. */
  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.root.classList.toggle('is-paused', paused);
    if (paused) this.guide.note('pause');
    if (this.clockButtons) {
      this.clockButtons.pause.textContent = paused ? 'Resume' : 'Pause';
      this.clockButtons.pause.classList.toggle('is-on', paused);
    }
    this.hint.textContent = paused ? 'Paused. Give your orders, then press P to go on.' : 'The campaign goes on.';
  }

  /** Set how fast the campaign runs: 1, 2 or 3 times. */
  private setRate(rate: number): void {
    this.rate = rate;
    if (this.clockButtons) this.clockButtons.speed.textContent = `${rate}×`;
  }

  private openOrganize(): void {
    if (this.battleActive || getState().phase !== 'playing') return;
    this.guide.note('army');
    this.exits.organize();
  }

  // ----------------------------------------------------------------- input --

  private listen(): void {
    const canvas = this.app.engine.canvas;
    const at = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      target.addEventListener(type, fn as EventListener);
      this.unlisten.push(() => target.removeEventListener(type, fn as EventListener));
    };
    // The camera: drag to pan (right-drag turns), the wheel zooms, keys pan
    // and turn. A press that does not become a drag is a click on the map.
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'pointerdown', (e) => {
      if (this.covered) return;
      const p = at(e);
      canvas.setPointerCapture(e.pointerId);
      this.press = { x: p.x, y: p.y, lastX: p.x, lastY: p.y, button: e.button, dragging: false };
    });
    on(canvas, 'pointermove', (e) => {
      const press = this.press;
      const p = at(e);
      if (!press && !this.covered) {
        // The pointer shows what a click would reach: a squad to choose, or an enemy to look over.
        const over = getState().squads.some((s) => {
          const o = this.squadOnScreen(s);
          return o.visible && Math.hypot(p.x - o.x, p.y - o.y) < 22;
        });
        canvas.style.cursor = over ? 'pointer' : '';
      }
      if (!press || this.covered) return;
      if (!press.dragging && Math.hypot(p.x - press.x, p.y - press.y) < DRAG_SLOP) return;
      press.dragging = true;
      this.following = false;
      if (press.button === 0) this.world.drag(press.lastX, press.lastY, p.x, p.y);
      else this.world.turn((p.x - press.lastX) * 0.01);
      press.lastX = p.x;
      press.lastY = p.y;
    });
    on(canvas, 'pointerup', (e) => {
      const press = this.press;
      this.press = null;
      if (!press || press.dragging || press.button !== 0 || this.covered) return;
      const p = at(e);
      this.clickMap(p.x, p.y);
    });
    on(canvas, 'wheel', (e) => {
      if (this.covered) return;
      e.preventDefault();
      const p = at(e);
      this.world.zoomAt(e.deltaY > 0 ? 1.12 : 1 / 1.12, p.x, p.y);
    });
    on(window, 'keydown', (e) => {
      if (this.covered || isTyping(e)) return;
      this.held.add(e.code);
      if (e.code === 'Space') {
        e.preventDefault();
        this.findSquad();
      }
      if (e.code === 'KeyR') {
        this.following = false;
        this.world.setView(OVERVIEW);
      }
      if (e.code === 'KeyO') this.openOrganize();
      if (e.code === 'KeyM') this.openMarchList();
      if (e.code === 'KeyP') this.setPaused(!this.paused);
      // Escape puts away whatever is open; with nothing open, it lets the chosen squad go.
      if (e.code === 'Escape') {
        if (this.closeStack) this.closeStack();
        else if (this.closeInspect) this.closeInspect();
        else if (!this.closeMarchList) this.deselect();
      }
      if (e.code === 'KeyF') this.setRate(this.rate >= 3 ? 1 : this.rate + 1);
      // 1 to 9 choose the army's squads, as the roster numbers them.
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit) {
        const sq = getState().squads.filter((q) => q.side === 'player')[Number(digit[1]) - 1];
        if (sq) this.chooseSquad(sq, true);
      }
    });
    on(window, 'keyup', (e) => this.held.delete(e.code));
    on(window, 'blur', () => this.held.clear());
  }

  /** Keys pan and turn the camera while held. */
  private steerCamera(dt: number): void {
    const down = (...codes: string[]) => codes.some((c) => this.held.has(c));
    const step = this.world.view.distance * 0.9 * dt;
    const right = (down('KeyD', 'ArrowRight') ? 1 : 0) - (down('KeyA', 'ArrowLeft') ? 1 : 0);
    const forward = (down('KeyW', 'ArrowUp') ? 1 : 0) - (down('KeyS', 'ArrowDown') ? 1 : 0);
    if (right || forward) {
      this.following = false;
      this.world.setView(panView(this.world.view, right * step, forward * step));
    }
    const turn = (down('KeyE') ? 1 : 0) - (down('KeyQ') ? 1 : 0);
    if (turn) this.world.turn(turn * 1.6 * dt);
  }

  // ---------------------------------------------------------------- the map --

  /**
   * A click on the map. Selecting your own squad takes priority; otherwise,
   * with a squad selected, it is a march order to that point of ground,
   * anywhere on the map.
   */
  private clickMap(sx: number, sy: number): void {
    const st = getState();
    if (this.battleActive || st.phase !== 'playing') return;
    // Squads are picked where they stand on screen. Where several stand
    // together (the keep, at the start), a list of them opens to pick from.
    this.closeStack?.();
    this.closeInspect?.();
    // The squad under the click, and with it every squad of its side standing
    // on the same spot (they are drawn fanned out, but stand together).
    const under = (side: 'player' | 'enemy') => {
      const hit = st.squads.filter((s) => {
        if (s.side !== side) return false;
        const at = this.squadOnScreen(s);
        return at.visible && Math.hypot(sx - at.x, sy - at.y) < 22;
      });
      if (!hit.length) return hit;
      const together = st.squads.filter((s) => s.side === side && !hit.includes(s) && hit.some((h) => Math.hypot(s.x - h.x, s.y - h.y) < TOGETHER));
      return [...hit, ...together];
    };
    const mine = under('player');
    if (mine.length > 1) {
      this.openStack(mine, sx, sy);
      return;
    }
    if (mine.length === 1) {
      // A click on the chosen squad lets it go; on another, chooses it.
      if (mine[0] === this.selected) this.deselect();
      else this.chooseSquad(mine[0], false);
      return;
    }
    // An enemy squad clicked is looked over; with a squad chosen, that squad is also sent against it.
    const foes = under('enemy');
    if (foes.length > 1) {
      this.openStack(foes, sx, sy);
      return;
    }
    if (foes.length === 1) {
      this.engage(foes[0]);
      return;
    }
    const ground = this.world.pick(sx, sy);
    if (this.selected && ground) this.orderMarch(this.selected, ground.x, ground.y);
  }

  /** Look an enemy squad over, and send the chosen squad (if any) against it. */
  private engage(foe: Squad): void {
    this.inspect(foe);
    if (!this.selected) return;
    this.orderMarch(this.selected, foe.x, foe.y);
    this.hint.textContent = `${this.selected.name} marches against ${foe.name}.`;
  }

  /** Let the chosen squad go: clicks on the map then order no one. */
  private deselect(): void {
    if (!this.selected) return;
    this.selected = null;
    this.following = false;
    this.world.select(null);
    this.hint.textContent = 'Select a squad, then click a stronghold to march.';
  }

  /** The squads standing together under a click, listed beside it to pick one from. */
  private openStack(squads: Squad[], sx: number, sy: number): void {
    const close = () => {
      list.remove();
      this.closeStack = null;
    };
    const list = el('div', { class: 'stack-list panel', ui: 'stack-list', role: 'menu', 'aria-label': 'Squads here' },
      ...squads.map((sq) => {
        const pick = () => {
          close();
          if (sq.side === 'player') this.chooseSquad(sq, false);
          else this.engage(sq);
        };
        const leader = getState().chars.get(sq.leaderId);
        const row = button('', pick, { class: `stack-item is-${sq.side} ${sq === this.selected ? 'is-on' : ''}`, ui: `stack-${sq.id}`, role: 'menuitem' });
        row.append(
          leader ? unitIcon(classOf(leader.classId).palette, 26) : '',
          el('span', { class: 'stack-name' }, sq.name),
          el('span', { class: 'stack-strength' }, `${Math.round(strengthOf(sq) * 100)}%`),
        );
        return row;
      }),
    );
    // Beside the click, kept within the view.
    list.style.left = `${Math.min(Math.max(8, sx + 14), this.width - 230)}px`;
    list.style.top = `${Math.min(Math.max(8, sy - 20), this.height - 60 - squads.length * 40)}px`;
    this.closeStack = close;
    this.root.append(list);
    list.querySelector<HTMLElement>('button')?.focus();
  }

  /**
   * An enemy squad's sheet: who is in it, how much strength it has left, and
   * how a fight with the chosen squad is likely to go.
   */
  private inspect(foe: Squad): void {
    const st = getState();
    const members = squadMemberIds(foe).map((id) => st.chars.get(id)!).filter(Boolean);
    const type = squadType(members);
    const mine = this.selected;
    const odds = mine ? forecast(st, mine, foe) : null;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const close = () => {
      sheet.remove();
      this.closeInspect = null;
    };
    const shut = button('', close, { class: 'btn-icon btn-quiet', ui: 'inspect-close', 'aria-label': 'Close' });
    shut.append(icon('close', 18));
    const sheet = el('div', { class: 'inspect panel', ui: 'inspect', role: 'dialog', 'aria-label': `${foe.name}, an enemy squad` },
      el('div', { class: 'march-head' },
        el('h3', {}, icon('skull', 18), ` ${foe.name}`),
        el('span', { class: 'inspect-kind' }, `${SQUAD_TYPE_LABEL[type]} · strength ${pct(strengthOf(foe))}`),
        shut,
      ),
      el('div', { class: 'inspect-members' }, ...members.map((c) => {
        const def = classOf(c.classId);
        const share = Math.max(0, c.hp) / Math.max(1, c.stats.hp);
        const bar = el('span', { class: 'inspect-bar' }, el('i', {}));
        const fillEl = bar.firstElementChild as HTMLElement;
        fillEl.style.width = pct(share);
        fillEl.style.background = hpColour(share);
        return el('div', { class: `inspect-member ${c.hp <= 0 ? 'is-down' : ''}` },
          unitIcon(def.palette, 30),
          el('span', { class: 'inspect-name' }, `${def.name}${c.id === foe.leaderId ? ' ★' : ''}`),
          el('span', { class: 'inspect-level' }, `Lv ${c.level}`),
          el('span', { class: 'inspect-row' }, memberRow(foe, c.id)),
          bar,
        );
      })),
      odds && mine
        ? el('div', { class: 'inspect-odds', ui: 'inspect-odds' },
          el('span', {}, `${mine.name} attacking:`),
          el('b', { class: 'is-good' }, `win ${pct(odds.win)}`),
          el('b', {}, `draw ${pct(odds.draw)}`),
          el('b', { class: 'is-bad' }, `lose ${pct(odds.loss)}`),
        )
        : el('div', { class: 'inspect-odds' }, 'Choose a squad of your own first to see how a fight would go.'),
    );
    this.closeInspect = close;
    this.root.append(sheet);
    this.guide.note('inspect');
  }

  private squadOnScreen(sq: Squad): { x: number; y: number; visible: boolean } {
    const p = this.shownAt(sq);
    return this.world.project(p.x, p.y, this.world.squadHeight(sq.id) / 2);
  }

  /**
   * Where a squad is drawn: where it stands, except that one halted on a
   * stronghold's very centre stands in front of the building instead of
   * inside it. (Its place in the game is unchanged.)
   */
  private shownAt(sq: Squad): { x: number; y: number } {
    if (sq.moving) return { x: sq.x, y: sq.y };
    const st = getState();
    const near = (s: Squad, n: MapNode) => !s.moving && Math.hypot(n.x - s.x, n.y - s.y) < 50;
    const n = st.nodes.find((o) => near(sq, o));
    if (!n) return { x: sq.x, y: sq.y };
    // The squads parked at a stronghold stand in an arc in front of it,
    // spreading further as the camera draws back and their figures grow.
    const parked = st.squads.filter((o) => near(o, n)).sort((a, b) => a.id - b.id);
    const view = this.world.view;
    return parkedAt(n.x, n.y, parked.indexOf(sq), parked.length, view.yaw, figureScale(view.distance));
  }

  private routeOf(sq: Squad): { x: number; y: number } | null {
    return sq.moving && sq.targetX !== null && sq.targetY !== null ? { x: sq.targetX, y: sq.targetY } : null;
  }

  /**
   * Fetch Ogre Battle 64's sprites for every squad's leader, where they were
   * extracted; until they arrive a leader shows its standing drawing.
   */
  private prepareLeaders(): void {
    const st = getState();
    void prepareSprites(st.squads.map((sq) => ({ def: classOf(st.chars.get(sq.leaderId)!.classId), side: sq.side })));
  }

  /** Choose a squad to give orders to; `look` brings it into view. */
  private chooseSquad(sq: Squad, look: boolean): void {
    const st = getState();
    if (this.covered || !st.squads.includes(sq)) return;
    this.selected = sq;
    play('select');
    this.guide.note('select');
    this.world.select(sq.id, this.routeOf(sq));
    const type = squadType(squadMemberIds(sq).map((id) => st.chars.get(id)!));
    this.hint.textContent = `${sq.name} (${SQUAD_TYPE_LABEL[type]}) — click anywhere to march.`;
    // The view keeps to the squad from here on; chosen from its card or by its number, it also comes in close.
    this.following = true;
    if (look) {
      const p = this.shownAt(sq);
      this.world.lookAt(p.x, p.y, Math.min(this.world.view.distance, FOLLOW_DISTANCE));
    }
  }

  /** Stop the chosen squad where it stands. */
  private halt(): void {
    const sq = this.selected;
    if (!sq || !sq.moving) return;
    haltSquad(sq);
    this.world.select(sq.id, null);
    this.hint.textContent = `${sq.name} holds its ground.`;
    play('order');
  }

  /** Bring the selected squad into view, or the next of the army's squads. */
  private findSquad(): void {
    const st = getState();
    const mine = st.squads.filter((s) => s.side === 'player');
    if (!mine.length) return;
    const sq = this.selected ?? mine[0];
    this.selected = sq;
    this.world.select(sq.id, this.routeOf(sq));
    const p = this.shownAt(sq);
    this.world.lookAt(p.x, p.y, 18);
    this.following = true;
  }

  // -------------------------------------------------------------- movement --

  /** March to any point on the map. Clicks near a stronghold snap onto it. */
  /** Shut the march list, if it is open. */
  private closeMarchList: (() => void) | null = null;

  /**
   * March orders by keyboard (M, or the March button): the chosen squad's
   * choice of strongholds, nearest first, each with who holds it and how far
   * it lies. Arrows move along the list, Enter sends the squad, Escape shuts it.
   */
  private openMarchList(): void {
    const st = getState();
    if (this.covered || this.battleActive || st.phase !== 'playing' || this.closeMarchList) return;
    const sq = this.selected;
    if (!sq) {
      this.hint.textContent = 'Choose a squad first: 1 to 9, or click it on the map.';
      return;
    }
    const opener = document.activeElement as HTMLElement | null;
    const close = () => {
      list.remove();
      this.closeMarchList = null;
      if (opener && document.contains(opener)) opener.focus();
    };
    const items = marchChoices(sq, st.nodes).map(({ node, tiles }) => {
      const b = button('', () => {
        close();
        if (st.squads.includes(sq)) this.orderMarch(sq, node.x, node.y);
      }, { class: `march-item is-${node.owner}`, ui: `march-to-${node.id}` });
      b.append(
        icon(node.kind.startsWith('hq') ? 'castle' : node.kind === 'fort' ? 'shield' : 'flag', 18),
        el('span', { class: 'march-name' }, node.name),
        el('span', { class: 'march-owner' }, OWNER_LABEL[node.owner]),
        el('span', { class: 'march-far' }, `${tiles} tiles`),
      );
      return b;
    });
    const shut = button('', close, { class: 'btn-icon btn-quiet', ui: 'march-close', 'aria-label': 'Close' });
    shut.append(icon('close', 16));
    const list = el('div', { class: 'march-list panel', ui: 'march-list', role: 'dialog', 'aria-modal': 'true', 'aria-label': `March ${sq.name} on…` },
      el('div', { class: 'march-head' }, el('h3', {}, `March ${sq.name} on…`), shut),
      el('div', { class: 'march-items' }, ...items),
    );
    list.addEventListener('keydown', (e) => {
      // The list's keys are its own: the map beneath pans on arrows and letters.
      e.stopPropagation();
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.code === 'Escape') close();
      else if (e.code === 'Tab') keepFocusWithin(list, e);
      else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        e.preventDefault();
        const step = e.code === 'ArrowDown' ? 1 : -1;
        items[(at + step + items.length) % items.length]?.focus();
      }
    });
    this.closeMarchList = close;
    this.root.append(list);
    items[0]?.focus();
  }

  private orderMarch(sq: Squad, x: number, y: number): void {
    const st = getState();
    const dest = snapOrder(st.nodes, x, y);
    orderTo(sq, dest.x, dest.y);
    if (sq.side === 'player') {
      const node = strongholdAt(st.nodes, dest.x, dest.y);
      this.hint.textContent = node ? `${sq.name} marches on ${node.name}.` : `${sq.name} marches into open country.`;
      this.world.ping(dest.x, dest.y);
      play('order');
      this.guide.note('order');
      if (this.selected === sq) this.world.select(sq.id, dest);
    }
  }

  private stepSquad(sq: Squad, dt: number): void {
    const st = getState();
    if (!sq.moving || sq.targetX === null || sq.targetY === null) return;

    const chars = squadMemberIds(sq).map((id) => st.chars.get(id)!);
    const type = squadType(chars);
    // The squad's make-up sets its pace, and how the ground under it tells.
    const terrainFactor = speedMultiplierAt(this.terrain, sq.x, sq.y, type);
    const distance = moveSpeed(type) * terrainFactor * dt;

    const next = stepToward(sq.x, sq.y, sq.targetX, sq.targetY, distance);
    sq.x = next.x;
    sq.y = next.y;
    if (!next.arrived) return;

    haltSquad(sq);
    if (this.selected === sq) this.world.select(sq.id, null);
    const node = strongholdAt(st.nodes, sq.x, sq.y);
    if (node) {
      sq.nodeId = node.id;
      this.settle(sq, node);
      this.tryCapture(sq, node);
    }
  }

  /**
   * Park a squad at its stronghold, close about any squads already
   * stationed there, near enough to hold it and to meet an enemy who comes
   * for it. The map draws parked squads spread out in front of the building.
   */
  private settle(sq: Squad, node: MapNode, slot?: number): void {
    const st = getState();
    const index = slot ?? st.squads.filter(
      (o) => o.id !== sq.id && !o.moving && o.nodeId === node.id,
    ).length;
    const at = settleOffset(index);
    sq.x = node.x + at.x;
    sq.y = node.y + at.y;
  }

  private tryCapture(sq: Squad, node: MapNode): void {
    const st = getState();
    const hostile = sq.side === 'player' ? 'enemy' : 'player';
    // A routed squad still regrouping holds nothing: it cannot stop a capture.
    const contested = st.squads.some(
      (o) => o.side === hostile && !this.isRecovering(o) && Math.hypot(o.x - node.x, o.y - node.y) < CONTEST_RADIUS,
    );
    if (contested) {
      this.sieges.delete(node.id);
      return;
    }
    // A headquarters does not fall at a touch: it must be held a full day
    // with no one to dispute it, which gives its side a day to come back.
    if (node.owner !== sq.side && (node.kind === 'hq-player' || node.kind === 'hq-enemy')) {
      const siege = this.sieges.get(node.id);
      if (!siege || siege.side !== sq.side) {
        this.sieges.set(node.id, { side: sq.side, since: this.clock });
        this.toast(
          sq.side === 'enemy' ? `${sq.name} is at the gates of ${node.name}! It falls in a day unless relieved.` : `${sq.name} lays siege to ${node.name}: hold it a day to take it.`,
          sq.side === 'enemy' ? 'bad' : 'warn', 8000,
        );
        return;
      }
      if (this.clock - siege.since < DAY_MS) return;
      this.sieges.delete(node.id);
    }
    if (node.owner !== sq.side) {
      if (DEBUG) {
        captures.push({
          day: st.day, node: node.name, by: sq.name, from: node.owner,
          near: st.squads.filter((o) => o !== sq && Math.hypot(o.x - node.x, o.y - node.y) < 60).map((o) => ({
            name: o.name, side: o.side, dist: Math.round(Math.hypot(o.x - node.x, o.y - node.y)),
            moving: o.moving, cooldown: Math.max(0, Math.round((this.cooldowns.get(o.id) ?? 0) - this.clock)),
            recovering: this.isRecovering(o),
          })),
        });
      }
      node.owner = sq.side;
      this.world.setOwner(node.id, sq.side);
      this.world.celebrate(node.x, node.y, sq.side);
      this.toast(`${node.name} ${sq.side === 'player' ? 'liberated!' : 'has fallen!'}`, sq.side === 'player' ? 'good' : 'bad');
      if (sq.side === 'player') this.guide.note('capture');
      if (node.kind === 'hq-enemy' && sq.side === 'player') this.endCampaign('victory');
      if (node.kind === 'hq-player' && sq.side === 'enemy') this.endCampaign('defeat');
    }
  }

  private isRecovering(sq: Squad): boolean {
    return (this.recovering.get(sq.id) ?? 0) > this.clock;
  }

  /**
   * A squad standing on a stronghold it does not hold takes it as soon as no
   * one is left to dispute it, not only on the moment it arrives.
   */
  private pressClaims(): void {
    const st = getState();
    // A siege is lifted the moment no one of the besieging side stands halted there.
    for (const [id, siege] of this.sieges) {
      const node = st.nodes.find((n) => n.id === id)!;
      const held = st.squads.some((o) => o.side === siege.side && !o.moving && !this.isRecovering(o) && strongholdAt(st.nodes, o.x, o.y) === node);
      if (!held || node.owner === siege.side) this.sieges.delete(id);
    }
    for (const sq of st.squads) {
      if (sq.moving || this.isRecovering(sq)) continue;
      const node = strongholdAt(st.nodes, sq.x, sq.y);
      if (node && node.owner !== sq.side) this.tryCapture(sq, node);
      if (st.phase !== 'playing') return;
    }
  }

  // -------------------------------------------------------------- enemy AI --

  private aiTick(): void {
    const st = getState();
    for (const sq of st.squads) {
      if (sq.side !== 'enemy' || sq.moving || this.isRecovering(sq)) continue;
      const order = enemyOrder(st, sq);
      if (order.kind === 'hold') continue;
      // It does not set out on the instant: a strike at the player's holdings
      // more readily than a claim on unclaimed ground or a move up the road,
      // so the front creeps on the keep rather than rushing it.
      const eager = order.why === 'home' || order.why === 'rest' ? 1 : order.why === 'strike' ? 0.6 : order.why === 'claim' ? 0.2 : 0.3;
      if (rng() < eager) this.orderMarch(sq, order.to.x, order.to.y);
    }
  }

  // --------------------------------------------------------------- battles --

  private checkEncounters(): void {
    if (this.battleActive) return;
    const st = getState();
    const now = this.clock;
    for (const a of st.squads) {
      if (a.side !== 'player') continue;
      for (const b of st.squads) {
        if (b.side !== 'enemy') continue;
        if ((this.cooldowns.get(a.id) ?? 0) > now || (this.cooldowns.get(b.id) ?? 0) > now) continue;
        if (squadsMeet(st.nodes, a, b)) {
          this.startBattle(a, b);
          return;
        }
      }
    }
  }

  private startBattle(attacker: Squad, defender: Squad, ground?: Terrain): void {
    this.battleActive = true;
    this.closeInspect?.();
    this.guide.note('battle');
    attacker.moving = false;
    defender.moving = false;
    // The battlefield takes the ground the squads meet on.
    const field = ground ?? terrainAtPoint(this.terrain, (attacker.x + defender.x) / 2, (attacker.y + defender.y) / 2);
    this.fighting = new Set([attacker.id, defender.id]);
    this.exits.battle(attacker.id, defender.id, { field, ...this.sky }, (result) => this.onBattleDone(result));
  }

  private onBattleDone(payload: BattleResult): void {
    const st = getState();
    this.battleActive = false;
    this.fighting.clear();
    // Counted on the map's own clock, which stood still through the battle.
    const now = this.clock;

    for (const side of ['attackerId', 'defenderId'] as const) {
      const sq = st.squads.find((s) => s.id === payload[side]);
      if (!sq) continue;
      this.cooldowns.set(sq.id, now + 7000);
      const members = squadMemberIds(sq).map((id) => st.chars.get(id)!);
      const wiped = members.every((c) => c.hp <= 0);
      if (wiped) {
        if (sq.side === 'enemy') {
          st.squads.splice(st.squads.indexOf(sq), 1);
          const loot = rollLoot(members);
          addLoot(loot, st.inventory, st);
          const found = loot.items.map((id) => itemOf(id).name);
          this.toast(`${sq.name} destroyed! Spoils: ${[`${loot.goth} Goth`, ...found].join(', ')}`, 'good');
        } else {
          // routed home: survivors crawl back to HQ at low strength
          const hq = st.nodes.find((n) => n.kind === 'hq-player')!;
          sq.nodeId = hq.id;
          haltSquad(sq);
          this.settle(sq, hq);
          for (const c of members) c.hp = Math.max(1, Math.floor(c.stats.hp * 0.25));
          // It sits out a day to regroup, so it is not thrown straight back at
          // whoever routed it (perhaps camped on the keep itself).
          this.cooldowns.set(sq.id, now + REGROUP_MS);
          this.recovering.set(sq.id, now + REGROUP_MS);
          this.toast(`${sq.name} routed! They regroup at the keep.`, 'warn');
        }
      } else {
        // The fallen stay down until revived, or until their squad rests at its keep.
        // The beaten side gives ground, falling back on its own nearest holding.
        const lostAsAttacker = side === 'attackerId' && payload.winner === 'defender';
        const lostAsDefender = side === 'defenderId' && payload.winner === 'attacker';
        // Not from its own headquarters, though (the keep, or the enemy's
        // castle): there is nowhere further back, and a side's last
        // stronghold is held until its defenders are down.
        const here = strongholdAt(st.nodes, sq.x, sq.y);
        const atKeep = here?.owner === sq.side && here.kind === (sq.side === 'player' ? 'hq-player' : 'hq-enemy');
        if ((lostAsAttacker || lostAsDefender) && !atKeep) {
          const foe = st.squads.find((o) => o.id === payload[side === 'attackerId' ? 'defenderId' : 'attackerId']);
          const away = retreatTarget(st.nodes, sq.side, sq.x, sq.y, foe?.x ?? sq.x, foe?.y ?? sq.y);
          orderTo(sq, away.x, away.y);
        }
      }
    }
    this.syncAll();
    this.save();
  }

  // ------------------------------------------------------------- view sync --

  private syncAll(): void {
    const st = getState();
    const live = new Set(st.squads.map((s) => s.id));
    for (const [id, tag] of this.tags) {
      if (!live.has(id)) {
        this.world.removeSquad(id);
        tag.root.remove();
        this.tags.delete(id);
      }
    }
    for (const sq of st.squads) if (!this.tags.has(sq.id)) this.makeTag(sq);
    if (this.selected && !live.has(this.selected.id)) this.selected = null;
    if (this.selected) this.world.select(this.selected.id, this.routeOf(this.selected));
  }

  private makeTag(sq: Squad): void {
    const fill = el('div', { class: 'bar-fill' });
    const root = el('div', { class: `squad-tag is-${sq.side}`, ui: `squad-${sq.id}` },
      el('div', { class: 'squad-name' }, sq.name),
      el('div', { class: 'bar' }, fill),
    );
    this.labels.append(root);
    this.tags.set(sq.id, { root, fill, width: 0 });
  }

  /**
   * Stand every squad where it now is, step the world, and lay the names and
   * strength bars over it where the camera sees each one.
   */
  private drawWorld(deltaMs: number): void {
    const st = getState();
    const world = this.world;
    for (const sq of st.squads) {
      const leader = st.chars.get(sq.leaderId)!;
      const p = this.shownAt(sq);
      world.setSquad(sq.id, p.x, p.y, sq.side, mapFigureFor(classOf(leader.classId), sq.side), sq.moving);
    }
    if (this.selected?.moving) {
      world.refreshRoute(this.routeOf(this.selected));
      // The view goes with a squad on the march, unless the player has moved it away.
      if (this.following && !this.press) world.centreOn(this.selected.x, this.selected.y);
    }
    world.held = this.paused;
    world.update(Math.min(deltaMs, 50 * SPEED));
    if (this.covered) return;

    const W = this.width;
    const H = this.height;
    // The chosen squad's commands, about its feet.
    const chosen = this.selected && st.squads.includes(this.selected) && !this.battleActive && st.phase === 'playing' ? this.selected : null;
    const feet = chosen ? (() => {
      const p = this.shownAt(chosen);
      return world.project(p.x, p.y, 0);
    })() : null;
    const ringOn = !!feet && feet.visible && feet.y < H - 150 && feet.y > 60;
    this.ring.hidden = !ringOn;
    if (ringOn && feet) {
      this.ring.style.transform = `translate(${Math.round(feet.x)}px, ${Math.round(feet.y + 26)}px) translateX(-50%)`;
      this.ring.classList.toggle('is-marching', !!chosen?.moving);
    }
    const shownNames: { label: { el: HTMLElement; width: number; height: number }; x: number; y: number }[] = [];
    for (const n of st.nodes) {
      const label = this.nodeLabels.get(n.id)!;
      const owner = `node-name is-${n.owner}`;
      if (label.el.className !== owner) label.el.className = owner;
      // Over the building, clear of the squads parked in front of it.
      const at = world.project(n.x, n.y, n.kind === 'town' ? 1.9 : 3.1);
      const visible = at.visible && at.y > 20 && at.y < H - 60;
      label.el.hidden = !visible;
      if (!visible) continue;
      if (!label.width) {
        label.width = label.el.offsetWidth;
        label.height = label.el.offsetHeight;
      }
      shownNames.push({ label, x: at.x, y: at.y - 16 });
      label.el.style.transform = `translate(${Math.round(at.x - label.width / 2)}px, ${Math.round(at.y - 16)}px)`;
    }
    // Each squad's name and strength sit over its head, moved clear of one
    // another (and of the strongholds' names) where squads gather.
    const heads = st.squads.flatMap((sq) => {
      const tag = this.tags.get(sq.id);
      if (!tag) return [];
      const p = this.shownAt(sq);
      const at = world.project(p.x, p.y, world.squadHeight(sq.id) + 0.15);
      const ok = at.visible && at.y > 0 && at.y < H;
      tag.root.hidden = !ok;
      return ok ? [{ sq, tag, at }] : [];
    });
    for (const h of heads) if (!h.tag.width) h.tag.width = h.tag.root.offsetWidth;
    const boxes = [
      ...heads.map(({ tag, at }) => ({ x: at.x, y: at.y - 19, w: Math.max(28, tag.width), h: 18 })),
      ...shownNames.map(({ label, x, y }) => ({ x, y, w: label.width, h: label.height })),
    ];
    // Stronghold names hold their places: they count as already placed, being lowest.
    const ys = declutter(boxes, 1, 6, heads.length);
    heads.forEach(({ sq, tag, at }, k) => {
      const top = ys[k];
      // Kept whole on screen at its edges.
      const half = tag.width / 2 + 2;
      const x = Math.max(half, Math.min(W - half, at.x));
      tag.root.style.transform = `translate(${Math.round(x - tag.width / 2)}px, ${Math.round(top)}px)`;
      const members = squadMemberIds(sq).map((id) => st.chars.get(id)!);
      const ratio = members.reduce((s, c) => s + c.hp, 0) / Math.max(1, members.reduce((s, c) => s + c.stats.hp, 0));
      tag.fill.style.width = `${Math.round(ratio * 100)}%`;
      tag.fill.style.background = hpColour(ratio);
      tag.root.classList.toggle('is-selected', this.selected === sq);
    });
  }

  private endCampaign(result: 'victory' | 'defeat'): void {
    const st = getState();
    if (st.phase !== 'playing') return;
    st.phase = result;
    this.save();
    const panel = el('div', { class: `end-panel panel is-${result}`, ui: 'end-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': result === 'victory' ? 'Victory' : 'Defeat' },
      icon(result === 'victory' ? 'crown' : 'skull', 48),
      el('h2', {}, result === 'victory' ? 'Victory!' : 'Defeat…'),
      el('p', {}, result === 'victory' ? 'Castle Verlaine is yours. The realm is liberated.' : 'Fort Melchor has fallen.'),
      button('Title', () => this.exits.title(), { ui: 'to-title', class: 'btn-primary' }),
    );
    this.root.append(panel);
    play(result);
    panel.querySelector<HTMLElement>('[data-ui="to-title"]')?.focus();
  }

  private toast(msg: string, tone: 'good' | 'bad' | 'warn', ms = 2600): void {
    const mark: Record<typeof tone, IconName> = { good: 'flag', bad: 'skull', warn: 'shield' };
    const t = el('div', { class: `toast is-${tone}` }, icon(mark[tone], 18), msg);
    play(tone === 'good' ? 'capture' : tone === 'bad' ? 'lost' : 'warn');
    t.style.animationDuration = `${ms / SPEED}ms`;
    t.addEventListener('animationend', () => t.remove());
    this.toasts.append(t);
  }

  /** One step of the campaign: squads march, strongholds change hands, squads meet, the enemy plans, days pass. */
  private step(stepMs: number): void {
    const st = getState();
    const dt = stepMs / 1000;
    this.clock += stepMs;
    for (const sq of st.squads) this.stepSquad(sq, dt);
    this.pressClaims();
    if (st.phase === 'playing') this.checkEncounters();

    this.aiTimer += dt;
    if (this.aiTimer > 6) {
      this.aiTimer = 0;
      this.aiTick();
    }
    this.dayTimer += dt;
    if (this.dayTimer > DAY_MS / 1000) {
      this.dayTimer = 0;
      st.day++;
      const income = st.nodes.filter((n) => n.owner === 'player').length * 50;
      st.goth += income;
      play('bell');
      restSquads(st);
      const fresh = reinforce(st);
      if (fresh) {
        this.syncAll();
        this.toast(`${fresh.name} marches out of Castle Verlaine!`, 'bad', 6000);
      }
      this.save();
    }
  }

  /** Keep the campaign as it stands (each day, after each battle, on leaving the army screen); an ended one is cleared. */
  private save(): void {
    saveCampaign(getState(), this.dayTimer);
  }

  update(frameMs: number): void {
    // The settings sheet holds the clock, as the pause does.
    const held = this.paused || this.root.querySelector('.settings') !== null;
    const deltaMs = held ? 0 : frameMs * SPEED * this.rate;
    const st = getState();
    if (st.phase === 'playing') {
      this.steerCamera(frameMs / 1000);
      // The campaign moves on in steps of no more than STEP_MS of game time,
      // however long the frame, so squads meet where and when they would at
      // any frame rate. A battle that breaks out stops the clock until it ends.
      let left = deltaMs;
      while (left > 0 && st.phase === 'playing' && !this.battleActive) {
        const stepMs = Math.min(STEP_MS, left);
        left -= stepMs;
        this.step(stepMs);
      }
    }
    // The hour and the weather follow the campaign's days (unless a test has fixed them).
    if (!this.skyFixed) {
      this.sky = { hour: hourOf(st.day - 1 + this.dayTimer / (DAY_MS / 1000)), weather: weatherOn(st.day) };
      this.world.setHour(this.sky.hour);
      this.world.setWeather(this.sky.weather);
    }
    // The world goes on moving (flags, the camera) even once the campaign is over.
    this.drawWorld(st.phase === 'playing' && !held ? deltaMs : frameMs);
    // The instruments, a few times a second.
    this.instrumentsAt -= frameMs;
    if (this.instrumentsAt <= 0 && !this.covered) {
      this.instrumentsAt = 150;
      const v = this.world.view;
      this.instruments.update({
        hour: this.sky.hour, weather: this.sky.weather, selected: this.selected, fighting: this.fighting,
        regrouping: new Set([...this.recovering].filter(([, until]) => until > this.clock).map(([id]) => id)),
        view: { x: v.x * TILE, y: v.z * TILE, distance: v.distance },
      });
    }
  }

  // -------------------------------------------------------------- testing --

  private exposeForTests(): void {
    const world = this.world;
    // For the automated playthrough: where a squad or a map point is on screen.
    exposeDebug('map', {
      scene: this,
      pointOnScreen: (x: number, y: number) => world.project(x, y, 0),
      squadOnScreen: (id: number) => {
        const sq = getState().squads.find((s) => s.id === id);
        return sq ? this.squadOnScreen(sq) : null;
      },
      selectedId: () => this.selected?.id ?? null,
      view: () => ({ ...world.view }),
      hint: () => this.hint.textContent,
      setView: (v: Parameters<WorldStage['setView']>[0]) => world.setView(v, true),
      setSky: (hour: number, weather: Weather) => {
        this.skyFixed = true;
        this.sky = { hour, weather };
        world.setHour(hour);
        world.setWeather(weather, true);
      },
      /** Open a battle between two squads at once, on the ground given (else where they stand). */
      fight: (attackerId: number, defenderId: number, field?: Terrain) => {
        const st = getState();
        const a = st.squads.find((q) => q.id === attackerId);
        const d = st.squads.find((q) => q.id === defenderId);
        if (!a || !d || this.battleActive) return false;
        this.startBattle(a, d, field);
        return true;
      },
    });
  }
}

/** Whether a key press is meant for a text field rather than the map. */
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
