import Phaser from 'phaser';
import { getState } from '../core/state';
import type { MapNode, Squad } from '../core/types';
import { classOf } from '../data/registry';
import { moveSpeed, squadMemberIds, squadType, SQUAD_TYPE_LABEL } from '../core/squad';
import { addLoot, rollLoot } from '../core/items';
import { restSquads } from '../core/camp';
import { itemOf } from '../data/registry';
import { drawPanel, makeButton, SMALL_STYLE, TEXT_STYLE, hpColor } from '../gfx/ui';
import { WorldStage } from '../gfx3d/world';
import { mapFigureFor } from '../gfx3d/mapFigures';
import { prepareSprites } from '../gfx3d/ob64Sprites';
import { figureScale, OVERVIEW, panView } from '../gfx3d/worldMap';
import { declutter } from '../gfx/declutter';
import { exposeDebug, SPEED } from '../debug';
import { rng } from '../data/names';
import {
  CONTEST_RADIUS, ENGAGE_RADIUS, haltSquad, orderTo, retreatTarget, settleOffset, snapOrder, stepToward, strikeTarget, strongholdAt,
} from '../core/movement';
import type { Terrain } from '../core/terrain';
import { buildTerrainGrid, MAP_H, speedMultiplierAt, terrainAtPoint } from '../core/terrain';

const W = 800;

interface SquadView {
  hpBar: Phaser.GameObjects.Rectangle;
  hpFill: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

/** How far the pointer must travel before a press becomes a drag. */
const DRAG_SLOP = 6;

/** A campaign day, in ms of the map's clock. */
const DAY_MS = 12000;

export class OverworldScene extends Phaser.Scene {
  private views = new Map<number, SquadView>();
  private selected: Squad | null = null;
  private world: WorldStage | null = null;
  private screen: Phaser.Textures.CanvasTexture | null = null;
  private nodeLabels = new Map<number, Phaser.GameObjects.Text>();
  private press: { x: number; y: number; button: number; dragging: boolean } | null = null;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private hudText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private battleActive = false;
  private cooldowns = new Map<number, number>(); // squad id -> map time when it may fight again
  /** Routed squads, by id, and the map time they have rested enough to stand and fight. */
  private recovering = new Map<number, number>();
  /** The map's own clock, in ms: it runs only while the map does. */
  private clock = 0;
  private aiTimer = 0;
  private dayTimer = 0;
  private terrain: Terrain[] = [];

  constructor() {
    super('Overworld');
  }

