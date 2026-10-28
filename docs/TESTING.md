# Testing Palatinus Tactics

Three kinds of check, from quickest to slowest:

| | Command | What it runs | Where |
|---|---|---|---|
| Unit tests | `npm test` | 335 tests (318 without extracted ROM data), in Node, no browser | CI, every push |
| Automated playthrough | `npm run e2e` | A real browser plays the game through its interface | By hand, with `npm run dev` running |
| Performance probe | `npm run perf` | Boot time, frame times, GPU memory over a run of battles | By hand, with `npm run dev` running |

CI type-checks, runs the unit tests and builds on every push and pull
request (`.github/workflows/ci.yml`). It has no ROM, so it runs on the
built-in data and the painted figures, and the 17 tests that need extracted
Ogre Battle 64 data skip themselves.

## Unit tests

Mostly over the rules in `src/core/`, which take no renderer: the rules more
than the rendering. They cover the parts that are easy to break silently.

**Battle.** A member's column really does select their attack and strike
count; the front rank is struck before the back, and combat spills backward
once it falls; alignment drifts in the right direction and stays in bounds.
Promotions gate on level, stats and alignment independently: a chaotic
Fighter is locked out of Knight but can reach Berserker.

**Movement and terrain.**
* A squad heads straight for any point rather than drifting along an axis,
  and converges on its destination instead of oscillating around it.
* Orders off the edge of the map are clamped.
* Clicks near a stronghold snap onto it, while clicks in open country stay
  exactly where they landed.
* No terrain is ever impassable; roads beat plain and rough ground is slower;
  fliers ignore the ground.

**The class tree.** Every promotion points at a class that exists, stays
within its gender line, never drops a tier and forms no cycles, and every
non-monster class is reachable from a tier-1 root. These catch data-entry
mistakes in `classes.ts` that playtesting would not reliably surface.

**Ogre Battle 64's data.** The decoder runs against a synthetic cartridge
built in memory with the same layout, so CI never needs a ROM. It checks:
* stat and growth fields, the seven resistances and lineage bytes;
* the `0x10` line-break control code in two-line names.

The converter's tests check that:
* promotions come out of lineage, and story classes stay out of the player's
  tree;
* heals are Virtue magic, not merely the heal effect byte;
* the inferred gates reproduce the four documented requirements.

The rules tests cover lineage downgrade, growth as each class held along the
way, the 0–2 level-up roll (including that it actually varies), class change
keeping stats, and element-resolved spells. Where `npm run extract:ob64` has
been run, an extra suite checks the real data:
* Fighter's eight class changes and Amazon's six;
* every promotion pointing a tier up within the same gender;
* clean names, and the great monsters flagged as large.

**The class expansion.** Over the whole expanded tree:
* every route points at a class that exists, never a tier down, only between
  genders that can hold both, with no loops;
* every playable translated class is reachable from a tier-1 class, and can
  field a squad and fight.

It also checks that:
* no gunpowder class gets in;
* the existing class wins a merge untouched while gaining routes, and the
  input dataset is never modified;
* a class 20% stronger than its SNES tier lands 20% above this dataset's tier
  average, and Symphony of War's ratings order correctly;
* SNES undead immunity survives;
* stat gates appear only on datasets that gate, and lead with the stat the
  source names;
* item routes stay shut, and a unit sees only the class changes its gender
  allows.

Squad-type tests cover each composition rule at its boundary, and terrain
tests each type's ground.

**Equipment and items.**
* Gear goes where its type says, and only on classes that may wear it.
* Equipping moves items to and from the inventory, and fails without the item
  in hand. A two-handed weapon sets down the shield and refuses one beside it.
* Bonuses add to the stats a unit fights with, but not its own; resistances
  add and stay within 0..100.
* Armour blunts blows; an elemental weapon strikes half with its element; a
  slaying weapon strikes its quarry half again as hard, and nothing else.
* Supplies heal only up to the maximum, revive only the fallen, reach a whole
  squad when they should, and spend nothing when they would do nothing.
  Relics last.
* The shop stocks by rank, charges, and buys back at half.
* Class changes that call for an item open only with it in hand, spend it,
  and shed gear the new class cannot use.
* Large units take two cells and two places, fight from their foremost cell,
  act once, and cannot be set over another unit or past the fifth place.
* Squads rest only on their own strongholds, the fallen rise only at the
  keep, and no two soldiers share a name until a pool runs dry.

**Sprites.** The sprite decoder runs on bundles built by hand to the
documented formats. It covers:
* colour and mask frames rebuilt from their differences, drawn through a
  palette with the mask's alpha;
