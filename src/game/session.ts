/**
 * A flight session through one level: throw → fly → (crash / ground / workbench / exit).
 * Owns the physics plane, the current room's runtime state and drives the renderer.
 */

import * as THREE from 'three';
import type { Design } from '../paper/design';
import { analyzeDesign, type AeroModel } from '../paper/aero';
import { buildMesh, type PlaneBuild, type PlaneMesh } from '../paper/build';
import { PHYS, PX_PER_M, ROOM_H, ROOM_W } from '../physics/config';
import { createPlane, launch, planePx, stepPlane, idealThrowPower, type Plane } from '../physics/flight';
import { applyImpact, damagePct, ignite, repair, soakUp, structural, type PartName } from '../physics/damage';
import type { ControlState, ThrowState } from '../core/types';
import { paintRoom, type RoomArt } from '../render/roomArt';
import type { ActiveLight, GameRenderer } from '../render/GameRenderer';
import { rgb } from '../render/particles';
import { OBJECTS } from './objects';
import type { GameObject, ObjCtx, SessionApi, WindOut } from './objects/types';
import { bounds, polyVsBox, profileHull, surfaceBelow, worldHull, type V } from './collide';
import { countStars, neighbour, type LevelDef } from './level';
import type { Collider, ItemDef, RoomDef } from '../world/types';

export type Phase = 'aim' | 'fly' | 'down' | 'workbench' | 'complete' | 'failed';

export interface SessionOptions {
  autoTrim: boolean;
  slowMo: boolean;
  /** Multiplier on vent / fan strength (roguelike perks). */
  airMul?: number;
  /** Extra sheets on top of the level's. */
  bonusSheets?: number;
  /** Charges for gadgets at the start. */
  charges?: Partial<Charges>;
  /** Stars already collected (e.g. resuming). */
  collected?: string[];
}

export interface Charges {
  boost: number;
  bands: number;
  helium: number;
}

export interface HudState {
  phase: Phase;
  sheets: number;
  stars: number;
  starsTotal: number;
  time: number;
  damage: number;
  burning: boolean;
  soak: number;
  charges: Charges;
  gadget: Design['extras']['gadget'];
  roomName: string;
  lightsOn: boolean;
  message: string | null;
  speed: number;
  alpha: number;
  ld: number;
  stall: number;
  power: number;
  idealPower: number;
}

export interface LevelResult {
  levelId: string;
  time: number;
  stars: number;
  starsTotal: number;
  damage: number;
  sheetsUsed: number;
  crashes: number;
  roomsVisited: number;
  /** Per-room outcome in visit order (for the daily share card). */
  roomLog: ('clear' | 'damaged' | 'crash')[];
}

export interface SessionCallbacks {
  hud?(h: HudState): void;
  complete?(r: LevelResult): void;
  failed?(r: LevelResult): void;
  workbench?(): void;
  room?(key: string, def: RoomDef): void;
  sfx?(name: string, opts?: { vol?: number; pitch?: number }): void;
}

const DEG = Math.PI / 180;

class RoomRuntime {
  objects: GameObject[] = [];
  lightsOn: boolean;
  constructor(
    readonly key: string,
    readonly def: RoomDef,
    readonly art: RoomArt,
    renderer: GameRenderer,
    readonly switches: Map<string, boolean>,
  ) {
    this.lightsOn = !def.dark;
    let i = 0;
    for (const it of def.items) {
      const f = OBJECTS[it.t];
      if (!f) continue;
      const id = typeof it.id === 'string' ? it.id : `${key}:${it.t}:${i++}`;
      this.objects.push(f(it, id, renderer, { dark: !!def.dark, night: !!def.night }));
    }
  }

  colliders(): Collider[] {
    const out = this.art.colliders.slice();
    for (const o of this.objects) if (o.colliders) out.push(...o.colliders());
    return out;
  }

  lights(): ActiveLight[] {
    const out: ActiveLight[] = [];
    for (const l of this.art.lights) {
      if (l.switched && !this.lightsOn) continue;
      out.push({ x: l.x, y: l.y, r: l.r, color: new THREE.Color(l.color), intensity: l.intensity });
    }
    for (const o of this.objects) if (o.lights) out.push(...o.lights());
    return out;
  }

