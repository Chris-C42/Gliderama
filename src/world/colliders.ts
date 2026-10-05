/** Static room colliders (pure: usable headless). */

import { KINDS } from './kinds';
import { LAYOUT, type Collider, type RoomDef } from './types';

const ROOM_W = 640;
const ROOM_H = 360;

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


/** Shell + every item's static colliders. */
export function roomColliders(room: RoomDef): Collider[] {
  const out = shellColliders(room);
  for (const it of room.items) {
    const k = KINDS[it.t];
    if (k?.colliders) out.push(...k.colliders(it, room));
  }
  return out;
}
