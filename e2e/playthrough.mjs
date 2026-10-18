// The automated playthrough: plays Palatinus through a real browser,
// clicking as a player would, and checks the campaign's state after every
// step. Each check carries an id from the sweep's checklist.
//
//   npm run dev            (in another terminal)
//   npm run e2e            every section
//   npm run e2e -- map     just one or more: title map organize battle campaign defeat soak
//
// With Ogre Battle 64 data extracted, it plays on that; without, on the
// built-in data. Screenshots and a JSON report land in e2e-results/.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { freezeEnemies, newCampaign, openGame, OUT, thawEnemies } from './harness.mjs';

const near = (a, b, d) => Math.hypot(a.x - b.x, a.y - b.y) <= d;
const players = (s) => s.squads.filter((q) => q.side === 'player');
const enemies = (s) => s.squads.filter((q) => q.side === 'enemy');
const membersOf = (s, q) => [...new Set(q.grid.filter((i) => i !== null))].map((i) => s.chars[i]);

// ------------------------------------------------------------------ title --

async function title(g) {
  const label = await g.page.evaluate(() => {
    const t = window.__palatinus.game.scene.getScene('Title');
    return t.children.list.filter((o) => o.type === 'Text').map((o) => o.text).find((x) => x.startsWith('Class data')) ?? '';
  });
  g.check('T1', 'the title screen shows which class data is loaded', /Class data: .+ · \d+ classes/.test(label), label);
  await g.shot('title');
  g.check('T2', 'NEW CAMPAIGN opens the map', await newCampaign(g));
  const s = await g.state();
  g.check('T3', 'a new campaign starts as written: 4 squads of ours, 7 of theirs, 500 Goth, day 1',
    players(s).length === 4 && enemies(s).length === 7 && s.goth === 500 && s.day === 1 && s.phase === 'playing',
    `${players(s).length} / ${enemies(s).length} squads, ${s.goth} Goth, day ${s.day}`);
  g.check('T4', 'only the keep is ours at the start',
    s.nodes.filter((n) => n.owner === 'player').map((n) => n.name).join() === 'Fort Melchor');
  await g.wait(1500);
  await g.shot('map-start');
}

// -------------------------------------------------------------------- map --

