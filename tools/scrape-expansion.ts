// Gather the class data for the roster expansion from two public fan sources:
//
//   Ogre Battle: The March of the Black Queen (SNES) - shrines.rpgclassics.com
//   Symphony of War: The Nephilim Saga               - symphonyofwar.wiki.gg
//
//   npm run scrape:expansion
//
// Only facts are kept: class names, numbers, requirements, routes and attack
// names. The sites' written notes and descriptions are never copied; the game
// writes its own. Output goes to src/data/expansion/*.json, which is committed.
// Gunpowder classes are left out by design.
//
// Behind an HTTP proxy, run with NODE_USE_ENV_PROXY=1 so fetch honours it.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SnesClass, SowAttack, SowClass } from '../src/expansion/sources';

const SNES_BASE = 'https://shrines.rpgclassics.com/snes/ogrebattle/classes/';
const SNES_FAMILIES = [
  'fighter', 'amazon', 'dragon', 'giant', 'faerie', 'angel', 'demon', 'birdman', 'golem',
  'canine', 'wyrm', 'octopus', 'gryphon', 'mermaid', 'pumpkin', 'undead',
];
const SOW_BASE = 'https://symphonyofwar.wiki.gg';
const GUNPOWDER = new Set(['Gunner', 'Siege Cannon', 'Field Cannon']);
const NOT_CLASSES = new Set(['Promotions', 'Firearms Promotions', 'Demotions', 'Demotion']);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polite fetch: one request at a time with a pause, backing off when rate-limited. */
async function get(url: string): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(1200);
    const res = await fetch(url, { headers: { 'User-Agent': 'palatinus-class-scraper (fan project)' } });
    if (res.ok) return res.text();
    if (res.status !== 429 && res.status < 500) throw new Error(`${res.status} ${url}`);
    const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * 2 ** attempt;
    console.warn(`  ${res.status} on ${url}, retrying in ${Math.round(wait / 1000)}s`);
    await sleep(wait);
  }
  throw new Error(`gave up on ${url}`);
}

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function textOf(html: string): string {
  return decode(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- SNES ----

function parseRequirement(req: string): Pick<SnesClass, 'from' | 'level' | 'cha' | 'aliMin' | 'aliMax' | 'item' | 'formOf'> {
  const out = { from: null, level: null, cha: null, aliMin: null, aliMax: null, item: null, formOf: null } as
    Pick<SnesClass, 'from' | 'level' | 'cha' | 'aliMin' | 'aliMax' | 'item' | 'formOf'>;
  if (!req) return out;
  const inner = req.replace(/^\(|\)$/g, '').trim();
  const form = inner.match(/^(.+?) during (day|night)$/i);
  if (form) return { ...out, formOf: form[1].trim() };
  const item = inner.match(/^(?:(.+?) )?Item: (.+)$/);
  if (item) return { ...out, from: item[1]?.trim() ?? null, item: item[2].trim() };
  const lv = inner.match(/^(.+?) Lv\. (\d+)\+/);
  if (lv) {
    out.from = lv[1].trim();
    out.level = Number(lv[2]);
  }
  const cha = inner.match(/CHA (\d+)\+/);
  if (cha) out.cha = Number(cha[1]);
  const aliRange = inner.match(/ALI (\d+)-(\d+)/);
  const aliMin = inner.match(/ALI (\d+)\+/);
  if (aliRange) {
    out.aliMin = Number(aliRange[1]);
    out.aliMax = Number(aliRange[2]);
  } else if (aliMin) {
    out.aliMin = Number(aliMin[1]);
  }
  return out;
}

export function parseSnesPage(html: string, family: string): SnesClass[] {
  const t = textOf(html);
  const re = new RegExp(
    String.raw`([A-Z][A-Za-z' ]{1,24}?)\s*(\((?:[^()]|\([^)]*\))*\))?\s*` +
    String.raw`HP:\s*(\d+)\s*\+\s*(\d+)\s*STR:\s*(\d+)\s*\+\s*(\d+)\s*AGI:\s*(\d+)\s*\+\s*(\d+)\s*INT:\s*(\d+)\s*\+\s*(\d+)\s*` +
    String.raw`CHA:\s*(\d+)\s*ALI:\s*(\d+)\s*LUK:\s*(\d+)\s*` +
    String.raw`P:\s*(\d+|-)\s*F:\s*(\d+|-)\s*I:\s*(\d+|-)\s*E:\s*(\d+|-)\s*B:\s*(\d+|-)\s*W:\s*(\d+|-)\s*` +
    String.raw`Type:\s*([A-Za-z ]+?)\s*\((\d+)\)\s*Size:\s*(\w+).*?` +
    String.raw`Front Row:\s*(.+?)\s*\((\d+)\)\s*Back Row:\s*(.+?)\s*\((\d+)\)`,
    'g',
  );
  const out: SnesClass[] = [];
  for (const m of t.matchAll(re)) {
    const n = (i: number) => Number(m[i]);
    const opt = (i: number) => (m[i] === '-' ? null : Number(m[i]));
    out.push({
      name: m[1].trim(),
      family,
      ...parseRequirement((m[2] ?? '').trim()),
      hp: [n(3), n(4)], str: [n(5), n(6)], agi: [n(7), n(8)], int: [n(9), n(10)],
      cha0: n(11), ali0: n(12), luk0: n(13),
      aff: { p: opt(14), f: opt(15), i: opt(16), e: opt(17), b: opt(18), w: opt(19) },
      terrain: m[20], bulk: n(21), large: /large/i.test(m[22]),
      front: { attack: m[23].trim(), hits: n(24) },
      back: { attack: m[25].trim(), hits: n(26) },
    });
  }
  return out;
}

// ------------------------------------------------------- Symphony of War ----

function infobox(html: string): Record<string, { text: string; links: string[] }> {
  const box = html.match(/<aside[^>]*portable-infobox[\s\S]*?<\/aside>/i)?.[0] ?? '';
  const out: Record<string, { text: string; links: string[] }> = {};
  const re = /<div[^>]+class="pi-item[^"]*pi-data[^"]*"[^>]*data-source="([^"]+)"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  for (const m of box.matchAll(re)) {
    const inner = m[2].replace(/<h3[\s\S]*?<\/h3>/i, '');
    out[m[1]] = {
      text: textOf(inner),
      links: [...inner.matchAll(/<a [^>]*title="([^"]+)"/gi)].map((l) => decode(l[1])),
    };
  }
  return out;
}

