// The interface's icons, drawn here as small line drawings on a 24-unit
// square (SVG, in the text's own colour), so they stay sharp at any size
// and need nothing fetched.

/** A cog of eight teeth about the middle of the square, as a path. */
function cog(): string {
  const pts: string[] = [];
  const teeth = 8;
  for (let k = 0; k < teeth * 4; k++) {
    // Each tooth: up its flank, across its top, down, along the root.
    const a = ((k - 0.5) / (teeth * 4)) * Math.PI * 2;
    const r = k % 4 === 1 || k % 4 === 2 ? 9 : 6.6;
    pts.push(`${(12 + Math.cos(a) * r).toFixed(2)} ${(12 + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

const PATHS = {
  coin: 'M12 4.5a7.5 7.5 0 1 0 0 15a7.5 7.5 0 1 0 0-15Z M12 8v8 M9.5 9.8c.6-.9 1.5-1.3 2.5-1.3 1.6 0 2.5.8 2.5 1.8 0 2.3-5 1.2-5 3.6 0 1 .9 1.9 2.6 1.9 1 0 2-.4 2.6-1.2',
  castle: 'M4 20V9h2.5v2h2V9H11v2h2V9h2.5v2h2V9H20v11Z M10 20v-4.5a2 2 0 0 1 4 0V20 M7 6l1.5-2L10 6 M14 6l1.5-2L17 6',
  flag: 'M6 21V4 M6 4.5c3-1.5 5 1.5 8 0s4-1 4-1v8s-1-.5-4 1-5-1.5-8 0',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8Z M12 2.5v2.5 M12 19v2.5 M2.5 12H5 M19 12h2.5 M5.3 5.3l1.8 1.8 M16.9 16.9l1.8 1.8 M5.3 18.7l1.8-1.8 M16.9 7.1l1.8-1.8',
  moon: 'M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5Z',
  dawn: 'M4 18h16 M7 18a5 5 0 0 1 10 0 M12 6v3 M5.5 10.5l1.8 1.5 M18.5 10.5l-1.8 1.5 M2 21h20',
  cloud: 'M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 9.5 3.8 3.8 0 0 1 17.5 18Z',
  rain: 'M7 14a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 5.5 3.8 3.8 0 0 1 17.5 14Z M8 17l-1 3 M12 17l-1 3 M16 17l-1 3',
  snow: 'M12 3v18 M4.2 7.5l15.6 9 M4.2 16.5l15.6-9 M10 4.5 12 6l2-1.5 M10 19.5 12 18l2 1.5',
  mist: 'M4 9h16 M6 13h14 M4 17h13',
  sword: 'M14.5 4.5 20 4l-.5 5.5-9 9-3-3Z M8.5 14.5 5 18 M6 13l5 5 M4 20l1.5-1.5',
  shield: 'M12 3 19 6v5.5c0 4.5-3 7.5-7 9.5-4-2-7-5-7-9.5V6Z',
  staff: 'M8 20 16.5 7.5 M15 4.5a2.5 2.5 0 1 0 3 3 M18 3.5l.5-1.5 M20.5 6l1.5-.5',
  bow: 'M6 4c7 2 10 7 10 14 M6 4l10 14 M4 12h12 M13 9l3 3-3 3',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  crown: 'M4 17 3 7l5 4 4-6 4 6 5-4-1 10Z M4 20h16',
  march: 'M5 19c2 0 3-2 3-4V9 M8 11l3-2 M14 19c2 0 3-2 3-4v-2 M17 15l3-1 M13 5.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0Z M4 5.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0Z',
  rest: 'M3 18h18 M5 18v-5h14v5 M7 13V9h4v4 M16 6h3l-3 3h3 M13 4h2l-2 2h2',
  route: 'M6 18a2 2 0 1 0 0-4a2 2 0 1 0 0 4Z M18 9a2 2 0 1 0 0-4a2 2 0 1 0 0 4Z M7.5 14.5C10 11 11 15 13 12s3-4 3.5-4.5',
  bag: 'M6 8h12l1 12H5Z M9 8V6a3 3 0 0 1 6 0v2',
  people: 'M9 11a3 3 0 1 0 0-6a3 3 0 1 0 0 6Z M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6 M16 11a2.5 2.5 0 1 0 0-5 M17.5 14c2 .6 3.5 2.6 3.5 5',
  gear: `${cog()} M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5Z`,
  close: 'M6 6l12 12 M18 6 6 18',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z',
  skull: 'M12 3a7 7 0 0 0-7 7c0 2.5 1.2 4 2.5 5V18h9v-3c1.3-1 2.5-2.5 2.5-5a7 7 0 0 0-7-7Z M9 11h.01 M15 11h.01 M10 21v-3 M14 21v-3',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2Z M9 4v14 M15 6v14',
  key: 'M8 14a4 4 0 1 0 0-8a4 4 0 1 0 0 8Z M11 11h10 M18 11v3 M15 11v2',
  // The elements.
  flame: 'M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2.5-5 .5 1.5 1.5 2.5 2.5 2.5C12 8 11 6 12 3Z',
  water: 'M12 3.5C9 8 6.5 11 6.5 14a5.5 5.5 0 0 0 11 0c0-3-2.5-6-5.5-10.5Z',
  wind: 'M3 9h11a2.5 2.5 0 1 0-2.5-2.5 M3 13h15a2.5 2.5 0 1 1-2.5 2.5 M3 17h7',
  earth: 'M3 19 9 9l3.5 5L15 10l6 9Z M7.5 11.5 9 13l1.5-1.5',
  virtue: 'M12 4v16 M7 9h10 M12 4l-1.5 2h3Z',
  bane: 'M15 4a8 8 0 1 0 5 13A7 7 0 0 1 15 4Z M8 9l.5 1.5L10 11l-1.5.5L8 13l-.5-1.5L6 11l1.5-.5Z',
  drakonite: 'M12 3 18 9l-6 12L6 9Z M6 9h12 M12 3v18',
  physical: 'M14.5 4.5 20 4l-.5 5.5-9 9-3-3Z M8.5 14.5 5 18 M6 13l5 5',
} as const;

export type IconName = keyof typeof PATHS;

/** An icon as an SVG element, `size` pixels square, in the colour of the text about it. */
export function icon(name: IconName, size = 18, title?: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', `icon icon-${name}`);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (title) {
    svg.setAttribute('role', 'img');
    const t = document.createElementNS(ns, 'title');
    t.textContent = title;
    svg.append(t);
  } else svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', PATHS[name]);
  svg.append(path);
  return svg;
}

/** Every icon's name (for the tests). */
export const ICONS = Object.keys(PATHS) as IconName[];

/** The path each icon is drawn with (for the tests). */
export function iconPath(name: IconName): string {
  return PATHS[name];
}
