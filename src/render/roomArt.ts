/**
 * Paint a whole room: shell + items (sorted by layer) into an albedo canvas, plus a glow canvas
 * for emissive pixels, and gather static colliders and lights.
 */

import { Px } from './pixel';
import { paintRoomShell } from './art/room';
import { KINDS } from '../world/kinds';
import type { LightDef } from '../world/kinds/types';
import { LAYOUT, type Collider, type RoomDef } from '../world/types';

export interface RoomArt {
  albedo: HTMLCanvasElement;
  glow: HTMLCanvasElement;
  colliders: Collider[];
  lights: LightDef[];
}

export const ROOM_W = 640;
export const ROOM_H = 360;

export function shellColliders(room: RoomDef): Collider[] {
  const out: Collider[] = [];
  const sw = LAYOUT.sideWall;
  const c = LAYOUT.ceiling + 2;
  // floor
  if (room.exits.down) {
    const d = room.exits.down;
    out.push({ x: -40, y: LAYOUT.floor, w: d.from + 40, h: 80 });
    out.push({ x: d.to, y: LAYOUT.floor, w: ROOM_W - d.to + 40, h: 80 });
  } else out.push({ x: -40, y: LAYOUT.floor, w: ROOM_W + 80, h: 80 });
  // ceiling
  if (room.exits.up) {
    const u = room.exits.up;
    out.push({ x: -40, y: -80, w: u.from + 40, h: c + 80 });
    out.push({ x: u.to, y: -80, w: ROOM_W - u.to + 40, h: c + 80 });
  } else out.push({ x: -40, y: -80, w: ROOM_W + 80, h: c + 80 });
  // side walls (with openings)
  for (const side of ['left', 'right'] as const) {
    const ex = room.exits[side];
    const x = side === 'left' ? -40 : ROOM_W - sw;
    const w = sw + 40;
    if (!ex) out.push({ x, y: -80, w, h: ROOM_H + 160 });
    else {
      out.push({ x, y: -80, w, h: ex.from + 80 });
      out.push({ x, y: ex.to, w, h: ROOM_H - ex.to + 80 });
    }
  }
  return out;
}

export function paintRoom(room: RoomDef): RoomArt {
  const px = Px.create(ROOM_W, ROOM_H, room.seed ?? 7);
  const glowPx = Px.create(ROOM_W, ROOM_H, 1);
  paintRoomShell(px, room);
  const items = room.items
    .map((it, i) => ({ it, i, kind: KINDS[it.t] }))
    .filter((e) => e.kind)
    .sort((a, b) => a.kind.z - b.kind.z || a.i - b.i);
  const colliders: Collider[] = shellColliders(room);
  const lights: LightDef[] = [];
  for (const { it, kind } of items) {
    kind.paint?.(px, it, room);
    kind.glow?.(glowPx, it, room);
    if (kind.colliders) colliders.push(...kind.colliders(it, room));
    if (kind.lights) lights.push(...kind.lights(it, room));
  }
  return { albedo: px.canvas as HTMLCanvasElement, glow: glowPx.canvas as HTMLCanvasElement, colliders, lights };
}
