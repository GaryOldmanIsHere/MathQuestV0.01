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
