// The automated playthrough's tools: a browser on the game (opened with
// ?debug, which publishes the campaign's state and where things are on the
// 3D map's screen), clicks in the game's own 800x600 coordinates, a reader
// for the state, and a log of checks that ends up as a pass/fail report.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const OUT = process.env.E2E_OUT ?? 'e2e-results';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openGame({ url = 'http://localhost:5173/', speed = 4, tag = 'run' } = {}) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-precise-memory-info'],
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // A missing ob64/ file is how the game learns it has no extracted data.
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  // E2E_DATA=builtin plays on the built-in data even where OB64's is extracted,
  // by answering the game's requests for it as if the files were not there.
  // Only the extracted folder at the site's root: the game's own code lives under src/ob64/.
  if (process.env.E2E_DATA === 'builtin') await page.route(/^https?:\/\/[^/]+\/ob64\//, (r) => r.fulfill({ status: 404, body: '' }));
  await page.goto(`${url}?debug&speed=${speed}`, { waitUntil: 'networkidle' });
  // Generous: two runs side by side share the CPU with a software GPU.
  await page.waitForFunction(() => window.__palatinus?.game?.scene?.isActive('Title'), null, { timeout: 120000 });
  const box = await page.locator('canvas').boundingBox();
  const g = { browser, page, errors, box, tag, speed, checks: [], shots: 0 };

  /** A point in the game's 800x600 space, on the page. */
  g.at = (x, y) => [box.x + (x / 800) * box.width, box.y + (y / 600) * box.height];
  g.click = async (x, y, wait = 250) => {
    await page.mouse.click(...g.at(x, y));
    await sleep(wait);
  };
  g.wait = (ms) => sleep(ms);
  g.shot = async (name) => {
    const file = `${tag}-${String(++g.shots).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: join(OUT, file), clip: box });
    return file;
  };
  g.active = (scene) => page.evaluate((s) => window.__palatinus.game.scene.isActive(s), scene);
  g.paused = (scene) => page.evaluate((s) => window.__palatinus.game.scene.isPaused(s), scene);
  /** The campaign, as plain data. */
  g.state = () => page.evaluate(() => {
    const s = window.__palatinus.state();
    return {
      goth: s.goth, day: s.day, phase: s.phase, inventory: { ...s.inventory },
      nodes: s.nodes.map((n) => ({ id: n.id, name: n.name, owner: n.owner, kind: n.kind, x: n.x, y: n.y })),
      squads: s.squads.map((q) => ({
        id: q.id, name: q.name, side: q.side, x: q.x, y: q.y, moving: q.moving, tx: q.targetX, ty: q.targetY,
        leaderId: q.leaderId, nodeId: q.nodeId, grid: [...q.grid],
      })),
      chars: Object.fromEntries([...s.chars.values()].map((c) => [c.id, {
        id: c.id, name: c.name, classId: c.classId, level: c.level, exp: c.exp, hp: c.hp, max: c.stats.hp,
        ali: c.ali, kills: c.kills, gear: { ...c.gear },
      }])),
    };
  });
  /** Run something against the live state (to set up a case the UI then exercises). */
  g.mutate = (fn, arg) => page.evaluate(fn, arg);
  g.squadOnScreen = async (id) => {
    const p = await page.evaluate((i) => window.__palatinus.map.squadOnScreen(i), id);
    return p && p.visible ? p : null;
  };
  g.pointOnScreen = (x, y) => page.evaluate(([a, b]) => window.__palatinus.map.pointOnScreen(a, b), [x, y]);
  g.mapInfo = () => page.evaluate(() => ({
    selected: window.__palatinus.map.selectedId(),
    hint: window.__palatinus.map.hint(),
    view: window.__palatinus.map.view(),
  }));
  g.battles = () => page.evaluate(() => window.__palatinus.battles.length);
  /** Wait until a condition on the page holds, or give up. */
  g.until = async (fn, arg, ms = 60000) => {
    try {
      await page.waitForFunction(fn, arg, { timeout: ms, polling: 200 });
      return true;
    } catch {
      return false;
    }
  };

  /** Record a check: an id from the checklist, what it means, whether it held, and why. */
  g.check = (id, what, ok, detail = '') => {
    g.checks.push({ id, what, ok: !!ok, detail: String(detail) });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${what}${detail ? ` — ${detail}` : ''}`);
    return !!ok;
  };
  g.finish = async () => {
    g.check(`${tag}:console`, 'no errors in the browser console', errors.length === 0, errors.slice(0, 5).join(' | '));
    writeFileSync(join(OUT, `${tag}.json`), JSON.stringify({ tag, checks: g.checks, errors }, null, 2));
    await browser.close();
    return g.checks;
  };
  return g;
}

/** Start a new campaign from the title screen. */
export async function newCampaign(g) {
  await g.click(400, 320, 300);
  return g.until(() => window.__palatinus.game.scene.isActive('Overworld') && !!window.__palatinus.map, null, 20000);
}

/** Leave the map with every hostile squad held still, so a case plays out undisturbed. */
export async function freezeEnemies(g) {
  await g.mutate(() => {
    const s = window.__palatinus.state();
    for (const q of s.squads) if (q.side === 'enemy') { q.moving = false; q.targetX = null; q.targetY = null; }
    const sc = window.__palatinus.map.scene;
    sc.aiTimer = -1e9;
  });
}

/** Let the enemy march again after freezeEnemies. */
export async function thawEnemies(g) {
  await g.mutate(() => { window.__palatinus.map.scene.aiTimer = 0; });
}