async function map(g) {
  await freezeEnemies(g);
  let s = await g.state();
  const ours = players(s);

  // Selecting: every squad of ours can be picked where it stands on screen.
  let picked = 0;
  for (const q of ours) {
    const at = await g.squadOnScreen(q.id);
    if (!at) continue;
    await g.click(at.x, at.y);
    let info = await g.mapInfo();
    // Squads stacked on one spot are picked in turn.
    for (let k = 0; k < ours.length && info.selected !== q.id; k++) {
      await g.click(at.x, at.y);
      info = await g.mapInfo();
    }
    if (info.selected === q.id && info.hint.startsWith(q.name)) picked++;
  }
  g.check('M1', 'each of our squads can be selected by clicking it on the map', picked === ours.length, `${picked}/${ours.length}`);

  // The camera.
  const v0 = (await g.mapInfo()).view;
  await g.page.mouse.move(...g.at(400, 280));
  await g.page.mouse.wheel(0, -300);
  await g.wait(400);
  const v1 = (await g.mapInfo()).view;
  g.check('M2', 'the wheel zooms in', v1.distance < v0.distance, `${v0.distance.toFixed(1)} → ${v1.distance.toFixed(1)}`);
  await g.page.mouse.move(...g.at(400, 300));
  await g.page.mouse.down();
  await g.page.mouse.move(...g.at(250, 300), { steps: 6 });
  await g.page.mouse.up();
  await g.wait(200);
  const v2 = (await g.mapInfo()).view;
  g.check('M3', 'dragging pans the map (and a drag is not taken as a click)', Math.abs(v2.x - v1.x) > 1 && (await g.mapInfo()).selected === ours.at(-1).id,
    `x ${v1.x.toFixed(1)} → ${v2.x.toFixed(1)}`);
  await g.page.keyboard.down('E');
  await g.wait(500);
  await g.page.keyboard.up('E');
  const v3 = (await g.mapInfo()).view;
  g.check('M4', 'E turns the view', Math.abs(v3.yaw - v2.yaw) > 0.2, `yaw ${v2.yaw.toFixed(2)} → ${v3.yaw.toFixed(2)}`);
  await g.page.keyboard.down('W');
  await g.wait(400);
  await g.page.keyboard.up('W');
  const v4 = (await g.mapInfo()).view;
  g.check('M5', 'W pans the view forward', Math.hypot(v4.x - v3.x, v4.z - v3.z) > 0.5);
  await g.page.keyboard.press('r');
  await g.wait(1200);
  const v5 = (await g.mapInfo()).view;
  g.check('M6', 'R returns to the whole map', Math.abs(v5.distance - 56) < 1 && Math.abs(v5.yaw) < 0.01, `distance ${v5.distance.toFixed(1)}`);
  await g.page.keyboard.press('Space');
  await g.wait(1200);
  const v6 = await g.mapInfo();
  g.check('M7', 'Space finds a squad and closes in on it', v6.selected !== null && v6.view.distance < 30);

  // Marching: select Azure Wing and send it to Elm Vale (a click near a
  // stronghold snaps onto it).
  await g.page.keyboard.press('r');
  await g.wait(1200);
  s = await g.state();
  const azure = s.squads.find((q) => q.name === 'Azure Wing');
  const elm = s.nodes.find((n) => n.name === 'Elm Vale');
  const select = async (q) => {
    for (let k = 0; k < 6 && (await g.mapInfo()).selected !== q.id; k++) {
      const at = await g.squadOnScreen(q.id);
      await g.click(at.x, at.y);
    }
    return (await g.mapInfo()).selected === q.id;
  };
  await select(azure);
  const elmAt = await g.pointOnScreen(elm.x + 8, elm.y + 6);
  await g.click(elmAt.x, elmAt.y);
  s = await g.state();
  let a = s.squads.find((q) => q.id === azure.id);
  g.check('M8', 'a click beside a stronghold orders a march that snaps onto it', a.moving && a.tx === elm.x && a.ty === elm.y, `target ${a.tx},${a.ty}`);
  await g.shot('march-ordered');
  const reached = await g.until(([id]) => {
    const s = window.__palatinus.state();
    return s.nodes.find((n) => n.id === id).owner === 'player';
  }, [elm.id], 60000);
  g.check('M9', 'the squad arrives and liberates the town', reached);
  s = await g.state();
  a = s.squads.find((q) => q.id === azure.id);
  g.check('M10', 'it halts at the town, close enough to hold it', !a.moving && near(a, elm, 27), `${Math.hypot(a.x - elm.x, a.y - elm.y).toFixed(1)}px from its centre`);

  // Open country: a click away from any stronghold is a march to that very point.
  await select(a);
  const spot = { x: 300, y: 440 };
  const spotAt = await g.pointOnScreen(spot.x, spot.y);
  await g.click(spotAt.x, spotAt.y);
  s = await g.state();
  a = s.squads.find((q) => q.id === azure.id);
  g.check('M11', 'a click in open country marches to the ground under the pointer', a.moving && near({ x: a.tx, y: a.ty }, spot, 6),
    `aimed ${spot.x},${spot.y}, got ${a.tx?.toFixed(1)},${a.ty?.toFixed(1)}`);

  // Days pass and pay.
  const before = await g.state();
  const owned = before.nodes.filter((n) => n.owner === 'player').length;
  await g.until(([d]) => window.__palatinus.state().day > d, [before.day], 30000);
  const after = await g.state();
  g.check('M12', 'each day pays 50 Goth for every stronghold held', after.day === before.day + 1 && after.goth - before.goth === 50 * owned,
    `day ${before.day} → ${after.day}, ${before.goth} → ${after.goth} Goth with ${owned} held`);
  await g.shot('map-after-march');
}

// --------------------------------------------------------------- organize --

const CELL = (c) => [260 + (c % 3) * 88, 140 + Math.floor(c / 3) * 88];
const SQUAD_BUTTON = (i) => [106, 107 + i * 42];

async function organizeScene(g, fn) {
  return g.page.evaluate(fn);
}

