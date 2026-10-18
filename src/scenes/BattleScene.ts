import Phaser from 'phaser';
import { getState } from '../core/state';
import type { BattleEvent } from '../core/battle';
import { simulateBattle } from '../core/battle';
import type { Character, Element, Squad } from '../core/types';
import type { Terrain } from '../core/terrain';
import { classOf } from '../data/registry';
import { weaponOf } from '../core/items';
import { squadMemberIds } from '../core/squad';
import { BattleStage } from '../gfx3d/stage';
import { frameAction, placements, WIDE } from '../gfx3d/layout';
import { declutter } from '../gfx/declutter';
import type { Placement } from '../gfx3d/layout';
import { spriteSetFor } from '../gfx3d/unitArt';
import { prepareSprites } from '../gfx3d/ob64Sprites';
import { drawPanel, FONT, SMALL_STYLE, TEXT_STYLE, hpColor } from '../gfx/ui';
import { exposeDebug, SPEED } from '../debug';

// Plays back one engagement on a 3D battlefield: the two formations face each
// other on ground shaped like the place they met, and the camera follows
// each blow. The battle has already been decided (simulateBattle); this
// scene acts out its event log. The 3D stage renders into its own canvas,
// shown here as a texture with the interface drawn over it.

interface Label {
  char: Character;
  name: Phaser.GameObjects.Text;
  hpBack: Phaser.GameObjects.Rectangle;
  hpFill: Phaser.GameObjects.Rectangle;
}

const W = 800;
const H = 600;

export class BattleScene extends Phaser.Scene {
  private attacker!: Squad;
  private defender!: Squad;
  private field: Terrain = 'plain';
  private stage: BattleStage | null = null;
  private screen: Phaser.Textures.CanvasTexture | null = null;
  private labels = new Map<number, Label>();
  private places = new Map<number, Placement>();
  private banner!: Phaser.GameObjects.Text;

  constructor() {
    super('Battle');
  }

  init(data: { attackerId: number; defenderId: number; field?: Terrain }): void {
    const st = getState();
    this.attacker = st.squads.find((s) => s.id === data.attackerId)!;
    this.defender = st.squads.find((s) => s.id === data.defenderId)!;
    this.field = data.field ?? 'plain';
  }

  create(): void {
    const st = getState();
    this.labels.clear();
    this.places.clear();
    this.time.timeScale = SPEED;
    this.tweens.timeScale = SPEED;

    const stage = new BattleStage(W, H);
    this.stage = stage;
    stage.setField(this.field, this.attacker.id * 31 + this.defender.id);
    if (this.textures.exists('battle3d')) this.textures.remove('battle3d');
    this.screen = this.textures.createCanvas('battle3d', W, H);
    this.add.image(0, 0, 'battle3d').setOrigin(0).setDepth(0);

    // Units appear once their sprites are ready: Ogre Battle 64's are fetched
    // and drawn for this battle; the original art is at hand already.
    const sides = [[this.attacker, 'left'], [this.defender, 'right']] as const;
    const wanted = sides.flatMap(([sq]) => squadMemberIds(sq).map((id) => ({
      def: classOf(st.chars.get(id)!.classId), side: sq.side,
    })));
    this.banner = this.add.text(W / 2, H - 26, 'The squads close...', { ...TEXT_STYLE, fontSize: '14px' }).setOrigin(0.5).setDepth(31);
    prepareSprites(wanted).finally(() => {
      if (this.stage === stage) this.begin(stage, sides);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.stage?.dispose();
      this.stage = null;
      this.screen = null;
      if (this.textures.exists('battle3d')) this.textures.remove('battle3d');
    });
  }

  private begin(stage: BattleStage, sides: readonly (readonly [Squad, 'left' | 'right'])[]): void {
    const st = getState();
    for (const [sq, side] of sides) {
      for (const [id, p] of placements(sq, side)) {
        const c = st.chars.get(id)!;
        if (c.hp <= 0) continue;
        this.places.set(id, p);
        stage.addUnit(id, spriteSetFor(this, classOf(c.classId), sq.side), p);
        this.labels.set(id, {
          char: c,
          name: this.add.text(0, 0, `${c.name} L${c.level}`, {
            ...SMALL_STYLE, fontSize: '9px', stroke: '#101020', strokeThickness: 3,
          }).setOrigin(0.5, 0).setDepth(20),
          hpBack: this.add.rectangle(0, 0, 40, 5, 0x101020).setDepth(20),
          hpFill: this.add.rectangle(0, 0, 40, 5, hpColor(c.hp / c.stats.hp)).setOrigin(0, 0.5).setDepth(21),
        });
      }
    }

    // Interface over the field: who fights whom, and what is happening.
    this.add.rectangle(W / 2, 30, W, 60, 0x101820, 0.72).setDepth(30);
    this.add.rectangle(W / 2, H - 26, W, 52, 0x101820, 0.72).setDepth(30);
    this.add.text(24, 12, this.headline(this.attacker), TEXT_STYLE).setDepth(31);
    this.add.text(W - 24, 12, this.headline(this.defender), TEXT_STYLE).setOrigin(1, 0).setDepth(31);
    this.add.text(24, 33, 'ATTACKER', { ...SMALL_STYLE, color: '#8ab0f0' }).setDepth(31);
    this.add.text(W - 24, 33, 'DEFENDER', { ...SMALL_STYLE, color: '#f0908a' }).setOrigin(1, 0).setDepth(31);
    this.banner.setText('The squads clash!');

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
    this.time.delayedCall(1250, () => {
      this.playEvents(result.events, 0, () => {
        this.stage?.cut(WIDE, 600);
        const winnerName =
          result.winner === 'attacker' ? this.attacker.name :
          result.winner === 'defender' ? this.defender.name : null;
        this.showOutcome(winnerName ? `${winnerName} wins the clash!` : 'Both sides withdraw...', result.levelUps);
        this.time.delayedCall(2000, () => {
          this.scene.stop();
          this.scene.resume('Overworld');
          this.game.events.emit('battle-done', {
            attackerId: this.attacker.id,
            defenderId: this.defender.id,
            winner: result.winner,
          });
        });
      });
    });
  }

