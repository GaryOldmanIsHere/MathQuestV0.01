import Phaser from 'phaser';
import { getState } from '../core/state';
import type { MapNode, Squad } from '../core/types';
import { classOf } from '../data/classes';
import { squadMemberIds, squadMoveType, moveSpeed } from '../core/squad';
import { drawPanel, makeButton, SMALL_STYLE, TEXT_STYLE, hpColor } from '../gfx/ui';
import { CLASS_ART } from '../gfx/pixels';
import { rng } from '../data/names';
import { findPath, retreatNode } from '../core/pathing';

const MAP_H = 560; // playfield height; bottom strip is the HUD

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

  constructor() {
    super('Overworld');
  }

  create(): void {
    const st = getState();
    this.views.clear();
    this.selected = null;
    this.battleActive = false;

    this.drawTerrain();
    this.drawRoads();
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

    // map click -> issue march order
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y >= MAP_H || this.battleActive) return;
      const node = this.nodeAt(p.x, p.y);
      if (node && this.selected && st.phase === 'playing') {
        this.orderMarch(this.selected, node.id);
        return;
      }
      const sq = this.squadAt(p.x, p.y);
      if (sq && sq.side === 'player') {
        this.selected = sq;
        this.hintText.setText(`${sq.name} — click a stronghold to march.`);
      }
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

  private drawTerrain(): void {
    for (let y = 0; y < MAP_H; y += 16) {
      for (let x = 0; x < 800; x += 16) {
        // deterministic hash picks patches of forest/mountain/water
        const h = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
        let key = 'tile-grass';
        if (y < 80 && h > 0.3) key = 'tile-mountain';
        else if (x > 600 && y > 420 && h > 0.35) key = 'tile-water';
        else if (h > 0.82) key = 'tile-forest';
        else if (h < 0.06) key = 'tile-forest';
        this.add.image(x + 8, y + 8, key).setDepth(0);
      }
    }
  }

  private drawRoads(): void {
    const st = getState();
    const g = this.add.graphics().setDepth(1);
    g.lineStyle(6, 0x9a8a68, 1);
    const drawn = new Set<string>();
    for (const n of st.nodes) {
      for (const l of n.links) {
        const key = [Math.min(n.id, l), Math.max(n.id, l)].join('-');
        if (drawn.has(key)) continue;
        drawn.add(key);
        const m = st.nodes.find((x) => x.id === l)!;
        g.lineBetween(n.x, n.y, m.x, m.y);
      }
    }
    g.lineStyle(2, 0xb0a080, 1);
    for (const n of st.nodes) {
      for (const l of n.links) {
        const m = st.nodes.find((x) => x.id === l)!;
        if (m.id > n.id) g.lineBetween(n.x, n.y, m.x, m.y);
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

  private squadAt(x: number, y: number): Squad | null {
    const st = getState();
    let best: Squad | null = null;
    let bestD = 22;
    for (const sq of st.squads) {
      const d = Phaser.Math.Distance.Between(x, y, sq.x, sq.y);
      if (d < bestD) {
        bestD = d;
        best = sq;
      }
    }
    return best;
  }

  // ---------------- movement ----------------

  private bfsPath(from: number, to: number): number[] {
    return findPath(getState().nodes, from, to);
  }

  private orderMarch(sq: Squad, targetId: number): void {
    const path = this.bfsPath(sq.nodeId, targetId);
    if (path.length === 0 && sq.nodeId !== targetId) return;
    sq.pathNodes = path;
    sq.targetNodeId = targetId;
    sq.moving = path.length > 0;
    if (sq.side === 'player') {
      const st = getState();
      this.hintText.setText(`${sq.name} marches to ${st.nodes.find((n) => n.id === targetId)!.name}.`);
    }
  }

  private stepSquad(sq: Squad, dt: number): void {
    const st = getState();
    if (!sq.moving || sq.pathNodes.length === 0) return;
    const next = st.nodes.find((n) => n.id === sq.pathNodes[0])!;
    const chars = squadMemberIds(sq).map((id) => st.chars.get(id)!);
    const speed = moveSpeed(squadMoveType(chars));
    const d = Phaser.Math.Distance.Between(sq.x, sq.y, next.x, next.y);
    if (d < 2) {
      sq.x = next.x;
      sq.y = next.y;
      sq.nodeId = next.id;
      sq.pathNodes.shift();
      if (sq.pathNodes.length === 0) {
        sq.moving = false;
        sq.targetNodeId = null;
        this.settle(sq, next);
      }
      this.tryCapture(sq, next);
    } else {
      sq.x += ((next.x - sq.x) / d) * speed * dt;
      sq.y += ((next.y - sq.y) / d) * speed * dt;
    }
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
      const node = st.nodes.find((n) => n.id === sq.nodeId)!;
      // garrison holds its fort unless its node was taken
      const isGarrison = node.kind === 'hq-enemy' || (node.kind === 'fort' && node.owner === 'enemy');
      if (isGarrison) continue;
      // march toward nearest player-owned node
      const targets = st.nodes.filter((n) => n.owner === 'player');
      if (targets.length === 0) continue;
      let best: MapNode | null = null;
      let bestLen = Infinity;
      for (const t of targets) {
        const len = this.bfsPath(sq.nodeId, t.id).length;
        if (len > 0 && len < bestLen) {
          bestLen = len;
          best = t;
        }
      }
      if (best && rng() < 0.6) this.orderMarch(sq, best.id);
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
          this.toast(`${sq.name} destroyed!`, '#90e090');
        } else {
          // routed home: survivors crawl back to HQ at low strength
          const hq = st.nodes.find((n) => n.kind === 'hq-player')!;
          sq.nodeId = hq.id;
          sq.pathNodes = [];
          sq.moving = false;
          this.settle(sq, hq);
          for (const c of members) c.hp = Math.max(1, Math.floor(c.stats.hp * 0.25));
          this.toast(`${sq.name} routed! They regroup at the keep.`, '#e0b060');
        }
      } else {
        for (const c of members) if (c.hp <= 0) c.hp = 1; // KO'd members limp on
        // loser gets pushed back toward a linked node
        const lostAsAttacker = side === 'attackerId' && payload.winner === 'defender';
        const lostAsDefender = side === 'defenderId' && payload.winner === 'attacker';
        if (lostAsAttacker || lostAsDefender) {
          const backId = retreatNode(st.nodes, sq.nodeId);
          if (backId !== null) this.orderMarch(sq, backId);
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
    const palette = CLASS_ART[classOf(leader.classId).palette] ? classOf(leader.classId).palette : 'fighter';
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
