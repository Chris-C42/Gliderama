import type { Px } from '../../render/pixel';
import type { Collider, ItemDef, RoomDef } from '../types';

export interface LightDef {
  x: number;
  y: number;
  /** Radius in pixels. */
  r: number;
  color: string;
  intensity: number;
  /** 0 = steady; >0 = candle-like flicker amount. */
  flicker?: number;
  /** Light belongs to the room's switchable lights (off in dark rooms until switched on). */
  switched?: boolean;
}

export interface KindDef {
  /** Draw order: 0 = wall decor, 1 = furniture, 2 = small items on furniture, 3 = foreground. */
  z: number;
  paint?(px: Px, it: ItemDef, room: RoomDef): void;
  /** Paint emissive pixels (things that glow when the room is dark) into the glow layer. */
  glow?(px: Px, it: ItemDef, room: RoomDef): void;
  colliders?(it: ItemDef, room: RoomDef): Collider[];
  lights?(it: ItemDef, room: RoomDef): LightDef[];
}
