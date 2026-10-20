// The interface's pieces on one page, with the dev server running:
// /tools/ui-preview.html. Every icon, and the panels, buttons, chips, rows,
// bars and tooltips the screens are built from.

import '../src/ui/styles.css';
import { button, el } from '../src/ui/dom';
import { icon, ICONS } from '../src/ui/icons';

const out = document.getElementById('out')!;
const section = (title: string, ...children: (Node | string)[]) =>
  el('section', { class: 'panel', style: 'padding: 16px 18px; display: grid; gap: 12px;' }, el('h2', {}, title), ...children);

out.append(
  section('Icons', el('div', { style: 'display: grid; grid-template-columns: repeat(auto-fill, 92px); gap: 10px;' },
    ...ICONS.map((n) => el('div', { style: 'display: grid; justify-items: center; gap: 4px; font-size: 12px; color: var(--ink-soft);' }, icon(n, 28), n)))),
  section('Buttons', el('div', { style: 'display: flex; gap: 10px; flex-wrap: wrap; align-items: center;' },
    button('Primary', () => {}, { class: 'btn-primary' }),
    button('Plain', () => {}),
    button('Small', () => {}, { class: 'btn-small' }),
    button('Quiet', () => {}, { class: 'btn-quiet' }),
    button('Danger', () => {}, { class: 'btn-danger btn-small' }),
    button('Disabled', () => {}, { disabled: true }),
    el('span', { class: 'chip', 'data-tip': 'A tooltip' }, icon('star', 12), 'Chip with tip'),
    el('span', { class: 'kbd' }, 'Esc'))),
  section('Rows and bars', el('div', { class: 'rows', style: 'max-width: 420px;' },
    el('button', { type: 'button', class: 'row' }, el('span', { class: 'row-icon' }, icon('sword', 18)), el('span', { class: 'v' }, 'Iron Sword'), el('span', { class: 'sub' }, 'Sword STR+4'), el('span', { class: 'price gold' }, '120g')),
    el('button', { type: 'button', class: 'row is-on' }, el('span', { class: 'row-icon' }, icon('shield', 18)), el('span', { class: 'v' }, 'Oak Pavise'), el('span', { class: 'sub' }, 'Large shield DEF+4'))),
    el('div', { class: 'bar', style: 'width: 200px; height: 8px;' }, el('div', { class: 'bar-chip', style: 'width: 80%; position: absolute; inset: 0 auto 0 0;' }), el('div', { class: 'bar-fill', style: 'width: 55%; position: absolute; inset: 0 auto 0 0;' }))),
);