  ambient(): THREE.Color {
    const night = !!this.def.night;
    if (!this.lightsOn) return night ? new THREE.Color(0.1, 0.11, 0.2) : new THREE.Color(0.2, 0.21, 0.3);
    return night ? new THREE.Color(0.5, 0.47, 0.46) : new THREE.Color(0.74, 0.73, 0.74);
  }

  dispose(): void {
    for (const o of this.objects) o.dispose?.();
    this.objects = [];
  }
}

export class Session {
  phase: Phase = 'aim';
  plane!: Plane;
  aero!: AeroModel;
  build!: PlaneBuild;
  mesh!: PlaneMesh;
  hullLocal: V[] = [];
  room!: RoomRuntime;
  sheets: number;
  time = 0;
  collected = new Set<string>();
  starsTotal: number;
  charges: Charges;
  crashes = 0;
  sheetsUsed = 0;
  roomLog: ('clear' | 'damaged' | 'crash')[] = [];
  roomsVisited = new Set<string>();
  checkpoint: { room: string; x: number; y: number; facing: 1 | -1 };
  aim = { angle: 0.15, power: 0.5 };
  message: string | null = null;
  private artCache = new Map<string, RoomArt>();
  private switches = new Map<string, boolean>();
  private groundT = 0;
  private stillT = 0;
  private downT = 0;
  private flash = 0;
  private shakeAmt = 0;
  private hudT = 0;
  private realTime = 0;
  private roomDamage0 = 0;
  private triggeredThisTick = new Set<string>();

  constructor(
    readonly renderer: GameRenderer,
    readonly level: LevelDef,
    public design: Design,
    readonly opts: SessionOptions,
    readonly cb: SessionCallbacks = {},
  ) {
    this.sheets = level.sheets + (opts.bonusSheets ?? 0);
    this.starsTotal = countStars(level);
    this.charges = { boost: 0, bands: 0, helium: 0, ...opts.charges };
    for (const id of opts.collected ?? []) this.collected.add(id);
    this.checkpoint = { ...level.start };
    this.setDesign(design, true);
    this.enterRoom(level.start.room);
    this.beginAim();
    if (level.intro) this.message = level.intro;
  }

  // ------------------------------------------------------------------------------------------
  // Design / plane

  setDesign(design: Design, fresh: boolean): void {
    this.design = design;
    const { build, aero } = analyzeDesign(design);
    this.build = build;
    this.aero = aero;
    this.mesh = buildMesh(build, aero.cg);
    this.hullLocal = profileHull(this.mesh);
    const damage = !fresh && this.plane ? this.plane.damage : undefined;
    this.plane = createPlane(aero, { autoTrim: this.opts.autoTrim });
    if (damage) this.plane.damage = damage;
    this.renderer.plane.setMesh(this.mesh, design.look, { width: build.width, length: build.length });
    if (design.extras.gadget === 'battery') this.charges.boost = Math.max(this.charges.boost, 2);
    if (design.extras.gadget === 'helium') this.charges.helium = Math.max(this.charges.helium, 1);
    if (design.extras.gadget === 'bands') this.charges.bands = Math.max(this.charges.bands, 3);
  }

  // ------------------------------------------------------------------------------------------
  // Rooms

  private artFor(key: string): RoomArt {
    let a = this.artCache.get(key);
    if (!a) {
      a = paintRoom(this.level.rooms[key]);
      this.artCache.set(key, a);
    }
    return a;
  }

  private enterRoom(key: string): void {
    if (this.room) {
      this.room.dispose();
      this.renderer.clearSprites();
      this.logRoom();
    }
    const def = this.level.rooms[key];
    const art = this.artFor(key);
    this.renderer.setRoom(art);
    this.renderer.particles.clear();
    this.room = new RoomRuntime(key, def, art, this.renderer, this.switches);
    if (this.switches.get(`lights:${key}`) !== undefined) this.room.lightsOn = this.switches.get(`lights:${key}`)!;
    this.roomsVisited.add(key);
    this.roomDamage0 = this.plane ? structural(this.plane.damage) : 0;
    if (def.dark && !this.room.lightsOn) this.message = 'Too dark to see! Find the light switch.';
    this.cb.room?.(key, def);
  }

