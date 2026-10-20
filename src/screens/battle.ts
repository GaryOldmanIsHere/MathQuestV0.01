import type { App, Screen } from '../app/app';
import { Timers } from '../app/timers';
import type { View } from '../render/engine';
import { getState } from '../core/state';
import type { BattleEvent } from '../core/battle';
import { simulateBattle } from '../core/battle';
import type { Character, Element, Squad } from '../core/types';
import type { BattleGround } from './map';
import { classOf } from '../data/registry';
import { weaponOf } from '../core/items';
import { squadMemberIds } from '../core/squad';
import { BattleStage } from '../gfx3d/stage';
import { frameAction, placements, WIDE } from '../gfx3d/layout';
import type { Placement } from '../gfx3d/layout';
import { declutter } from '../gfx/declutter';
import { spriteSetFor } from '../gfx3d/unitArt';
import { prepareSprites } from '../gfx3d/ob64Sprites';
import { exposeDebug, SPEED } from '../debug';
import { el, hpColour } from '../ui/dom';
import { ELEMENT_COLOUR } from '../gfx3d/spells';
import type { Hue } from '../gfx3d/spells';
import { StrengthBar } from '../gfx/strengthBar';

// Plays back one engagement on a 3D battlefield: the two formations face each
// other on ground shaped like the place they met, and the camera follows
// each blow. The battle has already been decided (simulateBattle); this
// screen acts out its event log, on its own clock.

/** How long the squads take to march on, ms. */
const MARCH_MS = 1300;
/** How long a fighter takes to run in to strike, or back. */
const RUN_MS = 300;
/** Between strikes on one unit, ms; and after the last lands before the next acts. */
const STRIKE_GAP = 150;
const AFTER_MS = 560;

export interface BattleResult {
  attackerId: number;
  defenderId: number;
  winner: 'attacker' | 'defender' | 'draw';
}

interface Label {
  char: Character;
  root: HTMLElement;
  fill: HTMLElement;
  chip: HTMLElement;
  width: number;
  /** The strength shown, as the blows land (the battle's outcome is already in `char`). */
  hp: number;
  bar: StrengthBar;
}

export class BattleScreen implements Screen {
  readonly name = 'Battle' as const;
  readonly root: HTMLElement;
  private stage = new BattleStage();
  private timers = new Timers();
  private labels = new Map<number, Label>();
  private places = new Map<number, Placement>();
  private layer: HTMLElement;
  private banner: HTMLElement;
  private attacker: Squad;
  private defender: Squad;
  private disposed = false;

  constructor(
    private app: App,
    params: { attackerId: number; defenderId: number; ground: BattleGround },
    private done: (result: BattleResult) => void,
  ) {
    const st = getState();
    this.attacker = st.squads.find((s) => s.id === params.attackerId)!;
    this.defender = st.squads.find((s) => s.id === params.defenderId)!;
    const q = app.engine.settings;
    this.stage.setField(params.ground.field, {
      seed: this.attacker.id * 31 + this.defender.id,
      grass: q.grass, shadows: q.shadows, particles: q.particles, simple: q.simpleShading,
      hour: params.ground.hour, weather: params.ground.weather,
    });

    this.layer = el('div', { class: 'battle-labels' });
    this.banner = el('div', { class: 'battle-banner', ui: 'battle-banner' }, 'The squads close…');
    this.root = el('div', { class: 'screen battle-screen', ui: 'battle' }, this.layer, this.banner);

    // Units appear once their sprites are ready: Ogre Battle 64's are fetched
    // and drawn for this battle; the original art is at hand already.
    const sides = [[this.attacker, 'left'], [this.defender, 'right']] as const;
    const wanted = sides.flatMap(([sq]) => squadMemberIds(sq).map((id) => ({
      def: classOf(st.chars.get(id)!.classId), side: sq.side,
    })));
    prepareSprites(wanted).finally(() => {
      if (!this.disposed) this.begin(sides);
    });
  }

  view(): View {
    return this.stage;
  }

  resize(w: number, h: number): void {
    this.stage.resize(w, h);
  }

  dispose(): void {
    this.disposed = true;
    this.timers.clear();
    this.stage.dispose();
  }