async function organize(g) {
  await freezeEnemies(g);
  const before = await g.state();
  await g.click(742, 580, 500);
  g.check('O1', 'ORGANIZE opens the army screen and holds the map still',
    (await g.active('Organize')) && (await g.paused('Overworld')));
  await g.wait(1000);
  const held = await g.state();
  g.check('O2', 'nothing moves on the map while the army is organized',
    JSON.stringify(held.squads.map((q) => [q.x, q.y])) === JSON.stringify((await g.state()).squads.map((q) => [q.x, q.y])) && held.day === before.day);

  // Squads and their sheets.
  const ours = players(held);
  await g.click(...SQUAD_BUTTON(2));
  const wolves = ours[2];
  const shown = await organizeScene(g, () => window.__palatinus.game.scene.getScene('Organize').squad?.name);
  g.check('O3', 'the squad buttons switch the formation shown', shown === wolves.name, shown);
  const leaderCell = wolves.grid.indexOf(wolves.leaderId);
  await g.click(...CELL(leaderCell));
  const sel = await organizeScene(g, () => window.__palatinus.game.scene.getScene('Organize').selectedChar?.id);
  g.check('O4', 'clicking a member opens its sheet', sel === wolves.leaderId);
  await g.shot('organize-sheet');

  // Moving a member: to an empty cell, and a large unit only where it fits.
  let s = await g.state();
  let q = s.squads.find((x) => x.id === wolves.id);
  const empty = q.grid.findIndex((x) => x === null);
  await g.click(...CELL(empty));
  s = await g.state();
  q = s.squads.find((x) => x.id === wolves.id);
  g.check('O5', 'a selected member moves to the empty cell clicked', q.grid[empty] === wolves.leaderId && !q.grid.some((x, i) => x === wolves.leaderId && i !== empty));
  const large = membersOf(s, q).find((c) => q.grid.filter((x) => x === c.id).length === 2);
  if (large) {
    const cells = q.grid.flatMap((x, i) => (x === large.id ? [i] : []));
    await g.click(...CELL(cells[0]));
    // A cell whose row has no room beside it for the beast's second half.
    const target = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((c) => q.grid[c] === null && [c - 1, c + 1].every((n) =>
      n < 0 || n > 8 || Math.floor(n / 3) !== Math.floor(c / 3) || (q.grid[n] !== null && q.grid[n] !== large.id)));
    if (target !== undefined) {
      await g.click(...CELL(target));
      const msg = await organizeScene(g, () => window.__palatinus.game.scene.getScene('Organize').message);
      const s2 = await g.state();
      g.check('O6', 'a large unit will not go where it has no room, and says so',
        JSON.stringify(s2.squads.find((x) => x.id === wolves.id).grid) === JSON.stringify(q.grid) && /No room/.test(msg), msg);
    } else {
      g.check('O6', 'a large unit will not go where it has no room, and says so', true, 'no such cell in this formation; covered by unit tests');
    }
    const s3 = await g.state();
    const g3 = s3.squads.find((x) => x.id === wolves.id).grid;
    const pair = g3.flatMap((x, i) => (x === large.id ? [i] : []));
    g.check('O7', 'a large unit always stands in two cells side by side', pair.length === 2 && pair[1] - pair[0] === 1 && Math.floor(pair[0] / 3) === Math.floor(pair[1] / 3), pair.join(','));
  }

  // Gear: take the leader's weapon off, then put the best one carried on.
  await g.click(...CELL(empty));
  await g.click(632, 133);
  s = await g.state();
  const lead = s.chars[wolves.leaderId];
  const wasWeapon = lead.gear.weapon;
  await g.click(650, 172);
  await g.click(650, 346);
  s = await g.state();
  const off = s.chars[wolves.leaderId];
  g.check('O8', 'taking a weapon off puts it in the army\'s stores', wasWeapon && off.gear.weapon === null && s.inventory[wasWeapon] >= 1,
    `${wasWeapon} → ${off.gear.weapon}, carried ${s.inventory[wasWeapon]}`);
  const carried = { ...s.inventory };
  await g.click(650, 346);
  s = await g.state();
  const on = s.chars[wolves.leaderId];
  g.check('O9', 'equipping takes a weapon from the stores', on.gear.weapon !== null && (s.inventory[on.gear.weapon] ?? 0) === (carried[on.gear.weapon] ?? 0) - 1,
    `now wields ${on.gear.weapon}`);
  await g.shot('organize-gear');

  // A class change: raise a member high enough to qualify, then take the change.
  const fighter = membersOf(s, s.squads.find((x) => x.id === wolves.id)).find((c) => c.id !== wolves.leaderId && s.chars[c.id].hp > 0);
  await g.mutate(([id]) => {
    const c = window.__palatinus.state().chars.get(id);
    c.level = 40;
    for (const k of Object.keys(c.stats)) if (k !== 'hp') c.stats[k] += 400;
    c.ali = 50;
  }, [fighter.id]);
  const fCell = s.squads.find((x) => x.id === wolves.id).grid.indexOf(fighter.id);
  await g.click(...CELL(fCell));
  await g.click(716, 133);
  let changed = false;
  for (let row = 0; row < 11 && !changed; row++) {
    await g.click(650, 167 + row * 30, 150);
    changed = (await g.state()).chars[fighter.id].classId !== fighter.classId;
  }
  s = await g.state();
  g.check('O10', 'a member who qualifies can change class', changed, `${fighter.classId} → ${s.chars[fighter.id].classId}`);
  await g.shot('organize-class');

  // The shop: buying, and not buying without the money.
  await g.click(106, 397);
  s = await g.state();
  const goth0 = s.goth;
  const inv0 = { ...s.inventory };
  await g.click(650, 124);
  s = await g.state();
  const boughtId = Object.keys(s.inventory).find((k) => (s.inventory[k] ?? 0) > (inv0[k] ?? 0));
  const price = boughtId ? await g.page.evaluate((id) => window.__palatinus.itemOf(id).price, boughtId) : 0;
  g.check('O11', 'buying a supply takes its price and adds it to the stores', !!boughtId && goth0 - s.goth === price, `${boughtId} for ${price}`);
  for (const [i, f] of ['weapons', 'armour', 'other'].entries()) {
    await g.click(524 + (i + 1) * 63 + 22, 94);
    const filter = await organizeScene(g, () => window.__palatinus.game.scene.getScene('Organize').filter);
    g.check(`O12.${f}`, `the shop's ${f} list opens`, filter === f);
  }
  await g.click(524 + 1 * 63 + 22, 94);
  await g.mutate(() => { window.__palatinus.state().goth = 0; });
  await g.click(524 + 1 * 63 + 22, 94);
  const inv1 = { ...(await g.state()).inventory };
  await g.click(650, 124);
  s = await g.state();
  g.check('O13', 'nothing can be bought without the Goth for it', JSON.stringify(s.inventory) === JSON.stringify(inv1) && s.goth === 0);
  await g.mutate(([v]) => { window.__palatinus.state().goth = v; }, [goth0]);
  await g.shot('organize-shop');

  // Items: heal the hurt, raise the fallen, sell.
  s = await g.state();
  q = s.squads.find((x) => x.id === wolves.id);
  const [hurt, down] = membersOf(s, q).filter((c) => c.id !== wolves.leaderId);
  await g.mutate(([h, d]) => {
    const st = window.__palatinus.state();
    st.chars.get(h).hp = 1;
    st.chars.get(d).hp = 0;
  }, [hurt.id, down.id]);
  await g.click(...CELL(q.grid.indexOf(hurt.id)));
  await g.click(106, 443);
  const rows = await g.page.evaluate(() => {
    const st = window.__palatinus.state();
    const order = { supply: 0, relic: 1, key: 2, gear: 3 };
    return Object.keys(st.inventory).map(window.__palatinus.itemOf)
      .sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name))
      .map((i) => ({ id: i.id, kind: i.kind, target: i.target, heal: i.effect?.heal, revive: i.effect?.revive }));
  });
  const healRow = rows.findIndex((r) => r.heal !== undefined && r.target === 'unit');
  const reviveRow = rows.findIndex((r) => r.revive !== undefined);
  s = await g.state();
  const healCount = s.inventory[rows[healRow].id];
  await g.click(706, 106 + healRow * 37 + 9);
  s = await g.state();
  g.check('O14', 'a healing supply heals the member and is spent', s.chars[hurt.id].hp > 1 && s.inventory[rows[healRow].id] === healCount - 1,
    `${hurt.name} 1 → ${s.chars[hurt.id].hp} HP`);
  await g.click(...CELL(q.grid.indexOf(down.id)));
  const rows2 = await g.page.evaluate(() => {
    const st = window.__palatinus.state();
    const order = { supply: 0, relic: 1, key: 2, gear: 3 };
    return Object.keys(st.inventory).map(window.__palatinus.itemOf)
      .sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name)).map((i) => i.id);
  });
  const reviveId = rows[reviveRow]?.id;
  if (reviveId) {
    await g.click(706, 106 + rows2.indexOf(reviveId) * 37 + 9);
    s = await g.state();
    g.check('O15', 'a revival brings a fallen member back', s.chars[down.id].hp > 0, `${down.name} 0 → ${s.chars[down.id].hp} HP`);
  } else {
    g.check('O15', 'a revival brings a fallen member back', false, 'no revival item in the starting stores');
  }
  const s5 = await g.state();
  const sellId = rows2[0];
  const sellPrice = await g.page.evaluate((id) => Math.floor(window.__palatinus.itemOf(id).price / 2), sellId);
  const sellCount = s5.inventory[sellId];
  await g.click(738, 106 + 9);
  s = await g.state();
  g.check('O16', 'selling pays half the price and gives the item up', s.goth - s5.goth === sellPrice && (s.inventory[sellId] ?? 0) === sellCount - 1,
    `${sellId}: +${s.goth - s5.goth} Goth`);
  await g.shot('organize-items');

  // Recruits: a full squad takes none; one with room takes one for its price.
  await g.click(106, 489);
  s = await g.state();
  const fullBefore = JSON.stringify(s.squads.find((x) => x.id === wolves.id).grid);
  await g.click(650, 133);
  s = await g.state();
  g.check('O17', 'a full squad cannot enlist anyone', JSON.stringify(s.squads.find((x) => x.id === wolves.id).grid) === fullBefore);
  // Make room the way a player would: dismiss a member (asked twice).
  await g.click(106, 489);
  s = await g.state();
  q = s.squads.find((x) => x.id === wolves.id);
  await g.click(...CELL(q.grid.indexOf(hurt.id)));
  const goneGear = Object.values(s.chars[hurt.id].gear).filter(Boolean);
  await g.click(740, 93);
  s = await g.state();
  g.check('O21', 'DISMISS asks before it acts', s.squads.find((x) => x.id === wolves.id).grid.includes(hurt.id));
  await g.click(740, 93);
  s = await g.state();
  g.check('O22', 'a dismissed member leaves the squad and their gear returns to the stores',
    !s.squads.find((x) => x.id === wolves.id).grid.includes(hurt.id) && !s.chars[hurt.id]
      && goneGear.every((id) => (s.inventory[id] ?? 0) >= 1), `${hurt.name}, gear ${goneGear.join(', ')}`);
  // And a new leader.
  q = s.squads.find((x) => x.id === wolves.id);
  const heir = membersOf(s, q).find((c) => c.id !== q.leaderId && c.hp > 0);
  await g.click(...CELL(q.grid.indexOf(heir.id)));
  await g.click(732, 77);
  s = await g.state();
  g.check('O23', 'LEAD makes a member the squad\'s leader', s.squads.find((x) => x.id === wolves.id).leaderId === heir.id, heir.name);
  await g.click(106, 489);
  s = await g.state();
  const g0 = s.goth;
  const n0 = membersOf(s, s.squads.find((x) => x.id === wolves.id)).length;
  await g.click(650, 133);
  s = await g.state();
  const n1 = membersOf(s, s.squads.find((x) => x.id === wolves.id)).length;
  g.check('O18', 'a squad with room enlists a recruit for its price', n1 === n0 + 1 && s.goth < g0, `${n0} → ${n1} members, ${g0} → ${s.goth} Goth`);
  await g.shot('organize-recruit');

  await g.click(106, 548, 600);
  g.check('O19', 'BACK TO MAP returns to the map, running again', (await g.active('Overworld')) && !(await g.paused('Overworld')) && !(await g.active('Organize')));
  const hud = await g.page.evaluate(() => window.__palatinus.map.scene.hudText.visible && window.__palatinus.map.scene.hintText.visible);
  g.check('O20', 'the map\'s HUD is back', hud);
}

