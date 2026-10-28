import type { App } from '../app/app';
import { QUALITIES, saveAdaptive, saveQuality } from '../render/quality';
import type { Quality } from '../render/quality';
import { button, el } from '../ui/dom';
import { icon } from '../ui/icons';
import { BATTLE_PACES, comfort, MOTIONS, setComfort, UI_SCALES } from '../ui/comfort';
import type { Motion } from '../ui/comfort';

// The settings sheet, opened from the title or the map: how hard the
// renderer works, the interface's size, how much moves on screen, how fast
// battles play out, and the keys. It sits over whatever screen opened it.

export const QUALITY_LABEL: Record<Quality, string> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' };

/** A choice of graphics preset, applied at once and kept in this browser. */
export function qualitySelect(app: App, ui = 'quality'): HTMLSelectElement {
  return el('select', {
    class: 'select', ui, 'aria-label': 'Graphics quality',
    on: {
      change: (e) => {
        const q = (e.target as HTMLSelectElement).value as Quality;
        app.engine.setQuality(q);
        saveQuality(q);
      },
    },
  }, ...QUALITIES.map((q) => el('option', { value: q, selected: q === app.engine.currentQuality ? '' : undefined }, QUALITY_LABEL[q])));
}

const MOTION_LABEL: Record<Motion, string> = { system: 'As the system asks', reduce: 'Reduced', full: 'Full' };
const PACE_LABEL: Record<number, string> = { 1: 'Steady', 1.5: 'Brisk (1.5×)', 2: 'Swift (2×)' };

/** A choice among `values`, shown by `label`, calling `change` with the one chosen. */
function choice<T extends string | number>(ui: string, aria: string, values: readonly T[], now: T, label: (v: T) => string, change: (v: T) => void): HTMLSelectElement {
  return el('select', {
    class: 'select', ui, 'aria-label': aria,
    on: { change: (e) => change(values[(e.target as HTMLSelectElement).selectedIndex]) },
  }, ...values.map((v) => el('option', { value: String(v), selected: v === now ? '' : undefined }, label(v))));
}

const KEYS: [string[], string][] = [
  [['Drag'], 'Pan the map'],
  [['Right-drag'], 'Turn the map'],
  [['Wheel'], 'Zoom'],
  [['W', 'A', 'S', 'D'], 'Pan'],
  [['Q', 'E'], 'Turn'],
  [['1', '–', '9'], 'Choose a squad'],
  [['Space'], 'Find the chosen squad'],
  [['M'], 'March the chosen squad on a stronghold'],
  [['R'], 'The whole map'],
  [['O'], 'The army screen'],
  [['Esc'], 'Close a sheet or the army screen'],
  [['F3'], 'Frame rate'],
];

/**
 * Open the settings sheet over `host` (one at a time); Escape or the close
 * button shuts it. While it is open, Tab moves only among its own controls,
 * and on closing, the keyboard's place returns to whatever opened it.
 */
export function openSettings(app: App, host: HTMLElement): void {
  if (host.querySelector('.settings')) return;
  const opener = document.activeElement as HTMLElement | null;
  const close = () => {
    panel.remove();
    window.removeEventListener('keydown', onKey, true);
    opener?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Tab') {
      keepFocusWithin(panel, e);
      return;
    }
    // The sheet's own keys stay with it (the map beneath moves on arrows and letters).
    if (panel.contains(e.target as Node)) e.stopPropagation();
    if (e.code !== 'Escape') return;
    e.stopPropagation();
    close();
  };
  const shut = button('', close, { class: 'btn-icon btn-quiet', ui: 'settings-close', 'aria-label': 'Close' });
  shut.append(icon('close', 18));
  const c = comfort();
  const adaptive = el('input', {
    type: 'checkbox', ui: 'settings-adaptive', checked: app.engine.governor.enabled ? '' : undefined,
    on: { change: (e) => { const on = (e.target as HTMLInputElement).checked; app.engine.setAdaptive(on); saveAdaptive(on); } },
  });
  const row = (k: string, control: HTMLElement, note?: string) => el('label', { class: 'settings-row' },
    el('span', { class: 'k' }, k, note ? el('small', {}, note) : null), control);
  const panel = el('div', { class: 'settings panel', ui: 'settings-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' },
    el('div', { class: 'settings-head' }, el('h2', {}, 'Settings'), shut),
    row('Graphics', qualitySelect(app, 'settings-quality')),
    row('Adaptive resolution', adaptive, 'Fewer pixels while frames come slowly'),
    row('Interface size', choice('settings-scale', 'Interface size', UI_SCALES, c.uiScale, (v) => `${Math.round(v * 100)}%`, (uiScale) => setComfort({ uiScale }))),
    row('Motion', choice('settings-motion', 'Motion', MOTIONS, c.motion, (v) => MOTION_LABEL[v], (motion) => setComfort({ motion })), 'Reduced: no camera shake, softer flashes'),
    row('Battle pace', choice('settings-pace', 'Battle pace', BATTLE_PACES, c.battlePace, (v) => PACE_LABEL[v], (battlePace) => setComfort({ battlePace }))),
    el('h3', {}, 'Keys'),
    el('div', { class: 'settings-keys' }, ...KEYS.flatMap(([keys, what]) => [
      el('span', {}, ...keys.map((k) => (k === '–' ? ' – ' : el('span', { class: 'kbd' }, k)))),
      el('span', {}, what),
    ])),
  );
  host.append(panel);
  window.addEventListener('keydown', onKey, true);
  shut.focus();
}

/** Keep Tab and Shift-Tab cycling among a sheet's own controls. */
export function keepFocusWithin(sheet: HTMLElement, e: KeyboardEvent): void {
  const stops = [...sheet.querySelectorAll<HTMLElement>('button, select, input, [tabindex]:not([tabindex="-1"])')].filter((x) => !(x as HTMLButtonElement).disabled);
  if (!stops.length) return;
  const first = stops[0];
  const last = stops[stops.length - 1];
  const at = document.activeElement;
  if (e.shiftKey && (at === first || !sheet.contains(at))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (at === last || !sheet.contains(at))) {
    e.preventDefault();
    first.focus();
  }
}