  private begin(sides: readonly (readonly [Squad, 'left' | 'right'])[]): void {
    const st = getState();
    const stage = this.stage;
    for (const [sq, side] of sides) {
      for (const [id, p] of placements(sq, side)) {
        const c = st.chars.get(id)!;
        if (c.hp <= 0) continue;
        this.places.set(id, p);
        stage.addUnit(id, spriteSetFor(classOf(c.classId), sq.side), p);
        const fill = el('div', { class: 'bar-fill' });
        const chip = el('div', { class: 'bar-chip' });
        const root = el('div', { class: `unit-tag is-${sq.side}` },
          el('div', { class: 'bar' }, chip, fill),
          el('div', { class: 'unit-name' }, `${c.name} L${c.level}`),
        );
        this.layer.append(root);
        this.labels.set(id, { char: c, root, fill, chip, width: 0, hp: c.hp, bar: new StrengthBar(c.hp / c.stats.hp) });
      }
    }

    // Who fights whom, over the field.
    this.root.prepend(el('div', { class: 'battle-heads' },
      el('div', { class: 'battle-head is-attacker' }, el('span', { class: 'role' }, 'Attacker'), this.headline(this.attacker)),
      el('div', { class: 'battle-head is-defender' }, el('span', { class: 'role' }, 'Defender'), this.headline(this.defender)),
    ));
    // The squads march on from either side as the camera sweeps down onto the field.
    for (const [id, p] of this.places) stage.marchIn(id, -p.facing * (6 + Math.random() * 1.5), MARCH_MS + Math.random() * 250);
    stage.cut({ ...WIDE, distance: WIDE.distance + 8, elevation: 0.78, azimuth: -0.55 }, 0);
    stage.cut(WIDE, MARCH_MS + 200);
    this.timers.after(MARCH_MS, () => {
      this.banner.textContent = 'The squads clash!';
    });

    const result = simulateBattle({ squad: this.attacker, chars: st.chars }, { squad: this.defender, chars: st.chars });
    exposeDebug('lastBattle', {
      attackerId: this.attacker.id, defenderId: this.defender.id, winner: result.winner,
      attackerWiped: result.attackerWiped, defenderWiped: result.defenderWiped,
      kinds: result.events.flatMap((e) => (e.kind === 'act' ? [e.attack.type] : [])),
      levelUps: [...result.levelUps.entries()],
    });
    this.timers.after(MARCH_MS + 450, () => {
      this.playEvents(result.events, 0, () => {
        this.stage.highlight(null);
        this.stage.cut(WIDE, 600);
        this.cheer(result.winner);
        const winnerName =
          result.winner === 'attacker' ? this.attacker.name :
          result.winner === 'defender' ? this.defender.name : null;
        this.showOutcome(winnerName ? `${winnerName} wins the clash!` : 'Both sides withdraw…', result.levelUps);
        this.timers.after(2000, () => {
          const outcome: BattleResult = { attackerId: this.attacker.id, defenderId: this.defender.id, winner: result.winner };
          this.app.close(this);
          this.done(outcome);
          this.app.emit('battle-done', outcome);
        });
      });
    });
  }

  update(frameMs: number): void {
    const ms = Math.min(frameMs, 50) * SPEED;
    this.timers.update(ms);
    if (this.disposed) return;
    const stage = this.stage;
    stage.update(ms);
    // Each unit's strength bar and name sit under its feet, moved clear of
    // one another where units stand close.
    const shown = [...this.labels].flatMap(([id, l]) => {
      const p = stage.project(id);
      return p && !l.root.classList.contains('is-down') ? [{ l, p }] : [];
    });
    for (const { l } of shown) if (!l.width) l.width = l.root.offsetWidth;
    const ys = declutter(shown.map(({ l, p }) => ({ x: p.x, y: p.y, w: Math.max(40, l.width), h: 22 })));
    shown.forEach(({ l, p }, k) => {
      l.bar.step(ms);
      l.root.style.transform = `translate(${Math.round(p.x - l.width / 2)}px, ${Math.round(ys[k])}px)`;
      l.fill.style.width = `${(l.bar.fill * 100).toFixed(1)}%`;
      l.fill.style.background = hpColour(l.bar.fill);
      l.chip.style.width = `${(l.bar.chip * 100).toFixed(1)}%`;
      l.chip.classList.toggle('is-gain', l.bar.chipKind === 'gain');
    });
  }

