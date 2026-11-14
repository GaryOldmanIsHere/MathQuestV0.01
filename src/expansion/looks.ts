// Whose Ogre Battle 64 art each translated class wears, by Ogre Battle 64
// class number (the order of its class table), when the player has
// extracted the sprites. Chosen by likeness: the same class where Ogre
// Battle 64 has it, else its nearest kin (a samurai dresses as a fencer, a
// giant of fire as a giant). A class left out keeps Palatinus's pixel art.

export const LOOKS: Record<string, number> = {
  // March of the Black Queen
  fighter: 2, knight: 5, paladin: 19, vampyre: 43, coffin: 43, 'wild-man': 6,
  'evil-one': 116, werewolf: 42, 'tiger-man': 3, 'beast-man': 3, 'beast-master': 24,
  dragoner: 14, 'dragon-master': 29, 'doll-mage': 10, 'doll-master': 25,
  ninja: 11, 'ninja-master': 26, wizard: 12, mage: 12, sorcerer: 27, lich: 38,
  samurai: 7, 'samurai-master': 22, amazon: 4, valkyrie: 15, muse: 30, witch: 16,
  cleric: 18, shaman: 18, monk: 32, princess: 33,
  dragon: 56, 'red-dragon': 58, 'red-dragon-ii': 58, salamand: 64, 'silver-dragon': 61,
  'gold-dragon': 63, 'platinum-dragon': 61, 'black-dragon': 62, tiamat: 68,
  'zombie-dragon': 164,
  giant: 77, 'fire-giant': 77, 'ice-giant': 77, titan: 77,
  faerie: 51, pixie: 51, sylph: 51, angel: 36, cherubim: 36, seraphim: 37,
  imp: 52, demon: 116, devil: 116, 'hawk-man': 39, 'eagle-man': 40, 'raven-man': 41,
  golem: 78, 'rock-golem': 79, 'iron-golem': 80, hellhound: 75, cerberus: 76,
  wyrm: 69, wyvern: 70, octopus: 66, kraken: 66, gryphon: 71, cockatris: 73,
  mermaid: 31, nixie: 31, pumpkin: 50, halloween: 50,
  skeleton: 47, wraith: 48, ghost: 48, phantom: 48,
  // Symphony of War
  bowman: 13, militia: 1, medic: 18, drakeling: 56, acolyte: 18, soldier: 1,
  spearman: 8, archer: 13, crossbowman: 13, rogue: 7, skirmisher: 7, swordfighter: 2,
  apprentice: 12, priestess: 18, siren: 31, cavalier: 5, horsebow: 13, hospitaller: 19,
  scout: 7, sentinel: 8, champion: 22, zweihander: 81, centurion: 34, 'blue-dragon': 60,
  ranger: 28, assassin: 26, swordmaster: 22, warbow: 28, templar: 115,
  'fire-mage': 27, 'lightning-mage': 27, 'ice-mage': 27, sorceress: 17,
  hussar: 23, raider: 6, 'blue-dragon-rider': 60, 'silver-dragon-rider': 61,
  'red-dragon-rider': 58, necromancer: 92, 'dark-mage': 92,
  'risen-spearman': 47, 'risen-soldier': 47, 'risen-swordsman': 47, 'risen-archer': 47,
  'risen-warrior': 47, 'risen-knight': 47, 'risen-archmage': 38, arbalest: 13,
  'war-cat': 75, behemoth: 76, oracle: 32,
};
