import { afterEach, describe, expect, it } from 'vitest';
import {
  buy, canEquip, defaultGearFor, effectiveResist, effectiveStats, equip, equipRulesOf, rollLoot, sell, shopRank,
  shopStock, slotsFor, starterInventory, unequip, useItem,
} from './items';
import type { Inventory, ItemDef } from './items';
import { elementBonus } from './battle';
import { makeCharacter, meetsReq, promote, routeItemId } from './character';
import { allItems, classOf, installDataset, itemOf, ORIGINALS, resetDataset } from '../data/registry';
import { withExpansion } from '../expansion';
import type { RowAttack } from './types';

afterEach(() => resetDataset());

const byName = (name: string): ItemDef => allItems().find((i) => i.name === name)!;
const slash: RowAttack = { name: 'Slash', type: 'melee', count: 1, power: 1, target: 'one' };

describe('where gear goes', () => {
  it('puts each type in its place, and an accessory in either the off hand or the head', () => {
    expect(slotsFor('sword')).toEqual(['weapon']);
    expect(slotsFor('greatshield')).toEqual(['offhand']);
    expect(slotsFor('robe')).toEqual(['body']);
    expect(slotsFor('helm')).toEqual(['head']);
    expect(slotsFor('accessory')).toEqual(['offhand', 'head']);
  });

  it('lets a knight wear plate and swing a sword, but not a wizard', () => {
    const knight = makeCharacter('knight', 5);
    const wizard = makeCharacter('wizard', 5);
    const plate = byName('Steel Plate');
    expect(canEquip(knight, plate, 'body')).toBe(true);
    expect(canEquip(wizard, plate, 'body')).toBe(false);
    expect(canEquip(wizard, byName('Sage Robe'), 'body')).toBe(true);
    expect(canEquip(knight, byName('Steel Sword'), 'weapon')).toBe(true);
    expect(canEquip(knight, byName('Steel Sword'), 'body')).toBe(false); // right item, wrong place
  });

  it('dresses monsters in accessories only', () => {
    const golem = makeCharacter('golem', 5);
    expect(equipRulesOf(classOf('golem')).weapon).toEqual([]);
    expect(canEquip(golem, byName('Steel Sword'), 'weapon')).toBe(false);
    expect(canEquip(golem, byName('Iron Torc'), 'head')).toBe(true);
  });

  it('issues every new unit only gear its class may wear', () => {
    for (const def of Object.values(withExpansion(ORIGINALS).classes)) {
      installDataset(withExpansion(ORIGINALS));
      const gear = defaultGearFor(def);
      const unit = makeCharacter(def.id, 5);
      for (const [slot, id] of Object.entries(unit.gear)) {
        if (id) expect(canEquip(unit, itemOf(id), slot as never), `${def.name} ${slot} ${id}`).toBe(true);
      }
      expect(gear).toBeDefined();
    }
  });

  it('arms a soldier: a new knight carries a weapon and armour', () => {
    const k = makeCharacter('knight', 5);
    expect(k.gear.weapon).not.toBeNull();
    expect(k.gear.body).not.toBeNull();
    expect(makeCharacter('golem', 5).gear).toEqual({ weapon: null, body: null, offhand: null, head: null });
  });
});

describe('equipping', () => {
  it('moves gear between the inventory and the unit, returning what it replaces', () => {
    const k = makeCharacter('knight', 5);
    const old = k.gear.weapon!;
    const inv: Inventory = { 'steel-sword': 1 };
    expect(equip(k, 'steel-sword', 'weapon', inv)).toBe(true);
    expect(k.gear.weapon).toBe('steel-sword');
    expect(inv).toEqual({ [old]: 1 });
    unequip(k, 'weapon', inv);
    expect(k.gear.weapon).toBeNull();
    expect(inv).toEqual({ [old]: 1, 'steel-sword': 1 });
  });

  it('needs the item in hand', () => {
    const k = makeCharacter('knight', 5);
    const before = { ...k.gear };
    expect(equip(k, 'steel-sword', 'weapon', {})).toBe(false);
    expect(k.gear).toEqual(before);
  });

  it('sets down the shield to take up a two-handed weapon, and refuses a shield beside one', () => {
    const k = makeCharacter('fighter', 5);
    installDataset({ ...withExpansion(ORIGINALS) });
    // A fighter of the originals may only use swords; let one use a greatsword.
    classOf('fighter').equip = { ...equipRulesOf(classOf('fighter')), weapon: ['sword', 'greatsword'] };
    try {
      k.gear.offhand = 'iron-buckler';
      const inv: Inventory = { 'steel-greatsword': 1, 'steel-targe': 1 };
      expect(equip(k, 'steel-greatsword', 'weapon', inv)).toBe(true);
      expect(k.gear.offhand).toBeNull();
      expect(inv['iron-buckler']).toBe(1);
      expect(equip(k, 'steel-targe', 'offhand', inv)).toBe(false);
    } finally {
      delete classOf('fighter').equip;
    }
  });
});

