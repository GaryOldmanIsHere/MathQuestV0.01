# Palatinus Tactics

A playable real-time strategy RPG in the tradition of the late-90s "march your
squads across a liberation map" tactics games. Built with Phaser 3 +
TypeScript, running entirely in the browser. All art and text are original.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # run the simulation test suite
npm run build    # type-check + production bundle into dist/
```

## What's implemented

**Overworld (real-time march).** A node-and-road strategic map with a player
HQ, enemy castle, towns, and forts. Select a squad and click a stronghold to
issue a march order; squads move continuously along roads at the pace of their
slowest member. Arriving uncontested at a stronghold liberates it and flips its
flag. Owned strongholds generate income each day. Enemy squads march on your
territory on their own initiative, while garrisons hold their forts. Taking
Castle Verlaine wins the campaign; losing Fort Melchor ends it.

**Auto-battle with 3x3 formations.** When opposing squads meet on the map the
engagement resolves automatically. Each squad fields up to five members on a
3x3 grid, and the *column* a member occupies decides their battle row — front,
middle, or back — which in turn decides which attack they use and how many
times it lands. A knight in front swings twice; an archer gains a third shot
from the back rank; clerics only heal from the rear. Combatants act in agility
order, attacks target the enemy's nearest live rank first, and the side dealing
more damage wins the clash and pushes the loser back along the road. Wiped
enemy squads are destroyed; wiped player squads rout home to the keep at low
strength.

**Class structure and promotion tree.** 37 classes across the male line
(Fighter → Knight/Berserker/Ninja/Wizard/Phalanx/Fencer/Beast Tamer/Doll
Master and their elite third tiers), the female line (Amazon →
Valkyrie/Archer/Cleric/Witch/Sorceress → Freya/Diana/Priest/Siren), and
monsters. Each class carries its own base stats, per-level growths, movement
type, and a distinct attack for each of the three rows. Promotions are gated on
level, charisma, and alignment, exactly the three-axis gate the genre uses —
so a chaotic Fighter can become a Berserker or Ninja but never a Knight.

**Alignment.** Every character has an alignment from 0 (chaotic) to 100
(lawful) that drifts during battle: felling enemies stronger than you is
honorable and raises it, while preying on the weak lowers it. Since promotions
read alignment, how you fight determines which classes open up.

**Organize screen.** Browse your squads, reposition members on the formation
grid, and read a full character sheet — stats, alignment, kills, the attack
they use in each row, and every promotion the class offers with its
requirements, highlighted green when the character qualifies.

## Layout

```
src/
  core/         pure simulation, no Phaser
    types.ts       shared types, grid/row mapping
    classes*       (see data/) 
    character.ts   stat derivation, exp, promotion gates, alignment drift
    squad.ts       formation grid, march speed, auto-placement
    battle.ts      engagement simulator; returns an animatable event log
    pathing.ts     road-network routing and retreat
    state.ts       campaign state and starting scenario
  data/
    classes.ts     the class tree: stats, growths, row attacks, promotions
    names.ts       name pools and the seeded RNG
  gfx/
    pixels.ts      pixel sprite templates + per-class palette swaps
    terrain.ts     procedural terrain tiles and stronghold icons
    ui.ts          menu panel styling
  scenes/
    BootScene      renders all textures at startup
    TitleScene
    OverworldScene march orders, capture, enemy AI, encounter detection
    BattleScene    plays back the simulated engagement
    OrganizeScene  formation editing and promotions
```

The simulation in `src/core/` has no Phaser dependency — battles resolve as
pure functions over game state and emit an event log that `BattleScene` merely
animates. Sprites are authored as small ASCII templates in `gfx/pixels.ts` and
palette-swapped per class into canvas textures at boot, so the whole game ships
without a single binary asset.

## Tests

`npm test` runs 51 tests over the simulation core — the rules, not the
rendering. They cover the parts that are easy to break silently: that a
member's column really does select their attack and strike count, that the
front rank is struck before the back and combat spills backward once it falls,
that promotions gate on level, charisma, and alignment independently (a
chaotic Fighter is locked out of Knight but can reach Berserker), that
alignment drifts in the right direction and stays in bounds, that a squad
marches at its slowest member's pace, and that road routing only ever walks
real links.

A few structural tests guard the class tree itself: every promotion points at
a class that exists, stays within its gender line, never drops a tier, forms no
cycles, and every non-monster class is reachable from a tier-1 root. These
catch data-entry mistakes in `classes.ts` that no amount of playtesting would
reliably surface.

The suite was mutation-checked rather than trusted on a green run — deliberately
breaking the holy-damage bonus and the front-rank targeting rule each produced
failures, which is what confirmed those tests were actually testing something.

## Balance knobs

Class stats, growths, row attacks, and promotion requirements all live in
`src/data/classes.ts`. Damage and healing formulas are in `src/core/battle.ts`;
march speeds are in `src/core/squad.ts`; the campaign map and starting armies
are in `src/core/state.ts`.
