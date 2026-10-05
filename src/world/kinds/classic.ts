/**
 * Kinds for the Classic Houses (Glider PRO houses). No new pictures: invisible obstacles, and transports drawn
 * with the existing vent grilles.
 */

import { LAYOUT } from '../types';
import { ceilingVentKind, floorVentKind } from './home';
import type { KindDef } from './types';

/** An invisible solid rectangle x, y, w, h (Glider PRO's invisible obstacles and bounce walls). */
export const solidKind: KindDef = {
  z: 1,
  colliders(it) {
    return [{ x: it.x, y: it.y, w: it.w ?? 40, h: it.h ?? 40 }];
  },
};

/** A transport's look: `look` floorDuct / ceilingDuct draw a vent grille; otherwise it is invisible. */
export const transportKind: KindDef = {
  z: 1,
  paint(px, it, room) {
    const w = it.w ?? 60;
    if (it.look === 'floorDuct') floorVentKind.paint!(px, { t: 'floorVent', x: it.x + 8, y: LAYOUT.floor, w: Math.max(32, w - 16) }, room);
    else if (it.look === 'ceilingDuct') ceilingVentKind.paint!(px, { t: 'ceilingVent', x: it.x + 8, y: LAYOUT.ceiling, w: Math.max(32, w - 16) }, room);
  },
};