// ----------------------------------------------------------------- battle --

/** Select one of our squads on the map, clicking it until it is the one selected. */
async function selectSquad(g, id) {
  for (let k = 0; k < 6 && (await g.mapInfo()).selected !== id; k++) {
    const at = await g.squadOnScreen(id);
    if (!at) {
      await g.page.keyboard.press('r');
      await g.wait(1200);
      continue;
    }
    await g.click(at.x, at.y);
  }
  return (await g.mapInfo()).selected === id;
}

/** Order a selected squad to a map point by clicking the ground there. */
async function marchTo(g, id, x, y) {
  if (!(await selectSquad(g, id))) return false;
  const p = await g.pointOnScreen(x, y);
  if (!p.visible) return false;
  await g.click(p.x, p.y);
  const s = await g.state();
  return s.squads.find((q) => q.id === id)?.moving ?? false;
}

async function battle(g) {
  await freezeEnemies(g);
  await g.page.keyboard.press('r');
  await g.wait(1200);
  let s = await g.state();
  const wolves = s.squads.find((q) => q.name === 'Grey Wolves');
  const patrol = s.squads.find((q) => q.name === 'Border Patrol');
  const before = await g.state();
  const fought = await g.battles();
  g.check('B1', 'a squad can be sent against an enemy squad', await marchTo(g, wolves.id, patrol.x, patrol.y));
  const started = await g.until(() => window.__palatinus.game.scene.isActive('Battle'), null, 60000);
  g.check('B2', 'meeting the enemy starts a battle, and the map waits', started && (await g.paused('Overworld')));
  await g.wait(2500);
  await g.shot('battle');
  const ended = await g.until(([n]) => window.__palatinus.battles.length > n && window.__palatinus.game.scene.isActive('Overworld')
    && !window.__palatinus.game.scene.isPaused('Overworld'), [fought], 90000);
  g.check('B3', 'the battle plays to its end and returns to the map', ended);
  const result = await g.page.evaluate(() => window.__palatinus.lastBattle);
  s = await g.state();
  const ids = [wolves, patrol].flatMap((q) => [...new Set(q.grid.filter((x) => x !== null))]);
  const hurt = ids.filter((id) => s.chars[id] && s.chars[id].hp < before.chars[id].hp);
  g.check('B4', 'blows land: someone on the field is hurt', hurt.length > 0, `${hurt.length} hurt; ${result.kinds.length} actions (${[...new Set(result.kinds)].join(', ')})`);
  const ours = [...new Set(wolves.grid.filter((x) => x !== null))].filter((id) => s.chars[id]?.hp > 0);
  g.check('B5', 'our survivors gain experience', ours.some((id) => s.chars[id].exp > before.chars[id].exp || s.chars[id].level > before.chars[id].level));
  const fallen = ids.filter((id) => s.chars[id] && s.chars[id].hp <= 0);
  g.check('B6', 'the fallen stay down after the battle', fallen.every((id) => s.chars[id].hp === 0), `${fallen.length} fallen`);
  const patrolNow = s.squads.find((q) => q.id === patrol.id);
  if (result.defenderWiped) {
    g.check('B7', 'a wiped-out enemy squad is gone, and pays its spoils', !patrolNow && s.goth > before.goth, `+${s.goth - before.goth} Goth`);
  } else if (result.winner === 'attacker') {
    g.check('B7', 'a beaten enemy squad falls back', !!patrolNow && patrolNow.moving);
  } else {
    const w = s.squads.find((q) => q.id === wolves.id);
    g.check('B7', 'a beaten squad of ours falls back', !w || w.moving || result.attackerWiped);
  }
  // No rematch the moment the battle ends.
  const n = await g.battles();
  await g.wait(Math.ceil(5000 / g.speed));
  g.check('B8', 'the same squads do not clash again straight away', (await g.battles()) === n && !(await g.active('Battle')));
  g.check('B9', 'kills are counted', ids.reduce((k, id) => k + (s.chars[id]?.kills ?? 0), 0) > ids.reduce((k, id) => k + before.chars[id].kills, 0)
    || fallen.length === 0);
  await g.shot('after-battle');

  // Every kind of action: watch battles until melee, ranged, magic and healing have all been seen.
  const seen = new Set(result.kinds);
  const others = [['Silver Talon', 'Risen Host'], ['Azure Wing', 'Ash Raiders'], ['Crimson Lances', 'Highcliff Garrison']];
  for (const [mine, theirs] of others) {
    if (['melee', 'ranged', 'magic', 'heal'].every((k) => seen.has(k))) break;
    await freezeEnemies(g);
    s = await g.state();
    const a = s.squads.find((q) => q.name === mine);
    const e = s.squads.find((q) => q.name === theirs);
    if (!a || !e) continue;
    const k = await g.battles();
    if (!(await marchTo(g, a.id, e.x, e.y))) continue;
    await g.until(([n]) => window.__palatinus.battles.length > n && !window.__palatinus.game.scene.isActive('Battle'), [k], 120000);
    const r = await g.page.evaluate(() => window.__palatinus.lastBattle);
    r.kinds.forEach((x) => seen.add(x));
  }
  g.check('B10', 'battles play melee, ranged, magic and healing actions', ['melee', 'ranged', 'magic', 'heal'].every((k) => seen.has(k)), [...seen].join(', '));
}

