// The performance probe: how long the game takes to boot, how long its
// frames take on each screen, and whether the graphics card's memory holds
// level over a run of battles (the leak check).
//
//   npm run dev            (in another terminal)
//   npm run perf           the Low preset, five battles
//   npm run perf -- high 3 a preset, and how many battles
//
// It plays on the built-in data, at four times speed, and prints one JSON
// report. Frame times on a software GPU say little about a real machine's:
// compare runs on the same machine, not across machines.

import { openGame } from './harness.mjs';

const [quality = 'low', count = '5'] = process.argv.slice(2);
process.env.E2E_QUALITY = quality;
process.env.E2E_DATA = 'builtin';
const battles = Number(count);
const FIELDS = ['road', 'forest', 'water', 'mountain', 'plain'];

const g = await openGame({ tag: 'perf', speed: 4 });
const { page } = g;

/** Frame times over `ms` (median and 95th percentile), and the CPU time of each draw. */
const sample = (ms) => page.evaluate((ms) => new Promise((done) => {
  const frames = [];
  let last = performance.now();
  const end = last + ms;
  window.__drawMs = [];
  const tick = (t) => {
    frames.push(t - last);
    last = t;
    if (t < end) return requestAnimationFrame(tick);
    const at = (a, k) => (a.length ? +[...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * k))].toFixed(1) : 0);
    done({ frames: frames.length, medianMs: at(frames, 0.5), p95Ms: at(frames, 0.95), drawCpuMedianMs: at(window.__drawMs, 0.5), draws: window.__drawMs.length });
  };
  requestAnimationFrame(tick);
}), ms);

const memory = () => page.evaluate(() => ({ ...window.__palatinus.gpu(), heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1e6) }));

const report = { quality, battles };
report.boot = await page.evaluate(() => Object.fromEntries(performance.getEntriesByType('measure').filter((m) => m.name.startsWith('boot:')).map((m) => [m.name, Math.round(m.duration)])));
// Time the CPU's side of each draw.
await page.evaluate(() => {
  const engine = window.__palatinus.engine;
  const render = engine.render.bind(engine);
  engine.render = (view) => {
    const t = performance.now();
    render(view);
    window.__drawMs?.push(performance.now() - t);
  };
});
report.title = await sample(4000);
await g.ui('new-campaign', { wait: 0 });
await page.waitForFunction(() => !!window.__palatinus?.map, null, { timeout: 120000 });
await g.wait(3000);
report.map = await sample(6000);
await g.ui('organize', { wait: 1500 });
report.armyScreen = await sample(4000);
await g.ui('back-to-map', { wait: 1000 });

report.memory = [await memory()];
for (let i = 0; i < battles; i++) {
  const asked = Date.now();
  await page.evaluate((field) => {
    const P = window.__palatinus;
    const s = P.state();
    const mine = s.squads.find((q) => q.side === 'player');
    const theirs = s.squads.find((q) => q.side === 'enemy');
    P.map.fight(mine.id, theirs.id, field);
  }, FIELDS[i % FIELDS.length]);
  // Open: until the field is shown (its shaders prepared).
  await page.waitForFunction(() => !!document.querySelector('[data-ui="battle"]:not(.is-preparing)'), null, { timeout: 60000 });
  const openMs = Date.now() - asked;
  if (i === 0) report.battle = { openMs, ...(await sample(6000)) };
  await page.waitForFunction(() => !document.querySelector('[data-ui="battle"]'), null, { timeout: 300000 });
  await g.wait(800);
  // Every unit whole again, so the next battle is the same fight.
  await page.evaluate(() => { for (const c of window.__palatinus.state().chars.values()) c.hp = c.stats.hp; });
  report.memory.push(await memory());
}
const tex = report.memory.map((m) => m.textures);
report.texturesAfterFirstBattle = tex.slice(1);
report.leakSuspected = tex.length > 3 && tex[tex.length - 1] - tex[1] > 4 * (tex.length - 2);
report.errors = g.errors;
console.log(JSON.stringify(report, null, 2));
await g.browser.close();