  private logRoom(): void {
    const d = structural(this.plane.damage) - this.roomDamage0;
    this.roomLog.push(d > 0.05 ? 'damaged' : 'clear');
  }

  // ------------------------------------------------------------------------------------------
  // API for objects

  private api: SessionApi = {
    collectStar: (id) => {
      this.collected.add(id);
    },
    addSheet: () => {
      this.sheets++;
      this.message = '+1 spare sheet';
    },
    repair: (a) => {
      repair(this.plane.damage, a);
      this.message = 'Patched up with tape';
    },
    addCharge: (k, n) => {
      this.charges[k] += n;
    },
    toggleLights: () => {
      this.room.lightsOn = !this.room.lightsOn;
      this.switches.set(`lights:${this.room.key}`, this.room.lightsOn);
      this.message = null;
    },
    setSwitch: (g, on) => {
      this.switches.set(g, on);
    },
    switchOn: (g) => this.switches.get(g) ?? true,
    soak: (a) => soakUp(this.plane.damage, a, this.aero),
    ignite: () => {
      if (ignite(this.plane.damage, this.aero)) this.sfx('burn');
    },
    burnDamage: (a) => {
      this.plane.damage.scorch = Math.min(1, this.plane.damage.scorch + a);
    },
    tear: (a) => {
      this.plane.damage.body = Math.min(1, this.plane.damage.body + a);
    },
    completeLevel: () => this.complete(),
    openWorkbench: () => {
      if (this.phase !== 'fly') return;
      this.phase = 'workbench';
      const p = planePx(this.plane);
      this.checkpoint = { room: this.room.key, x: p.x, y: p.y - 12, facing: this.plane.facing };
      this.cb.workbench?.();
    },
    teleport: (toRoom, x, y, facing) => {
      if (toRoom !== this.room.key) this.enterRoom(toRoom);
      this.plane.x = x / PX_PER_M;
      this.plane.y = (ROOM_H - y) / PX_PER_M;
      if (facing) this.plane.facing = facing;
    },
    sfx: (n, o) => this.sfx(n, o),
    shake: (a) => {
      this.shakeAmt = Math.max(this.shakeAmt, a);
    },
    plane: () => {
      const p = planePx(this.plane);
      return { x: p.x, y: p.y, vx: this.plane.vx, vy: this.plane.vy, alive: this.phase === 'fly' };
    },
    isCollected: (id) => this.collected.has(id),
    lightsOn: () => this.room.lightsOn,
  };

  private sfx(name: string, opts?: { vol?: number; pitch?: number }): void {
    this.cb.sfx?.(name, opts);
  }

  // ------------------------------------------------------------------------------------------
  // Wind

  private windOut: WindOut = { x: 0, y: 0 };
  windAt = (xm: number, ym: number): { x: number; y: number } => {
    const out = this.windOut;
    out.x = 0;
    out.y = 0;
    const x = xm * PX_PER_M;
    const y = ROOM_H - ym * PX_PER_M;
    for (const o of this.room.objects) o.wind?.(x, y, out);
    const m = this.opts.airMul ?? 1;
    return { x: out.x * m, y: out.y * m };
  };

  // ------------------------------------------------------------------------------------------
  // Phases

  beginAim(): void {
    this.phase = 'aim';
    if (this.checkpoint.room !== this.room.key) this.enterRoom(this.checkpoint.room);
    const facing = this.checkpoint.facing;
    this.aim.angle = facing > 0 ? 8 * DEG : Math.PI - 8 * DEG;
    this.aim.power = idealThrowPower(this.aero);
  }

  /** Called by the UI after the workbench screen closes. */
  resumeFromWorkbench(design: Design | null, repaired: boolean): void {
    if (design) this.setDesign(design, false);
    if (repaired) repair(this.plane.damage, 1);
    this.beginAim();
  }

  throwNow(angle: number, power: number): void {
    if (this.phase !== 'aim') return;
    const cp = this.checkpoint;
    launch(this.plane, cp.x, cp.y, angle, power);
    this.phase = 'fly';
    this.groundT = 0;
    this.stillT = 0;
    this.message = null;
    this.sfx('throw', { vol: 0.5 + power * 0.5 });
  }

