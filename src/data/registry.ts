import type { ClassDef, Element, RowAttack, SpellKind } from '../core/types';
import { CLASSES } from './classes';
import { withExpansion } from '../expansion';

// The active class data. The game boots on its built-in originals and swaps
// in the Ogre Battle 64 tables when they have been extracted from the user's
// ROM; either way the classes translated from the SNES Ogre Battle and
// Symphony of War are grafted on (src/expansion/). Everything that needs a
// class goes through here, so no system cares which dataset is loaded.

/** For element-dependent spell slots: the concrete spell per kind and element. */
export type SpellBook = Record<SpellKind, Partial<Record<Element, RowAttack>>>;

export interface Dataset {
  classes: Record<string, ClassDef>;
  spells: SpellBook | null;
  source: 'ob64' | 'builtin';
  label: string;
}

/** The built-in originals alone, without the expansion. */
export const ORIGINALS: Dataset = {
  classes: CLASSES,
  spells: null,
  source: 'builtin',
  label: 'Palatinus originals',
};

const BUILTIN: Dataset = withExpansion(ORIGINALS);

let active: Dataset = BUILTIN;

export function installDataset(d: Dataset): void {
  active = d;
}

export function resetDataset(): void {
  active = BUILTIN;
}

export function datasetSource(): Dataset['source'] {
  return active.source;
}

export function datasetLabel(): string {
  return active.label;
}

export function hasClass(id: string): boolean {
  return id in active.classes;
}

export function classOf(id: string): ClassDef {
  const c = active.classes[id];
  if (!c) throw new Error(`Unknown class: ${id}`);
  return c;
}

export function allClasses(): ClassDef[] {
  return Object.values(active.classes);
}

/** The spell a caster of `element` casts for a slot of `kind`, if the dataset defines one. */
export function resolveSpell(kind: SpellKind, element: Element): RowAttack | null {
  return active.spells?.[kind]?.[element] ?? null;
}