  update(_time: number, delta: number): void {
    const stage = this.stage;
    if (!stage || !this.screen) return;
    stage.update(Math.min(delta, 50) * SPEED);
    const ctx = this.screen.getContext();
    ctx.drawImage(stage.canvas, 0, 0, W, H);
    this.screen.refresh();
    // Each unit's strength bar and name sit under its feet, moved clear of
    // one another where units stand close.
    const shown = [...this.labels].flatMap(([id, l]) => {
      const p = stage.project(id);
      return p && l.name.alpha > 0 ? [{ l, p }] : [];
    });
    const ys = declutter(shown.map(({ l, p }) => ({ x: p.x, y: p.y, w: Math.max(40, l.name.width), h: 18 })));
    shown.forEach(({ l, p }, k) => {
      const y = ys[k];
      const ratio = Math.max(0, l.char.hp / l.char.stats.hp);
      l.name.setPosition(p.x, y + 6);
      l.hpBack.setPosition(p.x, y + 2);
      l.hpFill.setPosition(p.x - 20, y + 2);
      l.hpFill.width = 40 * ratio;
      l.hpFill.fillColor = hpColor(ratio);
    });
  }

  private headline(sq: Squad): string {
    const st = getState();
    const leader = st.chars.get(sq.leaderId);
    const cls = leader ? classOf(leader.classId).name : '?';
    return `${sq.name}  (${leader?.name ?? '?'} the ${cls})`;
  }

  private playEvents(events: BattleEvent[], i: number, done: () => void): void {
    const stage = this.stage;
    if (!stage || i >= events.length) {
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
    this.banner.setText(`${actor.name}: ${attack.name}!`);
    const targets = [...new Set(ev.targetIds)].filter((id) => stage.has(id));
    stage.cut(frameAction(place, targets.map((t) => this.places.get(t)!).filter(Boolean)), 320);

    const blow = attack.type === 'melee' || attack.type === 'ranged';
    const element: Element | 'physical' = attack.element ?? (blow ? weaponOf(actor)?.element : undefined) ?? 'physical';
    let landed = false;
    const impact = () => {
      if (landed) return;
      landed = true;
      this.impact(ev, attack.type === 'heal', element);
      this.time.delayedCall(560, next);
    };

    this.time.delayedCall(300, () => {
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
        this.time.delayedCall(hit, () => {
          targets.forEach((t, k) => stage.projectile(ev.actorId, t, element, 300 + k * 40, impact, 1.1));
        });
      } else if (attack.type === 'heal') {
        const { hit } = stage.timing(ev.actorId, 'cast');
        stage.play(ev.actorId, 'cast');
        this.time.delayedCall(hit, () => {
          targets.forEach((t) => stage.burst(t, 'virtue', 'heal'));
          this.time.delayedCall(380, impact);
        });
      } else {
        const { hit } = stage.timing(ev.actorId, 'cast');
        stage.play(ev.actorId, 'cast');
        this.time.delayedCall(hit, () => {
          targets.forEach((t, k) => stage.projectile(ev.actorId, t, element, 420 + k * 30, impact, 0.5));
        });
      }
    });
  }

  /** Blows and spells land: flashes, numbers, health bars, the fallen tip over. */
  private impact(ev: Extract<BattleEvent, { kind: 'act' }>, heal: boolean, element: Element | 'physical'): void {
    const stage = this.stage;
    if (!stage) return;
    const seen = new Map<number, number>();
    ev.targetIds.forEach((id, k) => {
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      const p = stage.project(id);
      if (p) {
        this.floatNumber(p.x + (n % 3) * 14 - 14, p.headY - 8 - n * 12, `${heal ? '+' : ''}${ev.amounts[k]}`, heal ? '#90e090' : '#f0e090');
      }
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
      if (p) this.floatNumber(p.x, p.headY - 30, 'KO!', '#e05a48');
      const l = this.labels.get(id);
      if (l) this.tweens.add({ targets: [l.name, l.hpBack, l.hpFill], alpha: 0, duration: 400 });
    }
  }

  private floatNumber(x: number, y: number, txt: string, color: string): void {
    const t = this.add
      .text(x, y, txt, { fontFamily: FONT, fontSize: '16px', color, fontStyle: 'bold', stroke: '#101020', strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(40);
    this.tweens.add({ targets: t, y: y - 26, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }

  private showOutcome(msg: string, levelUps: Map<number, number>): void {
    drawPanel(this, W / 2 - 190, H / 2 - 60, 380, 120, { depth: 100 });
    const st = getState();
    const ups: string[] = [];
    for (const [id] of levelUps) {
      const c = st.chars.get(id);
      if (c) ups.push(`${c.name} reached Lv ${c.level}!`);
    }
    this.add.text(W / 2, H / 2 - 20, msg, { ...TEXT_STYLE, fontSize: '17px' }).setOrigin(0.5).setDepth(101);
    const extra = ups.slice(0, 3).join('\n');
    if (extra) {
      this.add.text(W / 2, H / 2 + 22, extra, { ...SMALL_STYLE, color: '#a0e0a0', align: 'center' }).setOrigin(0.5).setDepth(101);
    }
  }
}