  private complete(): void {
    if (this.phase === 'complete') return;
    this.logRoom();
    this.phase = 'complete';
    this.sfx('win');
    this.cb.complete?.(this.result());
  }

  result(): LevelResult {
    return {
      levelId: this.level.id,
      time: this.time,
      stars: [...this.collected].filter((id) => id.includes(':star:') || id.startsWith('star')).length,
      starsTotal: this.starsTotal,
      damage: damagePct(this.plane.damage),
      sheetsUsed: this.sheetsUsed,
      crashes: this.crashes,
      roomsVisited: this.roomsVisited.size,
      roomLog: this.roomLog,
    };
  }

  private flightOver(reason: 'grounded' | 'crashed'): void {
    if (this.phase !== 'fly') return;
    this.phase = 'down';
    this.downT = 0;
    this.crashes++;
    this.sheetsUsed++;
    this.sheets--;
    this.roomLog.push('crash');
    this.roomDamage0 = 0;
    const p = planePx(this.plane);
    this.sfx(reason === 'crashed' ? 'crumple' : 'bump');
    const paper = rgb(this.design.look.color);
    for (let k = 0; k < (reason === 'crashed' ? 26 : 8); k++) {
      this.renderer.particles.spawn({
        x: p.x,
        y: p.y,
        vx: (Math.random() - 0.5) * 120,
        vy: -Math.random() * 100,
        grav: 260,
        life: 0.8,
        max: 0.8,
        size: Math.random() < 0.3 ? 2 : 1,
        ...paper,
        a: 1,
      });
    }
    this.message = reason === 'crashed' ? 'Crumpled!' : 'Landed.';
  }

  // ------------------------------------------------------------------------------------------
  // Update