  private headline(sq: Squad): string {
    const st = getState();
    const leader = st.chars.get(sq.leaderId);
    const cls = leader ? classOf(leader.classId).name : '?';
    return `${sq.name} (${leader?.name ?? '?'} the ${cls})`;
  }

  private playEvents(events: BattleEvent[], i: number, done: () => void): void {
    const stage = this.stage;
    if (this.disposed || i >= events.length) {
      done();
      return;
    }
    const ev = events[i];
    const next = () => this.playEvents(events, i + 1, done);
    if (ev.kind !== 'act' || !stage.has(ev.actorId)) {
      next();
      return;
    }
    const actor = getState().chars.get(ev.actorId)!;
    const place = this.places.get(ev.actorId)!;
    const attack = ev.attack;
    const weapon = weaponOf(actor);
    const blow = attack.type === 'melee' || attack.type === 'ranged';
    const hue: Hue = (attack.element ?? (blow ? weapon?.element : undefined) ?? 'physical') as Hue;
    this.banner.textContent = `${actor.name}: ${attack.name}!`;
    this.banner.dataset.hue = attack.type === 'heal' ? 'heal' : hue;
    stage.highlight(ev.actorId);
    const targets = [...new Set(ev.targetIds)].filter((id) => stage.has(id));
    stage.cut(frameAction(place, targets.map((t) => this.places.get(t)!).filter(Boolean), stage.aspect), 320);

    // Each target takes its share as its blow or spell reaches it; once all have, the next acts.
    let left = targets.length;
    const reached = (id: number) => {
      this.land(ev, id, hue);
      if (--left === 0) this.timers.after(AFTER_MS, next);
    };
    if (!targets.length) {
      this.timers.after(500, next);
      return;
    }

    this.timers.after(300, () => {
      if (attack.type === 'melee') {
        // Run in, strike on the animation's own frame, step back.
        stage.advance(ev.actorId, stage.position(targets[0])!, RUN_MS, () => {
          const { hit, total } = stage.timing(ev.actorId, 'attack');
          stage.play(ev.actorId, 'attack');
          this.timers.after(hit, () => targets.forEach((t) => {
            stage.spells.slash(t, hue, place.facing, this.heavy(ev, t));
            reached(t);
          }));
          this.timers.after(Math.max(total, hit + 160), () => stage.withdraw(ev.actorId, RUN_MS));
        });
      } else if (attack.type === 'ranged') {
        const { hit } = stage.timing(ev.actorId, 'attack');
        stage.play(ev.actorId, 'attack');
        this.timers.after(hit, () => targets.forEach((t, k) => {
          const ms = 360 + k * 60;
          if (weapon?.type === 'bow' || hue === 'physical') stage.spells.arrow(ev.actorId, t, ms, () => reached(t), hue);
          else stage.spells.arrow(ev.actorId, t, ms, () => {
            stage.spells.burst(t, hue, 14);
            reached(t);
          }, hue);
        }));
      } else {
        // A spell: a circle under the caster, light gathering in their hands, then the spell itself.
        const healing = attack.type === 'heal';
        const glow: Hue = healing ? 'virtue' : hue;
        const { hit, total } = stage.timing(ev.actorId, 'cast');
        stage.play(ev.actorId, 'cast');
        stage.spells.glyph(ev.actorId, healing ? 'wind' : glow, total + 250);
        stage.spells.gather(ev.actorId, glow, hit);
        this.timers.after(hit, () => targets.forEach((t, k) => this.timers.after(k * 110, () => {
          if (healing) {
            stage.spells.heal(t);
            this.timers.after(260, () => reached(t));
          } else {
            stage.spells.spell(ev.actorId, t, hue, () => reached(t));
          }
        })));
      }
    });
  }

  /** Whether a unit's share of an action is a heavy blow (a quarter of its strength or more). */
  private heavy(ev: Extract<BattleEvent, { kind: 'act' }>, id: number): boolean {
    const c = getState().chars.get(id);
    if (!c || ev.attack.type === 'heal') return false;
    const total = ev.targetIds.reduce((s, t, k) => (t === id ? s + ev.amounts[k] : s), 0);
    return total >= c.stats.hp * 0.25;
  }