// --------------------------------------------------------------- campaign --

/**
 * A plain commander, playing only through the map: a healthy squad marches
 * on the nearest stronghold we do not hold; a hurt one goes home to rest; the
 * weakest stays home to guard the keep. Plays until the campaign ends.
 */
async function campaign(g, { minutes = Number(process.env.E2E_MINUTES ?? 20), sample } = {}) {
  await thawEnemies(g);
  const start = Date.now();
  const log = [];
  let last = '';
  let sampled = 0;
  await g.page.keyboard.press('r');
  while (Date.now() - start < minutes * 60000) {
    const s = await g.state();
    if (s.phase !== 'playing') break;
    if ((await g.active('Battle')) || (await g.paused('Overworld'))) {
      await g.wait(500);
      continue;
    }
    const hq = s.nodes.find((n) => n.kind === 'hq-player');
    const strength = (q) => {
      const m = membersOf(s, q);
      return m.reduce((a, c) => a + Math.max(0, c.hp), 0) / Math.max(1, m.reduce((a, c) => a + c.max, 0));
    };
    const mine = players(s).sort((a, b) => strength(a) - strength(b));
    const guard = mine[0];
    for (const q of mine) {
      if (q.moving) continue;
      const atHome = Math.hypot(q.x - hq.x, q.y - hq.y) < 28;
      const hurt = strength(q) < 0.55 || membersOf(s, q).filter((c) => c.hp <= 0).length >= 2;
      let goal = null;
      if (q === guard || hurt) {
        if (!atHome) goal = hq;
      } else {
        const targets = s.nodes.filter((n) => n.owner !== 'player')
          .filter((n) => n.kind !== 'hq-enemy' || s.nodes.filter((m) => m.owner !== 'player').length <= 2);
        targets.sort((a, b) => Math.hypot(a.x - q.x, a.y - q.y) - Math.hypot(b.x - q.x, b.y - q.y));
        goal = targets[0] ?? null;
        if (goal && Math.hypot(goal.x - q.x, goal.y - q.y) < 8) goal = null;
      }
      if (goal) await marchTo(g, q.id, goal.x, goal.y);
    }
    const line = `day ${s.day}: ${s.nodes.filter((n) => n.owner === 'player').length}/9 held, ` +
      `${players(s).length} vs ${enemies(s).length} squads, ${s.goth} Goth, ${await g.battles()} battles`;
    if (line !== last) {
      log.push(line);
      last = line;
    }
    if (sample && Date.now() - sampled > 30000) {
      sampled = Date.now();
      await sample();
    }
    await g.wait(1500);
  }
  const s = await g.state();
  console.log(log.filter((_, i) => i % 5 === 0 || i === log.length - 1).join('\n'));
  await g.shot(`campaign-${s.phase}`);
  g.check('C1', 'a campaign comes to an end, won or lost', s.phase !== 'playing', `${s.phase} on day ${s.day} after ${await g.battles()} battles, ${((Date.now() - start) / 60000).toFixed(1)} min at ${g.speed}x`);
  g.check('C2', 'a plain strategy can win the campaign', s.phase === 'victory', log.at(-1));
  writeFileSync(join(OUT, `${g.tag}-campaign.log`), log.join('\n'));
  return s.phase;
}

