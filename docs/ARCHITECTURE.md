# How Palatinus Tactics is built

This is the map of the code: how the game is put together and why. Read it
before changing anything structural. The [README](../README.md) covers
playing, settings and data; [TESTING.md](TESTING.md) covers the tests;
[OB64.md](OB64.md) covers reading Ogre Battle 64's own data.

## The shape of it

```
            ┌───────────────────────── browser ─────────────────────────┐
            │                                                            │
 main.ts ──►│  Engine (render/)          App (app/)                      │
  boot      │  one WebGPU/WebGL2   ◄──── frame loop, one base screen     │
            │  renderer + finishing      and one over it                 │
            │  chain                          │                          │
            │        ▲                        ▼                          │
            │        │ View          Screens (screens/)                  │
            │        │ {scene,       title · map · battle · organize     │
            │        │  camera}      DOM interface (ui/) over the canvas │
            │        │                        │                          │
            │   3D stages (gfx3d/)  ◄─────────┤ reads/writes             │
            │   world · arena · stage         ▼                          │
            │   painted figures (art/)   Campaign state (core/state.ts)  │
            │                            pure rules (core/)              │
            │                            data (data/, ob64/, expansion/) │
            └────────────────────────────────────────────────────────────┘
```

Three layers, each knowing only the one below it:

1. **The rules** (`src/core/`, `src/data/`, `src/expansion/`, `src/ob64/`):
   plain TypeScript over plain data, with no renderer and no DOM. A battle is
   a pure function from two squads to an event log; marching, capture, items,
   promotion and rest are functions over the campaign state. Everything the
   game *decides* is here, and almost all the tests are here.
2. **The pictures** (`src/gfx3d/`, `src/art/`, `src/gfx/`, `src/render/`):
   Three.js scenes that show the state, and the code that paints every
   figure. They read the rules' results; they never change them.
3. **The screens** (`src/screens/`, `src/app/`, `src/ui/`): each screen owns
   one 3D stage (or none) and a layer of HTML over it, turns the player's
   input into calls on the rules, and plays the results back on its stage.

The visual overhaul changed layers 2 and 3 throughout and left layer 1 alone:
no game rule changed between the Phaser build and this one.

## Boot

`src/main.ts`, in order (each step is a mark in the browser's performance
panel, `boot:renderer` … `boot:title`):

1. The **engine** opens WebGPU (WebGL2 where it is missing or broken, or with
   `?webgl`) and picks a quality preset.
2. The **data**: the built-in classes and items, or Ogre Battle 64's if
   `public/ob64/data.json` was extracted (its reader, `ob64/convert.ts`, is
   only fetched then), with the class expansion grafted on. At the same time
   it loads the map's models (`src/assets/models/world.glb`) and, if
   extracted, Ogre Battle 64's sprite manifest.
3. The **art**: every class's portrait, painted in code (`art/sheet.ts`), or
   Ogre Battle 64's where extracted. The figures' animations are painted later,
   the first time each plays.
4. The **title** screen, and the frame loop starts.

## The frame loop and the screens

`App` (`src/app/app.ts`) holds one **base** screen (the title or the
campaign map) and at most one **overlay** (a battle or the army screen). A
screen is:

```ts
interface Screen {
  root: HTMLElement;          // its interface, laid over the canvas
  view(): View | null;        // the 3D scene and camera to draw, or none
  update(ms: number): void;   // let real time pass
  resize?(w, h); cover?(covered); dispose();
}
```

Each frame, the topmost screen runs, and the engine draws the topmost screen
that has a view. While an overlay is up, the base screen is *covered*: it
stops running, and its interface steps aside. The army screen has no view of
its own, so the covered map shows through it. Since the map is then still,
it is drawn **once** and left on the canvas until the window or the screens
change. That keeps the army screen at the display's frame rate, where it used
to redraw the whole land every frame.

Screens talk to the rest of the game through the campaign state
(`core/state.ts`) and a few callbacks `main.ts` hands them: the map starts a
battle and opens the army screen, and a battle reports its result.

## Rendering

`src/render/engine.ts` owns the one `WebGPURenderer`. It draws a screen's
`View` through a **finishing chain** built with three.js's node system (TSL):
ambient occlusion (GTAO), bloom, an optional tilt-shift blur, a vignette,
tone mapping, then FXAA or SMAA. The chain is built for one scene and camera
and rebuilt when the view changes.

When a view is let go, the engine walks the chain's node graph and frees
every pass and render target in it. three.js's own `RenderPipeline.dispose()`
frees only its material, which left about ten screen-sized textures on the
graphics card after every battle.

**Quality presets** (`render/quality.ts`): Low, Medium, High, Ultra. Each sets
the pixel-ratio cap, which effects run, the shadow map's size, grass density,
the particle budget and simple or physically based shading. The first guess
goes by backend and screen size; the player's choice is kept in
`localStorage`.