* each pose's kind and palette, read from the pose table;
* cells with signed offsets and mirroring, each part in its own palette;
* scripts read, played on into the script they link to, and the blow marked
  on its own frame only;
* a packed bundle unpacking to what the ROM holds.

**The painted figures** are tested on the raster itself, without a browser:
* shapes face the way they should, and the nearer one wins;
* outlines and the lines between parts fall where they should;
* pictures are shaded from the upper left, and normal maps point the right
  way;
* every frame of every look, beast and spirit stays whole within its canvas,
  standing on its feet.

**The 3D map and the battle**, without a browser:
* The map's heights are deterministic, under the water exactly on the water
  tiles, mountains above open country, and smooth between vertices; the land
  mirrors past the edges.
* The camera opens on the whole map, stays on it, keeps its distance and
  pitch within bounds, pans the way it faces and turns the short way round.
* Map figures show their front coming toward the camera and their back going
  away, walk only while marching, and grow with the camera's distance.
* Squads parked at a stronghold stand close enough to hold it.
* Formations stand on the diagonal, and every action shot keeps the actor and
  its targets in frame. Labels never overlap.
* Each battlefield gives the squads level ground, rises into hills beyond
  (falling away under a shore's water), and keeps its trees and boulders off
  the battle line.
* A strength bar drops at once and drains its chip only after a beat, keeps a
  run of quick blows in the chip, and rises to a heal.

**The interface.**
* The map's instruments name the hours aright, tell a squad's orders and
  measure its strength.
* The march list offers every stronghold but the squad's own, nearest first.
* Every icon is drawn within its square.
* **Contrast:** every text colour reads at 4.5 to 1 or better (WCAG AA) on a
  panel over anything the view may show behind it, from night to white
  (`src/ui/contrast.test.ts`).
* Comfort settings read back what was kept, with defaults for anything
  missing or unreadable.
* **Adaptive resolution** draws fewer pixels while frames are slow, down to
  its floor, and more when they come easily. It never climbs back to a share
  already found too slow, and leaves a steady 60 frames a second alone.

### Mutation checking

The suite is checked by breaking the code on purpose, not trusted on a green
run. Each subsystem's tests were tried against deliberate mutations, such as:
* the holy-damage bonus, front-rank targeting, road stamping, flier terrain
  immunity and movement normalisation;
* twenty-nine mutations of equipment and items;
* ten of the sprite decoder, and twelve of the 3D map.

Each mutation that survived got a test of its own. Among them:
* the resistance cap, the banner's direction, placement past the fifth place;
* rest on an enemy stronghold, the fallen rising away from the keep, names
  reused too early;
* the expansion's loop guard;
* one direction of the camera's yaw wrap.

Two early tests were caught passing for the wrong reasons this way, and
rewritten.

## The automated playthrough (`e2e/`)

`e2e/playthrough.mjs` opens the game in Chromium (Playwright, WebGL2, the Low
preset) with `?debug`. It plays the game as a player would, clicking the
interface's named controls (`data-ui`) and the map where things stand, and
checks the campaign's state after every step. Each check has an id from the
sweep's checklist; screenshots and a JSON report land in `e2e-results/`.

```bash
npm run dev                         # in another terminal
npm run e2e                         # every section
npm run e2e -- organize battle      # some: title map organize battle edges victory defeat soak
E2E_DATA=builtin npm run e2e        # the built-in data, even where OB64's is extracted
```

The *victory*, *defeat* and *soak* sections play whole campaigns in real
time. On a machine with a software GPU, the commander falls behind the game,
so run them at a lower `E2E_SPEED` (2 to 4). The other sections do not
depend on the machine's speed. The commander's quartermaster
(`e2e/quartermaster.mjs`) promotes, equips and shops between marches, through
the army screen alone.

## The performance probe

```bash
npm run dev            # in another terminal
npm run perf           # the Low preset, five battles
npm run perf -- high 3 # a preset, and how many battles
```

`e2e/perf.mjs` reports:
* the boot's stages, from the marks `main.ts` leaves;
* frame times on the title, the map, the army screen and a battle (median and
  95th percentile, and the CPU's share of each draw);
* how long a battle takes to open;
* GPU geometries and textures, and the JS heap, after each battle.

The last of these is the leak check: once the first battle has painted its
figures, the counts should hold level from battle to battle.

On this project's test machine (software GPU), it found two problems:
* every battle left about ten screen-sized textures behind;
* the army screen redrew the still map at the map's cost, about 380 ms a
  frame.

Both are fixed: the texture count now levels off, and the army screen runs
at the display's rate. A software GPU says little about real frame rates,
though: compare runs on the same machine, not across machines.
