import Phaser from 'phaser';
import { getState } from '../core/state';
import type { Character, Element, Squad } from '../core/types';
import { CELL_ROW } from '../core/types';
import { classOf } from '../data/registry';
import { availablePromotions, allPromotions, makeCharacter, meetsReq, promote } from '../core/character';
import { autoPlace, marchOf, squadMemberIds, squadType, SQUAD_TYPE_LABEL } from '../core/squad';
import { allClasses } from '../data/registry';
import type { ClassDef } from '../core/types';
import { resolveAttack } from '../core/battle';
import { drawPanel, makeButton, SMALL_STYLE, TEXT_STYLE, TITLE_STYLE } from '../gfx/ui';

// Army organization: reposition members on the 3x3 grid, promote characters
// through the class tree, and recruit new tier-1 soldiers into a squad.

const PAGE = 7;

/** What it costs to enlist a recruit of a class: monsters and the large come dear. */
export function recruitCost(def: ClassDef): number {
  return def.gender === 'X' ? (def.size === 2 ? 260 : 160) : 90;
}

export class OrganizeScene extends Phaser.Scene {
  private squad: Squad | null = null;
  private selectedChar: Character | null = null;
  private dynamic: Phaser.GameObjects.GameObject[] = [];
  private promoPage = 0;
  private recruiting = false;
  private recruitPage = 0;

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
        this.recruiting = false;
        this.refresh();
      });
    });

    makeButton(this, 26, 470, 160, 38, 'RECRUIT', () => {
      this.recruiting = !this.recruiting;
      this.selectedChar = null;
      this.refresh();
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
    const members = squadMemberIds(sq).map((id) => st.chars.get(id)!);
    this.track(this.add.text(226, 68, `${sq.name} — ${SQUAD_TYPE_LABEL[squadType(members)].toUpperCase()}`, { ...SMALL_STYLE, color: '#c8b458' }));
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
      this.promoPage = 0;
      this.recruiting = false;
    } else if (this.selectedChar) {
      const from = this.squad.grid.indexOf(this.selectedChar.id);
      if (from >= 0) {
        this.squad.grid[from] = null;
        this.squad.grid[cell] = this.selectedChar.id;
      }
    }
    this.refresh();
  }

  /** A row of page arrows under a list, when the list runs past one page. */
  private pager(x: number, y: number, page: number, total: number, go: (page: number) => void): void {
    const pages = Math.ceil(total / PAGE);
    if (pages <= 1) return;
    const label = this.track(
      this.add.text(x + 126, y, `${page + 1} / ${pages}`, { ...SMALL_STYLE, fontSize: '10px', color: '#a8acc0' }).setOrigin(0.5, 0),
    );
    label.setDepth(1);
    const arrow = (dx: number, text: string, to: number) => {
      const a = this.track(this.add.text(x + 126 + dx, y - 2, text, { ...SMALL_STYLE, color: '#f0e090' }).setOrigin(0.5, 0));
      a.setInteractive({ useHandCursor: true });
      a.on('pointerdown', () => go((to + pages) % pages));
    };
    arrow(-52, '◀', page - 1);
    arrow(52, '▶', page + 1);
  }

  private drawRecruits(): void {
    const st = getState();
    const sq = this.squad!;
    const x = 524;
    this.track(drawPanel(this, 508, 56, 276, 460));
    this.track(this.add.text(x, 70, 'RECRUIT', { ...SMALL_STYLE, color: '#c8b458' }));
    const full = squadMemberIds(sq).length >= 5;
    this.track(this.add.text(x, 88, `Treasury ${st.goth} Goth · ${sq.name} ${full ? 'is full' : `${squadMemberIds(sq).length}/5`}`, {
      ...SMALL_STYLE, fontSize: '10px', color: full ? '#e09090' : '#a8acc0',
    }));
    const pool = allClasses()
      .filter((d) => d.tier === 1 && d.playable)
      .sort((a, b) => recruitCost(a) - recruitCost(b) || a.name.localeCompare(b.name));
    pool.slice(this.recruitPage * PAGE, (this.recruitPage + 1) * PAGE).forEach((def, i) => {
      const y = 112 + i * 52;
      const cost = recruitCost(def);
      const ok = !full && st.goth >= cost;
      const box = this.track(
        this.add.rectangle(x + 126, y + 20, 252, 46, ok ? 0x22324a : 0x1a2038).setStrokeStyle(1, ok ? 0x8098c8 : 0x484a6a),
      );
      this.track(this.add.image(x + 18, y + 18, `unit-${def.palette}`).setScale(2));
      this.track(this.add.text(x + 40, y + 2, def.name, { ...SMALL_STYLE, fontSize: '11px', color: ok ? '#e0e8f8' : '#8890a8' }));
      const from = def.origin === 'snes' ? 'Ogre Battle (SNES)' : def.origin === 'sow' ? 'Symphony of War' : def.source === 'ob64' ? 'Ogre Battle 64' : 'Palatinus';
      this.track(this.add.text(x + 40, y + 17, `${SQUAD_TYPE_LABEL[marchOf(def)]} · ${from}`, {
        ...SMALL_STYLE, fontSize: '9px', color: '#8890a8',
      }));
      this.track(this.add.text(x + 40, y + 29, `${cost} Goth${def.size === 2 ? ' · Large' : ''}`, {
        ...SMALL_STYLE, fontSize: '9px', color: '#c8b458',
      }));
      if (ok) {
        box.setInteractive({ useHandCursor: true });
        box.on('pointerdown', () => {
          const recruit = makeCharacter(def.id, 3);
          if (!autoPlace(sq, recruit)) return;
          st.chars.set(recruit.id, recruit);
          st.goth -= cost;
          this.refresh();
        });
        this.track(this.add.text(x + 200, y + 2, 'ENLIST', { ...SMALL_STYLE, fontSize: '9px', color: '#f0e090' }));
      }
    });
    this.pager(x, 482, this.recruitPage, pool.length, (p) => {
      this.recruitPage = p;
      this.refresh();
    });
  }

  private drawSheet(): void {
    if (this.recruiting) {
      this.drawRecruits();
      return;
    }
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
    this.track(this.add.text(x + 44, 74, c.name, TEXT_STYLE));
    this.track(this.add.text(x + 44, 93, `${def.name}  Lv ${c.level}`, { ...SMALL_STYLE, color: '#c8b458' }));
    const tags = [cap(c.element), def.size === 2 ? 'Large' : '', SQUAD_TYPE_LABEL[marchOf(def)]]
      .filter(Boolean).join(' · ');
    this.track(this.add.text(x + 44, 108, tags, { ...SMALL_STYLE, fontSize: '10px', color: ELEMENT_COLOR[c.element] }));

    const aliWord = c.ali >= 60 ? 'Lawful' : c.ali <= 40 ? 'Chaotic' : 'Neutral';
    this.track(
      this.add.text(
        x, 128,
        `HP ${c.hp}/${c.stats.hp}\n` +
        `STR ${pad(c.stats.str)} VIT ${pad(c.stats.vit)} INT ${pad(c.stats.int)}\n` +
        `MEN ${pad(c.stats.men)} AGI ${pad(c.stats.agi)} DEX ${pad(c.stats.dex)}\n` +
        `ALI ${c.ali} (${aliWord})  LUK ${c.luk}  Kills ${c.kills}`,
        { ...SMALL_STYLE, lineSpacing: 3 },
      ),
    );

    // attacks by row, as this character actually makes them
    const rows = (['front', 'mid', 'back'] as const)
      .map((r) => {
        const slot = def.attacks[r];
        if (!slot) return `${r.toUpperCase().padEnd(5)} —`;
        const a = resolveAttack(slot, c);
        return `${r.toUpperCase().padEnd(5)} ${a.name} x${a.count}`;
      })
      .join('\n');
    this.track(this.add.text(x, 204, rows, { ...SMALL_STYLE, fontSize: '10px', color: '#a8c8e8', lineSpacing: 3 }));

    // promotions
    this.track(this.add.text(x, 254, 'CLASS CHANGE', { ...SMALL_STYLE, color: '#c8b458' }));
    const promos = allPromotions(c);
    if (promos.length === 0) {
      this.track(this.add.text(x, 274, 'This class has mastered its path.', { ...SMALL_STYLE, fontSize: '10px', color: '#8890a8' }));
      return;
    }
    const eligible = new Set(availablePromotions(c).map((p) => p.classId));
    const page = Math.min(this.promoPage, Math.ceil(promos.length / PAGE) - 1);
    this.pager(x, 482, page, promos.length, (p) => {
      this.promoPage = p;
      this.refresh();
    });
    promos.slice(page * PAGE, (page + 1) * PAGE).forEach((req, i) => {
      const target = classOf(req.classId);
      const ok = eligible.has(req.classId);
      const y = 274 + i * 29;
      const gates = Object.entries(req.stats ?? {}).map(([k, v]) => `${k.toUpperCase()}${v}`);
      const ali = req.aliMin !== undefined && req.aliMax !== undefined
        ? `ALI${req.aliMin}-${req.aliMax}`
        : req.aliMin !== undefined ? `ALI${req.aliMin}+` : req.aliMax !== undefined ? `ALI${req.aliMax}-` : '';
      const reqs = [`Lv${req.level}`, ...gates, ali, req.item ? `needs ${req.item}` : ''].filter(Boolean).join(' ');
      const box = this.track(
        this.add.rectangle(x + 126, y + 11, 252, 27, ok ? 0x2a4a2a : 0x1a2038).setStrokeStyle(1, ok ? 0x90e090 : 0x484a6a),
      );
      this.track(this.add.image(x + 12, y + 11, `unit-${target.palette}`).setScale(1.3));
      this.track(
        this.add.text(x + 26, y, target.name, { ...SMALL_STYLE, fontSize: '10px', color: ok ? '#c0f0c0' : '#a8acc0' }),
      );
      this.track(this.add.text(x + 26, y + 12, reqs, { ...SMALL_STYLE, fontSize: '9px', color: '#8890a8' }));
      if (ok && meetsReq(c, req)) {
        box.setInteractive({ useHandCursor: true });
        box.on('pointerdown', () => {
          promote(c, req.classId);
          this.refresh();
        });
        this.track(this.add.text(x + 206, y + 1, 'PROMOTE', { ...SMALL_STYLE, fontSize: '9px', color: '#f0e090' }));
      }
    });
  }
}

function pad(n: number): string {
  return String(n).padStart(3, ' ');
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const ELEMENT_COLOR: Record<Element, string> = {
  wind: '#a8e0f0', flame: '#f0a070', earth: '#c8b078', water: '#88b0f0',
  virtue: '#f0e8a8', bane: '#c090e0', drakonite: '#e0c060',
};
