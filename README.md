# Palatinus Tactics

A playable real-time strategy RPG in the tradition of the late-90s "march your
squads across a liberation map" tactics games. Built with Phaser 3 +
TypeScript, with the campaign map and its battles in 3D by Three.js, running
entirely in the browser. All art and text in this repository are original; Ogre Battle 64's
own art appears only when extracted locally from your own ROM (below).

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
`public/ob64/data.json` and the unit sprites in `public/ob64/sprites/`. That folder is git-ignored and must stay that way: it
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
| 277 pieces of equipment: type, element, rank, price, STR/INT/AGI/DEX/VIT/MEN/LUK bonuses, physical and six elemental resistances | Each class's default gear, from its record's four item ids | What each class may wear: the code that decides it sits in an overlay not yet decompressed, so the rule is read off each class's default gear (keep to its weapon type; heavier armour admits the lighter; anyone wears accessories) |
| Every class's unit sprites: each pose image, palette, cell and animation script, seen from the front and from behind, in player and enemy colours | Which bundle and variant draw each class, from the table the battle code reads; which poses are weapons and which palette each takes, from the bundle's own pose table | Which of a weapon pose's looks goes with which weapon: not found yet, so a unit carries its class's own |
| 44 supplies, relics and key items: category, price, one unit or a squad | Which flag bits mean "no shop sells this", "slays dragons", "slays the undead", from the items that carry them | What each supply and relic does, and how much: read from the names (a Heal Leaf heals, a Sword Emblem raises STR) at Palatinus's own magnitudes |

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

## Equipment, items, elements and large units

**Gear.** Every unit has the four places Ogre Battle 64's class records give
it: a weapon, body armour, an off hand (a shield or a book, or an accessory)
and a head (a helm or a hat, or an accessory). A new unit comes dressed: in
Ogre Battle 64 mode exactly as the game dresses its class (a Fighter in a
Short Sword, Chain Mail, Round Shield and Iron Helm), otherwise in the best
plain gear a recruit of its tier would own. Gear adds to the stats a unit
fights with and to its resistances; the sheet shows both, with the bonus
beside each stat. Two-handed weapons (greatswords, hammers, bows) leave no
hand for a shield. A class change sheds whatever the new class cannot use
back into the inventory. Monsters wear accessories only.

**Elements in combat.** A unit's resistance to an attack's element is its
class's plus its gear's, so a Flame Shield blunts a Fireball and armour blunts
a sword. A blow struck with an elemental weapon lands half as steel, half as
its element. Weapons made to slay dragons or the undead strike them half again
as hard.

**Large units.** Dragons, golems, hellhounds and other great beasts stand in
two cells side by side and fill two of a squad's five places. They fight from
their foremost cell, act once a round, and are drawn once, across both cells,
in the formation and in battle.