**Adaptive resolution** (`render/governor.ts`): every 30 frames the app
reports the average frame time. If two windows in a row run slower than
about 45 frames a second, the governor draws 10% fewer pixels, down to half.
After six easy windows it draws more again, but never back up to a share
that already proved too slow, so it settles instead of see-sawing. The
interface is HTML, so it stays sharp regardless. It is off when the address
names a preset (`?quality=…`): screenshots and tests are drawn exactly as
asked.

**Shader warm-up**: a battle's field is prepared with `compileAsync` before
it is first shown (the map shows through, dimmed, for that moment). Where
the browser offers parallel shader compilation, that keeps the page from
stalling on the first frame.

## The 3D stages

| Stage | File | What it is |
|---|---|---|
| Campaign map | `gfx3d/world.ts` | Ground grown from the terrain grid, water, woods, KayKit strongholds, squads' figures, the camera and picking |
| Battle | `gfx3d/stage.ts` | An arena, billboard units, their moves, camera shots, effects |
| Title | `screens/title.ts` | The campaign map, turning slowly |

Shared pieces:

* `worldMap.ts`: the map in world units, heights from the terrain grid, and
  the camera's views and limits.
* `landscape.ts`: the ground, water, wind and grass materials, painted in the
  GPU from noise. The battle arena reuses the same painted ground.
* `atmosphere.ts` and `sky.ts`: the sun and its shadows, the hour's light,
  sky, clouds, rain, snow and mist.
* `arena.ts`: a battlefield in the map's manner, shaped by where the squads
  met (meadow, road, forest, pass or shore).
* `spells.ts` and `vfx.ts`: every effect, built from one pool of additive
  particles, a few textures drawn in code, and two pooled point lights.
* `layout.ts`: where each squad member stands, and the camera's shots, as pure
  functions so they can be tested.

**The map and the rules agree by construction.** The map's heights, water,
roads and woods are grown from the same terrain grid that marching is
charged on (`core/terrain.ts`), so what the player sees is what a march
pays.

## The figures

Every class is painted in code (`src/art/`) the first time it is needed:

* `raster.ts`: a pixel canvas where each pixel also records which way its
  surface faces and how near it is, so one drawing gives both a picture and a
  normal map, and the 3D scene lights it like the land.
* `humanoid.ts` and `creatures.ts`: rigs for people, beasts, dragons, horses,
  ghosts and sea creatures.
* `looks.ts`: what a class wears, from its equipment rules, palette and tier.
* `motion.ts`: six animations, as key poses eased into frames.
* `sheet.ts`: a class's sprite set. Each frame is cropped to what is drawn,
  and each animation is painted the first time it plays.

Ogre Battle 64's own sprites, where extracted, take their place through the
same `SpriteSet` interface (`gfx3d/sprites.ts`, `ob64Sprites.ts`); each gets a
normal map worked out from its outline (`art/normals.ts`).

## The interface

Plain HTML over the canvas, built with a tiny helper (`ui/dom.ts`: `el()`,
`button()`), styled by one sheet (`ui/styles.css`) that starts with design
tokens: ink, gold, panels, the owners' and elements' colours, shape and
motion. Icons are SVG paths drawn in code (`ui/icons.ts`).

* **`data-ui` names** mark every control the automated playthrough presses or
  reads. Keep them when restyling: `e2e/` depends on them.
* **Comfort settings** (`ui/comfort.ts`): interface size, motion and battle
  pace, kept in `localStorage`. They are applied as a CSS variable
  (`--ui-scale`, used through CSS `zoom`) and an attribute
  (`data-motion="reduce"`) the style sheet reads. The battle stage reads
  reduced motion too, and then neither shakes nor pushes the camera.
* **Names over the 3D view** (squads, strongholds, units in battle) follow
  projected positions in canvas pixels, so they are not zoomed; a small
  solver (`gfx/declutter.ts`) keeps them apart.

## Data

* `data/registry.ts` is the one place every class and item lookup goes
  through. `installDataset()` swaps in Ogre Battle 64's at boot.
* `ob64/` reads the ROM's tables (`decode.ts`), turns them into the game's
  classes and items (`convert.ts`), and decodes the unit sprites
  (`sprites.ts`, `lz.ts`). The extractor (`tools/extract-ob64.ts`) runs it on
  the player's own cartridge and writes `public/ob64/`, which is git-ignored
  and kept out of every build by the `keepRomDataOut` plugin in
  `vite.config.ts`.
* `expansion/` translates two other games' classes (facts scraped into
  `data/expansion/*.json`) onto whichever dataset is loaded.

## Test hooks

With `?debug`, `main.ts` and the screens publish the game on
`window.__palatinus` (`debug.ts`): the state, the screens, the rules a player
weighs, where squads and strongholds are on screen, and every battle's
outcome. `?speed=N` (up to 8) runs the clocks faster. Normal play never sees
any of it. The automated playthrough (`e2e/`) drives the game through these
hooks and the interface's `data-ui` names.

## Conventions

* Comments say what the code is *for*, in plain words, often from the
  player's side.
* The rules stay pure: if a screen needs a number, the rule that makes it
  lives in `core/` and gets a test.
* Anything that holds GPU memory has a `dispose()`, and the screen that made
  it calls it.
* No Ogre Battle 64 data or art is ever committed, and no build ships it.
