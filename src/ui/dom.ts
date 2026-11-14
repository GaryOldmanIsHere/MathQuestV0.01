// A small helper for building the interface out of plain HTML elements.

type Child = Node | string | number | null | undefined | false;

export interface Attrs {
  class?: string;
  text?: string | number;
  title?: string;
  /** A name for the automated playthrough (and for styling), as `data-ui`. */
  ui?: string;
  style?: Partial<CSSStyleDeclaration> | string;
  disabled?: boolean;
  on?: Partial<{ [E in keyof HTMLElementEventMap]: (ev: HTMLElementEventMap[E]) => void }>;
  [attr: string]: unknown;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = String(v);
    else if (k === 'text') e.textContent = String(v);
    else if (k === 'ui') e.dataset.ui = String(v);
    else if (k === 'style') {
      if (typeof v === 'string') e.setAttribute('style', v);
      else Object.assign(e.style, v);
    } else if (k === 'on') {
      for (const [ev, fn] of Object.entries(v as Record<string, EventListener>)) e.addEventListener(ev, fn);
    } else if (k === 'disabled') (e as HTMLButtonElement).disabled = Boolean(v);
    else e.setAttribute(k, String(v));
  }
  append(e, ...children);
  return e;
}

export function append(parent: Element, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.append(c instanceof Node ? c : String(c));
  }
}

/** A button that does `onClick` when pressed. */
export function button(label: string, onClick: () => void, attrs: Attrs = {}): HTMLButtonElement {
  return el('button', { type: 'button', ...attrs, class: `btn ${attrs.class ?? ''}`.trim(), on: { click: () => onClick() } }, label);
}

/** Replace an element's children. */
export function fill(parent: Element, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, ...children);
}

/** A strength bar's colour for a share of health left. */
export function hpColour(ratio: number): string {
  if (ratio > 0.5) return '#58c858';
  if (ratio > 0.25) return '#e0b838';
  return '#d04838';
}
