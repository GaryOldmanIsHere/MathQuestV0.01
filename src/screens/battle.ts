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

// Plays back one engagement on a 3D battlefield: the two formations face each
// other on ground shaped like the place they met, and the camera follows
// each blow. The battle has already been decided (simulateBattle); this
// screen acts out its event log, on its own clock.

export interface BattleResult {
  attackerId: number;
  defenderId: number;
  winner: 'attacker' | 'defender' | 'draw';
}

interface Label {
  char: Character;
  root: HTMLElement;
  fill: HTMLElement;
  width: number;
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
        const root = el('div', { class: `unit-tag is-${sq.side}` },
          el('div', { class: 'bar' }, fill),
          el('div', { class: 'unit-name' }, `${c.name} L${c.level}`),
        );
        this.layer.append(root);
        this.labels.set(id, { char: c, root, fill, width: 0 });
      }
    }

    // Who fights whom, over the field.
    this.root.prepend(el('div', { class: 'battle-heads' },
      el('div', { class: 'battle-head is-attacker' }, el('span', { class: 'role' }, 'Attacker'), this.headline(this.attacker)),
      el('div', { class: 'battle-head is-defender' }, el('span', { class: 'role' }, 'Defender'), this.headline(this.defender)),
    ));
    this.banner.textContent = 'The squads clash!';

    // Open on a slow sweep down onto the field, then act out the log.
    stage.cut({ ...WIDE, distance: WIDE.distance + 7, elevation: 0.7, azimuth: -0.5 }, 0);
    stage.cut(WIDE, 1100);

    const result = simulateBattle({ squad: this.attacker, chars: st.chars }, { squad: this.defender, chars: st.chars });
    exposeDebug('lastBattle', {
      attackerId: this.attacker.id, defenderId: this.defender.id, winner: result.winner,
      attackerWiped: result.attackerWiped, defenderWiped: result.defenderWiped,
      kinds: result.events.flatMap((e) => (e.kind === 'act' ? [e.attack.type] : [])),
      levelUps: [...result.levelUps.entries()],
    });
    this.timers.after(1250, () => {
      this.playEvents(result.events, 0, () => {
        this.stage.cut(WIDE, 600);
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
      const ratio = Math.max(0, l.char.hp / l.char.stats.hp);
      l.root.style.transform = `translate(${Math.round(p.x - l.width / 2)}px, ${Math.round(ys[k])}px)`;
      l.fill.style.width = `${Math.round(ratio * 100)}%`;
      l.fill.style.background = hpColour(ratio);
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
    this.banner.textContent = `${actor.name}: ${attack.name}!`;
    const targets = [...new Set(ev.targetIds)].filter((id) => stage.has(id));
    stage.cut(frameAction(place, targets.map((t) => this.places.get(t)!).filter(Boolean), stage.aspect), 320);

    const blow = attack.type === 'melee' || attack.type === 'ranged';
    const element: Element | 'physical' = attack.element ?? (blow ? weaponOf(actor)?.element : undefined) ?? 'physical';
    let landed = false;
    const impact = () => {
      if (landed) return;
      landed = true;
      this.impact(ev, attack.type === 'heal', element);
      this.timers.after(560, next);
    };

    this.timers.after(300, () => {
      if (!targets.length) {
        impact();
        return;
      }
      // Each blow lands on the frame its animation marks.
      if (attack.type === 'melee') {
        const { hit } = stage.timing(ev.actorId, 'attack');
        stage.play(ev.actorId, 'attack');
        stage.lunge(ev.actorId, stage.position(targets[0])!, Math.max(300, hit * 2), impact);
      } else if (attack.type === 'ranged') {
        const { hit } = stage.timing(ev.actorId, 'attack');
        stage.play(ev.actorId, 'attack');
        this.timers.after(hit, () => {
          targets.forEach((t, k) => stage.projectile(ev.actorId, t, element, 300 + k * 40, impact, 1.1));
        });
      } else if (attack.type === 'heal') {
        const { hit } = stage.timing(ev.actorId, 'cast');
        stage.play(ev.actorId, 'cast');
        this.timers.after(hit, () => {
          targets.forEach((t) => stage.burst(t, 'virtue', 'heal'));
          this.timers.after(380, impact);
        });
      } else {
        const { hit } = stage.timing(ev.actorId, 'cast');
        stage.play(ev.actorId, 'cast');
        this.timers.after(hit, () => {
          targets.forEach((t, k) => stage.projectile(ev.actorId, t, element, 420 + k * 30, impact, 0.5));
        });
      }
    });
  }

  /** Blows and spells land: flashes, numbers, health bars, the fallen tip over. */
  private impact(ev: Extract<BattleEvent, { kind: 'act' }>, heal: boolean, element: Element | 'physical'): void {
    const stage = this.stage;
    const seen = new Map<number, number>();
    ev.targetIds.forEach((id, k) => {
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      const p = stage.project(id);
      if (p) this.floatNumber(p.x + (n % 3) * 14 - 14, p.headY - 8 - n * 12, `${heal ? '+' : ''}${ev.amounts[k]}`, heal ? 'heal' : 'hit');
      if (!heal && n === 0) {
        stage.play(id, 'hit');
        stage.flash(id);
        stage.recoil(id);
        stage.burst(id, element, ev.attack.type === 'magic' ? 'spell' : 'hit');
      }
    });
    if (!heal && ev.targetIds.length) stage.quake(ev.attack.type === 'magic' ? 0.22 : 0.12);
    for (const id of ev.kos) {
      stage.fall(id);
      const p = stage.project(id);
      if (p) this.floatNumber(p.x, p.headY - 30, 'KO!', 'ko');
      this.labels.get(id)?.root.classList.add('is-down');
    }
  }

  private floatNumber(x: number, y: number, txt: string, kind: 'hit' | 'heal' | 'ko'): void {
    const t = el('div', { class: `float-number is-${kind}` }, txt);
    t.style.left = `${Math.round(x)}px`;
    t.style.top = `${Math.round(y)}px`;
    t.style.animationDuration = `${900 / SPEED}ms`;
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
