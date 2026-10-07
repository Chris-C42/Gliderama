import type { ActiveLight, SpriteHandle } from '../../render/GameRenderer';
import type { AirFlow } from '../../render/airLines';
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
  /** Flip the lights of the current room (or of `room`, for a switch wired to another room's lights). */
  toggleLights(room?: string): void;
  setSwitch(group: string, on: boolean): void;
  switchOn(group: string): boolean;
  soak(amount: number): void;
  ignite(): void;
  burnDamage(amount: number): void;
  tear(amount: number): void;
  /**
   * Struck by something moving (a balloon, a toy helicopter, another dart): crumples the plane by `amount` of its
   * structure (1 = destroyed) and knocks it away from `from` (room px).
   */
  strike(amount: number, from: { x: number; y: number }): void;
  /** Caught in a cobweb at room px (x, y): held there a moment, then let go with no speed to speak of. */
  snag(x: number, y: number): void;
  completeLevel(): void;
  openWorkbench(objId: string): void;
  teleport(toRoom: string, x: number, y: number, facing?: 1 | -1): void;
  /** Take the stairs up or down: on to the matching stairs in the room above / below, gliding level again. */
  takeStairs(way: 'up' | 'down'): void;
  /** A transport (duct, mail slot): out at (x, y) in `toRoom`, gliding level again; that's the new checkpoint. */
  transport(toRoom: string, x: number, y: number, facing: 1 | -1): void;
  sfx(name: string, opts?: { vol?: number; pitch?: number }): void;
  shake(amount: number): void;
  plane(): { x: number; y: number; vx: number; vy: number; alive: boolean };
  isCollected(id: string): boolean;
  lightsOn(room?: string): boolean;
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
  /** Touching its trigger hurts (an enemy, a cobweb): the headless simulator fails a flight that does. */
  hazard?: boolean;
  /** A rubber band at room px (x, y): true when it hits this object, which reacts (a balloon pops). */
  shot?(x: number, y: number, ctx: ObjCtx): boolean;
  lights?(): ActiveLight[];
  /** Ambient sound source (room px) for the mixer, or null when silent. */
  sound?(): AmbientSound | null;
  /** The shape of this object's air current, drawn as squiggly lines that end where the wind ends. */
  airflow?(): AirFlow[];
  /** The plane was lost: forget what it set off that has yet to happen (a trigger's switch). */
  planeLost?(): void;
  dispose?(): void;
}

export type { AirFlow };

export interface AmbientSound {
  loop: 'vent' | 'fan' | 'fire';
  x: number;
  y: number;
  /** Loudness at the source, 0..1. */
  vol: number;
}

export type ObjFactory = (def: ItemDef, id: string, gfx: Gfx | null, room: { dark: boolean; night: boolean }) => GameObject;
