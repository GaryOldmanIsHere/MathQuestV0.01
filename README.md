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

## Playing on Ogre Battle 64's own data

If you own Ogre Battle 64: Person of Lordly Caliber (USA, Rev A), Palatinus
can run on the real game's class tables instead of its built-in originals:

```bash
npm run extract:ob64 -- path/to/your/ogre-battle-64.z64   # .n64 and .v64 work too
npm run dev
```

The title screen confirms it with *Class data: Ogre Battle 64 (d26b14be) +
expansion · 190 classes*: the game's 106, plus the expansion below.

**What stays on your machine.** The extractor reads your ROM and writes
`public/ob64/data.json`. That folder is git-ignored and must stay that way: it
is copyrighted game data, and this repository only ever contains the code that
reads it. The ROM dump itself is ignored too. Note that `npm run build` copies
`public/` into `dist/`, so don't publish a build made while the data is
present. Without the extracted file, the game simply runs on its originals,
which is also what CI and anyone else who clones the repo gets.

The extractor checks the dump's SHA-1 (`d26b14be…`) and refuses anything else,
because every table is read from a fixed address in that exact revision.

**What comes over, and how faithfully.** Everything below was located in the
ROM and its layout confirmed against the game's own code, using the
disassembly from the [OB64 recompilation project](https://github.com/lfarroco/ogre-battle-64-recomp):

| From the ROM, directly | Derived from ROM structure | Inferred, and labelled as such |
|---|---|---|
| 166 class records: stats and per-level growth, starting alignment and Luck, resistances to physical and the six elements, size, movement type, element, default equipment | The player's class tree, from each class's promotion lineage | Which stats a class change demands and its alignment window: a rule fitted to the documented Knight, Berserker, Wizard and Paladin gates, which it reproduces exactly |
| Each row's attack and hit count | Each element's spell family (a Wizard of Earth casts Acid Vapor; of Flame, Fireball) from the shape of the attack table | How resistances scale damage, until the battle formula is decoded |
| 159 attacks: category, element, target, effect | Story and boss classes, kept out of the player's tree by where they sit in the table | |
| Level gates, lineage, and the level-up roll (growth + 0–2 per stat, capped at 999) | | |

With the data loaded, Ogre Battle 64's own rules apply: units grow as whichever
class their lineage says they were at each level, a class change keeps a unit's
stats, an enemy "Paladin" below level 15 takes the field as the Knight it still
is, and every human recruit rolls an element that decides their spells.

## The class expansion

On top of whichever dataset is loaded, Palatinus grafts on the classes of two
other games, translated into Ogre Battle 64's model:

| Source | What it gives | Classes added (originals / OB64) |
|---|---|---|
| *Ogre Battle: The March of the Black Queen* (SNES), from [the RPGClassics shrine](https://shrines.rpgclassics.com/snes/ogrebattle/classes.shtml) | HP, STR, AGI and INT as base + growth; six affinities; starting alignment and luck; two row attacks with hit counts; each class's route (from which class, at what level, in what alignment window, or by which item) | 53 / 39 |
| *Symphony of War: The Nephilim Saga*, from [the Symphony of War wiki](https://symphonyofwar.wiki.gg) | Low / Med / High ratings for each stat's base and growth; unit type (heavy or light infantry, cavalry, flier, caster, healer); the stat a promotion asks for; which classes each upgrades into | 47 / 45 |

That is 136 classes on the originals, 190 on Ogre Battle 64's data, with
classes now reaching a fourth tier (Dragon Master, Lich, the Dragon Riders,
the Dark Mage). Gunpowder classes are left out by design. Named characters
are not classes and are not taken.

**How a class is translated.** Neither game uses Ogre Battle 64's seven stats
or its scale, so stats carry over *relatively*: a SNES class's standing
against the other SNES classes of its tier becomes the same standing against
the active dataset's classes of that tier. A Symphony of War rating does the
same with Med as the tier average. VIT, MEN and DEX, which neither game has,
come from the nearest things each does have: HP and physical affinity, INT
and elemental affinity, AGI and STR for the SNES; armour, magic and skill for
Symphony of War. SNES affinities become resistances (its undead, immune to
all but holy power, stay that way). Attacks are named for what they are:
*Jihad* is Virtue magic that hits everyone, *Magic* is an element slot cast in
the caster's own element, a Symphony of War Fire Mage throws Fire at a whole
row. Large monsters and Colossal dragons fill two places.

**Merging.** When a class already exists (Ogre Battle 64's Knight, the
originals' Wizard) the existing one wins untouched and the other game only
adds its routes into it. So a SNES Beast Man can become Ogre Battle 64's own
Beast Master, and Symphony of War's Soldier and Cavalier both become Knights.
Its generic recruit, the Fighter, is Ogre Battle 64's Fighter *and* Amazon,
so its whole tree opens to women too. Most Symphony of War classes are open to
either gender; a unit only sees the class changes its gender can hold. On
Ogre Battle 64's data the new routes are stat-gated by the same rule as the
game's own, led by the stat Symphony of War names (a Scout asks for DEX).
Routes that consume an item (the SNES Werewolf's *Virus*, the Lich's
*Undead Ring*) show it and stay shut until Phase 2 brings items.

**Squad types.** How a squad marches now follows from its make-up, by
Symphony of War's rules. Each class is slow (casters, healers), heavy, light,
heavy or light cavalry, or a flier. A squad is *flying* when fliers are at
least as many as the rest with no horses or grounded giants among them;
*cavalry* when horses outnumber the infantry; *slow* when half are casters;
*light* when light troops outnumber the rest by one; *heavy* otherwise. Light
troops are not slowed by forest or hills, heavy cavalry is quick on open
ground and bogged down in rough, fliers ignore the ground and the road alike.

**Recruiting.** The Organize screen's *Recruit* button enlists any playable
tier-1 class into the selected squad for Goth: Bowmen, Militia, Medics and
Drakelings from Symphony of War, Angels, Imps, Giants, Mermaids and more from
the SNES game, alongside each dataset's own.

The scraped facts live in `src/data/expansion/*.json`. They hold numbers,
names and routes only; none of either site's writing is copied, and the
descriptions in game are Palatinus's own. `npm run scrape:expansion`
regenerates them, pausing between requests.

## What's implemented

**Overworld (free real-time march).** An open strategic map with a player HQ,
enemy castle, towns, and forts. Select a squad and click *anywhere* — squads
march in a straight line to any point you pick, not along a fixed network.
Clicks landing near a stronghold snap onto it so capturing stays easy to aim.
A squad that halts within an uncontested stronghold's radius liberates it and
flips its flag; owned strongholds generate income each day. Enemy squads pick
the nearest player holding and drive straight at it, while garrisons hold their
forts. Taking Castle Verlaine wins the campaign; losing Fort Melchor ends it.

**Terrain that costs time, never access.** Nothing on the map is impassable —
you can always go anywhere — but the ground decides how fast you get there.
Roads are quickest, open plain is the baseline, and forest, mountain, and water
each slow a march progressively — how much depends on the squad's type (see
*Squad types* above): light troops shrug off forest and hills, cavalry hates
them, fliers ignore the ground entirely. Because the
renderer draws from the very same terrain grid the movement code charges
against, what you read off the map is always exactly what you pay.

**Auto-battle with 3x3 formations.** When opposing squads meet on the map the
engagement resolves automatically. Each squad fields up to five members on a
3x3 grid, and the *column* a member occupies decides their battle row — front,
middle, or back — which in turn decides which attack they use and how many
times it lands. A knight in front swings twice; an archer gains a third shot
from the back rank; clerics only heal from the rear. Combatants act in agility
order, attacks target the enemy's nearest live rank first, and the side dealing
more damage wins the clash and drives the loser back onto its own nearest
holding. Because squads move freely, engagements happen wherever two forces
meet — you can intercept a march in open country, and be intercepted yourself.
Wiped enemy squads are destroyed; wiped player squads rout home to the keep at
low strength.

**Class structure and promotion tree.** 36 original classes across the male line
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
requirements, highlighted green when the character qualifies, paged when a
class has more routes than fit. The squad's type heads its formation panel.

## Layout

```
src/
  core/         pure simulation, no Phaser
    types.ts       shared types, grid/row mapping, elements and resistances
    character.ts   lineage, stat generation and level-up rolls, class change, alignment
    squad.ts       formation grid, march speed, auto-placement
    battle.ts      engagement simulator; returns an animatable event log
    terrain.ts     terrain grid, road stamping, per-tile movement costs
    movement.ts    free-form marching, stronghold occupancy, retreat
    state.ts       campaign state and starting scenario
  data/
    classes.ts     the built-in class tree: stats, growths, row attacks, promotions
    registry.ts    the active dataset (built-in or extracted); every class lookup goes here
    expansion/     the scraped class facts the expansion translates
    names.ts       name pools and the seeded RNG
  expansion/
    sources.ts     the shape of the scraped SNES and Symphony of War class facts
    translate.ts   turns them into classes and routes on the active dataset
    index.ts       withExpansion(): the expansion, applied
  ob64/
    decode.ts      reads Ogre Battle 64's class, attack and element tables from a ROM
    convert.ts     turns them into Palatinus classes: roster, promotions, spells, gates
tools/
  extract-ob64.ts  `npm run extract:ob64`: verifies the dump, writes public/ob64/
  scrape-expansion.ts `npm run scrape:expansion`: the two class sources, as facts
  gfx/
    pixels.ts      pixel sprite templates, per-class palettes, stand-in art for the rest
    terrain.ts     procedural terrain tiles and stronghold icons
    ui.ts          menu panel styling
  scenes/
    BootScene      loads extracted data if present, renders all textures
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

`npm test` runs 151 tests (142 without extracted ROM data) over the simulation core — the rules, not the
rendering. They cover the parts that are easy to break silently: that a
member's column really does select their attack and strike count, that the
front rank is struck before the back and combat spills backward once it falls,
that promotions gate on level, stats, and alignment independently (a
chaotic Fighter is locked out of Knight but can reach Berserker), and that
alignment drifts in the right direction and stays in bounds.

Movement and terrain get their own coverage: that a squad heads straight for an
arbitrary point rather than drifting along an axis, that it converges on its
destination instead of oscillating around it, that orders off the edge of the
map are clamped, that clicks near a stronghold snap onto it while clicks in
open country stay exactly where they landed, that no terrain is ever
impassable, that roads beat plain and rough ground is slower, and that fliers
ignore the ground.

A few structural tests guard the class tree itself: every promotion points at
a class that exists, stays within its gender line, never drops a tier, forms no
cycles, and every non-monster class is reachable from a tier-1 root. These
catch data-entry mistakes in `classes.ts` that no amount of playtesting would
reliably surface.

The suite is mutation-checked rather than trusted on a green run. Deliberately
breaking the holy-damage bonus, front-rank targeting, road stamping, flier
terrain immunity, and movement normalisation each produced failures, which is
what confirms those tests are actually testing something. Two early tests were
caught passing for the wrong reasons this way and rewritten.

The Ogre Battle 64 path has its own coverage. The decoder runs against a
synthetic cartridge built in memory with the same layout, so CI never needs a
ROM: stat and growth fields, the seven resistances, lineage bytes, the
`0x10` line-break control code in two-line names. The converter's tests check
that promotions come out of lineage, that story classes stay out of the
player's tree, that heals are Virtue magic and not merely the heal effect byte,
and that the inferred gates reproduce the four documented requirements. The
rules tests cover lineage downgrade, growth as each class held along the way,
the 0–2 level-up roll (including that it actually varies), class change keeping
stats, and element-resolved spells. Where `npm run extract:ob64` has been run,
an extra suite checks the real data: Fighter's eight class changes and
Amazon's six, every promotion pointing a tier up within the same gender, clean
names, and the great monsters flagged as large.

The expansion has its own suite. Over the whole expanded tree: every route
points at a class that exists, never a tier down, only between genders that
can hold both, with no loops, and every playable translated class reachable
from a tier-1 class. It checks that no gunpowder class gets in, that the
existing class wins a merge untouched while gaining routes, that the input
dataset is never modified, that a class 20% stronger than its SNES tier lands
20% above this dataset's tier average, that Symphony of War's ratings order
correctly, that SNES undead immunity survives, that stat gates appear only on
datasets that gate and lead with the stat the source names, that item routes
stay shut, that a unit sees only the class changes its gender allows, and
that every playable translated class can field a squad and fight. Squad type
tests cover each composition rule at its boundary, and terrain tests each
type's ground. Each of these was mutation-checked; two guards that the real
data never exercises (loops, and either-gender classes refusing monsters)
survived at first, and now have tests of their own.

## Balance knobs

Class stats, growths, row attacks, and promotion requirements all live in
`src/data/classes.ts`. Damage and healing formulas are in `src/core/battle.ts`;
base march speeds and squad-type rules are in `src/core/squad.ts`;
translation weights are in `src/expansion/translate.ts`; recruit costs are in
`src/scenes/OrganizeScene.ts`; terrain movement costs and the
road bonus are in `TERRAIN_SPEED` and `MARCH_TERRAIN` in `src/core/terrain.ts`; capture and snap
radii are in `src/core/movement.ts`; the campaign map and starting armies are
in `src/core/state.ts`.
