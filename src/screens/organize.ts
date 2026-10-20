import type { App, Screen } from '../app/app';
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
import { dismissMember, makeLeader, rallyHome } from '../core/camp';
import { unitIcon } from '../gfx/unitIcon';
import { button, el, fill } from '../ui/dom';

// Army organization: reposition members on the 3x3 grid, read and change a
// unit's gear, promote it through the class tree, use and sell items, buy
// from the army's shop, and recruit new tier-1 soldiers into a squad. It
// opens over the map, which waits, darkened, behind it.

/** What it costs to enlist a recruit of a class: monsters and the large come dear. */
export function recruitCost(def: ClassDef): number {
  return def.gender === 'X' ? (def.size === 2 ? 260 : 160) : 90;
}

type Mode = 'sheet' | 'recruit' | 'shop' | 'items';
type Tab = 'status' | 'gear' | 'class';
type ShopFilter = 'supplies' | 'weapons' | 'armour' | 'other';

const SLOT_LABEL: Record<Slot, string> = { weapon: 'Weapon', body: 'Body', offhand: 'Off hand', head: 'Head' };
const WEAPONS = new Set(['sword', 'greatsword', 'rapier', 'axe', 'hammer', 'spear', 'whip', 'claw', 'bow', 'mace', 'staff', 'doll', 'fan']);
const ARMOUR = new Set(['light', 'medium', 'heavy', 'robe', 'clothing', 'shield', 'greatshield', 'helm', 'hat']);

export class OrganizeScreen implements Screen {
  readonly name = 'Organize' as const;
  readonly root: HTMLElement;
  squad: Squad | null = null;
  selectedChar: Character | null = null;
  mode: Mode = 'sheet';
  tab: Tab = 'status';
  slot: Slot | null = null;
  filter: ShopFilter = 'supplies';
  message = '';
  /** A dismissal asked for once, awaiting its confirmation. */
  private dismissing: number | null = null;
  private formation = el('div', { class: 'org-formation panel' });
  private info = el('div', { class: 'org-info panel', ui: 'org-info' });
  private side = el('div', { class: 'org-side panel', ui: 'org-side' });
  private squadButtons: HTMLButtonElement[] = [];
  private modeButtons = new Map<Mode, HTMLButtonElement>();

  constructor(private app: App) {
    const st = getState();
    const playerSquads = st.squads.filter((s) => s.side === 'player');
    this.squadButtons = playerSquads.slice(0, 6).map((sq, i) => button(sq.name, () => {
      this.squad = sq;
      this.selectedChar = null;
      this.refresh();
    }, { ui: `squad-${i}`, class: 'org-squad' }));
    const modeButton = (label: string, mode: Mode) => {
      const b = button(label, () => {
        this.mode = this.mode === mode ? 'sheet' : mode;
        this.message = '';
        this.refresh();
      }, { ui: `mode-${mode}`, class: 'org-mode' });
      this.modeButtons.set(mode, b);
      return b;
    };
    this.root = el('div', { class: 'screen organize-screen', ui: 'organize' },
      el('h1', { class: 'org-title' }, 'Organize army'),
      el('div', { class: 'org-layout' },
        el('nav', { class: 'org-nav panel' },
          el('div', { class: 'label' }, 'Squads'),
          el('div', { class: 'org-squads' }, ...this.squadButtons),
          el('div', { class: 'org-modes' }, modeButton('Shop', 'shop'), modeButton('Items', 'items'), modeButton('Recruit', 'recruit')),
          button('Back to map', () => this.app.close(this), { ui: 'back-to-map', class: 'btn-primary org-back' }),
        ),
        el('div', { class: 'org-centre' }, this.formation, this.info),
        this.side,
      ),
    );
    window.addEventListener('keydown', this.onKey);
    this.squad = playerSquads[0] ?? null;
    this.refresh();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape') this.app.close(this);
  };

  view(): null {
    return null;
  }

  update(): void {
    // The army screen changes only when the player acts.
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
  }