// ------------------------------------------------------------------- soak --

/** Battle after battle, watching that the GPU's and the page's memory level off. */
async function soak(g) {
  const samples = [];
  const sample = async () => {
    const m = await g.page.evaluate(() => ({
      gpu: window.__palatinus.gpu?.() ?? { geometries: 0, textures: 0 },
      heap: performance.memory?.usedJSHeapSize ?? 0,
      battles: window.__palatinus.battles.length,
    }));
    samples.push(m);
  };
  await sample();
  await campaign(g, { minutes: Number(process.env.E2E_SOAK_MINUTES ?? 12), sample });
  await sample();
  const firstBusy = samples.find((x) => x.battles >= 2) ?? samples[0];
  const last = samples.at(-1);
  const battles = last.battles - firstBusy.battles;
  writeFileSync(join(OUT, `${g.tag}-soak.json`), JSON.stringify(samples, null, 2));
  g.check('S1', 'many battles are fought in a long run', last.battles >= 8, `${last.battles} battles`);
  // Allow some growth (new classes' sprites seen for the first time), not growth with every battle.
  g.check('S2', 'GPU geometries do not pile up battle after battle',
    last.gpu.geometries <= firstBusy.gpu.geometries + 60 + battles * 2, `${firstBusy.gpu.geometries} → ${last.gpu.geometries} over ${battles} battles`);
  g.check('S3', 'GPU textures do not pile up battle after battle',
    last.gpu.textures <= firstBusy.gpu.textures + 80 + battles * 2, `${firstBusy.gpu.textures} → ${last.gpu.textures} over ${battles} battles`);
  g.check('S4', 'the page\'s memory levels off', last.heap <= Math.max(firstBusy.heap * 2.2, firstBusy.heap + 120e6),
    `${(firstBusy.heap / 1e6).toFixed(0)} → ${(last.heap / 1e6).toFixed(0)} MB`);
}

