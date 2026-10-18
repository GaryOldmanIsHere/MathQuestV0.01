import Phaser from 'phaser';
import { getState } from '../core/state';
import type { MapNode, Squad } from '../core/types';
import { classOf } from '../data/registry';
import { moveSpeed, squadMemberIds, squadType, SQUAD_TYPE_LABEL } from '../core/squad';
import { addLoot, rollLoot } from '../core/items';
import { restSquads } from '../core/camp';
import { itemOf } from '../data/registry';
import { drawPanel, makeButton, SMALL_STYLE, TEXT_STYLE, hpColor } from '../gfx/ui';
import { rng } from '../data/names';
import {
  haltSquad, orderTo, retreatTarget, snapOrder, stepToward, strongholdAt,
} from '../core/movement';
import type { Terrain } from '../core/terrain';
import {
  buildTerrainGrid, COLS, MAP_H, ROWS, speedMultiplierAt, terrainAtTile, TILE,
} from '../core/terrain';

interface SquadView {
  sprite: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Arc;
  hpBar: Phaser.GameObjects.Rectangle;
  hpFill: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

export class OverworldScene extends Phaser.Scene {
  private views = new Map<number, SquadView>();
  private selected: Squad | null = null;
  private selectRing!: Phaser.GameObjects.Arc;
  private hudText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private battleActive = false;
  private cooldowns = new Map<number, number>(); // squad id -> time ok to fight again
  private aiTimer = 0;
  private dayTimer = 0;
  private nodeFlags = new Map<number, Phaser.GameObjects.Image>();
  private terrain: Terrain[] = [];

  constructor() {
    super('Overworld');
  }

