// The commander's quartermaster: between marches it does what a player does
// with the army's money, through the Organize screen and nothing else.
// It changes the class of every soldier who has earned a higher one,
// puts the best gear the army carries on each of them, and buys better gear
// from the shop while the treasury allows, keeping a reserve.
//
// It plans with the game's own rules (published by the ?debug hook) and acts
// only by clicking the screen's controls, so every purchase, change and
// promotion is the UI's.

// The Organize screen's controls, by name, looked for within that screen
// (its squad buttons share names with the map's squad tags).
const org = (g, name, wait = 120) => g.ui(name, { within: 'organize', wait });

const FILTERS = ['supplies', 'weapons', 'armour', 'other'];
const WEAPONS = ['sword', 'greatsword', 'rapier', 'axe', 'hammer', 'spear', 'whip', 'claw', 'bow', 'mace', 'staff', 'doll', 'fan'];
const ARMOUR = ['light', 'medium', 'heavy', 'robe', 'clothing', 'shield', 'greatshield', 'helm', 'hat'];

/** Treasury kept back for recruits and supplies. */
const RESERVE = 300;

/**
 * The plan for one soldier, worked out in the page: the class change to take
 * (the first offered that climbs a tier), and
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
    const promo = promos.find((p) => eligible.has(p.classId) && P.classOf(p.classId).tier > tier);

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
        buy = { id: forSale.id, filter: filterOf(forSale), price: forSale.price };
        left -= forSale.price;
        pick = forSale.id;
      } else if (best && best.rank > worn) {
        pick = best.id;
        spare[best.id]--;
      }
      return { slot, slotIndex, pick, buy };
    }).filter((p) => p.pick);
    return { promoTo: promo?.classId ?? null, gear };
  }, [charId, budget, FILTERS, WEAPONS, ARMOUR]);
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
    await g.ui('organize', { within: 'map', wait: 500 });
  }
  if (!(await g.active('Organize'))) {
    const screens = await g.page.evaluate(() => ['Title', 'Overworld', 'Battle', 'Organize'].filter((n) => window.__palatinus.game.scene.isActive(n)).join('+'));
    const shot = await g.shot('organize-did-not-open');
    done.misses.push(`Organize did not open (screens ${screens}, map ${(await g.paused('Overworld')) ? 'paused' : 'running'}; ${shot})`);
    return done;
  }
  const squads = await g.page.evaluate(() => window.__palatinus.state().squads
    .filter((q) => q.side === 'player').slice(0, 6).map((q) => q.id));
  for (const [si, squadId] of squads.entries()) {
    await org(g, `squad-${si}`, 150);
    const members = await g.page.evaluate((qid) => {
      const q = window.__palatinus.state().squads.find((x) => x.id === qid);
      return [...new Set(q.grid.filter((x) => x !== null))].map((id) => ({ id, cell: q.grid.indexOf(id) }));
    }, squadId);
    for (const m of members) {
      await org(g, `cell-${m.cell}`);
      const budget = async () => Math.max(0, (await g.state()).goth - RESERVE);
      let plan = await planFor(g, m.id, await budget());

      if (plan.promoTo) {
        await org(g, 'tab-class');
        await org(g, `class-${plan.promoTo}`, 150);
        const now = (await g.state()).chars[m.id].classId;
        if (now === plan.promoTo) done.promoted.push(`${now}`);
        else done.misses.push(`promotion to ${plan.promoTo}`);
        // A new class wears different gear: plan its kit afresh.
        plan = await planFor(g, m.id, await budget());
      }

      for (const step of plan.gear) {
        if (step.buy) {
          const before = await g.state();
          await org(g, 'mode-shop', 150);
          await org(g, `filter-${step.buy.filter}`);
          await org(g, `buy-${step.buy.id}`, 150);
          const after = await g.state();
          if ((after.inventory[step.buy.id] ?? 0) > (before.inventory[step.buy.id] ?? 0)) {
            done.bought++;
            done.spent += before.goth - after.goth;
          } else {
            done.misses.push(`buying ${step.buy.id}`);
          }
          await org(g, 'mode-shop', 150); // back to the soldier's sheet
          await org(g, `cell-${m.cell}`);
        }
        await org(g, 'tab-gear');
        // The place's list of what fits stays open once chosen; choose it only if it is not.
        const open = await g.page.evaluate((slot) => document.querySelector(`[data-ui="slot-${slot}"]`)?.classList.contains('is-on'), step.slot);
        if (!open) await org(g, `slot-${step.slot}`);
        if (!(await org(g, `equip-${step.pick}`, 150))) {
          done.misses.push(`${step.pick} not offered for ${step.slot}`);
          continue;
        }
        if ((await g.state()).chars[m.id].gear[step.slot] === step.pick) done.equipped++;
        else done.misses.push(`equipping ${step.pick}`);
      }
    }
  }
  await org(g, 'back-to-map', 400);
  // Back on the map: running, or already in a battle that broke out the moment it resumed.
  const resumed = await g.until(() => {
    const sc = window.__palatinus.game.scene;
    return !sc.isActive('Organize') && (sc.isActive('Battle') || !sc.isPaused('Overworld'));
  }, null, 5000);
  if (!resumed) done.misses.push('the map did not resume');
  return done;
}
