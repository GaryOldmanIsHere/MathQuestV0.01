// Original character and squad names (no names from the source game).

export const MALE_NAMES = [
  'Aldric', 'Bertram', 'Corwin', 'Dain', 'Edrik', 'Falk', 'Garen', 'Hadrian',
  'Ivor', 'Joren', 'Kaelen', 'Lucan', 'Merek', 'Norvin', 'Osric', 'Percival',
  'Quillon', 'Roderic', 'Soren', 'Tavish', 'Ulric', 'Varek', 'Wendel', 'Yorick',
];

export const FEMALE_NAMES = [
  'Adela', 'Brienne', 'Cassia', 'Delia', 'Elowen', 'Fiora', 'Gwyn', 'Halia',
  'Isolde', 'Junia', 'Kara', 'Liora', 'Maren', 'Nyssa', 'Ophira', 'Petra',
  'Rhea', 'Sable', 'Thessa', 'Una', 'Vera', 'Wren', 'Ysolde', 'Zara',
];

export const MONSTER_NAMES = [
  'Ash', 'Cinder', 'Dusk', 'Ember', 'Fang', 'Grim', 'Howl', 'Marrow',
  'Night', 'Omen', 'Rime', 'Shard', 'Thorn', 'Umber', 'Vex', 'Wisp',
];

export const SQUAD_NAMES = [
  'Azure Wing', 'Iron Vanguard', 'Silver Talon', 'Ember Guard', 'North Star',
  'Gale Riders', 'Oath Keepers', 'Dawn Company', 'Grey Wolves', 'Thorn Brigade',
  'Storm Watch', 'Gold Lions', 'Night Heron', 'Red Banner', 'White Ash',
];

let seed = 0x2f6e2b1;
export function rng(): number {
  // xorshift — deterministic, seedable, no Math.random (keeps sim reproducible)
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 100000) / 100000;
}

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

const given = new Set<string>();

/**
 * A name nobody in the campaign has yet. Once a pool is spent, names repeat
 * with a numeral ("Una II"), so no two soldiers ever share one.
 */
export function freshName(pool: string[]): string {
  const unused = pool.filter((n) => !given.has(n));
  let name = unused.length ? pick(unused) : pick(pool);
  for (let n = 2; given.has(name); n++) name = `${name.replace(/ [IVX]+$/, '')} ${roman(n)}`;
  given.add(name);
  return name;
}

/** Mark a name as taken (named heroes), so no recruit is given it. */
export function claimName(name: string): void {
  given.add(name);
}

/** Forget every name given: a new campaign. */
export function resetNames(): void {
  given.clear();
}

function roman(n: number): string {
  const table: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of table) while (n >= v) { out += s; n -= v; }
  return out;
}
