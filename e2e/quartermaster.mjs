// The commander's quartermaster: between marches it does what a player does
// with the army's money, through the Organize screen and nothing else.
// It changes the class of every soldier who has earned a higher one,
// puts the best gear the army carries on each of them, and buys better gear
// from the shop while the treasury allows, keeping a reserve.
//
// It plans with the game's own rules (published by the ?debug hook) and acts
// only by clicking, so every purchase, change and promotion is the UI's.

// The Organize screen's layout, in the game's 800x600 space.
const ORGANIZE = [742, 580];
const BACK_TO_MAP = [106, 548];
const SHOP = [106, 397];
const SQUAD_BUTTON = (i) => [106, 107 + i * 42];
const CELL = (c) => [260 + (c % 3) * 88, 140 + Math.floor(c / 3) * 88];
const TAB = { gear: [632, 133], class: [716, 133] };
const SLOT_ROW = (i) => [650, 172 + i * 40];
const GEAR_OPTION = (i) => [650, 346 + i * 24];
const CLASS_ROW = (i) => [650, 167 + i * 30];
const SHOP_FILTER = (i) => [546 + i * 63, 94];
const SHOP_ROW = (i) => [650, 124 + i * 37];
const NEXT_PAGE = [702, 490];

const FILTERS = ['supplies', 'weapons', 'armour', 'other'];
const WEAPONS = ['sword', 'greatsword', 'rapier', 'axe', 'hammer', 'spear', 'whip', 'claw', 'bow', 'mace', 'staff', 'doll', 'fan'];
const ARMOUR = ['light', 'medium', 'heavy', 'robe', 'clothing', 'shield', 'greatshield', 'helm', 'hat'];

/** Treasury kept back for recruits and supplies. */
const RESERVE = 300;

async function turnTo(g, page) {
  for (let p = 0; p < page; p++) await g.click(...NEXT_PAGE, 120);
}

/**
 * The plan for one soldier, worked out in the page: the class change to take
 * (the first offered that climbs a tier, with its row on the Class tab), and
 * for each gear place the best piece better than what is worn, carried or
 * for sale within the budget.
 */
function planFor(g, charId, budget) {
  return g.page.evaluate(([id, budget, FILTERS, WEAPONS, ARMOUR]) => {
    const P = window.__palatinus;
    const R = P.rules;
    const st = P.state();
    const c = st.chars.get(id);
    const rankOf = (itemId) => (itemId ? P.itemOf(itemId).rank : -1);

    const promos = R.allPromotions(c);
    const eligible = new Set(R.availablePromotions(c, st.inventory).map((p) => p.classId));
    const tier = P.classOf(c.classId).tier;
    const promoRow = promos.findIndex((p) => eligible.has(p.classId) && P.classOf(p.classId).tier > tier);

    const owned = st.nodes.filter((n) => n.owner === 'player').length;
    const stock = R.shopStock(R.shopRank(owned));
    const filterOf = (i) => (i.kind === 'supply' ? 'supplies'
      : i.kind === 'gear' && WEAPONS.includes(i.type) ? 'weapons'
        : i.kind === 'gear' && ARMOUR.includes(i.type) ? 'armour' : 'other');
    let left = budget;
    // What is carried, less what this plan has already put on another place.
    const spare = { ...st.inventory };
    const gear = R.SLOTS.map((slot, slotIndex) => {
      const worn = rankOf(c.gear[slot]);
      const carried = Object.keys(spare).filter((k) => spare[k] > 0).map(P.itemOf).filter((i) => R.canEquip(c, i, slot))
        .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
      const best = carried[0];
      const forSale = stock.filter((i) => i.kind === 'gear' && R.canEquip(c, i, slot) && i.price <= left)
        .sort((a, b) => b.rank - a.rank || a.price - b.price)[0];
      let pick = null;
      let buy = null;
      if (forSale && forSale.rank > Math.max(worn, best?.rank ?? -1)) {
        const filter = filterOf(forSale);
        const list = stock.filter((i) => filterOf(i) === filter);
        buy = { id: forSale.id, filter: FILTERS.indexOf(filter), row: list.indexOf(forSale), price: forSale.price };
        left -= forSale.price;
        pick = forSale.id;
      } else if (best && best.rank > worn) {
        pick = best.id;
        spare[best.id]--;
      }
      return { slot, slotIndex, pick, buy };
    }).filter((p) => p.pick);
    return { promoRow, promoTo: promoRow >= 0 ? promos[promoRow].classId : null, gear };
  }, [charId, budget, FILTERS, WEAPONS, ARMOUR]);
}

