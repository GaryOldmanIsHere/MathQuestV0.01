import Phaser from 'phaser';
import { getState } from '../core/state';
import type { Character, ClassDef, Element, Squad } from '../core/types';
import { RESIST_KEYS } from '../core/types';
import { allClasses, classOf, itemOf } from '../data/registry';
import { allPromotions, availablePromotions, makeCharacter, promote, routeItemId } from '../core/character';
import {
  autoPlace, cellsOf, marchOf, placeAt, placesUsed, SQUAD_PLACES, squadMemberIds, squadType, SQUAD_TYPE_LABEL,
} from '../core/squad';
import { resolveAttack } from '../core/battle';
import {
  buy, canEquip, effectiveResist, effectiveStats, effectiveLuck, equip, gearBonus, itemSummary, sell, sellPrice,
  shopRank, shopStock, SLOTS, typeLabel, unequip, useItem, weaponOf,
} from '../core/items';
import type { ItemDef, Slot } from '../core/items';
import { rallyHome } from '../core/camp';
import { drawPanel, makeButton, SMALL_STYLE, TEXT_STYLE, TITLE_STYLE } from '../gfx/ui';
import { unitIcon } from '../gfx/unitIcon';

// Army organization: reposition members on the 3x3 grid, read and change a
// unit's gear, promote it through the class tree, use and sell items, buy
// from the army's shop, and recruit new tier-1 soldiers into a squad.

/** What it costs to enlist a recruit of a class: monsters and the large come dear. */
export function recruitCost(def: ClassDef): number {
  return def.gender === 'X' ? (def.size === 2 ? 260 : 160) : 90;
}

type Mode = 'sheet' | 'recruit' | 'shop' | 'items';
type Tab = 'status' | 'gear' | 'class';
type ShopFilter = 'supplies' | 'weapons' | 'armour' | 'other';

const X = 524; // left edge of the right-hand panel's content
const SLOT_LABEL: Record<Slot, string> = { weapon: 'WEAPON', body: 'BODY', offhand: 'OFF HAND', head: 'HEAD' };

export class OrganizeScene extends Phaser.Scene {
  private squad: Squad | null = null;
  private selectedChar: Character | null = null;
  private dynamic: Phaser.GameObjects.GameObject[] = [];
  private mode: Mode = 'sheet';
  private tab: Tab = 'status';
  private slot: Slot | null = null;
  private page = 0;
  private filter: ShopFilter = 'supplies';
  private message = '';

  constructor() {
    super('Organize');
  }