**Supplies, relics and key items.** Supplies heal one unit or a whole squad,
revive the fallen, or carry a squad home. Relics raise a stat, Luck, a level
or alignment for good. Key items open the class changes that call for them
(the SNES game's *Virus*, *Blood Kiss*, *Undead Ring*...) and are spent on
them. The Organize screen's *Items* panel uses them on the selected unit.

**The shop.** *Shop* sells supplies, weapons, armour and key items. Its stock
grows with the strongholds the army holds; shops buy back at half price.

**The fallen and rest.** A unit knocked out in battle stays down until it is
revived or its squad rests at the keep. A squad halted on one of its own
strongholds recovers some HP each day.

**Spoils.** Destroying an enemy squad pays Goth by the fallen's levels, and
now and then a supply, a piece of gear, a relic or a key item.

Without a ROM, Palatinus has its own catalogue of 164 items (145 pieces of
gear, 7 supplies, 12 relics) with original
names, on the same ranks and in the same shape, scaled to the built-in
classes.

## Ogre Battle 64's sprites and the 3D battle

Battles are staged in a real 3D scene: the two squads face each other on
ground themed by where they met (grass, a road, forest, rocky hills or a
river bank, with trees and rocks to match), and a camera that sweeps down
onto the field, swings in on whoever acts, and pulls back when the clash is
done. The units are
billboards, flat drawings that always face the camera, standing on that 3D
field, as Ogre Battle 64 itself draws them.

With the sprites extracted, each unit is drawn in Ogre Battle 64's own art:
every animation the game gives it (breathing at rest, walking, its melee
attacks with the blow landing on the game's own frame, casting, flinching,
falling) and both of the game's views of it, from the front for the army
facing left and from behind for the army facing right, as the game's diagonal
battle camera shows them. The player's squads wear the player's colours, the
enemy's theirs. Dragons and other great beasts, which the game draws little
bigger than a man, are enlarged. Menus, the map and the title use each
class's standing pose. The translated classes borrow the art of their nearest
Ogre Battle 64 kin (`src/expansion/looks.ts`): a Samurai dresses as a Fencer,
a Fire Giant as a Giant. Without the sprites, everything is drawn in
Palatinus's own pixel art, with its animations made by moving and tinting the
one drawing.

**How the sprites are stored, as decoded.** Every unit's art is a *bundle*
in the game's asset store, listed in a master table of 208 bundles. A bundle
holds:

* a table of *cells*, each one drawing of the unit made of several pose
  images placed relative to its feet;
* a table of *animation scripts*: show a cell for so many ticks, move, the
  blow lands here, go on to another script;
* a pose table saying which poses are bodies, which weapons, and which
  palette each takes;
* the palettes;
* the poses themselves, as "UT" containers of 8-bit colour-indexed frames
  with 4-bit alpha masks, later frames stored as differences from earlier
  ones.

One bundle dresses several classes: a body pose's frames come in pairs, the
first class in player and enemy colours, then the next. The Fighter and the
Lycanthrope share one, and so do the Hawkman, the Vultan and the Raven. A
weapon pose holds a frame per weapon look.

A class table beside the battle code gives, per class and side, the bundle
seen from behind, the one from the front, and the variant. The extractor
copies each bundle out as stored, still compressed (13 MB for the 137 in
use), and the browser unpacks a bundle when a battle first needs it.

## The campaign map in 3D

The campaign map is a 3D world in the manner of Ogre Battle 64's: rolling
polygon ground under a tilted camera, with a mountain range along the north,
woods, a lake, and roads of packed earth between strongholds. The
strongholds are small buildings flying their owner's colours: the two
castles with towers and a keep, forts with a stockade and a watchtower, and
towns of cottages. A flag changes colour the moment its stronghold falls.

The world is grown from the very terrain grid that marching is charged on
(`src/core/terrain.ts`), so the two never disagree:
* hills rise where marching is slow;
* the ground dips under the water exactly on the water tiles;
* the roads are painted as wide as the corridor that speeds a march;
* the woods stand on the forest tiles.

The landscape itself is drawn from smooth noise, so woods, hills and the
lake come in shapes rather than scattered tiles. Past the campaign's edges
the land runs on, darkened, as a mirror of the land within.

**The camera.**
* **Drag** to pan; the map moves with the pointer.
* **The wheel** zooms toward the pointer, looking down more steeply from afar.
* **Q and E**, or a right-drag, turn the view.
* **WASD or the arrow keys** pan.
* **Space** finds a squad.
* **R** returns to the whole map.

A click that isn't a drag works as before: it selects a squad, or orders the
selected one to march. Your squads are picked where they stand on screen;
the ground under the pointer is found as it rises and falls. A march order
leaves a ring where it was given and a dashed line along the route.

**Squads on the march.** Each squad is its leader's figure, standing on the
ground over a disc in its side's colour, with its name and strength above.
With Ogre Battle 64's sprites extracted, the leader walks the map as the game
walks its units, in its side's colours:
* the walking animation while it marches, at ease when it halts;
* seen from the front as it comes toward the camera, from behind as it goes
  away, and turned to the side it heads for, as the camera turns too;
* great beasts larger.

Without the sprites, the leader's pixel-art figure turns and bobs in step.
A squad halted on a stronghold is drawn in front of the building rather
than inside it; its place in the game doesn't change.

The map and the battles share one WebGL renderer. A battle only ever plays
while the map waits, and each copies out what it drew straight away.

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
them, fliers ignore the ground entirely. Because the 3D map is grown from
the very same terrain grid the movement code charges against, what you read
off the map is always exactly what you pay.

**Auto-battle with 3x3 formations.** When opposing squads meet on the map the
engagement resolves automatically, and plays out on the 3D battlefield. Each squad fields up to five members on a
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
grid, and read a full character sheet in three tabs: *Status* (stats with gear
bonuses, alignment, Luck, resistances, the attack each row makes), *Gear* (the
four places and what to put in them) and *Class* (every promotion the class
offers with its requirements, highlighted green when the character
qualifies, paged when there are many). The squad's type heads its formation
panel; its places used, the treasury and the shop rank sit below. *Shop*,
*Items* and *Recruit* open in the right-hand panel.

## Layout

```
src/
  core/         pure simulation, no Phaser
    types.ts       shared types, grid/row mapping, elements and resistances
    character.ts   lineage, stat generation and level-up rolls, class change, alignment
    items.ts       gear and its rules, effective stats and resistances, supplies, shop, spoils
    camp.ts        rest at strongholds, the fallen rising at the keep, a squad carried home
    squad.ts       formation grid, march speed, auto-placement
    battle.ts      engagement simulator; returns an animatable event log
    terrain.ts     terrain grid, road stamping, per-tile movement costs
    movement.ts    free-form marching, stronghold occupancy, retreat
    state.ts       campaign state and starting scenario
  data/
    classes.ts     the built-in class tree: stats, growths, row attacks, promotions
    items.ts       the built-in item catalogue
    registry.ts    the active dataset (built-in or extracted); every class lookup goes here
    expansion/     the scraped class facts the expansion translates
    names.ts       name pools and the seeded RNG
  expansion/
    sources.ts     the shape of the scraped SNES and Symphony of War class facts
    translate.ts   turns them into classes and routes on the active dataset
    index.ts       withExpansion(): the expansion, applied
    looks.ts       which Ogre Battle 64 class's art each translated class wears
  ob64/
    decode.ts      reads Ogre Battle 64's class, attack and element tables from a ROM
    convert.ts     turns them into Palatinus classes and items: roster, promotions, spells, gates, gear
    lz.ts          the game's asset store and its LZ compression
    sprites.ts     unit sprite bundles: pose images, palettes, cells, animation scripts, the class table
    spritePack.ts  one bundle as stored, packed into a file the browser fetches
  gfx3d/
    stage.ts       the Three.js battlefield: ground, billboard units, camera shots, effects
    layout.ts      where each squad member stands, and the camera's shots
    sprites.ts     what the stage needs from a unit's art; sets built from one still drawing
    ob64Sprites.ts loads the extracted sprites: portraits at boot, animated sets per battle
    unitArt.ts     a unit's battle art: Ogre Battle 64's if extracted, else the pixel art
    world.ts       the 3D campaign map: ground, water, woods, strongholds, squads, camera, picking
    worldMap.ts    the map's shape in 3D: world coordinates, heights from the terrain grid, the camera's views
    mapFigures.ts  a squad's figure on the map: the leader walking, turned the way it marches
    renderer.ts    the one WebGL renderer the map and battles share
  gfx/
    unitIcon.ts    a class's standing figure for menus and the map, whichever art it has
    pixels.ts      pixel sprite templates, per-class palettes, stand-in art for the rest
    ui.ts          menu panel styling
  scenes/
    BootScene      loads extracted data if present, renders all textures
    TitleScene
    OverworldScene the 3D map's camera and clicks, march orders, capture, enemy AI, encounter detection
    BattleScene    plays back the simulated engagement on the 3D stage
    OrganizeScene  formation editing and promotions
tools/
  extract-ob64.ts  `npm run extract:ob64`: verifies the dump, writes public/ob64/
  scrape-expansion.ts `npm run scrape:expansion`: the two class sources, as facts
  png.ts           a minimal PNG writer for the portrait atlas
```

The simulation in `src/core/` has no Phaser dependency — battles resolve as
pure functions over game state and emit an event log that `BattleScene` merely
animates. Sprites are authored as small ASCII templates in `gfx/pixels.ts` and
palette-swapped per class into canvas textures at boot, so the whole game ships
without a single binary asset.

## Tests

`npm test` runs 261 tests (244 without extracted ROM data) over the simulation core — the rules, not the
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

Equipment and items have their own suites. Gear goes where its type says and
only on classes that may wear it; equipping moves items to and from the
inventory and fails without the item in hand; a two-handed weapon sets down
the shield and refuses one beside it; bonuses add to the stats a unit fights
with but not its own; resistances add and stay within 0..100; armour blunts
blows, an elemental weapon strikes half with its element, and a slaying
weapon strikes its quarry half again as hard and nothing else. Supplies heal
only up to the maximum, revive only the fallen, reach a whole squad when
they should, and spend nothing when they would do nothing; relics last;
a banner draws a squad toward its leader from either side and no further.
The shop stocks by rank, charges, and buys back at half. Class changes that
call for an item open only with it in hand, spend it, and shed gear the new
class cannot use. Large units take two cells and two places, fight from their
foremost cell, act once, and cannot be set over another unit or past the
fifth place. Squads rest only on their own strongholds, the fallen rise only
at the keep, and no two soldiers share a name until a pool runs dry. The
decoder reads a synthetic item and consumable table; on real data, all 277
items read, the Fighter and Wizard are dressed as the game dresses them, every
class can wear its own default gear, and the dragon slayers are marked.
Twenty-nine mutations of this code were tried; six survived the first suite
(the resistance cap, the banner's direction, placement past the fifth place,
rest on an enemy stronghold, the fallen rising away from the keep, names
reused too early), and each now has a test that catches it.

The sprite decoder runs on bundles built by hand to the documented formats:
colour and mask frames rebuilt from their differences (both halves of a mask
byte), drawn through a palette with the mask's alpha; each pose's kind and
palette read from the pose table, and a table for the wrong number of poses
ignored; a body dressed by its variant while the weapon keeps its player
look; cells with signed offsets and mirroring, each part in its own palette,
faint texels left out; scripts read, played on into the script they link to,
and the blow marked on its own frame only; the Soldier's stand-ins replaced
by the other side's art, recoloured, or left out; and a packed bundle
unpacking to what the ROM holds. Ten mutations were tried; three survived at
first and now have tests. On real data, Fighter and Lycanthrope share a
bundle as variants, a bundle's poses take several palettes and its weapon is
marked, every translated class's borrowed art exists, and every class's
animations build. The stage's layout and camera, and the choice of which view
to show and which frame plays when, are tested without a browser.

The 3D map's shape is tested without a browser:
* **Heights:** deterministic, under the water exactly on the water tiles
  (even a lone pond, even a lone islet), mountains above open country, and
  smooth between vertices.
* **Edges:** the land mirrors past them.
* **The camera:** it opens on the whole map, stays on it, keeps its
  distance and pitch within bounds, pans the way it faces, zooms within
  limits, and turns the short way round.
* **Headings:** each turns into the right one on screen for any camera turn.
* **Map figures:** they show their front coming toward the camera and their
  back going away, turn to the side they head for, walk only while
  marching, and stand a man's height (great beasts larger).

Twelve mutations were tried; two survived at first (the shore fix, which
this map happens not to need, and one direction of the yaw wrap) and now
have tests.

## Balance knobs

Class stats, growths, row attacks, and promotion requirements all live in
`src/data/classes.ts`. Damage and healing formulas are in `src/core/battle.ts`;
base march speeds and squad-type rules are in `src/core/squad.ts`;
translation weights are in `src/expansion/translate.ts`; recruit costs are in
`src/scenes/OrganizeScene.ts`; the built-in items are in `src/data/items.ts`,
supply effects for the extracted data in `CONSUMABLE_EFFECT` in
`src/ob64/convert.ts`, and the slaying bonus, shop ranks, spoils and resale
price in `src/core/items.ts`; rest and revival rates are in `src/core/camp.ts`; terrain movement costs and the
road bonus are in `TERRAIN_SPEED` and `MARCH_TERRAIN` in `src/core/terrain.ts`; capture and snap
radii are in `src/core/movement.ts`; the campaign map and starting armies are
in `src/core/state.ts`. The battle's spacing and camera shots are in
`src/gfx3d/layout.ts`; Ogre Battle 64 sprites' size and the beasts'
enlargement are `PIXELS_PER_UNIT` and `LARGE_SCALE` in
`src/gfx3d/ob64Sprites.ts`, and their animation speed is `TICK_MS` in
`src/ob64/sprites.ts`. The landscape's shapes are in `baseTerrainAt` in
`src/core/terrain.ts`; the map's heights in `src/gfx3d/worldMap.ts`, with the
camera's limits and opening view (`VIEW_LIMITS`, `OVERVIEW`); figures' size on
the map is `FIGURE_HEIGHT` in `src/gfx3d/mapFigures.ts`.