  create(): void {
    const st = getState();
    this.views.clear();
    this.selected = null;
    this.battleActive = false;
    this.terrain = buildTerrainGrid(st.nodes);

    this.drawTerrain(); // roads are part of the terrain grid now
    this.drawNodes();

    this.selectRing = this.add.circle(0, 0, 20).setStrokeStyle(2, 0xf0e090).setVisible(false);
    this.selectRing.setDepth(50);

    // HUD
    drawPanel(this, 0, MAP_H, 800, 40, { depth: 90 });
    this.hudText = this.add.text(14, MAP_H + 12, '', TEXT_STYLE).setDepth(100);
    this.hintText = this.add.text(360, MAP_H + 14, 'Select a squad, then click a stronghold to march.', SMALL_STYLE).setDepth(100);
    makeButton(this, 690, MAP_H + 4, 104, 32, 'ORGANIZE', () => {
      if (this.battleActive) return;
      this.scene.pause();
      this.scene.launch('Organize');
    }, 95);

    // Map click: selecting your own squad takes priority, otherwise the click
    // is a march order to that exact point — anywhere on the map.
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y >= MAP_H || this.battleActive || st.phase !== 'playing') return;
      // Squads stacked on one spot (the keep, at the start) are picked in
      // turn: each click on the stack selects the next of them.
      const stack = st.squads.filter((s) => s.side === 'player' && Phaser.Math.Distance.Between(p.x, p.y, s.x, s.y) < 22);
      if (stack.length && !(stack.length === 1 && stack[0] === this.selected)) {
        const at = this.selected ? stack.indexOf(this.selected) : -1;
        const sq = stack[(at + 1) % stack.length];
        this.selected = sq;
        const type = squadType(squadMemberIds(sq).map((id) => st.chars.get(id)!));
        this.hintText.setText(`${sq.name} (${SQUAD_TYPE_LABEL[type]}) — click anywhere to march.`);
        return;
      }
      if (this.selected) this.orderMarch(this.selected, p.x, p.y);
    });

    // fan out squads that share a starting stronghold
    const slots = new Map<number, number>();
    for (const sq of st.squads) {
      if (sq.moving) continue;
      const slot = slots.get(sq.nodeId) ?? 0;
      slots.set(sq.nodeId, slot + 1);
      this.settle(sq, st.nodes.find((n) => n.id === sq.nodeId)!, slot);
    }

    this.events.on(Phaser.Scenes.Events.RESUME, () => this.syncAll());
    this.game.events.on('battle-done', this.onBattleDone, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('battle-done', this.onBattleDone, this);
    });

    this.syncAll();
  }

  // ---------------- terrain & nodes ----------------

  /**
   * Draw the ground straight from the terrain grid the movement code charges
   * against, so what the player reads off the map is exactly what they pay.
   */
  private drawTerrain(): void {
    const tileFor: Record<Terrain, string> = {
      plain: 'tile-grass',
      forest: 'tile-forest',
      mountain: 'tile-mountain',
      water: 'tile-water',
      road: 'tile-road',
    };
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const t = terrainAtTile(this.terrain, col, row);
        this.add.image(col * TILE + TILE / 2, row * TILE + TILE / 2, tileFor[t]).setDepth(0);
      }
    }
  }

  private drawNodes(): void {
    const st = getState();
    for (const n of st.nodes) {
      const icon = n.kind === 'town' ? 'icon-town' : n.kind === 'fort' ? 'icon-fort' : 'icon-castle';
      this.add.image(n.x, n.y - 6, icon).setScale(2).setDepth(5);
      const flag = this.add.image(n.x + 18, n.y - 24, `flag-${n.owner}`).setScale(2).setDepth(6);
      this.nodeFlags.set(n.id, flag);
      this.add
        .text(n.x, n.y + 18, n.name, { ...SMALL_STYLE, stroke: '#101020', strokeThickness: 3 })
        .setOrigin(0.5)
        .setDepth(5);
    }
  }

  private nodeAt(x: number, y: number): MapNode | null {
    const st = getState();
    for (const n of st.nodes) {
      if (Phaser.Math.Distance.Between(x, y, n.x, n.y) < 26) return n;
    }
    return null;
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
      this.pingOrder(dest.x, dest.y);
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
    const node = strongholdAt(st.nodes, sq.x, sq.y);
    if (node) {
      sq.nodeId = node.id;
      this.settle(sq, node);
      this.tryCapture(sq, node);
    }
  }

  /** Brief marker where a march order was issued, so the click reads. */
  private pingOrder(x: number, y: number): void {
    const ring = this.add.circle(x, y, 6).setStrokeStyle(2, 0xf0e090).setDepth(40);
    this.tweens.add({
      targets: ring,
      radius: 20,
      alpha: 0,
      duration: 500,
      onComplete: () => ring.destroy(),
    });
  }

  /**
   * Park a squad beside its stronghold rather than on top of it, fanning out
   * from any squads already stationed there so each stays clickable.
   */
  private settle(sq: Squad, node: MapNode, slot?: number): void {
    const st = getState();
    const index = slot ?? st.squads.filter(
      (o) => o.id !== sq.id && !o.moving && o.nodeId === node.id,
    ).length;
    const angle = -Math.PI / 2 + (index % 6) * (Math.PI / 3);
    const radius = index === 0 ? 0 : 30 + Math.floor(index / 6) * 16;
    sq.x = node.x + Math.cos(angle) * radius;
    sq.y = node.y + Math.sin(angle) * radius;
  }

  private tryCapture(sq: Squad, node: MapNode): void {
    const st = getState();
    const hostile = sq.side === 'player' ? 'enemy' : 'player';
    const contested = st.squads.some(
      (o) => o.side === hostile && Phaser.Math.Distance.Between(o.x, o.y, node.x, node.y) < 30,
    );
    if (contested) return;
    if (node.owner !== sq.side) {
      node.owner = sq.side;
      this.nodeFlags.get(node.id)?.setTexture(`flag-${sq.side}`);
      this.toast(`${node.name} ${sq.side === 'player' ? 'liberated!' : 'has fallen!'}`, sq.side === 'player' ? '#90e090' : '#e09090');
      if (node.kind === 'hq-enemy' && sq.side === 'player') this.endCampaign('victory');
      if (node.kind === 'hq-player' && sq.side === 'enemy') this.endCampaign('defeat');
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

      // Otherwise strike for the closest player holding — straight there, since
      // the enemy is no more bound to the roads than the player is.
      const targets = st.nodes.filter((n) => n.owner === 'player');
      if (targets.length === 0) continue;
      let best: MapNode | null = null;
      let bestDist = Infinity;
      for (const t of targets) {
        const d = Phaser.Math.Distance.Between(sq.x, sq.y, t.x, t.y);
        if (d < bestDist) {
          bestDist = d;
          best = t;
        }
      }
      if (best && rng() < 0.6) this.orderMarch(sq, best.x, best.y);
    }
  }

  // ---------------- battles ----------------

  private checkEncounters(): void {
    if (this.battleActive) return;
    const st = getState();
    const now = this.time.now;
    for (const a of st.squads) {
      if (a.side !== 'player') continue;
      for (const b of st.squads) {
        if (b.side !== 'enemy') continue;
        if ((this.cooldowns.get(a.id) ?? 0) > now || (this.cooldowns.get(b.id) ?? 0) > now) continue;
        if (Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y) < 18) {
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
    this.scene.launch('Battle', { attackerId: attacker.id, defenderId: defender.id });
  }

  private onBattleDone(payload: { attackerId: number; defenderId: number; winner: string }): void {
    const st = getState();
    this.battleActive = false;
    const now = this.time.now;

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
        v.sprite.destroy();
        v.ring.destroy();
        v.hpBar.destroy();
        v.hpFill.destroy();
        v.label.destroy();
        this.views.delete(id);
      }
    }
    for (const sq of st.squads) if (!this.views.has(sq.id)) this.makeView(sq);
    if (this.selected && !live.has(this.selected.id)) this.selected = null;
  }

  private makeView(sq: Squad): void {
    const st = getState();
    const leader = st.chars.get(sq.leaderId)!;
    const palette = classOf(leader.classId).palette;
    const ring = this.add
      .circle(sq.x, sq.y + 6, 13, sq.side === 'player' ? 0x4a6ae0 : 0xd04838, 0.45)
      .setDepth(9);
    const sprite = this.add.image(sq.x, sq.y, `unit-${palette}`).setScale(2).setDepth(10);
    const hpBar = this.add.rectangle(sq.x, sq.y - 22, 26, 4, 0x101020).setDepth(11);
    const hpFill = this.add.rectangle(sq.x - 13, sq.y - 22, 26, 4, 0x58c858).setOrigin(0, 0.5).setDepth(12);
    const label = this.add
      .text(sq.x, sq.y - 31, sq.name, { ...SMALL_STYLE, fontSize: '9px', stroke: '#101020', strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(11);
    this.views.set(sq.id, { sprite, ring, hpBar, hpFill, label });
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

  update(_time: number, deltaMs: number): void {
    const st = getState();
    if (st.phase !== 'playing') return;
    const dt = deltaMs / 1000;

    for (const sq of st.squads) this.stepSquad(sq, dt);
    this.checkEncounters();

    this.aiTimer += dt;
    if (this.aiTimer > 6) {
      this.aiTimer = 0;
      this.aiTick();
    }
    this.dayTimer += dt;
    if (this.dayTimer > 12) {
      this.dayTimer = 0;
      st.day++;
      const income = st.nodes.filter((n) => n.owner === 'player').length * 50;
      st.goth += income;
      restSquads(st);
    }

    // sync views
    for (const sq of st.squads) {
      const v = this.views.get(sq.id);
      if (!v) continue;
      v.sprite.setPosition(sq.x, sq.y);
      v.ring.setPosition(sq.x, sq.y + 6);
      v.hpBar.setPosition(sq.x, sq.y - 22);
      v.label.setPosition(sq.x, sq.y - 31);
      const members = squadMemberIds(sq).map((id) => st.chars.get(id)!);
      const ratio = members.reduce((s, c) => s + c.hp, 0) / Math.max(1, members.reduce((s, c) => s + c.stats.hp, 0));
      v.hpFill.setPosition(sq.x - 13, sq.y - 22);
      v.hpFill.width = 26 * ratio;
      v.hpFill.fillColor = hpColor(ratio);
    }
    if (this.selected) {
      this.selectRing.setVisible(true).setPosition(this.selected.x, this.selected.y + 2);
    } else {
      this.selectRing.setVisible(false);
    }

    const owned = st.nodes.filter((n) => n.owner === 'player').length;
    this.hudText.setText(`Day ${st.day}   ${st.goth} Goth   Strongholds ${owned}/${st.nodes.length}`);
  }
}
