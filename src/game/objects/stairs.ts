/** Stairs between floors: fly into the doorway at the top (or down into the stairwell) to change floor. */

import { stairsDownGeom, stairsUpGeom } from '../../world/stairs';
import type { ObjFactory } from './types';

export const stairsUp: ObjFactory = (def, id) => {
  const door = stairsUpGeom(def).door;
  // the inner part of the doorway, so brushing its casing doesn't count
  const trig = { x: door.x + 6, y: door.y + 8, w: door.w - 12, h: door.h - 10 };
  return {
    id,
    def,
    trigger: () => trig,
    onTouch(ctx) {
      ctx.api.takeStairs('up');
    },
  };
};

export const stairsDown: ObjFactory = (def, id) => {
  const trig = stairsDownGeom(def).trigger;
  return {
    id,
    def,
    trigger: () => trig,
    onTouch(ctx) {
      ctx.api.takeStairs('down');
    },
  };
};