  private refresh(): void {
    if (!this.squad) return;
    this.squadButtons.forEach((b) => b.classList.toggle('is-on', b.textContent === this.squad?.name));
    for (const [m, b] of this.modeButtons) b.classList.toggle('is-on', this.mode === m);
    this.drawGrid(this.squad);
    this.drawInfo(this.squad);
    if (this.mode === 'recruit') this.drawRecruits();
    else if (this.mode === 'shop') this.drawShop();
    else if (this.mode === 'items') this.drawItems();
    else this.drawSheet();
  }

  // ------------------------------------------------------------------ grid --

  private drawGrid(sq: Squad): void {
    const st = getState();
    const members = squadMemberIds(sq).map((id) => st.chars.get(id)!);
    const cells: HTMLElement[] = [];
    for (let cell = 0; cell < 9; cell++) {
      const id = sq.grid[cell];
      const isSel = id !== null && this.selectedChar?.id === id;
      cells.push(el('button', {
        type: 'button', class: `org-cell ${isSel ? 'is-selected' : ''} ${id === null ? 'is-empty' : ''}`, ui: `cell-${cell}`,
        'aria-label': id === null ? `Empty cell ${cell + 1}` : `${st.chars.get(id)?.name}`,
        on: { click: () => this.onCellClick(cell) },
      }));
    }
    // Members drawn over their cells; a large unit spans two.
    for (const c of members) {
      const at = cellsOf(sq, c.id);
      const first = cells[at[0]];
      const large = at.length > 1;
      const figure = el('div', { class: `org-member ${large ? 'is-large' : ''} ${c.hp <= 0 ? 'is-fallen' : ''}` },
        unitIcon(classOf(c.classId).palette, large ? 74 : 60),
        el('span', { class: 'org-member-name' }, c.hp <= 0 ? `${c.name} (fallen)` : c.name),
        c.id === sq.leaderId ? el('span', { class: 'org-leader', title: 'Leader' }, '★') : null,
      );
      first.append(figure);
      if (large) for (const k of at.slice(1)) cells[k].classList.add('is-covered');
    }
    fill(this.formation,
      el('div', { class: 'org-formation-head' },
        el('h2', {}, sq.name),
        el('span', { class: 'chip' }, SQUAD_TYPE_LABEL[squadType(members)]),
      ),
      el('div', { class: 'org-rows', 'aria-hidden': 'true' }, el('span', {}, 'Back'), el('span', {}, 'Mid'), el('span', {}, 'Front')),
      el('div', { class: 'org-grid' }, ...cells),
      el('p', { class: 'hint' }, 'Pick a member, then an empty cell. Its column sets its battle row.'),
    );
  }

  private drawInfo(sq: Squad): void {
    const st = getState();
    const owned = st.nodes.filter((n) => n.owner === 'player').length;
    const held = Object.values(st.inventory).reduce((a, b) => a + b, 0);
    fill(this.info,
      el('div', {}, `Places ${placesUsed(sq)}/${SQUAD_PLACES} · Large units fill two`),
      el('div', { class: 'gold' }, `Treasury ${st.goth} Goth · Shop rank ${shopRank(owned)}`),
      el('div', {}, `Items carried: ${held}`),
      this.message ? el('div', { class: 'org-message', ui: 'message' }, this.message) : null,
    );
  }

  private onCellClick(cell: number): void {
    if (!this.squad) return;
    const st = getState();
    const id = this.squad.grid[cell];
    if (id !== null) {
      if (this.selectedChar?.id !== id) {
        this.selectedChar = st.chars.get(id)!;
        this.dismissing = null;
        this.slot = null;
        if (this.mode === 'recruit') this.mode = 'sheet';
      }
    } else if (this.selectedChar && this.squad.grid.includes(this.selectedChar.id)) {
      if (!placeAt(this.squad, this.selectedChar, cell)) this.message = 'No room there for a large unit.';
      else this.message = '';
    }
    this.refresh();
  }

