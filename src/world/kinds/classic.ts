/**
 * Kinds for the Classic Houses (Glider PRO houses). No new pictures: plain blocks for the obstacles, and
 * transports drawn with the existing vent grilles.
 */

import { R, type RampName } from '../../render/palette';
import { LAYOUT } from '../types';
import { ceilingVentKind, floorVentKind } from './home';
import type { KindDef } from './types';

/**
 * A solid block x, y, w, h in the colour of ramp `ramp`: Glider PRO's obstacles (invisible there because the
 * room's picture showed what they were: walls, pipes, ledges), roofs and the walls between merged openings.
 */
export const solidKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = it.w ?? 40;
    const h = it.h ?? 40;
    const ramp = R[(typeof it.ramp === 'string' ? it.ramp : 'stone') as RampName] ?? R.stone;
    px.box(it.x, it.y, w, h, Math.min(5, Math.floor(h / 6)), ramp, w >= 4 && h >= 4);
  },
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