  create(): void {
    const st = getState();
    const { width: W, height: H } = this.scale;
    this.add.rectangle(W / 2, H / 2, W, H, 0x0c1024, 0.97);
    this.add.text(W / 2, 28, 'ORGANIZE  ARMY', TITLE_STYLE).setOrigin(0.5);

    drawPanel(this, 16, 56, 180, 460);
    this.add.text(30, 68, 'SQUADS', { ...SMALL_STYLE, color: '#c8b458' });
    const playerSquads = st.squads.filter((s) => s.side === 'player');
    playerSquads.slice(0, 6).forEach((sq, i) => {
      makeButton(this, 26, 90 + i * 42, 160, 34, sq.name, () => {
        this.squad = sq;
        this.selectedChar = null;
        if (this.mode === 'sheet') this.page = 0;
        this.refresh();
      });
    });

    const modeButton = (y: number, label: string, mode: Mode) =>
      makeButton(this, 26, y, 160, 38, label, () => {
        this.mode = this.mode === mode ? 'sheet' : mode;
        this.page = 0;
        this.message = '';
        this.refresh();
      });
    modeButton(378, 'SHOP', 'shop');
    modeButton(424, 'ITEMS', 'items');
    modeButton(470, 'RECRUIT', 'recruit');

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

  private text(x: number, y: number, s: string, color = '#c8c8d8', size = 11): Phaser.GameObjects.Text {
    return this.track(this.add.text(x, y, s, { ...SMALL_STYLE, fontSize: `${size}px`, color }));
  }

  /** A clickable row box. */
  private row(y: number, h: number, active: boolean, onClick?: () => void, highlight = false): void {
    const box = this.track(
      this.add.rectangle(X + 126, y + h / 2, 252, h - 3, highlight ? 0x34486e : active ? 0x22324a : 0x1a2038)
        .setStrokeStyle(1, highlight ? 0xf0e090 : active ? 0x8098c8 : 0x484a6a),
    );
    if (onClick) {
      box.setInteractive({ useHandCursor: true });
      box.on('pointerdown', onClick);
    }
  }

  private refresh(): void {
    this.clearDynamic();
    if (!this.squad) return;
    this.drawGrid(this.squad);
    this.drawInfo(this.squad);
    this.track(drawPanel(this, 508, 56, 276, 460));
    if (this.mode === 'recruit') this.drawRecruits();
    else if (this.mode === 'shop') this.drawShop();
    else if (this.mode === 'items') this.drawItems();
    else this.drawSheet();
  }

  // ---------------------------------------------------------------- grid --

  private drawGrid(sq: Squad): void {
    const st = getState();
    this.track(drawPanel(this, 212, 56, 280, 340));
    const members = squadMemberIds(sq).map((id) => st.chars.get(id)!);
    this.text(226, 68, `${sq.name} — ${SQUAD_TYPE_LABEL[squadType(members)].toUpperCase()}`, '#c8b458');
    (['BACK', 'MID', 'FRONT'] as const).forEach((label, col) => {
      this.track(this.add.text(260 + col * 88, 94, label, { ...SMALL_STYLE, fontSize: '10px', color: '#8890a8' }).setOrigin(0.5));
    });
    const at = (cell: number) => ({ x: 260 + (cell % 3) * 88, y: 140 + Math.floor(cell / 3) * 88 });
    for (let cell = 0; cell < 9; cell++) {
      const { x, y } = at(cell);
      const id = sq.grid[cell];
      const isSel = id !== null && this.selectedChar?.id === id;
      const box = this.track(
        this.add.rectangle(x, y, 78, 78, isSel ? 0x3a4a88 : 0x1a2448).setStrokeStyle(2, isSel ? 0xf0e090 : 0x686a8a),
      );
      box.setInteractive({ useHandCursor: true });
      box.on('pointerdown', () => this.onCellClick(cell));
    }
    for (const c of members) {
      const cells = cellsOf(sq, c.id);
      const xs = cells.map((cl) => at(cl).x);
      const x = xs.reduce((a, b) => a + b, 0) / xs.length;
      const { y } = at(cells[0]);
      const large = cells.length > 1;
      const sprite = this.track(unitIcon(this, x, y - (large ? 14 : 10), classOf(c.classId).palette, large ? 58 : 42));
      if (c.hp <= 0) sprite.setAlpha(0.35).setAngle(90);
      this.track(this.add.text(x, y + 26, c.hp <= 0 ? `${c.name} (fallen)` : c.name, {
        ...SMALL_STYLE, fontSize: '9px', color: c.hp <= 0 ? '#c08080' : '#c8c8d8',
      }).setOrigin(0.5));
      if (c.id === sq.leaderId) this.track(this.add.text(xs[0] - 32, y - 34, '★', { ...SMALL_STYLE, color: '#f0e090' }));
    }
    this.track(this.add.text(352, 376, 'Click a member, then an empty cell to move them.\nColumn decides their battle row.', {
      ...SMALL_STYLE, fontSize: '10px', color: '#8890a8', align: 'center',
    }).setOrigin(0.5));
  }

  private drawInfo(sq: Squad): void {
    const st = getState();
    this.track(drawPanel(this, 212, 404, 280, 112));
    const owned = st.nodes.filter((n) => n.owner === 'player').length;
    this.text(226, 416, `Places ${placesUsed(sq)}/${SQUAD_PLACES} · Large units fill two`, '#a8acc0', 10);
    this.text(226, 432, `Treasury ${st.goth} Goth · Shop rank ${shopRank(owned)}`, '#c8b458', 10);
    const held = Object.values(st.inventory).reduce((a, b) => a + b, 0);
    this.text(226, 448, `Items carried: ${held}`, '#a8acc0', 10);
    if (this.message) {
      this.track(this.add.text(226, 466, this.message, {
        ...SMALL_STYLE, fontSize: '10px', color: '#a0e0a0', wordWrap: { width: 252 },
      }));
    }
  }

  private onCellClick(cell: number): void {
    if (!this.squad) return;
    const st = getState();
    const id = this.squad.grid[cell];
    if (id !== null) {
      if (this.selectedChar?.id !== id) {
        this.selectedChar = st.chars.get(id)!;
        this.slot = null;
        if (this.mode === 'sheet') this.page = 0;
        if (this.mode === 'recruit') this.mode = 'sheet';
      }
    } else if (this.selectedChar && this.squad.grid.includes(this.selectedChar.id)) {
      if (!placeAt(this.squad, this.selectedChar, cell)) this.message = 'No room there for a large unit.';
      else this.message = '';
    }
    this.refresh();
  }

  /** Page arrows under a list, when the list runs past one page. */
  private pager(y: number, page: number, total: number, size: number, go: (page: number) => void): void {
    const pages = Math.ceil(total / size);
    if (pages <= 1) return;
    this.track(this.add.text(X + 126, y, `${page + 1} / ${pages}`, { ...SMALL_STYLE, fontSize: '10px', color: '#a8acc0' }).setOrigin(0.5, 0));
    const arrow = (dx: number, s: string, to: number) => {
      const a = this.track(this.add.text(X + 126 + dx, y - 2, s, { ...SMALL_STYLE, color: '#f0e090' }).setOrigin(0.5, 0));
      a.setInteractive({ useHandCursor: true });
      a.on('pointerdown', () => go((to + pages) % pages));
    };
    arrow(-52, '◀', page - 1);
    arrow(52, '▶', page + 1);
  }

  private paged<T>(list: T[], size: number): T[] {
    const pages = Math.max(1, Math.ceil(list.length / size));
    this.page = Math.min(this.page, pages - 1);
    this.pager(484, this.page, list.length, size, (p) => {
      this.page = p;
      this.refresh();
    });
    return list.slice(this.page * size, (this.page + 1) * size);
  }

  // --------------------------------------------------------------- sheet --

  private drawSheet(): void {
    const c = this.selectedChar;
    if (!c) {
      this.track(this.add.text(646, 260, 'Select a member\nto view their sheet.', { ...SMALL_STYLE, align: 'center' }).setOrigin(0.5));
      return;
    }
    const def = classOf(c.classId);
    this.track(unitIcon(this, X + 16, 96, def.palette, 50));
    this.track(this.add.text(X + 44, 72, c.name, TEXT_STYLE));
    this.text(X + 44, 90, `${def.name}  Lv ${c.level}`, '#c8b458');
    const tags = [cap(c.element), def.size === 2 ? 'Large' : '', SQUAD_TYPE_LABEL[marchOf(def)]].filter(Boolean).join(' · ');
    this.text(X + 44, 105, tags, ELEMENT_COLOR[c.element], 10);

    (['status', 'gear', 'class'] as Tab[]).forEach((t, i) => {
      const on = this.tab === t;
      const label = this.track(this.add.text(X + 4 + i * 84, 126, t.toUpperCase(), {
        ...SMALL_STYLE, color: on ? '#f0e090' : '#8890a8', backgroundColor: on ? '#2a3a68' : undefined, padding: { x: 6, y: 2 },
      }));
      label.setInteractive({ useHandCursor: true });
      label.on('pointerdown', () => {
        this.tab = t;
        this.page = 0;
        this.slot = null;
        this.refresh();
      });
    });

    if (this.tab === 'status') this.drawStatus(c, def);
    else if (this.tab === 'gear') this.drawGear(c);
    else this.drawClassChange(c);
  }

  private drawStatus(c: Character, def: ClassDef): void {
    const eff = effectiveStats(c);
    const b = gearBonus(c);
    const stat = (k: 'str' | 'vit' | 'int' | 'men' | 'agi' | 'dex') =>
      `${k.toUpperCase()} ${pad(eff[k])}${b[k] ? (b[k] > 0 ? `(+${b[k]})` : `(${b[k]})`) : ''}`.padEnd(14);
    const aliWord = c.ali >= 60 ? 'Lawful' : c.ali <= 40 ? 'Chaotic' : 'Neutral';
    this.text(X, 154,
      `HP ${c.hp}/${c.stats.hp}${c.hp <= 0 ? '  FALLEN' : ''}\n` +
      `${stat('str')}${stat('vit')}\n${stat('int')}${stat('men')}\n${stat('agi')}${stat('dex')}\n` +
      `ALI ${c.ali} (${aliWord})  LUK ${effectiveLuck(c)}  Kills ${c.kills}`, '#c8c8d8', 11)
      .setLineSpacing(3);

    this.text(X, 246, 'RESISTANCE', '#c8b458', 10);
    const res = effectiveResist(c);
    const short: Record<string, string> = { physical: 'PHY', wind: 'WND', flame: 'FLM', earth: 'ERT', water: 'WTR', virtue: 'VIR', bane: 'BAN' };
    RESIST_KEYS.forEach((k, i) => {
      const v = res[k];
      const color = v >= 60 ? '#a0e0a0' : v <= 40 ? '#e0a0a0' : '#c8c8d8';
      this.text(X + (i % 4) * 63, 262 + Math.floor(i / 4) * 15, `${short[k]} ${v}`, color, 10);
    });

    this.text(X, 304, 'ATTACKS', '#c8b458', 10);
    const weapon = weaponOf(c);
    (['front', 'mid', 'back'] as const).forEach((r, i) => {
      const slot = def.attacks[r];
      let line = `${r.toUpperCase().padEnd(5)} —`;
      if (slot) {
        const a = resolveAttack(slot, c);
        const elem = a.element ?? ((a.type === 'melee' || a.type === 'ranged') ? weapon?.element : undefined);
        line = `${r.toUpperCase().padEnd(5)} ${a.name} x${a.count}${elem ? ` · ${cap(elem)}` : ''}`;
      }
      this.text(X, 320 + i * 15, line, '#a8c8e8', 10);
    });
    if (def.desc) {
      this.track(this.add.text(X, 374, def.desc, { ...SMALL_STYLE, fontSize: '9px', color: '#8890a8', wordWrap: { width: 250 } }));
    }
  }

  private drawGear(c: Character): void {
    const st = getState();
    SLOTS.forEach((slot, i) => {
      const y = 152 + i * 40;
      const id = c.gear[slot];
      const item = id ? itemOf(id) : null;
      this.row(y, 40, true, () => {
        this.slot = this.slot === slot ? null : slot;
        this.page = 0;
        this.refresh();
      }, this.slot === slot);
      this.text(X + 6, y + 4, SLOT_LABEL[slot], '#8890a8', 9);
      this.text(X + 70, y + 4, item ? item.name : '—', item ? '#e0e8f8' : '#686a8a', 11);
      if (item) this.text(X + 6, y + 20, `${item.type ? typeLabel(item.type) : ''}  ${itemSummary(item)}`.slice(0, 44), '#a8c8e8', 9);
    });
    if (!this.slot) {
      this.text(X, 320, 'Click a place to change what is worn there.', '#8890a8', 10);
      return;
    }
    const slot = this.slot;
    this.text(X, 316, `EQUIP IN ${SLOT_LABEL[slot]}`, '#c8b458', 10);
    const options: (ItemDef | null)[] = [
      ...(c.gear[slot] ? [null] : []),
      ...Object.keys(st.inventory).map(itemOf).filter((i) => canEquip(c, i, slot))
        .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name)),
    ];
    if (!options.length) {
      this.text(X, 334, 'Nothing carried fits here. The shop sells gear.', '#8890a8', 10);
      return;
    }
    this.paged(options, 6).forEach((item, i) => {
      const y = 334 + i * 24;
      this.row(y, 24, true, () => {
        if (item) equip(c, item.id, slot, st.inventory);
        else unequip(c, slot, st.inventory);
        this.message = item ? `${c.name} equips: ${item.name}.` : `${c.name} takes it off.`;
        this.refresh();
      });
      if (!item) this.text(X + 6, y + 5, '(take it off)', '#e0b0a0', 10);
      else this.text(X + 6, y + 5, `${item.name} ×${st.inventory[item.id]}  ${itemSummary(item)}`.slice(0, 46), '#e0e8f8', 10);
    });
  }

  private drawClassChange(c: Character): void {
    const st = getState();
    const promos = allPromotions(c);
    if (promos.length === 0) {
      this.text(X, 156, 'This class has mastered its path.', '#8890a8', 10);
      return;
    }
    const eligible = new Set(availablePromotions(c, st.inventory).map((p) => p.classId));
    this.paged(promos, 11).forEach((req, i) => {
      const target = classOf(req.classId);
      const ok = eligible.has(req.classId);
      const y = 152 + i * 30;
      const gates = Object.entries(req.stats ?? {}).map(([k, v]) => `${k.toUpperCase()}${v}`);
      const ali = req.aliMin !== undefined && req.aliMax !== undefined
        ? `ALI${req.aliMin}-${req.aliMax}`
        : req.aliMin !== undefined ? `ALI${req.aliMin}+` : req.aliMax !== undefined ? `ALI${req.aliMax}-` : '';
      const itemId = routeItemId(req);
      const item = req.item ? `${req.item} (${itemId ? st.inventory[itemId] ?? 0 : 0})` : '';
      const reqs = [`Lv${req.level}`, ...gates, ali, item].filter(Boolean).join(' ');
      this.row(y, 30, ok, ok ? () => {
        promote(c, req.classId, st.inventory);
        this.message = `${c.name} is now a ${target.name}.`;
        this.refresh();
      } : undefined);
      this.track(unitIcon(this, X + 12, y + 14, target.palette, 22));
      this.text(X + 26, y + 2, target.name, ok ? '#c0f0c0' : '#a8acc0', 10);
      this.text(X + 26, y + 15, reqs, '#8890a8', 9);
      if (ok) this.text(X + 200, y + 3, 'PROMOTE', '#f0e090', 9);
    });
  }

  // ---------------------------------------------------------------- items --

  private drawItems(): void {
    const st = getState();
    const sq = this.squad!;
    const c = this.selectedChar;
    this.text(X, 70, 'ITEMS', '#c8b458');
    this.text(X, 88, c ? `Using on ${c.name} (${sq.name})` : `Select a member to use items on`, '#a8acc0', 10);
    const order = { supply: 0, relic: 1, key: 2, gear: 3 };
    const held = Object.keys(st.inventory).map(itemOf)
      .sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
    if (!held.length) {
      this.text(X, 112, 'The army carries nothing.', '#8890a8', 10);
      return;
    }
    this.paged(held, 10).forEach((item, i) => {
      const y = 106 + i * 37;
      const usable = !!c && (item.kind === 'supply' || item.kind === 'relic');
      this.row(y, 37, usable);
      this.text(X + 6, y + 3, `${item.name} ×${st.inventory[item.id]}`, '#e0e8f8', 10);
      this.text(X + 6, y + 18, itemSummary(item).slice(0, 34), '#8890a8', 9);
      if (usable) {
        const use = this.text(X + 182, y + 3, 'USE', '#f0e090', 10);
        use.setInteractive({ useHandCursor: true });
        use.on('pointerdown', () => {
          const squadChars = squadMemberIds(sq).map((id) => st.chars.get(id)!);
          const ordered = [st.chars.get(sq.leaderId)!, ...squadChars.filter((m) => m.id !== sq.leaderId)];
          const result = useItem(item.id, c!, ordered, st.inventory);
          if (result && item.effect?.rally) rallyHome(st, sq);
          this.message = result ?? `The ${item.name} would do nothing now.`;
          this.refresh();
        });
      }
      const sale = this.text(X + 214, y + 3, `SELL`, '#c0a0e0', 10);
      sale.setInteractive({ useHandCursor: true });
      sale.on('pointerdown', () => {
        sell(item.id, st.inventory, st);
        this.message = `Sold: ${item.name}, for ${sellPrice(item)} Goth.`;
        this.refresh();
      });
      this.text(X + 214, y + 18, `${sellPrice(item)}g`, '#8890a8', 9);
    });
  }

  // ----------------------------------------------------------------- shop --

  private drawShop(): void {
    const st = getState();
    const rank = shopRank(st.nodes.filter((n) => n.owner === 'player').length);
    this.text(X, 70, `SHOP · rank ${rank}`, '#c8b458');
    this.text(X + 130, 70, `${st.goth} Goth`, '#e0d080');
    (['supplies', 'weapons', 'armour', 'other'] as ShopFilter[]).forEach((f, i) => {
      const on = this.filter === f;
      const t = this.track(this.add.text(X + i * 63, 88, f.toUpperCase(), {
        ...SMALL_STYLE, fontSize: '10px', color: on ? '#f0e090' : '#8890a8', backgroundColor: on ? '#2a3a68' : undefined, padding: { x: 3, y: 1 },
      }));
      t.setInteractive({ useHandCursor: true });
      t.on('pointerdown', () => {
        this.filter = f;
        this.page = 0;
        this.refresh();
      });
    });
    const weapons = new Set(['sword', 'greatsword', 'rapier', 'axe', 'hammer', 'spear', 'whip', 'claw', 'bow', 'mace', 'staff', 'doll', 'fan']);
    const armour = new Set(['light', 'medium', 'heavy', 'robe', 'clothing', 'shield', 'greatshield', 'helm', 'hat']);
    const stock = shopStock(rank).filter((i) =>
      this.filter === 'supplies' ? i.kind === 'supply'
        : this.filter === 'weapons' ? i.kind === 'gear' && weapons.has(i.type!)
          : this.filter === 'armour' ? i.kind === 'gear' && armour.has(i.type!)
            : i.kind === 'key' || i.kind === 'relic' || (i.kind === 'gear' && (i.type === 'book' || i.type === 'accessory')));
    const c = this.selectedChar;
    if (!stock.length) {
      this.text(X, 112, 'Nothing of this kind at this rank yet.', '#8890a8', 10);
      return;
    }
    this.paged(stock, 10).forEach((item, i) => {
      const y = 106 + i * 37;
      const ok = st.goth >= item.price;
      this.row(y, 37, ok, ok ? () => {
        buy(item.id, st.inventory, st);
        this.message = `Bought: ${item.name}.`;
        this.refresh();
      } : undefined);
      const fits = c && item.kind === 'gear' && SLOTS.some((s) => canEquip(c, item, s));
      this.text(X + 6, y + 3, `${item.name}${fits ? ' ✓' : ''}`, ok ? '#e0e8f8' : '#8890a8', 10);
      this.text(X + 6, y + 18, `${item.type ? typeLabel(item.type) + ' ' : ''}${itemSummary(item)}`.slice(0, 40), '#8890a8', 9);
      this.text(X + 196, y + 3, `${item.price}g`, ok ? '#e0d080' : '#806848', 10);
    });
  }

  // -------------------------------------------------------------- recruit --

  private drawRecruits(): void {
    const st = getState();
    const sq = this.squad!;
    this.text(X, 70, 'RECRUIT', '#c8b458');
    const room = SQUAD_PLACES - placesUsed(sq);
    this.text(X, 88, `Treasury ${st.goth} Goth · ${sq.name} ${room ? `has ${room} place${room > 1 ? 's' : ''}` : 'is full'}`,
      room ? '#a8acc0' : '#e09090', 10);
    const pool = allClasses()
      .filter((d) => d.tier === 1 && d.playable)
      .sort((a, b) => recruitCost(a) - recruitCost(b) || a.name.localeCompare(b.name));
    this.paged(pool, 7).forEach((def, i) => {
      const y = 108 + i * 53;
      const cost = recruitCost(def);
      const ok = room >= def.size && st.goth >= cost;
      this.row(y, 50, ok, ok ? () => {
        const recruit = makeCharacter(def.id, 3);
        if (!autoPlace(sq, recruit)) return;
        st.chars.set(recruit.id, recruit);
        st.goth -= cost;
        this.message = `${recruit.name} the ${def.name} joins ${sq.name}.`;
        this.refresh();
      } : undefined);
      this.track(unitIcon(this, X + 18, y + 22, def.palette, 34));
      this.text(X + 40, y + 4, def.name, ok ? '#e0e8f8' : '#8890a8', 11);
      const from = def.origin === 'snes' ? 'Ogre Battle (SNES)' : def.origin === 'sow' ? 'Symphony of War' : def.source === 'ob64' ? 'Ogre Battle 64' : 'Palatinus';
      this.text(X + 40, y + 19, `${SQUAD_TYPE_LABEL[marchOf(def)]} · ${from}`, '#8890a8', 9);
      this.text(X + 40, y + 31, `${cost} Goth${def.size === 2 ? ' · Large' : ''}`, '#c8b458', 9);
      if (ok) this.text(X + 200, y + 4, 'ENLIST', '#f0e090', 9);
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