  update(dt: number, input: ControlState, thr: ThrowState): void {
    this.realTime += dt;
    this.triggeredThisTick.clear();
    const ctx: ObjCtx = { dt, time: this.realTime, renderer: this.renderer, particles: this.renderer.particles, api: this.api };
    for (const o of this.room.objects) o.update?.(ctx);

    if (this.phase === 'aim') {
      this.time += dt;
      if (thr.aiming || thr.released) {
        this.aim.angle = thr.angle;
        this.aim.power = thr.power;
      }
      if (thr.released) this.throwNow(thr.angle, thr.power);
    } else if (this.phase === 'fly') {
      this.time += dt;
      this.flyStep(dt, input, ctx);
    } else if (this.phase === 'down') {
      this.downT += dt;
      if (this.downT > 1.3) {
        if (this.sheets <= 0) {
          this.phase = 'failed';
          this.sfx('lose');
          this.cb.failed?.(this.result());
        } else {
          // a fresh sheet folded to the same design
          const keep = this.design;
          this.setDesign(keep, true);
          this.beginAim();
        }
      }
    }
    this.renderer.particles.update(dt);
    this.flash = Math.max(0, this.flash - dt * 4);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 3);
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      this.cb.hud?.(this.hud());
    }
  }

  private flyStep(dt: number, input: ControlState, ctx: ObjCtx): void {
    const p = this.plane;
    // gadgets
    const boost = input.gadget && this.design.extras.gadget === 'battery' && (this.charges.boost > 0 || p.boostLeft > 0);
    if (input.gadgetPressed) {
      if (this.design.extras.gadget === 'battery' && this.charges.boost > 0 && p.boostLeft <= 0) {
        this.charges.boost--;
        p.boostLeft = PHYS.boostTime;
        this.sfx('boost');
      } else if (this.design.extras.gadget === 'helium' && this.charges.helium > 0 && p.heliumLeft <= 0) {
        this.charges.helium--;
        p.heliumLeft = PHYS.heliumTime;
        this.sfx('pop', { pitch: 7 });
      }
    }
    stepPlane(p, { dir: input.dir, pitch: input.pitch, boost }, this.windAt, dt, { slowMo: this.opts.slowMo });

    // burning plane: fire particles & destruction
    if (p.damage.burning > 0) {
      const q = planePx(p);
      if (Math.random() < 0.7)
        this.renderer.particles.spawn({ x: q.x + (Math.random() - 0.5) * 16, y: q.y + (Math.random() - 0.5) * 6, vy: -40, life: 0.4, max: 0.4, ...rgb(Math.random() < 0.5 ? '#ffb040' : '#ff6020'), a: 1 });
    }

    // collisions
    this.collide(dt);
    if (this.phase !== 'fly') return;

    // triggers
    const pos = planePx(p);
    const squash = p.turn ? Math.max(0.35, Math.abs(Math.cos(Math.PI * (p.turn.t / p.turn.dur)))) : 1;
    const hullW = worldHull(this.hullLocal, pos.x, pos.y, p.theta, p.facing, squash);
    const bb = bounds(hullW);
    for (const o of this.room.objects) {
      const r = o.trigger?.();
      if (!r) continue;
      if (bb.x1 < r.x || bb.x0 > r.x + r.w || bb.y1 < r.y || bb.y0 > r.y + r.h) continue;
      if (!polyVsBox(hullW, { ...r })) continue;
      o.onTouch?.(ctx);
      if (this.phase !== 'fly') return;
    }

    if (structural(p.damage) >= 1) {
      this.flightOver('crashed');
      return;
    }

    // room transitions
    this.edges(pos);
  }

  private collide(dt: number): void {
    const p = this.plane;
    const pos = planePx(p);
    const squash = p.turn ? Math.max(0.35, Math.abs(Math.cos(Math.PI * (p.turn.t / p.turn.dur)))) : 1;
    let hullW = worldHull(this.hullLocal, pos.x, pos.y, p.theta, p.facing, squash);
    const cols = this.room.colliders();
    let resting = false;
    for (let iter = 0; iter < 3; iter++) {
      let hit = false;
      const bb = bounds(hullW);
      for (const c of cols) {
        if (bb.x1 < c.x || bb.x0 > c.x + c.w || bb.y1 < c.y || bb.y0 > c.y + c.h) continue;
        const ct = polyVsBox(hullW, c);
        if (!ct) continue;
        hit = true;
        // physics frame normal (y up)
        const nx = ct.nx;
        const ny = -ct.ny;
        const vn = p.vx * nx + p.vy * ny;
        if (ny > 0.65) resting = true;
        if (vn < 0) {
          const impact = -vn;
          const kind = c.kind ?? 'solid';
          const sev = (impact - PHYS.safeImpact) * (kind === 'soft' ? 0.35 : kind === 'sharp' ? 2.5 : 1);
          if (kind === 'fire') this.api.ignite();
          if (kind === 'water') {
            soakUp(p.damage, 0.3, this.aero);
            this.sfx('splash');
          }
          if (sev > 0) {
            const part = this.partAt(ct.px, ct.py, pos, ny);
            const added = applyImpact(p.damage, part, sev, this.aero.toughness, Math.random);
            if (added > 0.02) {
              this.flash = Math.min(1, added * 3);
              this.shakeAmt = Math.max(this.shakeAmt, Math.min(1, added * 4));
              this.sfx('bump', { vol: Math.min(1, 0.3 + added * 2) });
            }
          } else if (impact > 0.4) this.sfx('bump', { vol: 0.2 });
          // response: restitution on the normal, friction on the tangent
          const e = kind === 'soft' ? 0.05 : PHYS.restitution;
          let vx = p.vx - (1 + e) * vn * nx;
          let vy = p.vy - (1 + e) * vn * ny;
          const vn2 = vx * nx + vy * ny;
          const tx = vx - vn2 * nx;
          const ty = vy - vn2 * ny;
          const f = kind === 'sticky' ? 0.2 : kind === 'soft' ? 0.6 : PHYS.friction;
          vx = vn2 * nx + tx * f;
          vy = vn2 * ny + ty * f;
          p.vx = vx;
          p.vy = vy;
          // pitch kick: nose hits push the nose away from the surface
          p.q += -Math.sign(ny || 1) * Math.min(6, impact * 1.5) * 0.3;
          if (p.turn) {
            p.turn = null;
            p.facing = p.vx >= 0 ? 1 : -1;
          }
        }
        // push out
        p.x += (nx * ct.depth) / PX_PER_M;
        p.y += (ny * ct.depth) / PX_PER_M;
        const np = planePx(p);
        hullW = worldHull(this.hullLocal, np.x, np.y, p.theta, p.facing, squash);
        break;
      }
      if (!hit) break;
    }
    // grounding: resting on a surface and slow
    const speed = Math.hypot(p.vx, p.vy);
    if (resting && speed < PHYS.groundSpeed) this.groundT += dt * PHYS.timeScale;
    else this.groundT = Math.max(0, this.groundT - dt);
    if (speed < 0.12) this.stillT += dt;
    else this.stillT = 0;
    if (this.groundT > PHYS.groundTime || this.stillT > 1.5) {
      // resting on a workbench is not a crash
      for (const o of this.room.objects) {
        if (o.def.t !== 'workbench') continue;
        const r = o.trigger?.();
        const q = planePx(p);
        if (r && q.x > r.x && q.x < r.x + r.w && q.y > r.y - 20 && q.y < r.y + r.h + 10) {
          this.api.openWorkbench(o.id);
          return;
        }
      }
      this.flightOver('grounded');
    }
  }

  private partAt(cx: number, cy: number, pos: { x: number; y: number }, ny: number): PartName {
    const p = this.plane;
    const nose = { x: Math.cos(p.theta) * p.facing, y: -Math.sin(p.theta) };
    const half = (this.mesh.max.x - this.mesh.min.x) * PX_PER_M * 0.5;
    const s = ((cx - pos.x) * nose.x + (cy - pos.y) * nose.y) / Math.max(4, half);
    if (s > 0.45) return 'nose';
    if (s < -0.5) return 'tail';
    if (ny > 0.6) return 'body';
    return Math.random() < 0.5 ? 'wingL' : 'wingR';
  }

  private edges(pos: { x: number; y: number }): void {
    const def = this.room.def;
    const p = this.plane;
    let side: 'left' | 'right' | 'up' | 'down' | null = null;
    if (pos.x < -2) side = 'left';
    else if (pos.x > ROOM_W + 2) side = 'right';
    else if (pos.y < -2) side = 'up';
    else if (pos.y > ROOM_H + 2) side = 'down';
    if (!side) return;
    const span = def.exits[side];
    const next = neighbour(this.level, this.room.key, side);
    if (!next) {
      if (span && (span as { exit?: boolean }).exit) this.complete();
      else this.flightOver('crashed');
      return;
    }
    this.enterRoom(next);
    if (side === 'left') p.x += ROOM_W / PX_PER_M;
    if (side === 'right') p.x -= ROOM_W / PX_PER_M;
    if (side === 'up') p.y -= ROOM_H / PX_PER_M;
    if (side === 'down') p.y += ROOM_H / PX_PER_M;
    const np = planePx(p);
    // checkpoint: just inside the entry edge
    const entry = { left: 'right', right: 'left', up: 'down', down: 'up' }[side] as 'left' | 'right' | 'up' | 'down';
    const ex = this.level.rooms[next].exits[entry];
    let cx = Math.max(40, Math.min(ROOM_W - 40, np.x));
    let cy = Math.max(40, Math.min(300, np.y));
    if (entry === 'left') cx = 44;
    if (entry === 'right') cx = ROOM_W - 44;
    if (ex && (entry === 'left' || entry === 'right')) cy = Math.max(ex.from + 16, Math.min(ex.to - 30, np.y));
    if (entry === 'down') cy = 280;
    if (entry === 'up') cy = 60;
    this.checkpoint = { room: next, x: cx, y: cy, facing: p.facing };
  }

  // ------------------------------------------------------------------------------------------
  // HUD & render

  hud(): HudState {
    const p = this.plane;
    return {
      phase: this.phase,
      sheets: this.sheets,
      stars: [...this.collected].filter((id) => id.includes(':star:') || id.startsWith('star')).length,
      starsTotal: this.starsTotal,
      time: this.time,
      damage: damagePct(p.damage),
      burning: p.damage.burning > 0,
      soak: p.damage.soak,
      charges: { ...this.charges },
      gadget: this.design.extras.gadget,
      roomName: this.room.def.name,
      lightsOn: this.room.lightsOn,
      message: this.message,
      speed: p.V,
      alpha: p.alpha / DEG,
      ld: p.CD > 0 ? p.CL / p.CD : 0,
      stall: p.stall,
      power: this.aim.power,
      idealPower: idealThrowPower(this.aero),
    };
  }

  render(): void {
    const r = this.renderer;
    const p = this.plane;
    const lights = this.room.lights();
    r.setLights(lights, this.room.ambient());
    r.setGlow(this.room.lightsOn ? 0 : 1);

    // plane lighting: ambient + nearest strong light
    let best: ActiveLight | undefined;
    let bestScore = 0;
    const pos = this.phase === 'aim' ? { x: this.checkpoint.x, y: this.checkpoint.y } : planePx(p);
    for (const l of lights) {
      const d = Math.hypot(l.x - pos.x, l.y - pos.y);
      const s = Math.max(0, 1 - d / l.r) * l.intensity;
      if (s > bestScore) {
        bestScore = s;
        best = l;
      }
    }
    const amb = this.room.ambient();
    r.plane.setLighting(
      new THREE.Color(amb.r * 0.82, amb.g * 0.82, amb.b * 0.86),
      new THREE.Color(amb.r * 0.5, amb.g * 0.48, amb.b * 0.44),
      best ? { x: best.x - pos.x, y: pos.y - best.y, color: best.color.clone().multiplyScalar(best.intensity), range: best.r } : undefined,
    );
    const d = p.damage;
    r.plane.setDamage([d.nose, d.wingL, d.wingR, d.tail, d.body], [d.scorch, d.scorch, d.scorch, d.scorch, d.scorch], [d.soak, d.soak, d.soak, d.soak, d.soak]);
    r.plane.setFlash(this.flash);

    if (this.phase === 'aim') {
      const a = this.aim.angle;
      const facing: 1 | -1 = Math.cos(a) >= 0 ? 1 : -1;
      const theta = Math.atan2(Math.sin(a), Math.abs(Math.cos(a)));
      r.plane.pose({ x: pos.x, y: pos.y, theta, facing, turn: null, bank: 0, roll: 0, righting: 0, visible: true });
      this.previewTrajectory();
    } else {
      const visible = this.phase === 'fly' || this.phase === 'workbench' || this.phase === 'complete' || (this.phase === 'down' && this.downT < 0.15);
      r.setGuide([]);
      r.plane.pose({
        x: pos.x,
        y: pos.y,
        theta: p.theta,
        facing: p.facing,
        turn: p.turn ? { s: p.turn.t / p.turn.dur, from: p.turn.from } : null,
        bank: p.bank,
        roll: p.roll,
        righting: p.righting,
        visible,
      });
    }
    // shadow on the surface below
    const cols = this.room.colliders();
    const sy = surfaceBelow(cols, pos.x, pos.y + 4);
    const h = Math.max(0, sy - pos.y);
    const len = (this.mesh.max.x - this.mesh.min.x) * PX_PER_M;
    r.plane.placeShadow(pos.x, sy, len * (1.0 - Math.min(0.5, h / 600)), Math.max(0, 0.75 - h / 420));
    // screen shake via camera offset
    const s = this.shakeAmt * 3;
    r.camera.position.x = s ? (Math.random() - 0.5) * s : 0;
    r.camera.position.y = s ? (Math.random() - 0.5) * s : 0;
    r.render(this.realTime);
  }

  /** Dotted trajectory preview during aiming (first ~1.5 s of flight, ignoring collisions). */
  private previewTrajectory(): void {
    const sim = createPlane(this.aero, { autoTrim: this.opts.autoTrim });
    launch(sim, this.checkpoint.x, this.checkpoint.y, this.aim.angle, this.aim.power);
    const dots = 22;
    const pts: { x: number; y: number; a: number }[] = [];
    for (let k = 0; k < dots; k++) {
      for (let s = 0; s < 6; s++) stepPlane(sim, { dir: 0, pitch: 0, boost: false }, this.windAt, 1 / 120, { slowMo: this.opts.slowMo });
      const q = planePx(sim);
      if (q.x < 0 || q.x > ROOM_W || q.y < 0 || q.y > ROOM_H) break;
      pts.push({ x: q.x, y: q.y, a: 0.95 - (k / dots) * 0.75 });
    }
    this.renderer.setGuide(pts);
  }

  /** Items of the current room (for debug overlays). */
  roomItems(): ItemDef[] {
    return this.room.def.items;
  }

  dispose(): void {
    this.room?.dispose();
    this.renderer.clearSprites();
  }
}