  // ------------------------------------------------------------------ sheet --

  private drawSheet(): void {
    const c = this.selectedChar;
    if (!c) {
      fill(this.side, el('p', { class: 'org-empty' }, 'Select a member to view their sheet.'));
      return;
    }
    const def = classOf(c.classId);
    const tags = [cap(c.element), def.size === 2 ? 'Large' : '', SQUAD_TYPE_LABEL[marchOf(def)]].filter(Boolean).join(' · ');
    const tabs = (['status', 'gear', 'class'] as Tab[]).map((t) => el('button', {
      type: 'button', class: `tab ${this.tab === t ? 'is-on' : ''}`, ui: `tab-${t}`, role: 'tab', 'aria-selected': String(this.tab === t),
      on: { click: () => { this.tab = t; this.slot = null; this.refresh(); } },
    }, cap(t)));
    const body = this.tab === 'status' ? this.drawStatus(c, def) : this.tab === 'gear' ? this.drawGear(c) : this.drawClassChange(c);
    fill(this.side,
      el('div', { class: 'sheet-head' },
        el('div', { class: 'sheet-portrait' }, unitIcon(def.palette, 58)),
        el('div', { class: 'sheet-id' },
          el('h2', {}, c.name),
          el('div', { class: 'gold' }, `${def.name} · Lv ${c.level}`),
          el('div', { class: 'sheet-tags', style: { color: ELEMENT_COLOR[c.element] } }, tags),
        ),
        this.memberActions(c),
      ),
      el('div', { class: 'tabs', role: 'tablist' }, ...tabs),
      body,
    );
  }

  /**
   * Leading and leaving: any standing member can be made the squad's
   * leader; any but the leader can be dismissed (asked twice), freeing their
   * places for a recruit and returning their gear to the stores.
   */
  private memberActions(c: Character): HTMLElement {
    const sq = this.squad;
    if (!sq || c.id === sq.leaderId) return el('div', { class: 'sheet-actions' }, el('span', { class: 'chip gold' }, 'Leader'));
    const st = getState();
    const asked = this.dismissing === c.id;
    return el('div', { class: 'sheet-actions' },
      c.hp > 0 ? button('Lead', () => {
        makeLeader(st, sq, c.id);
        this.message = `${c.name} now leads ${sq.name}.`;
        this.refresh();
      }, { ui: 'lead', class: 'btn-small' }) : null,
      button(asked ? 'Sure?' : 'Dismiss', () => {
        if (!asked) {
          this.dismissing = c.id;
          this.refresh();
          return;
        }
        this.dismissing = null;
        if (dismissMember(st, sq, c.id)) {
          this.message = `${c.name} leaves the army; their gear goes to the stores.`;
          this.selectedChar = null;
        }
        this.refresh();
      }, { ui: 'dismiss', class: `btn-small ${asked ? 'btn-danger' : ''}` }),
    );
  }

