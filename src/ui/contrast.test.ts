import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The interface's text is read off translucent panels over the 3D view, which
// may be night or a bright noon sky. Each colour text is set in must stay
// readable on a panel over any of them: at least 4.5 to 1, the WCAG AA mark
// for body text.

const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');
const TOKENS = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6}|rgba?\([^)]*\))/gi)].map((m) => [m[1], m[2]]));

type RGBA = [number, number, number, number];

function rgba(v: string): RGBA {
  if (v.startsWith('#')) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
  const [r, g, b, a = 1] = (v.match(/[\d.]+/g) ?? []).map(Number);
  return [r, g, b, a];
}

/** A translucent colour laid over an opaque one. */
function over(top: RGBA, under: RGBA): RGBA {
  return [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1) as RGBA;
}

function luminance([r, g, b]: RGBA): number {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: RGBA, b: RGBA): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The colours text is set in (gold-deep is for edges and shadows only). */
const TEXT = ['ink', 'ink-soft', 'ink-faint', 'gold', 'gold-bright', 'good', 'bad', 'warn', 'player', 'enemy', 'neutral'];
/** What may lie behind a panel: the page, a night sky, a day sky, white. */
const BEHIND = ['#0b1020', '#7f9cc4', '#c8d8f0', '#ffffff'];

describe('the interface colours', () => {
  it('read at 4.5 to 1 or better on a panel, over anything the view may show behind it', () => {
    expect(TOKENS.panel).toBeDefined();
    for (const name of TEXT) {
      expect(TOKENS[name], name).toBeDefined();
      for (const behind of BEHIND) {
        const ratio = contrast(rgba(TOKENS[name]), over(rgba(TOKENS.panel), rgba(behind)));
        expect(ratio, `--${name} on a panel over ${behind}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