  /**
   * A unit's share of an action lands: each strike in turn (a unit struck
   * twice is struck twice) with its number and its cut of the strength
   * bar; a flinch and a held moment for each blow; the fallen go down
   * after their last.
   */
  private land(ev: Extract<BattleEvent, { kind: 'act' }>, id: number, hue: Hue): void {
    const stage = this.stage;
    const heal = ev.attack.type === 'heal';
    const strikes = ev.targetIds.flatMap((t, k) => (t === id ? [ev.amounts[k]] : []));
    const l = this.labels.get(id);
    const max = l?.char.stats.hp ?? 1;
    const heavy = this.heavy(ev, id);
    strikes.forEach((amount, n) => this.timers.after(n * STRIKE_GAP, () => {
      const p = stage.project(id);
      if (p) this.floatNumber(p.x + (n % 2 ? 12 : -12) * Math.min(1, n), p.headY - 6 - n * 16, `${heal ? '+' : ''}${amount}`, heal ? 'heal' : 'hit', {
        big: !heal && amount >= max * 0.25, hue: heal ? undefined : hue,
      });
      if (l) {
        l.hp = heal ? Math.min(max, l.hp + amount) : Math.max(0, l.hp - amount);
        l.bar.set(l.hp / max);
      }
      if (heal) return;
      stage.play(id, 'hit');
      stage.flash(id, hue === 'physical' ? 0xff6a5a : 0xffffff);
      stage.recoil(id, heavy ? 1.4 : 1);
      // The weight of a blow: the moment held, the camera shaken (and pushed in, for a heavy one).
      stage.hitStop(ev.attack.type === 'melee' ? (heavy ? 90 : 55) : heavy ? 60 : 0);
      stage.quake(ev.attack.type === 'magic' ? 0.2 : heavy ? 0.22 : 0.1);
      if (heavy) stage.punch(1);
    }));
    if (ev.kos.includes(id)) {
      this.timers.after(Math.max(0, strikes.length - 1) * STRIKE_GAP + 120, () => {
        if (l) {
          l.hp = 0;
          l.bar.set(0);
        }
        stage.fall(id);
        const p = stage.project(id);
        if (p) this.floatNumber(p.x, p.headY - 34, 'Down!', 'ko');
        // The empty bar shows a moment before the name goes.
        this.timers.after(700, () => l?.root.classList.add('is-down'));
      });
    }
  }

  /** The side that won hops for joy. */
  private cheer(winner: 'attacker' | 'defender' | 'draw'): void {
    if (winner === 'draw') return;
    const facing = winner === 'attacker' ? 1 : -1;
    let k = 0;
    for (const [id, p] of this.places) {
      if (p.facing !== facing) continue;
      const l = this.labels.get(id);
      if (!l || l.hp <= 0) continue;
      const delay = 200 + (k++ % 3) * 90;
      this.timers.after(delay, () => this.stage.hop(id, 360));
      this.timers.after(delay + 480, () => this.stage.hop(id, 320, 0.3));
    }
  }

  private floatNumber(x: number, y: number, txt: string, kind: 'hit' | 'heal' | 'ko', o: { big?: boolean; hue?: Hue } = {}): void {
    const t = el('div', { class: `float-number is-${kind}${o.big ? ' is-big' : ''}` }, txt);
    if (o.hue && o.hue !== 'physical') t.style.setProperty('--tint', `#${ELEMENT_COLOUR[o.hue].toString(16).padStart(6, '0')}`);
    t.style.left = `${Math.round(x)}px`;
    t.style.top = `${Math.round(y)}px`;
    t.style.animationDuration = `${1000 / SPEED}ms`;
    t.addEventListener('animationend', () => t.remove());
    this.layer.append(t);
  }

  private showOutcome(msg: string, levelUps: Map<number, number>): void {
    const st = getState();
    const ups: string[] = [];
    for (const [id] of levelUps) {
      const c = st.chars.get(id);
      if (c) ups.push(`${c.name} reached Lv ${c.level}!`);
    }
    this.root.append(el('div', { class: 'battle-outcome panel', ui: 'battle-outcome' },
      el('h2', {}, msg),
      ups.length ? el('p', { class: 'level-ups' }, ups.slice(0, 3).join(' · ')) : null,
    ));
  }
}
