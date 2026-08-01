import Phaser from 'phaser';
import { getState } from '../core/state';
import type { Character, Squad } from '../core/types';
import { CELL_ROW } from '../core/types';
import { classOf } from '../data/classes';
import { availablePromotions, allPromotions, meetsReq, promote } from '../core/character';
import { squadMemberIds } from '../core/squad';
import { drawPanel, makeButton, SMALL_STYLE, TEXT_STYLE, TITLE_STYLE } from '../gfx/ui';

// Army organization: reposition members on the 3x3 grid and promote
// characters through the class tree.

export class OrganizeScene extends Phaser.Scene {
  private squad: Squad | null = null;
  private selectedChar: Character | null = null;
  private dynamic: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('Organize');
  }

  create(): void {
    const st = getState();
    const { width: W, height: H } = this.scale;
    this.add.rectangle(W / 2, H / 2, W, H, 0x0c1024, 0.97);
    this.add.text(W / 2, 28, 'ORGANIZE  ARMY', TITLE_STYLE).setOrigin(0.5);

    // squad roster (left column)
    drawPanel(this, 16, 56, 180, 460);
    this.add.text(30, 68, 'SQUADS', { ...SMALL_STYLE, color: '#c8b458' });
    const playerSquads = st.squads.filter((s) => s.side === 'player');
    playerSquads.forEach((sq, i) => {
      makeButton(this, 26, 92 + i * 46, 160, 38, sq.name, () => {
        this.squad = sq;
        this.selectedChar = null;
        this.refresh();
      });
    });

    makeButton(this, 16, 528, 180, 40, 'BACK TO MAP', () => {
      this.scene.stop();
      this.scene.resume('Overworld');
    });

    this.squad = playerSquads[0] ?? null;
    this.refresh();
  }

  private clearDynamic(): void {
    for (const o of this.dynamic) o.destroy();
    this.dynamic = [];
  }

  private track<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.dynamic.push(o);
    return o;
  }

  private refresh(): void {
    this.clearDynamic();
    if (!this.squad) return;
    const st = getState();
    const sq = this.squad;

    // formation grid (center)
    this.track(drawPanel(this, 212, 56, 280, 340));
    this.track(this.add.text(226, 68, `${sq.name} — FORMATION`, { ...SMALL_STYLE, color: '#c8b458' }));
    (['BACK', 'MID', 'FRONT'] as const).forEach((label, col) => {
      this.track(
        this.add
          .text(260 + col * 88, 94, label, { ...SMALL_STYLE, fontSize: '10px', color: '#8890a8' })
          .setOrigin(0.5),
      );
    });

    for (let cell = 0; cell < 9; cell++) {
      const col = cell % 3;
      const r = Math.floor(cell / 3);
      const x = 260 + col * 88;
      const y = 140 + r * 88;
      const id = sq.grid[cell];
      const isSel = id !== null && this.selectedChar?.id === id;
      const box = this.track(
        this.add.rectangle(x, y, 78, 78, isSel ? 0x3a4a88 : 0x1a2448).setStrokeStyle(2, isSel ? 0xf0e090 : 0x686a8a),
      );
      box.setInteractive({ useHandCursor: true });
      box.on('pointerdown', () => this.onCellClick(cell));
      if (id !== null) {
        const c = st.chars.get(id)!;
        this.track(this.add.image(x, y - 10, `unit-${classOf(c.classId).palette}`).setScale(2.6));
        this.track(
          this.add
            .text(x, y + 26, c.name, { ...SMALL_STYLE, fontSize: '9px' })
            .setOrigin(0.5),
        );
        if (id === sq.leaderId) {
          this.track(this.add.text(x - 32, y - 34, '★', { ...SMALL_STYLE, color: '#f0e090' }));
        }
      }
    }
    this.track(
      this.add.text(352, 376, 'Click a member, then an empty cell to move them.\nColumn decides their battle row.', {
        ...SMALL_STYLE,
        fontSize: '10px',
        color: '#8890a8',
        align: 'center',
      }).setOrigin(0.5),
    );

    this.drawSheet();
  }

  private onCellClick(cell: number): void {
    if (!this.squad) return;
    const st = getState();
    const id = this.squad.grid[cell];
    if (id !== null) {
      this.selectedChar = st.chars.get(id)!;
    } else if (this.selectedChar) {
      const from = this.squad.grid.indexOf(this.selectedChar.id);
      if (from >= 0) {
        this.squad.grid[from] = null;
        this.squad.grid[cell] = this.selectedChar.id;
      }
    }
    this.refresh();
  }

  private drawSheet(): void {
    const c = this.selectedChar;
    this.track(drawPanel(this, 508, 56, 276, 460));
    if (!c) {
      this.track(
        this.add.text(646, 260, 'Select a member\nto view their sheet.', { ...SMALL_STYLE, align: 'center' }).setOrigin(0.5),
      );
      return;
    }
    const def = classOf(c.classId);
    const x = 524;
    this.track(this.add.image(x + 16, 96, `unit-${def.palette}`).setScale(3.2));
    this.track(this.add.text(x + 44, 76, c.name, TEXT_STYLE));
    this.track(this.add.text(x + 44, 96, `${def.name}  Lv ${c.level}`, { ...SMALL_STYLE, color: '#c8b458' }));
    const aliWord = c.ali >= 60 ? 'Lawful' : c.ali <= 40 ? 'Chaotic' : 'Neutral';
    this.track(
      this.add.text(
        x, 130,
        `HP ${c.hp}/${c.stats.hp}   STR ${c.stats.str}  VIT ${c.stats.vit}\n` +
        `INT ${c.stats.int}  MEN ${c.stats.men}  AGI ${c.stats.agi}\n` +
        `CHA ${c.cha}   ALI ${c.ali} (${aliWord})   Kills ${c.kills}`,
        { ...SMALL_STYLE, lineSpacing: 4 },
      ),
    );
    this.track(this.add.text(x, 186, def.desc, { ...SMALL_STYLE, fontSize: '10px', color: '#8890a8', wordWrap: { width: 250 } }));

    // attacks by row
    const rows = (['front', 'mid', 'back'] as const)
      .map((r) => {
        const a = def.attacks[r];
        return a ? `${r.toUpperCase().padEnd(5)} ${a.name} x${a.count}` : `${r.toUpperCase().padEnd(5)} —`;
      })
      .join('\n');
    this.track(this.add.text(x, 226, rows, { ...SMALL_STYLE, fontSize: '10px', color: '#a8c8e8', lineSpacing: 3 }));

    // promotions
    this.track(this.add.text(x, 288, 'CLASS CHANGE', { ...SMALL_STYLE, color: '#c8b458' }));
    const promos = allPromotions(c);
    if (promos.length === 0) {
      this.track(this.add.text(x, 308, 'This class has mastered its path.', { ...SMALL_STYLE, fontSize: '10px', color: '#8890a8' }));
      return;
    }
    const eligible = new Set(availablePromotions(c).map((p) => p.classId));
    promos.slice(0, 5).forEach((req, i) => {
      const target = classOf(req.classId);
      const ok = eligible.has(req.classId);
      const y = 310 + i * 40;
      const reqs = [
        `Lv${req.level}`,
        req.cha !== undefined ? `CHA${req.cha}+` : '',
        req.aliMin !== undefined && req.aliMax !== undefined
          ? `ALI ${req.aliMin}-${req.aliMax}`
          : req.aliMin !== undefined
            ? `ALI ${req.aliMin}+`
            : req.aliMax !== undefined
              ? `ALI ${req.aliMax}-`
              : '',
      ].filter(Boolean).join('  ');
      const box = this.track(
        this.add.rectangle(x + 126, y + 10, 252, 34, ok ? 0x2a4a2a : 0x1a2038).setStrokeStyle(1, ok ? 0x90e090 : 0x484a6a),
      );
      this.track(this.add.image(x + 18, y + 10, `unit-${target.palette}`).setScale(1.8));
      this.track(
        this.add.text(x + 36, y - 2, target.name, { ...SMALL_STYLE, fontSize: '11px', color: ok ? '#c0f0c0' : '#8890a8' }),
      );
      this.track(this.add.text(x + 36, y + 12, reqs, { ...SMALL_STYLE, fontSize: '9px', color: '#8890a8' }));
      if (ok && meetsReq(c, req)) {
        box.setInteractive({ useHandCursor: true });
        box.on('pointerdown', () => {
          promote(c, req.classId);
          this.refresh();
        });
        this.track(this.add.text(x + 210, y + 4, 'PROMOTE', { ...SMALL_STYLE, fontSize: '9px', color: '#f0e090' }));
      }
    });
  }
}