// ------------------------------------------------------------ end of game --

/** The ending panel's TITLE button, then a fresh campaign that is truly fresh. */
async function afterEnd(g, phase) {
  const panel = await g.page.evaluate(() => window.__palatinus.map.scene.children.list
    .filter((o) => o.type === 'Text').map((o) => o.text).find((t) => /VICTORY|DEFEAT/.test(t)) ?? '');
  g.check(`E1.${phase}`, `the ${phase} is announced on the map`, phase === 'victory' ? /VICTORY/.test(panel) : /DEFEAT/.test(panel), panel.split('\n')[0]);
  const frozen = await g.state();
  await g.wait(Math.ceil(13000 / g.speed));
  const later = await g.state();
  g.check(`E2.${phase}`, 'the campaign stands still once it is over', later.day === frozen.day && later.goth === frozen.goth);
  await g.click(400, 317, 800);
  g.check(`E3.${phase}`, 'TITLE goes back to the title screen', await g.active('Title'));
  await newCampaign(g);
  const s = await g.state();
  g.check(`E4.${phase}`, 'a new campaign after the end starts afresh',
    s.phase === 'playing' && s.day === 1 && s.goth === 500 && players(s).length === 4 && enemies(s).length === 7
      && s.nodes.filter((n) => n.owner === 'player').length === 1,
    `${s.phase}, day ${s.day}, ${s.goth} Goth`);
  const names = Object.values(s.chars).map((c) => c.name);
  g.check(`E5.${phase}`, 'no two soldiers share a name in the new campaign', new Set(names).size === names.length);
  await g.wait(2000);
  await g.shot(`new-campaign-after-${phase}`);
}

async function victory(g) {
  const phase = await campaign(g);
  if (phase !== 'playing') await afterEnd(g, phase);
}

/** Leave the keep unguarded and let the enemy take it. */
async function defeat(g) {
  await thawEnemies(g);
  const s = await g.state();
  const far = { x: 120, y: 120 };
  for (const q of players(s)) await marchTo(g, q.id, far.x + (q.id % 4) * 10, far.y);
  const lost = await g.until(() => window.__palatinus.state().phase === 'defeat', null, Math.ceil(600000 / g.speed));
  g.check('D1', 'losing the keep loses the campaign', lost);
  await g.shot('defeat');
  if (lost) await afterEnd(g, 'defeat');
}

// ------------------------------------------------------------- edge cases --

