import type { ActiveLight, SpriteHandle } from '../../render/GameRenderer';
import type { Particle } from '../../render/particles';
import type { Collider, ItemDef, Rect } from '../../world/types';

export interface WindOut {
  x: number;
  y: number;
}

/** What objects may ask of the running session. */
export interface SessionApi {
  collectStar(id: string): void;
  addSheet(): void;
  repair(amount: number): void;
  addCharge(kind: 'boost' | 'bands' | 'helium', n: number): void;
  toggleLights(group?: string): void;
  setSwitch(group: string, on: boolean): void;
  switchOn(group: string): boolean;
  soak(amount: number): void;
  ignite(): void;
  burnDamage(amount: number): void;
  tear(amount: number): void;
  completeLevel(): void;
  openWorkbench(objId: string): void;
  teleport(toRoom: string, x: number, y: number, facing?: 1 | -1): void;
  sfx(name: string, opts?: { vol?: number; pitch?: number }): void;
  shake(amount: number): void;
  plane(): { x: number; y: number; vx: number; vy: number; alive: boolean };
  isCollected(id: string): boolean;
  lightsOn(): boolean;
  /** Report a goal event (hoops, targets) to the mode. */
  goal?(kind: string, id: string): void;
}

/** Where objects can emit particles (a no-op sink when simulating headless). */
export interface ParticleSink {
  spawn(p: Partial<Particle> & { x: number; y: number }): void;
}

/** Graphics services for objects; null when simulating headless (validation, tests). */
export interface Gfx {
  createSprite(w: number, h: number, emissive?: number, z?: number): SpriteHandle;
}

export interface ObjCtx {
  dt: number;
  time: number;
  particles: ParticleSink;
  api: SessionApi;
}

export interface GameObject {
  id: string;
  def: ItemDef;
  /** Add this object's wind (m/s, room frame, y UP) at a room-pixel position. */
  wind?(x: number, y: number, out: WindOut): void;
  update?(ctx: ObjCtx): void;
  /** Trigger area (room px); `onTouch` fires when the plane overlaps it. */
  trigger?(): Rect | null;
  onTouch?(ctx: ObjCtx): void;
  /** Extra moving colliders. */
  colliders?(): Collider[];
  lights?(): ActiveLight[];
  /** Ambient sound source (room px) for the mixer, or null when silent. */
  sound?(): AmbientSound | null;
  dispose?(): void;
}

export interface AmbientSound {
  loop: 'vent' | 'fan' | 'fire';
  x: number;
  y: number;
  /** Loudness at the source, 0..1. */
  vol: number;
}

export type ObjFactory = (def: ItemDef, id: string, gfx: Gfx | null, room: { dark: boolean; night: boolean }) => GameObject;
