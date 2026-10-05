/**
 * Paint a whole room: shell + items (sorted by layer) into an albedo canvas, plus a glow canvas
 * for emissive pixels, and gather static colliders and lights.
 */

import { Px } from './pixel';
import { paintRoomShell } from './art/room';
import { KINDS } from '../world/kinds';
import type { LightDef } from '../world/kinds/types';
import type { Collider, RoomDef } from '../world/types';
import { roomColliders } from '../world/colliders';
export { shellColliders } from '../world/colliders';

export interface RoomArt {
  albedo: HTMLCanvasElement;
  glow: HTMLCanvasElement;
  colliders: Collider[];
  lights: LightDef[];
}

export const ROOM_W = 640;
export const ROOM_H = 360;

export function paintRoom(room: RoomDef): RoomArt {
  const px = Px.create(ROOM_W, ROOM_H, room.seed ?? 7);
  const glowPx = Px.create(ROOM_W, ROOM_H, 1);
  paintRoomShell(px, room);
  const items = room.items
    .map((it, i) => ({ it, i, kind: KINDS[it.t] }))
    .filter((e) => e.kind)
    .sort((a, b) => a.kind.z - b.kind.z || a.i - b.i);
  const colliders: Collider[] = roomColliders(room);
  const lights: LightDef[] = [];
  for (const { it, kind } of items) {
    kind.paint?.(px, it, room);
    kind.glow?.(glowPx, it, room);
    if (kind.lights) lights.push(...kind.lights(it, room));
  }
  return { albedo: px.canvas as HTMLCanvasElement, glow: glowPx.canvas as HTMLCanvasElement, colliders, lights };
}
