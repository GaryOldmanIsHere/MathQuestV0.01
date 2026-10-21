import type { App } from '../app/app';
import { QUALITIES, saveQuality } from '../render/quality';
import type { Quality } from '../render/quality';
import { button, el } from '../ui/dom';
import { icon } from '../ui/icons';

// The settings sheet, opened from the title or the map: how hard the
// renderer works, and the keys. It sits over whatever screen opened it.

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

const KEYS: [string[], string][] = [
  [['Drag'], 'Pan the map'],
  [['Right-drag'], 'Turn the map'],
  [['Wheel'], 'Zoom'],
  [['W', 'A', 'S', 'D'], 'Pan'],
  [['Q', 'E'], 'Turn'],
  [['1', '–', '9'], 'Choose a squad'],
  [['Space'], 'Find the chosen squad'],
  [['R'], 'The whole map'],
  [['O'], 'The army screen'],
  [['Esc'], 'Close a sheet or the army screen'],
  [['F3'], 'Frame rate'],
];

/** Open the settings sheet over `host` (one at a time); Escape or the close button shuts it. */
export function openSettings(app: App, host: HTMLElement): void {
  if (host.querySelector('.settings')) return;
  const close = () => {
    panel.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Escape') return;
    e.stopPropagation();
    close();
  };
  const shut = button('', close, { class: 'btn-icon btn-quiet', ui: 'settings-close', 'aria-label': 'Close' });
  shut.append(icon('close', 18));
  const panel = el('div', { class: 'settings panel', ui: 'settings-panel', role: 'dialog', 'aria-label': 'Settings' },
    el('div', { class: 'settings-head' }, el('h2', {}, 'Settings'), shut),
    el('label', { class: 'settings-row' }, el('span', { class: 'k' }, 'Graphics'), qualitySelect(app, 'settings-quality')),
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