  create(): void {
    const st = getState();
    this.views.clear();
    this.selected = null;
    this.battleActive = false;
    // A new campaign starts its clocks afresh.
    this.clock = 0;
    this.aiTimer = 0;
    this.dayTimer = 0;
    this.cooldowns.clear();
    this.recovering.clear();
    this.terrain = buildTerrainGrid(st.nodes);

    // The map in 3D, grown from the same terrain grid marching is charged on,
    // drawn by Three.js and shown here as a texture under the interface.
    this.world?.dispose();
    const world = new WorldStage(W, MAP_H);
    this.world = world;
    world.build(this.terrain, st.nodes);
    world.setView(OVERVIEW, true);
    if (this.textures.exists('world3d')) this.textures.remove('world3d');
    this.screen = this.textures.createCanvas('world3d', W, MAP_H);
    const view3d = this.add.image(0, 0, 'world3d').setOrigin(0).setDepth(0);
    this.nodeLabels.clear();
    for (const n of st.nodes) {
      this.nodeLabels.set(n.id, this.add
        .text(0, 0, n.name, { ...SMALL_STYLE, stroke: '#101020', strokeThickness: 3 })
        .setOrigin(0.5, 0)
        .setDepth(5));
    }
    this.add
      .text(8, 6, 'Drag: pan   Wheel: zoom   Q/E or right-drag: turn   Space: find squad   R: whole map',
        { ...SMALL_STYLE, fontSize: '9px', color: '#e8e0c8', stroke: '#101020', strokeThickness: 3 })
      .setDepth(60)
      .setAlpha(0.85);

    // HUD
    drawPanel(this, 0, MAP_H, 800, 40, { depth: 90 });
    this.hudText = this.add.text(14, MAP_H + 12, '', TEXT_STYLE).setDepth(100);
    this.hintText = this.add.text(360, MAP_H + 14, 'Select a squad, then click a stronghold to march.', SMALL_STYLE).setDepth(100);
    makeButton(this, 690, MAP_H + 4, 104, 32, 'ORGANIZE', () => {
      if (this.battleActive) return;
      this.scene.pause();
      this.scene.launch('Organize');
    }, 95);

    // The camera: drag to pan (right-drag turns), the wheel zooms, keys pan
    // and turn. A press that does not become a drag is a click on the map.
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y >= MAP_H) return;
      this.press = { x: p.x, y: p.y, button: p.button, dragging: false };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const press = this.press;
      if (!press || !p.isDown || !this.world) return;
      if (!press.dragging && Phaser.Math.Distance.Between(p.x, p.y, press.x, press.y) < DRAG_SLOP) return;
      press.dragging = true;
      if (press.button === 0) this.world.drag(p.prevPosition.x, p.prevPosition.y, p.x, p.y);
      else this.world.turn((p.x - p.prevPosition.x) * 0.01);
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const press = this.press;
      this.press = null;
      if (!press || press.dragging || press.button !== 0 || p.y >= MAP_H) return;
      this.clickMap(p.x, p.y);
    });
    this.input.on('wheel', (p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      if (p.y < MAP_H) this.world?.zoomAt(dy > 0 ? 1.12 : 1 / 1.12, p.x, p.y);
    });
    const kb = this.input.keyboard;
    if (kb) {
      this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,Q,E') as Record<string, Phaser.Input.Keyboard.Key>;
      kb.on('keydown-SPACE', () => this.findSquad());
      kb.on('keydown-R', () => this.world?.setView(OVERVIEW));
    }

    // fan out squads that share a starting stronghold
    const slots = new Map<number, number>();
    for (const sq of st.squads) {
      if (sq.moving) continue;
      const slot = slots.get(sq.nodeId) ?? 0;
      slots.set(sq.nodeId, slot + 1);
      this.settle(sq, st.nodes.find((n) => n.id === sq.nodeId)!, slot);
    }

    // While a menu or a battle stands over the map, only the land shows
    // through; the map's names, bars and HUD step aside until it returns.
    let hidden: Phaser.GameObjects.GameObject[] = [];
    this.events.on(Phaser.Scenes.Events.PAUSE, () => {
      hidden = this.children.list.filter((o) => o !== view3d && (o as unknown as Phaser.GameObjects.Components.Visible).visible);
      for (const o of hidden) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false);
    });
    this.tweens.timeScale = SPEED;
    // For the automated playthrough: where a squad or a map point is on screen.
    exposeDebug('map', {
      scene: this,
      pointOnScreen: (x: number, y: number) => world.project(x, y, 0),
      squadOnScreen: (id: number) => {
        const sq = getState().squads.find((s) => s.id === id);
        if (!sq) return null;
        const p = this.shownAt(sq);
        return world.project(p.x, p.y, world.squadHeight(id) / 2);
      },
      selectedId: () => this.selected?.id ?? null,
      view: () => ({ ...world.view }),
      hint: () => this.hintText.text,
      setView: (v: Parameters<WorldStage['setView']>[0]) => world.setView(v, true),
    });
    this.events.on(Phaser.Scenes.Events.RESUME, () => {
      for (const o of hidden) if (o.active) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(true);
      hidden = [];
      this.syncAll();
      this.prepareLeaders();
    });
    this.prepareLeaders();
    this.game.events.on('battle-done', this.onBattleDone, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('battle-done', this.onBattleDone, this);
      this.input.keyboard?.off('keydown-SPACE');
      this.input.keyboard?.off('keydown-R');
      this.world?.dispose();
      this.world = null;
      this.screen = null;
      if (this.textures.exists('world3d')) this.textures.remove('world3d');
    });

    this.syncAll();
  }

  // ---------------- the map ----------------

  /**
   * A click on the map. Selecting your own squad takes priority; otherwise,
   * with a squad selected, it is a march order to that point of ground,
   * anywhere on the map.
   */
  private clickMap(sx: number, sy: number): void {
    const st = getState();
    const world = this.world;
    if (!world || this.battleActive || st.phase !== 'playing') return;
    // Squads are picked where they stand on screen. Squads stacked on one
    // spot (the keep, at the start) are picked in turn: each click on the
    // stack selects the next of them.
    const stack = st.squads.filter((s) => {
      if (s.side !== 'player') return false;
      const p = this.shownAt(s);
      const at = world.project(p.x, p.y, world.squadHeight(s.id) / 2);
      return at.visible && Phaser.Math.Distance.Between(sx, sy, at.x, at.y) < 22;
    });
    if (stack.length && !(stack.length === 1 && stack[0] === this.selected)) {
      const at = this.selected ? stack.indexOf(this.selected) : -1;
      const sq = stack[(at + 1) % stack.length];
      this.selected = sq;
      world.select(sq.id, this.routeOf(sq));
      const type = squadType(squadMemberIds(sq).map((id) => st.chars.get(id)!));
      this.hintText.setText(`${sq.name} (${SQUAD_TYPE_LABEL[type]}) — click anywhere to march.`);
      return;
    }
    const ground = world.pick(sx, sy);
    if (this.selected && ground) this.orderMarch(this.selected, ground.x, ground.y);
  }

  /**
   * Where a squad is drawn: where it stands, except that one halted on a
   * stronghold's very centre stands in front of the building instead of
   * inside it. (Its place in the game is unchanged.)
   */
  private shownAt(sq: Squad): { x: number; y: number } {
    if (sq.moving) return { x: sq.x, y: sq.y };
    const st = getState();
    const near = (s: Squad, n: MapNode) => !s.moving && Math.hypot(n.x - s.x, n.y - s.y) < 50;
    const n = st.nodes.find((o) => near(sq, o));
    if (!n) return { x: sq.x, y: sq.y };
    // The squads parked at a stronghold stand in an arc in front of it, on
    // the camera's side, spreading further as the camera draws back and
    // their figures grow.
    const parked = st.squads.filter((o) => near(o, n)).sort((a, b) => a.id - b.id);
    const i = parked.indexOf(sq);
    const view = this.world?.view;
    const grow = figureScale(view?.distance ?? 0);
    // The camera stands toward (sin yaw, cos yaw) on the map.
    const toward = Math.PI / 2 - (view?.yaw ?? 0);
    const angle = toward + (i - (parked.length - 1) / 2) * 0.62;
    const r = (parked.length > 1 ? 30 : 22) * grow;
    return { x: n.x + Math.cos(angle) * r, y: n.y + Math.sin(angle) * r };
  }

  private routeOf(sq: Squad): { x: number; y: number } | null {
    return sq.moving && sq.targetX !== null && sq.targetY !== null ? { x: sq.targetX, y: sq.targetY } : null;
  }

  /**
   * Fetch Ogre Battle 64's sprites for every squad's leader, where they were
   * extracted; until they arrive a leader shows its standing drawing.
   */
  private prepareLeaders(): void {
    const st = getState();
    void prepareSprites(st.squads.map((sq) => ({ def: classOf(st.chars.get(sq.leaderId)!.classId), side: sq.side })));
  }

  /** Bring the selected squad into view, or the next of the army's squads. */
  private findSquad(): void {
    const st = getState();
    const mine = st.squads.filter((s) => s.side === 'player');
    if (!mine.length || !this.world) return;
    const sq = this.selected ?? mine[0];
    this.selected = sq;
    this.world.select(sq.id, this.routeOf(sq));
    const p = this.shownAt(sq);
    this.world.lookAt(p.x, p.y, 18);
  }

  /** Keys pan and turn the camera while held. */
  private steerCamera(dt: number): void {
    const world = this.world;
    if (!world) return;
    const k = this.keys;
    const down = (...names: string[]) => names.some((n) => k[n]?.isDown);
    const step = world.view.distance * 0.9 * dt;
    const right = (down('D', 'RIGHT') ? 1 : 0) - (down('A', 'LEFT') ? 1 : 0);
    const forward = (down('W', 'UP') ? 1 : 0) - (down('S', 'DOWN') ? 1 : 0);
    if (right || forward) world.setView(panView(world.view, right * step, forward * step));
    const turn = (down('E') ? 1 : 0) - (down('Q') ? 1 : 0);
    if (turn) world.turn(turn * 1.6 * dt);
  }

  // ---------------- movement ----------------

  /** March to any point on the map. Clicks near a stronghold snap onto it. */
  private orderMarch(sq: Squad, x: number, y: number): void {
    const st = getState();
    const dest = snapOrder(st.nodes, x, y);
    orderTo(sq, dest.x, dest.y);
    if (sq.side === 'player') {
      const node = strongholdAt(st.nodes, dest.x, dest.y);
      this.hintText.setText(
        node ? `${sq.name} marches on ${node.name}.` : `${sq.name} marches into open country.`,
      );
      this.world?.ping(dest.x, dest.y);
      if (this.selected === sq) this.world?.select(sq.id, dest);
    }
  }

  private stepSquad(sq: Squad, dt: number): void {
    const st = getState();
    if (!sq.moving || sq.targetX === null || sq.targetY === null) return;

    const chars = squadMemberIds(sq).map((id) => st.chars.get(id)!);
    const type = squadType(chars);
    // The squad's make-up sets its pace, and how the ground under it tells.
    const terrainFactor = speedMultiplierAt(this.terrain, sq.x, sq.y, type);
    const distance = moveSpeed(type) * terrainFactor * dt;

    const next = stepToward(sq.x, sq.y, sq.targetX, sq.targetY, distance);
    sq.x = next.x;
    sq.y = next.y;
    if (!next.arrived) return;

    haltSquad(sq);
    if (this.selected === sq) this.world?.select(sq.id, null);
    const node = strongholdAt(st.nodes, sq.x, sq.y);
    if (node) {
      sq.nodeId = node.id;
      this.settle(sq, node);
      this.tryCapture(sq, node);
    }
  }

  /**
   * Park a squad at its stronghold, close about any squads already
   * stationed there, near enough to hold it and to meet an enemy who comes
   * for it. The map draws parked squads spread out in front of the building.
   */
  private settle(sq: Squad, node: MapNode, slot?: number): void {
    const st = getState();
    const index = slot ?? st.squads.filter(
      (o) => o.id !== sq.id && !o.moving && o.nodeId === node.id,
    ).length;
    const at = settleOffset(index);
    sq.x = node.x + at.x;
    sq.y = node.y + at.y;
  }

  private tryCapture(sq: Squad, node: MapNode): void {
    const st = getState();
    const hostile = sq.side === 'player' ? 'enemy' : 'player';
    // A routed squad still regrouping holds nothing: it cannot stop a capture.
    const contested = st.squads.some(
      (o) => o.side === hostile && !this.isRecovering(o) &&
        Phaser.Math.Distance.Between(o.x, o.y, node.x, node.y) < CONTEST_RADIUS,
    );
    if (contested) return;
    if (node.owner !== sq.side) {
      node.owner = sq.side;
      this.world?.setOwner(node.id, sq.side);
      this.toast(`${node.name} ${sq.side === 'player' ? 'liberated!' : 'has fallen!'}`, sq.side === 'player' ? '#90e090' : '#e09090');
      if (node.kind === 'hq-enemy' && sq.side === 'player') this.endCampaign('victory');
      if (node.kind === 'hq-player' && sq.side === 'enemy') this.endCampaign('defeat');
    }
  }

  private isRecovering(sq: Squad): boolean {
    return (this.recovering.get(sq.id) ?? 0) > this.clock;
  }

  /**
   * A squad standing on a stronghold it does not hold takes it as soon as no
   * one is left to dispute it, not only on the moment it arrives.
   */
  private pressClaims(): void {
    const st = getState();
    for (const sq of st.squads) {
      if (sq.moving || this.isRecovering(sq)) continue;
      const node = strongholdAt(st.nodes, sq.x, sq.y);
      if (node && node.owner !== sq.side) this.tryCapture(sq, node);
      if (st.phase !== 'playing') return;
    }
  }

  // ---------------- enemy AI ----------------

  private aiTick(): void {
    const st = getState();
    const roamers = st.squads.filter((s) => s.side === 'enemy' && !s.moving);
    for (const sq of roamers) {
      // A garrison sits on its own fort and holds it.
      const here = strongholdAt(st.nodes, sq.x, sq.y);
      if (here && here.owner === 'enemy' && (here.kind === 'hq-enemy' || here.kind === 'fort')) continue;

      // Otherwise strike for the closest player holding within reach — straight
      // there, since the enemy is no more bound to the roads than the player is.
      const best = strikeTarget(st.nodes, sq.x, sq.y);
      if (best && rng() < 0.6) this.orderMarch(sq, best.x, best.y);
    }
  }

  // ---------------- battles ----------------

  private checkEncounters(): void {
    if (this.battleActive) return;
    const st = getState();
    const now = this.clock;
    for (const a of st.squads) {
      if (a.side !== 'player') continue;
      for (const b of st.squads) {
        if (b.side !== 'enemy') continue;
        if ((this.cooldowns.get(a.id) ?? 0) > now || (this.cooldowns.get(b.id) ?? 0) > now) continue;
        if (Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y) < ENGAGE_RADIUS) {
          this.startBattle(a, b);
          return;
        }
      }
    }
  }

  private startBattle(attacker: Squad, defender: Squad): void {
    this.battleActive = true;
    attacker.moving = false;
    defender.moving = false;
    this.scene.pause();
    // The battlefield takes the ground the squads meet on.
    const field = terrainAtPoint(this.terrain, (attacker.x + defender.x) / 2, (attacker.y + defender.y) / 2);
    this.scene.launch('Battle', { attackerId: attacker.id, defenderId: defender.id, field });
  }

  private onBattleDone(payload: { attackerId: number; defenderId: number; winner: string }): void {
    const st = getState();
    this.battleActive = false;
    // Counted on the map's own clock, which stood still through the battle.
    const now = this.clock;

    for (const side of ['attackerId', 'defenderId'] as const) {
      const sq = st.squads.find((s) => s.id === payload[side]);
      if (!sq) continue;
      this.cooldowns.set(sq.id, now + 7000);
      const members = squadMemberIds(sq).map((id) => st.chars.get(id)!);
      const wiped = members.every((c) => c.hp <= 0);
      if (wiped) {
        if (sq.side === 'enemy') {
          st.squads.splice(st.squads.indexOf(sq), 1);
          const loot = rollLoot(members);
          addLoot(loot, st.inventory, st);
          const found = loot.items.map((id) => itemOf(id).name);
          this.toast(`${sq.name} destroyed! Spoils: ${[`${loot.goth} Goth`, ...found].join(', ')}`, '#90e090');
        } else {
          // routed home: survivors crawl back to HQ at low strength
          const hq = st.nodes.find((n) => n.kind === 'hq-player')!;
          sq.nodeId = hq.id;
          haltSquad(sq);
          this.settle(sq, hq);
          for (const c of members) c.hp = Math.max(1, Math.floor(c.stats.hp * 0.25));
          // It sits out a day to regroup, so it is not thrown straight back at
          // whoever routed it (perhaps camped on the keep itself).
          this.cooldowns.set(sq.id, now + DAY_MS);
          this.recovering.set(sq.id, now + DAY_MS);
          this.toast(`${sq.name} routed! They regroup at the keep.`, '#e0b060');
        }
      } else {
        // The fallen stay down until revived, or until their squad rests at its keep.
        // The beaten side gives ground, falling back on its own nearest holding.
        const lostAsAttacker = side === 'attackerId' && payload.winner === 'defender';
        const lostAsDefender = side === 'defenderId' && payload.winner === 'attacker';
        if (lostAsAttacker || lostAsDefender) {
          const foe = st.squads.find((o) => o.id === payload[side === 'attackerId' ? 'defenderId' : 'attackerId']);
          const away = retreatTarget(st.nodes, sq.side, sq.x, sq.y, foe?.x ?? sq.x, foe?.y ?? sq.y);
          orderTo(sq, away.x, away.y);
        }
      }
    }
    this.syncAll();
  }

  // ---------------- view sync ----------------

  private syncAll(): void {
    const st = getState();
    const live = new Set(st.squads.map((s) => s.id));
    for (const [id, v] of this.views) {
      if (!live.has(id)) {
        this.world?.removeSquad(id);
        v.hpBar.destroy();
        v.hpFill.destroy();
        v.label.destroy();
        this.views.delete(id);
      }
    }
    for (const sq of st.squads) if (!this.views.has(sq.id)) this.makeView(sq);
    if (this.selected && !live.has(this.selected.id)) this.selected = null;
    if (this.selected) this.world?.select(this.selected.id, this.routeOf(this.selected));
  }

  private makeView(sq: Squad): void {
    const hpBar = this.add.rectangle(sq.x, sq.y - 22, 26, 4, 0x101020).setDepth(11);
    const hpFill = this.add.rectangle(sq.x - 13, sq.y - 22, 26, 4, 0x58c858).setOrigin(0, 0.5).setDepth(12);
    const label = this.add
      .text(sq.x, sq.y - 31, sq.name, { ...SMALL_STYLE, fontSize: '9px', stroke: '#101020', strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(11);
    this.views.set(sq.id, { hpBar, hpFill, label });
  }

  /**
   * Stand every squad where it now is, draw the world, and lay the names and
   * strength bars over it where the camera sees each one.
   */
  private drawWorld(deltaMs: number): void {
    const st = getState();
    const world = this.world;
    if (!world || !this.screen) return;
    for (const sq of st.squads) {
      const leader = st.chars.get(sq.leaderId)!;
      const p = this.shownAt(sq);
      world.setSquad(sq.id, p.x, p.y, sq.side, mapFigureFor(this, classOf(leader.classId), sq.side), sq.moving);
    }
    if (this.selected?.moving) world.refreshRoute(this.routeOf(this.selected));
    world.update(Math.min(deltaMs, 50 * SPEED));
    const ctx = this.screen.getContext();
    ctx.clearRect(0, 0, W, MAP_H);
    ctx.drawImage(world.canvas, 0, 0, W, MAP_H);
    this.screen.refresh();

    for (const n of st.nodes) {
      // Over the building, clear of the squads parked in front of it.
      const at = world.project(n.x, n.y, n.kind === 'town' ? 1.9 : 3.1);
      this.nodeLabels.get(n.id)?.setPosition(at.x, at.y - 16).setVisible(at.visible && at.y > 20 && at.y < MAP_H - 6);
    }
    // Each squad's name and strength sit over its head, moved clear of one
    // another (and of the strongholds' names) where squads gather.
    const heads = st.squads.flatMap((sq) => {
      const v = this.views.get(sq.id);
      if (!v) return [];
      const p = this.shownAt(sq);
      const at = world.project(p.x, p.y, world.squadHeight(sq.id) + 0.15);
      return at.visible && at.y > 0 && at.y < MAP_H ? [{ sq, v, at }] : [];
    });
    for (const sq of st.squads) {
      const v = this.views.get(sq.id);
      if (v && !heads.some((h) => h.sq === sq)) [v.hpBar, v.hpFill, v.label].forEach((o) => o.setVisible(false));
    }
    const names = [...this.nodeLabels.values()].filter((t) => t.visible);
    const boxes = [
      ...heads.map(({ v, at }) => ({ x: at.x, y: at.y - 19, w: Math.max(28, v.label.width), h: 18 })),
      ...names.map((t) => ({ x: t.x, y: t.y, w: t.width, h: t.height })),
    ];
    // Stronghold names hold their places: they count as already placed, being lowest.
    const ys = declutter(boxes, 1, 6, heads.length);
    heads.forEach(({ sq, v, at }, k) => {
      const top = ys[k];
      // Kept whole on screen at its edges.
      const half = v.label.width / 2 + 2;
      const x = Math.max(half, Math.min(W - half, at.x));
      v.label.setPosition(x, top + 6).setVisible(true);
      v.hpBar.setPosition(x, top + 15).setVisible(true);
      const members = squadMemberIds(sq).map((id) => st.chars.get(id)!);
      const ratio = members.reduce((s, c) => s + c.hp, 0) / Math.max(1, members.reduce((s, c) => s + c.stats.hp, 0));
      v.hpFill.setPosition(x - 13, top + 15).setVisible(true);
      v.hpFill.width = 26 * ratio;
      v.hpFill.fillColor = hpColor(ratio);
    });
  }

  private endCampaign(result: 'victory' | 'defeat'): void {
    const st = getState();
    if (st.phase !== 'playing') return;
    st.phase = result;
    const msg = result === 'victory'
      ? 'VICTORY!\nCastle Verlaine is yours.\nThe realm is liberated.'
      : 'DEFEAT...\nFort Melchor has fallen.';
    drawPanel(this, 250, 200, 300, 150);
    this.add
      .text(400, 255, msg, { ...TEXT_STYLE, fontSize: '16px', align: 'center' })
      .setOrigin(0.5)
      .setDepth(200);
    makeButton(this, 330, 300, 140, 34, 'TITLE', () => this.scene.start('Title'));
  }

  private toast(msg: string, color: string): void {
    const t = this.add
      .text(400, 80, msg, { ...TEXT_STYLE, color, stroke: '#101020', strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(150);
    this.tweens.add({ targets: t, y: 50, alpha: 0, duration: 2600, onComplete: () => t.destroy() });
  }

  update(_time: number, frameMs: number): void {
    const deltaMs = frameMs * SPEED;
    if (getState().phase === 'playing') this.clock += deltaMs;
    const st = getState();
    if (st.phase !== 'playing') return;
    const dt = deltaMs / 1000;

    this.steerCamera(dt);
    for (const sq of st.squads) this.stepSquad(sq, dt);
    this.pressClaims();
    if (st.phase !== 'playing') return;
    this.checkEncounters();

    this.aiTimer += dt;
    if (this.aiTimer > 6) {
      this.aiTimer = 0;
      this.aiTick();
    }
    this.dayTimer += dt;
    if (this.dayTimer > DAY_MS / 1000) {
      this.dayTimer = 0;
      st.day++;
      const income = st.nodes.filter((n) => n.owner === 'player').length * 50;
      st.goth += income;
      restSquads(st);
    }

    this.drawWorld(deltaMs);

    const owned = st.nodes.filter((n) => n.owner === 'player').length;
    this.hudText.setText(`Day ${st.day}   ${st.goth} Goth   Strongholds ${owned}/${st.nodes.length}`);
  }
}
