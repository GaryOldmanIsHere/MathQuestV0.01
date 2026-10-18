import Phaser from 'phaser';
import { getState } from '../core/state';
import type { BattleEvent } from '../core/battle';
import { simulateBattle } from '../core/battle';
import type { Character, Squad } from '../core/types';
import { classOf } from '../data/registry';
import { drawPanel, FONT, SMALL_STYLE, TEXT_STYLE, hpColor } from '../gfx/ui';

// Plays back one engagement: two 3x3 formations face each other and the
// pre-simulated event log animates strike by strike.

interface FighterView {
  char: Character;
  sprite: Phaser.GameObjects.Image;
  hpFill: Phaser.GameObjects.Rectangle;
  /** everything that should fade out with the sprite when the unit falls */
  trappings: Phaser.GameObjects.GameObject[];
  baseX: number;
  baseY: number;
  facing: 1 | -1;
}

export class BattleScene extends Phaser.Scene {
  private attacker!: Squad;
  private defender!: Squad;
  private views = new Map<number, FighterView>();
  private banner!: Phaser.GameObjects.Text;

  constructor() {
    super('Battle');
  }

  init(data: { attackerId: number; defenderId: number }): void {
    const st = getState();
    this.attacker = st.squads.find((s) => s.id === data.attackerId)!;
    this.defender = st.squads.find((s) => s.id === data.defenderId)!;
  }