function tableRows(table: string): { labels: string[]; cells: string[] }[] {
  return [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((tr) => ({
    labels: [...tr[1].matchAll(/(?:alt|title)="([^"]*)"/gi)].map((a) => decode(a[1])),
    cells: [...tr[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => textOf(c[1])),
  }));
}

function parseAttack(desc: string): SowAttack | null {
  const d = desc.toLowerCase();
  if (d === 'wait' || d === '-' || !d) return null;
  const element = d.match(/\b(lightning|fire|ice|dark|holy|light|shadow|poison)\b/)?.[1] ?? null;
  const kind: SowAttack['kind'] =
    /heal/.test(d) ? 'heal'
      : /magic/.test(d) ? 'magic'
        : /ranged|arrow|bolt|missile/.test(d) ? 'ranged'
          : /melee/.test(d) ? 'melee'
            : 'other';
  const area = desc.match(/([A-Za-z ]+AoE)/)?.[1].trim() ?? null;
  const range = d.match(/at ([\d\-]+) range/)?.[1] ?? null;
  return { kind, element, area, range };
}

const STAT_KEYS: Record<string, string> = {
  HP: 'hp', 'Max HP': 'hp', Weapon: 'weapon', Armor: 'armor', Strength: 'str', Magic: 'mag', Skill: 'skl',
};
const RATING = /^(Very Low|Low|Med|Medium|High|Very High|None|-)$/i;

function areaOf(special: string): string | null {
  if (/entire row|a row/i.test(special)) return 'row';
  if (/column/i.test(special)) return 'column';
  if (/aoe|area|all enemies|every/i.test(special)) return 'area';
  return null;
}

function num(s: string | undefined): number | null {
  const m = s?.match(/\d+/);
  return m ? Number(m[0]) : null;
}

export function parseSowPage(html: string, name: string, group: string): SowClass {
  const box = infobox(html);
  const tier = num(box.tier?.text);
  const reqs: Record<string, number> = {};
  for (const m of (box.reqs?.text ?? '').matchAll(/(\d+)\s*([A-Z]{2,4})/g)) reqs[m[2].toLowerCase()] = Number(m[1]);

  const clean = (xs: string[]) =>
    [...new Set(xs.filter((x) => !NOT_CLASSES.has(x) && !GUNPOWDER.has(x) && !/^(Category|Battle|Squad|Resources)/.test(x)))];
  const ancestors: Record<string, string[]> = {};
  for (const [key, v] of Object.entries(box)) {
    const t = key.match(/^upgrade tier (\d) units$/);
    if (t) {
      const names = clean(v.links);
      if (names.length) ancestors[t[1]] = names;
    }
  }

  const ratings: SowClass['ratings'] = {};
  const levels: SowClass['levels'] = {};
  const attacks: SowAttack[] = [];
  for (const table of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const rows = tableRows(table);
    if (/^Stats$/.test(rows[0]?.cells[0] ?? '')) {
      // Two layouts: an icon per row with ratings then numbers, or a text label
      // per row followed by its ratings only.
      for (const r of rows.slice(1)) {
        const label = STAT_KEYS[r.labels[0]] ? r.labels[0] : r.cells[0];
        const key = STAT_KEYS[label];
        if (!key) continue;
        const rated = r.cells.filter((c) => RATING.test(c));
        if (rated.length >= 2) ratings[key] = { base: rated[0], growth: rated[1] };
        const nums = r.cells.slice(r.cells.indexOf(rated[1] ?? '') + 1).map(num).filter((n) => n !== null);
        if (nums.length >= 2) levels[key] = [nums[0], nums[1]];
      }
    }
    if (/Round 1/.test(table)) {
      for (const r of rows) {
        if (/^(Round \d|Extra Attack)$/.test(r.cells[0] ?? '')) {
          const a = parseAttack(r.cells[1] ?? '');
          if (a) attacks.push(a);
        }
      }
    }
  }

  const categories = JSON.parse(`[${html.match(/"wgCategories":\[([^\]]*)\]/)?.[1] ?? ''}]`) as string[];
  return {
    name,
    group,
    tier,
    type: box.type?.text.replace(/^Type\s*/, '') ?? '',
    movement: box.movement?.text.replace(/^Movement\s*/, '') ?? '',
    leader: /yes/i.test(box.leader?.text ?? ''),
    reqs,
    into: clean(box['upgrades into']?.links ?? []),
    ancestors,
    ratings,
    levels,
    battleOrder: box['battle order']?.text.replace(/^Battle order\s*/, '') ?? '',
    area: areaOf(box['special traits']?.text ?? ''),
    traits: clean(box['unit traits']?.links ?? []),
    attacks,
    categories,
  };
}

/** The class table on the Classes page: every class name, its section, and its page. */
async function sowRoster(): Promise<{ name: string; group: string; href: string }[]> {
  const html = await get(`${SOW_BASE}/wiki/Classes`);
  const table = html.match(/<table[\s\S]*?<\/table>/i)?.[0] ?? '';
  const out: { name: string; group: string; href: string }[] = [];
  let group = '';
  for (const tr of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const heads = [...tr[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((h) => textOf(h[1]));
    const tierHead = heads.find((h) => /^Tier \d$|^Unique$|^DLC$|^Risen$|^Other$/.test(h));
    if (tierHead) group = tierHead.replace('Tier ', '').toLowerCase();
    const td = tr[1].match(/<td[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? '';
    for (const a of td.matchAll(/<a [^>]*href="(\/wiki\/[^"#]+)"[^>]*>([^<]+)<\/a>/gi)) {
      const name = decode(a[2]).trim();
      if (!GUNPOWDER.has(name)) out.push({ name, group, href: a[1] });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, '..', 'src', 'data', 'expansion');
  mkdirSync(outDir, { recursive: true });

  const snes: SnesClass[] = [];
  for (const fam of SNES_FAMILIES) {
    const classes = parseSnesPage(await get(`${SNES_BASE}${fam}.shtml`), fam);
    console.log(`  SNES ${fam.padEnd(8)} ${classes.length}`);
    snes.push(...classes);
  }
  writeFileSync(join(outDir, 'snes.json'), JSON.stringify(snes, null, 1) + '\n');

  const sow: SowClass[] = [];
  const skipped: string[] = [];
  for (const { name, group, href } of await sowRoster()) {
    const page = parseSowPage(await get(`${SOW_BASE}${href}`), name, group);
    // Unique classes redirect to a named character's page; those are not
    // classes a squad can field, and named characters are out of scope.
    if (page.categories.includes('Characters')) skipped.push(name);
    else sow.push(page);
  }
  console.log(`  Symphony of War: ${sow.length} classes (skipped named-character pages: ${skipped.join(', ') || 'none'})`);
  writeFileSync(join(outDir, 'sow.json'), JSON.stringify(sow, null, 1) + '\n');
  console.log(`Wrote ${snes.length} SNES and ${sow.length} Symphony of War classes to src/data/expansion/.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