describe('what gear does', () => {
  it('adds its bonuses to the stats a unit fights with, not its own', () => {
    const k = makeCharacter('knight', 5);
    k.gear = { weapon: 'runed-sword', body: null, offhand: null, head: null };
    const eff = effectiveStats(k);
    expect(eff.str).toBe(k.stats.str + itemOf('runed-sword').bonus!.str!);
    expect(eff.vit).toBe(k.stats.vit);
  });

  it('adds resistances, held within 0..100', () => {
    const k = makeCharacter('knight', 5);
    k.gear = { weapon: null, body: 'runed-plate', offhand: 'runed-bulwark', head: 'great-helm' };
    expect(effectiveResist(k).physical).toBe(Math.min(100, classOf('knight').resist.physical + 21 + 13 + 7));
    k.gear.body = 'emberward-mail';
    expect(effectiveResist(k).flame).toBeGreaterThan(classOf('knight').resist.flame);
    expect(effectiveResist(k).water).toBeLessThan(classOf('knight').resist.water);
  });

  it('never takes a resistance past 100', () => {
    installDataset({
      ...ORIGINALS,
      items: { ...ORIGINALS.items, aegis: { ...itemOf('great-helm'), id: 'aegis', resist: { physical: 90, bane: -90 } } },
    });
    const k = makeCharacter('knight', 5);
    k.gear.head = 'aegis';
    expect(effectiveResist(k).physical).toBe(100);
    expect(effectiveResist(k).bane).toBe(0);
  });

  it('blunts blows with armour', () => {
    const foe = makeCharacter('knight', 5);
    const bare = makeCharacter('knight', 5);
    bare.gear = { weapon: null, body: null, offhand: null, head: null };
    const plated = makeCharacter('knight', 5);
    plated.gear = { weapon: null, body: 'runed-plate', offhand: null, head: null };
    expect(elementBonus(slash, plated, foe)).toBeLessThan(elementBonus(slash, bare, foe));
  });

  it('lets an elemental weapon strike half with its element', () => {
    const swordsman = makeCharacter('knight', 5);
    const target = makeCharacter('knight', 5);
    target.gear = { weapon: null, body: 'frostward-mail', offhand: null, head: null }; // weak to flame
    swordsman.gear.weapon = 'steel-sword';
    const plain = elementBonus(slash, target, swordsman);
    swordsman.gear.weapon = 'emberbrand';
    expect(elementBonus(slash, target, swordsman)).toBeGreaterThan(plain);
  });

  it('lets a dragon-slaying blade strike dragons half again as hard', () => {
    const hero = makeCharacter('knight', 5);
    const dragon = makeCharacter('red-dragon', 9);
    hero.gear.weapon = 'mithril-greatsword';
    const plain = elementBonus(slash, dragon, hero);
    hero.gear.weapon = 'wyrmsbane';
    const slaying = elementBonus(slash, dragon, hero);
    // Wyrmsbane is also a flame blade; against a dragon of neutral flame
    // resistance that part changes nothing, so the rest is the slaying.
    expect(slaying).toBeCloseTo(plain * 1.5, 5);
    const knight = makeCharacter('knight', 5);
    const onMan = elementBonus(slash, knight, hero);
    hero.gear.weapon = 'emberbrand'; // flame too, but slays nothing
    expect(onMan).toBeCloseTo(elementBonus(slash, knight, hero), 5); // no slaying a man
  });
});