  private drawStatus(c: Character, def: ClassDef): HTMLElement {
    const eff = effectiveStats(c);
    const b = gearBonus(c);
    const stat = (k: 'str' | 'vit' | 'int' | 'men' | 'agi' | 'dex') => el('div', { class: 'stat' },
      el('span', { class: 'k' }, k.toUpperCase()),
      el('span', { class: 'v' }, eff[k]),
      b[k] ? el('span', { class: b[k] > 0 ? 'up' : 'down' }, b[k] > 0 ? `+${b[k]}` : `${b[k]}`) : null,
    );
    const aliWord = c.ali >= 60 ? 'Lawful' : c.ali <= 40 ? 'Chaotic' : 'Neutral';
    const res = effectiveResist(c);
    const short: Record<string, string> = { physical: 'PHY', wind: 'WND', flame: 'FLM', earth: 'ERT', water: 'WTR', virtue: 'VIR', bane: 'BAN' };
    const weapon = weaponOf(c);
    return el('div', { class: 'sheet-body', ui: 'status' },
      el('div', { class: 'hp-line' }, `HP ${c.hp}/${c.stats.hp}`, c.hp <= 0 ? el('span', { class: 'bad' }, ' Fallen') : null),
      el('div', { class: 'stats' }, ...(['str', 'vit', 'int', 'men', 'agi', 'dex'] as const).map(stat)),
      el('div', { class: 'muted' }, `ALI ${c.ali} (${aliWord}) · LUK ${effectiveLuck(c)} · Kills ${c.kills}`),
      el('h3', {}, 'Resistance'),
      el('div', { class: 'resists' }, ...RESIST_KEYS.map((k) => {
        const v = res[k];
        return el('span', { class: v >= 60 ? 'good' : v <= 40 ? 'bad' : '' }, `${short[k]} ${v}`);
      })),
      el('h3', {}, 'Attacks'),
      el('div', { class: 'attacks' }, ...(['front', 'mid', 'back'] as const).map((r) => {
        const slot = def.attacks[r];
        let line = '—';
        if (slot) {
          const a = resolveAttack(slot, c);
          const elem = a.element ?? ((a.type === 'melee' || a.type === 'ranged') ? weapon?.element : undefined);
          line = `${a.name} ×${a.count}${elem ? ` · ${cap(elem)}` : ''}`;
        }
        return el('div', {}, el('span', { class: 'k' }, cap(r)), line);
      })),
      def.desc ? el('p', { class: 'muted small' }, def.desc) : null,
    );
  }