  create(): void {
    const st = getState();
    this.views.clear();
    const { width: W, height: H } = this.scale;

    // Battlefield backdrop: a full grass field with only sparse darker patches.
    // The combatants have to read clearly against it, so the ground stays quiet.
    for (let y = 0; y < H; y += 16) {
      for (let x = 0; x < W; x += 16) {
        this.add.image(x + 8, y + 8, 'tile-grass');
      }
    }
    for (let y = 0; y < H; y += 16) {
      for (let x = 0; x < W; x += 16) {
        const h = Math.abs(Math.sin(x * 3.7 + y * 9.1) * 43758.5) % 1;
        if (h > 0.88) this.add.image(x + 8, y + 8, 'tile-forest').setAlpha(0.55);
      }
    }
    // vignette so the centre of the field carries the eye
    this.add.rectangle(W / 2, H / 2, W, H, 0x0c1408, 0.22);
    this.add.rectangle(W / 2, 40, W, 80, 0x101820, 0.85);
    this.add.rectangle(W / 2, H - 30, W, 60, 0x101820, 0.85);

    this.add.text(30, 18, this.headline(this.attacker), TEXT_STYLE);
    this.add.text(W - 30, 18, this.headline(this.defender), TEXT_STYLE).setOrigin(1, 0);
    this.add.text(30, 40, 'ATTACKER', { ...SMALL_STYLE, color: '#8ab0f0' });
    this.add.text(W - 30, 40, 'DEFENDER', { ...SMALL_STYLE, color: '#f0908a' }).setOrigin(1, 0);

    this.layoutSide(this.attacker, true);
    this.layoutSide(this.defender, false);

    this.banner = this.add
      .text(W / 2, H - 30, 'The squads clash!', { ...TEXT_STYLE, fontSize: '14px' })
      .setOrigin(0.5)
      .setDepth(100);

    // Run the simulation up front, then animate the log.
    const chars = st.chars;
    const result = simulateBattle(
      { squad: this.attacker, chars },
      { squad: this.defender, chars },
    );

    this.time.delayedCall(700, () => {
      this.playEvents(result.events, 0, () => {
        const winnerName =
          result.winner === 'attacker' ? this.attacker.name :
          result.winner === 'defender' ? this.defender.name : null;
        const msg = winnerName ? `${winnerName} wins the clash!` : 'Both sides withdraw...';
        this.showOutcome(msg, result.levelUps);
        this.time.delayedCall(1900, () => {
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

  private headline(sq: Squad): string {
    const st = getState();
    const leader = st.chars.get(sq.leaderId);
    const cls = leader ? classOf(leader.classId).name : '?';
    return `${sq.name}  (${leader?.name ?? '?'} the ${cls})`;
  }

  private layoutSide(sq: Squad, isLeft: boolean): void {
    const st = getState();
    const { width: W, height: H } = this.scale;
    const cx = isLeft ? W / 2 - 190 : W / 2 + 190;
    const cy = H / 2 + 10;
    const facing: 1 | -1 = isLeft ? 1 : -1;
    for (let cell = 0; cell < 9; cell++) {
      const id = sq.grid[cell];
      const col = cell % 3; // 0 back, 1 mid, 2 front
      const r = Math.floor(cell / 3);
      // front column is nearest the center line
      const x = cx + facing * (col - 1) * 70;
      const y = cy + (r - 1) * 95;
      if (id === null) continue;
      const char = st.chars.get(id)!;
      if (char.hp <= 0) continue;
      // ground shadow, only under a combatant who is actually standing there
      const shadow = this.add.ellipse(x, y + 16, 46, 12, 0x000000, 0.3).setDepth(1);
      const palette = classOf(char.classId).palette;
      const sprite = this.add.image(x, y - 12, `unit-${palette}`).setScale(3.4).setDepth(10);
      sprite.setFlipX(!isLeft);
      const hpBack = this.add.rectangle(x, y + 26, 44, 5, 0x101020).setDepth(11);
      const hpFill = this.add.rectangle(x - 22, y + 26, 44, 5, 0x58c858).setOrigin(0, 0.5).setDepth(12);
      hpFill.width = 44 * (char.hp / char.stats.hp);
      const label = this.add
        .text(x, y + 34, `${char.name} L${char.level}`, { ...SMALL_STYLE, fontSize: '9px', stroke: '#101020', strokeThickness: 3 })
        .setOrigin(0.5)
        .setDepth(11);
      this.views.set(char.id, {
        char, sprite, hpFill,
        trappings: [hpBack, hpFill, label, shadow],
        baseX: x, baseY: y - 12, facing,
      });
    }
  }

  private playEvents(events: BattleEvent[], i: number, done: () => void): void {
    if (i >= events.length) {
      done();
      return;
    }
    const ev = events[i];
    if (ev.kind === 'skip' || ev.kind === 'end') {
      this.playEvents(events, i + 1, done);
      return;
    }
    const actor = this.views.get(ev.actorId);
    if (!actor) {
      this.playEvents(events, i + 1, done);
      return;
    }

    this.banner.setText(`${actor.char.name}: ${ev.attack.name}!`);
    const isHeal = ev.attack.type === 'heal';
    const lungeX = actor.baseX + actor.facing * (ev.attack.type === 'melee' ? 26 : 10);

    this.tweens.add({
      targets: actor.sprite,
      x: lungeX,
      duration: 110,
      yoyo: true,
      onComplete: () => {
        // impact flashes + floating numbers, then hp bars settle
        const seen = new Set<number>();
        for (let k = 0; k < ev.targetIds.length; k++) {
          const tv = this.views.get(ev.targetIds[k]);
          if (!tv) continue;
          const jitter = seen.has(ev.targetIds[k]) ? (k % 3) * 12 - 12 : 0;
          seen.add(ev.targetIds[k]);
          this.floatNumber(tv.baseX + jitter, tv.baseY - 30 - (k % 3) * 10, `${isHeal ? '+' : ''}${ev.amounts[k]}`, isHeal ? '#90e090' : '#f0e090');
          if (!isHeal) {
            // multiply tint rather than fill: the unit still reads as itself
            // while it flashes, instead of blanking to a white silhouette
            tv.sprite.setTint(0xff7a6a);
            this.time.delayedCall(110, () => tv.sprite.clearTint());
          }
          const ratio = Math.max(0, tv.char.hp / tv.char.stats.hp);
          tv.hpFill.width = 44 * ratio;
          tv.hpFill.fillColor = hpColor(ratio);
        }
        for (const koId of ev.kos) {
          const kv = this.views.get(koId);
          if (kv) {
            this.tweens.add({ targets: kv.sprite, alpha: 0, angle: 90, duration: 380 });
            this.tweens.add({ targets: kv.trappings, alpha: 0, duration: 380 });
            this.floatNumber(kv.baseX, kv.baseY - 46, 'KO!', '#e05a48');
          }
        }
        this.time.delayedCall(420, () => this.playEvents(events, i + 1, done));
      },
    });
  }

  private floatNumber(x: number, y: number, txt: string, color: string): void {
    const t = this.add
      .text(x, y, txt, { fontFamily: FONT, fontSize: '15px', color, fontStyle: 'bold', stroke: '#101020', strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(60);
    this.tweens.add({ targets: t, y: y - 26, alpha: 0, duration: 850, onComplete: () => t.destroy() });
  }

  private showOutcome(msg: string, levelUps: Map<number, number>): void {
    const { width: W, height: H } = this.scale;
    drawPanel(this, W / 2 - 190, H / 2 - 60, 380, 120, { depth: 100 });
    const st = getState();
    const ups: string[] = [];
    for (const [id] of levelUps) {
      const c = st.chars.get(id);
      if (c) ups.push(`${c.name} reached Lv ${c.level}!`);
    }
    const extra = ups.slice(0, 3).join('\n');
    this.add
      .text(W / 2, H / 2 - 20, msg, { ...TEXT_STYLE, fontSize: '17px' })
      .setOrigin(0.5)
      .setDepth(101);
    if (extra) {
      this.add
        .text(W / 2, H / 2 + 22, extra, { ...SMALL_STYLE, color: '#a0e0a0', align: 'center' })
        .setOrigin(0.5)
        .setDepth(101);
    }
  }
}