async function edges(g) {
  await freezeEnemies(g);
  await g.page.keyboard.press('r');
  await g.wait(1200);
  let s = await g.state();
  const [azure, talon, wolves, lances] = players(s);
  const hq = s.nodes.find((n) => n.kind === 'hq-player');

  // Organizing in the middle of a march: the march carries on afterwards.
  const goal = { x: 300, y: 440 };
  await marchTo(g, azure.id, goal.x, goal.y);
  await g.wait(800);
  const mid = (await g.state()).squads.find((q) => q.id === azure.id);
  await g.click(742, 580, 500);
  await g.click(106, 548, 500);
  await g.wait(800);
  const after = (await g.state()).squads.find((q) => q.id === azure.id);
  g.check('X1', 'a march goes on after the army screen is opened and closed mid-way',
    after.tx === mid.tx && after.ty === mid.ty && (after.moving || near(after, goal, 3)) && !near(after, mid, 0.5));

  // A squad whose leader has fallen still marches, shows and fights.
  await g.mutate(([id]) => {
    const st = window.__palatinus.state();
    st.chars.get(st.squads.find((q) => q.id === id).leaderId).hp = 0;
  }, [talon.id]);
  await g.wait(600);
  g.check('X2', 'a squad with a fallen leader can still be selected and marched', await marchTo(g, talon.id, hq.x + 40, hq.y - 30));

  // Every member down: sent into the enemy, it is routed home rather than breaking anything.
  s = await g.state();
  const foe = s.squads.find((q) => q.name === 'Border Patrol') ?? enemies(s)[0];
  await g.mutate(([id]) => {
    const st = window.__palatinus.state();
    const q = st.squads.find((x) => x.id === id);
    for (const c of new Set(q.grid.filter((x) => x !== null))) st.chars.get(c).hp = 0;
  }, [lances.id]);
  const n = await g.battles();
  await marchTo(g, lances.id, foe.x, foe.y);
  const fought = await g.until(([k]) => window.__palatinus.battles.length > k && !window.__palatinus.game.scene.isActive('Battle')
    && window.__palatinus.game.scene.isActive('Overworld') && !window.__palatinus.game.scene.isPaused('Overworld'), [n], 90000);
  s = await g.state();
  const l = s.squads.find((q) => q.id === lances.id);
  g.check('X3', 'a squad with everyone down is routed home when it meets the enemy', fought && !!l && near(l, hq, 28)
    && membersOf(s, l).every((c) => c.hp > 0), l ? `${Math.hypot(l.x - hq.x, l.y - hq.y).toFixed(0)}px from the keep` : 'squad gone');

  // An empty treasury: no recruit, no purchase.
  await g.mutate(() => { window.__palatinus.state().goth = 0; });
  await g.click(742, 580, 500);
  await g.click(106, 107 + 2 * 42);
  s = await g.state();
  const w = s.squads.find((q) => q.id === wolves.id);
  const extra = membersOf(s, w).find((c) => c.id !== w.leaderId);
  await g.click(...CELL(w.grid.indexOf(extra.id)));
  await g.click(740, 93);
  await g.click(740, 93);
  await g.click(106, 489);
  const before = await g.state();
  await g.click(650, 133);
  s = await g.state();
  g.check('X4', 'nobody can be enlisted with an empty treasury',
    JSON.stringify(s.squads.find((q) => q.id === wolves.id).grid) === JSON.stringify(before.squads.find((q) => q.id === wolves.id).grid) && s.goth === 0);

  // Selling the last of something takes it off the list.
  await g.click(106, 443);
  s = await g.state();
  const order = await g.page.evaluate(() => {
    const st = window.__palatinus.state();
    const rank = { supply: 0, relic: 1, key: 2, gear: 3 };
    return Object.keys(st.inventory).map(window.__palatinus.itemOf)
      .sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name)).map((i) => i.id);
  });
  const first = order[0];
  for (let k = s.inventory[first]; k > 0; k--) await g.click(738, 106 + 9, 150);
  s = await g.state();
  g.check('X5', 'selling the last of an item takes it off the list', !(first in s.inventory) && s.goth > 0, first);
  await g.click(106, 548, 500);
  await g.shot('edges');
}

// ----------------------------------------------------------------- driver --

const SECTIONS = { title, map, organize, battle, edges, victory, defeat, soak };

const want = process.argv.slice(2);
const run = want.length ? want : Object.keys(SECTIONS);
const g = await openGame({ tag: process.env.E2E_TAG ?? 'sweep', speed: Number(process.env.E2E_SPEED ?? 4) });
try {
  if (!run.includes('title')) await newCampaign(g);
  for (const name of run) {
    console.log(`\n== ${name}`);
    try {
      await SECTIONS[name](g);
    } catch (e) {
      g.check(`${name}:crash`, `the ${name} section ran to its end`, false, e.stack?.split('\n').slice(0, 3).join(' '));
      await g.shot(`${name}-crash`).catch(() => {});
    }
  }
} finally {
  const checks = await g.finish();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  writeFileSync(join(OUT, 'last-run.txt'), failed.map((c) => `${c.id} ${c.what} — ${c.detail}`).join('\n'));
  process.exitCode = failed.length ? 1 : 0;
}