  private drawGear(c: Character): HTMLElement {
    const st = getState();
    const slots = SLOTS.map((slot) => {
      const id = c.gear[slot];
      const item = id ? itemOf(id) : null;
      return el('button', {
        type: 'button', class: `row ${this.slot === slot ? 'is-on' : ''}`, ui: `slot-${slot}`,
        on: { click: () => { this.slot = this.slot === slot ? null : slot; this.refresh(); } },
      },
        el('span', { class: 'k' }, SLOT_LABEL[slot]),
        el('span', { class: item ? 'v' : 'muted' }, item ? item.name : '—'),
        item ? el('span', { class: 'sub' }, `${item.type ? typeLabel(item.type) : ''} ${itemSummary(item)}`.trim()) : null,
      );
    });
    const out = el('div', { class: 'sheet-body', ui: 'gear' }, el('div', { class: 'rows' }, ...slots));
    if (!this.slot) {
      out.append(el('p', { class: 'muted' }, 'Choose a place to change what is worn there.'));
      return out;
    }
    const slot = this.slot;
    const options: (ItemDef | null)[] = [
      ...(c.gear[slot] ? [null] : []),
      ...Object.keys(st.inventory).map(itemOf).filter((i) => canEquip(c, i, slot))
        .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name)),
    ];
    out.append(el('h3', {}, `Equip in ${SLOT_LABEL[slot]}`));
    if (!options.length) {
      out.append(el('p', { class: 'muted' }, 'Nothing carried fits here. The shop sells gear.'));
      return out;
    }
    out.append(el('div', { class: 'rows scroll' }, ...options.map((item) => el('button', {
      type: 'button', class: 'row', ui: item ? `equip-${item.id}` : 'unequip',
      on: {
        click: () => {
          if (item) equip(c, item.id, slot, st.inventory);
          else unequip(c, slot, st.inventory);
          this.message = item ? `${c.name} equips: ${item.name}.` : `${c.name} takes it off.`;
          this.refresh();
        },
      },
    },
    item ? el('span', { class: 'v' }, `${item.name} ×${st.inventory[item.id]}`) : el('span', { class: 'warn' }, 'Take it off'),
    item ? el('span', { class: 'sub' }, itemSummary(item)) : null))));
    return out;
  }

  private drawClassChange(c: Character): HTMLElement {
    const st = getState();
    const promos = allPromotions(c);
    if (promos.length === 0) return el('div', { class: 'sheet-body' }, el('p', { class: 'muted' }, 'This class has mastered its path.'));
    const eligible = new Set(availablePromotions(c, st.inventory).map((p) => p.classId));
    return el('div', { class: 'sheet-body rows scroll', ui: 'class' }, ...promos.map((req) => {
      const target = classOf(req.classId);
      const ok = eligible.has(req.classId);
      const gates = Object.entries(req.stats ?? {}).map(([k, v]) => `${k.toUpperCase()} ${v}`);
      const ali = req.aliMin !== undefined && req.aliMax !== undefined
        ? `ALI ${req.aliMin}–${req.aliMax}`
        : req.aliMin !== undefined ? `ALI ${req.aliMin}+` : req.aliMax !== undefined ? `ALI ${req.aliMax}−` : '';
      const itemId = routeItemId(req);
      const item = req.item ? `${req.item} (${itemId ? st.inventory[itemId] ?? 0 : 0})` : '';
      const reqs = [`Lv ${req.level}`, ...gates, ali, item].filter(Boolean).join(' · ');
      return el('button', {
        type: 'button', class: `row promo ${ok ? 'is-ready' : ''}`, ui: `class-${req.classId}`, disabled: !ok,
        on: {
          click: () => {
            if (!ok) return;
            promote(c, req.classId, st.inventory);
            this.message = `${c.name} is now a ${target.name}.`;
            this.refresh();
          },
        },
      },
        unitIcon(target.palette, 26),
        el('span', { class: 'v' }, target.name),
        el('span', { class: 'sub' }, reqs),
        ok ? el('span', { class: 'chip gold' }, 'Promote') : null,
      );
    }));
  }

  // ------------------------------------------------------------------ items --

  private drawItems(): void {
    const st = getState();
    const sq = this.squad!;
    const c = this.selectedChar;
    const order = { supply: 0, relic: 1, key: 2, gear: 3 };
    const held = Object.keys(st.inventory).map(itemOf)
      .sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
    fill(this.side,
      el('h2', {}, 'Items'),
      el('p', { class: 'muted' }, c ? `Using on ${c.name} (${sq.name})` : 'Select a member to use items on'),
      !held.length ? el('p', { class: 'muted' }, 'The army carries nothing.') : el('div', { class: 'rows scroll', ui: 'items' }, ...held.map((item) => {
        const usable = !!c && (item.kind === 'supply' || item.kind === 'relic');
        return el('div', { class: 'row item-row', ui: `item-${item.id}` },
          el('span', { class: 'v' }, `${item.name} ×${st.inventory[item.id]}`),
          el('span', { class: 'sub' }, itemSummary(item)),
          el('span', { class: 'row-actions' },
            usable ? button('Use', () => {
              const squadChars = squadMemberIds(sq).map((id) => st.chars.get(id)!);
              const ordered = [st.chars.get(sq.leaderId)!, ...squadChars.filter((m) => m.id !== sq.leaderId)];
              const result = useItem(item.id, c!, ordered, st.inventory);
              if (result && item.effect?.rally) rallyHome(st, sq);
              this.message = result ?? `The ${item.name} would do nothing now.`;
              this.refresh();
            }, { ui: `use-${item.id}`, class: 'btn-small' }) : null,
            button(`Sell ${sellPrice(item)}g`, () => {
              sell(item.id, st.inventory, st);
              this.message = `Sold: ${item.name}, for ${sellPrice(item)} Goth.`;
              this.refresh();
            }, { ui: `sell-${item.id}`, class: 'btn-small btn-quiet' }),
          ),
        );
      })),
    );
  }

  // ------------------------------------------------------------------- shop --

  private drawShop(): void {
    const st = getState();
    const rank = shopRank(st.nodes.filter((n) => n.owner === 'player').length);
    const stock = shopStock(rank).filter((i) =>
      this.filter === 'supplies' ? i.kind === 'supply'
        : this.filter === 'weapons' ? i.kind === 'gear' && WEAPONS.has(i.type!)
          : this.filter === 'armour' ? i.kind === 'gear' && ARMOUR.has(i.type!)
            : i.kind === 'key' || i.kind === 'relic' || (i.kind === 'gear' && (i.type === 'book' || i.type === 'accessory')));
    const c = this.selectedChar;
    fill(this.side,
      el('div', { class: 'shop-head' }, el('h2', {}, `Shop · rank ${rank}`), el('span', { class: 'gold' }, `${st.goth} Goth`)),
      el('div', { class: 'tabs', role: 'tablist' }, ...(['supplies', 'weapons', 'armour', 'other'] as ShopFilter[]).map((f) => el('button', {
        type: 'button', class: `tab ${this.filter === f ? 'is-on' : ''}`, ui: `filter-${f}`, role: 'tab', 'aria-selected': String(this.filter === f),
        on: { click: () => { this.filter = f; this.refresh(); } },
      }, cap(f)))),
      !stock.length ? el('p', { class: 'muted' }, 'Nothing of this kind at this rank yet.') : el('div', { class: 'rows scroll', ui: 'stock' }, ...stock.map((item) => {
        const ok = st.goth >= item.price;
        const fits = c && item.kind === 'gear' && SLOTS.some((s) => canEquip(c, item, s));
        return el('button', {
          type: 'button', class: 'row', ui: `buy-${item.id}`, disabled: !ok,
          on: {
            click: () => {
              if (!ok) return;
              buy(item.id, st.inventory, st);
              this.message = `Bought: ${item.name}.`;
              this.refresh();
            },
          },
        },
          el('span', { class: 'v' }, `${item.name}${fits ? ' ✓' : ''}`),
          el('span', { class: 'sub' }, `${item.type ? typeLabel(item.type) + ' ' : ''}${itemSummary(item)}`),
          el('span', { class: ok ? 'price gold' : 'price muted' }, `${item.price}g`),
        );
      })),
    );
  }

  // ---------------------------------------------------------------- recruit --

  private drawRecruits(): void {
    const st = getState();
    const sq = this.squad!;
    const room = SQUAD_PLACES - placesUsed(sq);
    const pool = allClasses()
      .filter((d) => d.tier === 1 && d.playable)
      .sort((a, b) => recruitCost(a) - recruitCost(b) || a.name.localeCompare(b.name));
    fill(this.side,
      el('h2', {}, 'Recruit'),
      el('p', { class: room ? 'muted' : 'bad' }, `Treasury ${st.goth} Goth · ${sq.name} ${room ? `has ${room} place${room > 1 ? 's' : ''}` : 'is full'}`),
      el('div', { class: 'rows scroll', ui: 'recruits' }, ...pool.map((def) => {
        const cost = recruitCost(def);
        const ok = room >= def.size && st.goth >= cost;
        const from = def.origin === 'snes' ? 'Ogre Battle (SNES)' : def.origin === 'sow' ? 'Symphony of War' : def.source === 'ob64' ? 'Ogre Battle 64' : 'Palatinus';
        return el('button', {
          type: 'button', class: 'row recruit', ui: `enlist-${def.id}`, disabled: !ok,
          on: {
            click: () => {
              if (!ok) return;
              const recruit = makeCharacter(def.id, 3);
              if (!autoPlace(sq, recruit)) return;
              st.chars.set(recruit.id, recruit);
              st.goth -= cost;
              this.message = `${recruit.name} the ${def.name} joins ${sq.name}.`;
              this.refresh();
            },
          },
        },
          unitIcon(def.palette, 34),
          el('span', { class: 'v' }, def.name),
          el('span', { class: 'sub' }, `${SQUAD_TYPE_LABEL[marchOf(def)]} · ${from}`),
          el('span', { class: 'price gold' }, `${cost} Goth${def.size === 2 ? ' · Large' : ''}`),
        );
      })),
    );
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const ELEMENT_COLOR: Record<Element, string> = {
  wind: '#a8e0f0', flame: '#f0a070', earth: '#c8b078', water: '#88b0f0',
  virtue: '#f0e8a8', bane: '#c090e0', drakonite: '#e0c060',
};