describe('using items', () => {
  it('heals the hurt, never past their maximum, and spends the item', () => {
    const c = makeCharacter('fighter', 5);
    c.hp = c.stats.hp - 3;
    const inv: Inventory = { 'mending-draught': 2 };
    expect(useItem('mending-draught', c, [c], inv)).toMatch(/healed/);
    expect(c.hp).toBe(c.stats.hp);
    expect(inv['mending-draught']).toBe(1);
  });

  it('does nothing, and spends nothing, when there is nothing to do', () => {
    const c = makeCharacter('fighter', 5);
    const inv: Inventory = { 'mending-herb': 1, 'ember-of-return': 1 };
    expect(useItem('mending-herb', c, [c], inv)).toBeNull();
    expect(useItem('ember-of-return', c, [c], inv)).toBeNull(); // nobody has fallen
    expect(inv).toEqual({ 'mending-herb': 1, 'ember-of-return': 1 });
  });

  it('revives only the fallen', () => {
    const c = makeCharacter('fighter', 5);
    c.hp = 0;
    const inv: Inventory = { 'ember-of-return': 1 };
    expect(useItem('ember-of-return', c, [c], inv)).toMatch(/revived/);
    expect(c.hp).toBe(Math.round(c.stats.hp * 0.5));
  });

  it('reaches the whole squad with a squad item', () => {
    const a = makeCharacter('fighter', 5);
    const b = makeCharacter('fighter', 5);
    a.hp = 1;
    b.hp = 1;
    useItem('camp-feast', a, [a, b], { 'camp-feast': 1 });
    expect([a.hp, b.hp]).toEqual([a.stats.hp, b.stats.hp]);
  });

  it('raises a stat for good with a relic', () => {
    const c = makeCharacter('fighter', 5);
    const str = c.stats.str;
    useItem('torc-of-might', c, [c], { 'torc-of-might': 1 });
    expect(c.stats.str).toBe(str + 2);
  });

  it('draws a squad toward its leader', () => {
    const lead = makeCharacter('fighter', 5, { ali: 80 });
    const other = makeCharacter('fighter', 5, { ali: 20 });
    const above = makeCharacter('fighter', 5, { ali: 95 });
    const near = makeCharacter('fighter', 5, { ali: 76 });
    useItem('banner-of-accord', lead, [lead, other, above, near], { 'banner-of-accord': 1 });
    expect(other.ali).toBe(30);
    expect(above.ali).toBe(85); // pulled down, toward the leader
    expect(near.ali).toBe(80); // and no further than the leader
    expect(lead.ali).toBe(80);
  });
});

describe('the shop', () => {
  it('stocks more as the army takes ground, and only what is for sale', () => {
    expect(shopRank(1)).toBe(1);
    expect(shopStock(1).length).toBeLessThan(shopStock(6).length);
    expect(shopStock(8).every((i) => i.forSale)).toBe(true);
    expect(shopStock(1).every((i) => i.rank <= 1)).toBe(true);
    expect(shopStock(8).some((i) => i.kind === 'relic')).toBe(false);
  });

  it('takes Goth to buy and gives half back to sell', () => {
    const t = { goth: 100 };
    const inv: Inventory = {};
    expect(buy('mending-draught', inv, t)).toBe(true);
    expect(t.goth).toBe(55);
    expect(buy('camp-feast', inv, t)).toBe(false);
    expect(sell('mending-draught', inv, t)).toBe(true);
    expect(t.goth).toBe(55 + 22);
    expect(inv).toEqual({});
    expect(sell('mending-draught', inv, t)).toBe(false);
  });
});

describe('spoils and supplies', () => {
  it('pays more for stronger foes, in real items', () => {
    const weak = [makeCharacter('fighter', 2)];
    const strong = [makeCharacter('knight', 12), makeCharacter('knight', 12)];
    expect(rollLoot(strong).goth).toBeGreaterThan(rollLoot(weak).goth);
    for (let i = 0; i < 30; i++) for (const id of rollLoot(strong).items) expect(itemOf(id)).toBeDefined();
  });

  it('sets the army out with heals and a revive', () => {
    const inv = starterInventory();
    const effects = Object.keys(inv).map((id) => itemOf(id).effect!);
    expect(effects.some((e) => e.heal !== undefined)).toBe(true);
    expect(effects.some((e) => e.revive !== undefined)).toBe(true);
  });
});

describe('class changes that spend an item', () => {
  it('open when the item is held, spend it, and shed gear the new class cannot use', () => {
    installDataset(withExpansion(ORIGINALS));
    const knight = makeCharacter('knight', 20, { ali: 70 });
    const route = classOf('knight').promotesTo.find((p) => p.item)!;
    expect(route).toBeDefined();
    const key = routeItemId(route)!;
    expect(itemOf(key).kind).toBe('key');
    expect(meetsReq(knight, route, {})).toBe(false);
    const inv: Inventory = { [key]: 1 };
    expect(meetsReq(knight, route, inv)).toBe(true);
    promote(knight, route.classId, inv);
    expect(knight.classId).toBe(route.classId);
    expect(inv[key]).toBeUndefined();
    for (const [slot, id] of Object.entries(knight.gear)) {
      if (id) expect(canEquip(knight, itemOf(id), slot as never)).toBe(true);
    }
  });
});