/** Where `itemId` sits in the Gear tab's list of what may go in `slot` (taking off first, then best first). */
function optionRow(g, charId, slot, itemId) {
  return g.page.evaluate(([id, slot, itemId]) => {
    const P = window.__palatinus;
    const st = P.state();
    const c = st.chars.get(id);
    const options = [
      ...(c.gear[slot] ? [null] : []),
      ...Object.keys(st.inventory).map(P.itemOf).filter((i) => P.rules.canEquip(c, i, slot))
        .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name)).map((i) => i.id),
    ];
    return options.indexOf(itemId);
  }, [charId, slot, itemId]);
}

/**
 * One visit to the Organize screen: every squad, every soldier. Returns what
 * was done, for the campaign log. Anything the UI did not do as planned is
 * counted as a miss.
 */
export async function equipArmy(g) {
  const done = { promoted: [], equipped: 0, bought: 0, spent: 0, misses: [] };
  // Not in the middle of a battle: wait for the map to be running again (a
  // battle can still break out just as the button is pressed; then wait again).
  for (let tries = 0; tries < 4 && !(await g.active('Organize')); tries++) {
    await g.until(() => !window.__palatinus.game.scene.isActive('Battle') && !window.__palatinus.game.scene.isPaused('Overworld'), null, 60000);
    await g.click(...ORGANIZE, 500);
  }
  if (!(await g.active('Organize'))) {
    const scenes = await g.page.evaluate(() => window.__palatinus.game.scene.getScenes(true).map((x) => x.scene.key).join('+'));
    const shot = await g.shot('organize-did-not-open');
    done.misses.push(`Organize did not open (scenes ${scenes}, map ${(await g.paused('Overworld')) ? 'paused' : 'running'}; ${shot})`);
    return done;
  }
  const squads = await g.page.evaluate(() => window.__palatinus.state().squads
    .filter((q) => q.side === 'player').slice(0, 6).map((q) => q.id));
  for (const [si, squadId] of squads.entries()) {
    await g.click(...SQUAD_BUTTON(si), 150);
    const members = await g.page.evaluate((qid) => {
      const q = window.__palatinus.state().squads.find((x) => x.id === qid);
      return [...new Set(q.grid.filter((x) => x !== null))].map((id) => ({ id, cell: q.grid.indexOf(id) }));
    }, squadId);
    for (const m of members) {
      await g.click(...CELL(m.cell), 120);
      const budget = async () => Math.max(0, (await g.state()).goth - RESERVE);
      let plan = await planFor(g, m.id, await budget());

      if (plan.promoTo) {
        await g.click(...TAB.class, 120);
        await turnTo(g, Math.floor(plan.promoRow / 11));
        await g.click(...CLASS_ROW(plan.promoRow % 11), 150);
        const now = (await g.state()).chars[m.id].classId;
        if (now === plan.promoTo) done.promoted.push(`${now}`);
        else done.misses.push(`promotion to ${plan.promoTo}`);
        // A new class wears different gear: plan its kit afresh.
        plan = await planFor(g, m.id, await budget());
      }

      for (const step of plan.gear) {
        if (step.buy) {
          const before = await g.state();
          await g.click(...SHOP, 150);
          await g.click(...SHOP_FILTER(step.buy.filter), 120);
          await turnTo(g, Math.floor(step.buy.row / 10));
          await g.click(...SHOP_ROW(step.buy.row % 10), 150);
          const after = await g.state();
          if ((after.inventory[step.buy.id] ?? 0) > (before.inventory[step.buy.id] ?? 0)) {
            done.bought++;
            done.spent += before.goth - after.goth;
          } else {
            done.misses.push(`buying ${step.buy.id}`);
          }
          await g.click(...SHOP, 150); // back to the soldier's sheet
          await g.click(...CELL(m.cell), 120);
        }
        await g.click(...TAB.gear, 120);
        await g.click(...SLOT_ROW(step.slotIndex), 120);
        const row = await optionRow(g, m.id, step.slot, step.pick);
        if (row < 0) {
          done.misses.push(`${step.pick} not offered for ${step.slot}`);
          continue;
        }
        await turnTo(g, Math.floor(row / 6));
        await g.click(...GEAR_OPTION(row % 6), 150);
        if ((await g.state()).chars[m.id].gear[step.slot] === step.pick) done.equipped++;
        else done.misses.push(`equipping ${step.pick}`);
      }
    }
  }
  await g.click(...BACK_TO_MAP, 400);
  // Back on the map: running, or already in a battle that broke out the moment it resumed.
  if ((await g.active('Organize')) || !((await g.active('Battle')) || !(await g.paused('Overworld')))) done.misses.push('the map did not resume');
  return done;
}
