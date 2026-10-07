import type { Rect } from '../../world/types';
import type { GameObject, ObjFactory } from './types';
import { ceilingVent, current, deskFan, draft, floorVent, radiator } from './air';
import { transport } from './classic';
import { cat, cuckooClock, fireplace, grandfatherClock, kettle, stove } from './cottage';
import { stairsDown, stairsUp } from './stairs';
import { ball, balloon, chimes, cobweb, copter, dart, fish, grease, guitar, outlet, shredder, sparkle } from './enemies';
import { batteryPickup, bandsPickup, candle, drip, exitPortal, hoop, lightSwitch, sheetPickup, star, tapePickup, target, workbench } from './things';

/** Item kinds that have runtime behaviour (art may come from world/kinds as well). */
export const OBJECTS: Record<string, ObjFactory> = {
  floorVent,
  ceilingVent,
  fan: deskFan,
  radiator,
  draft,
  candle,
  switch: lightSwitch,
  star,
  sheet: sheetPickup,
  tape: tapePickup,
  battery: batteryPickup,
  bands: bandsPickup,
  drip,
  workbench,
  exit: exitPortal,
  target,
  hoop,
  fireplace,
  grandfatherClock,
  cat,
  kettle,
  cuckooClock,
  stove,
  stairsUp,
  stairsDown,
  current,
  transport,
  balloon,
  copter,
  dart,
  ball,
  fish,
  cobweb,
  outlet,
  shredder,
  grease,
  guitar,
  chimes,
  sparkle,
  // a tiki torch and a barbecue burn like candles
  tiki: candle,
  bbq: candle,
};

export function registerObjects(extra: Record<string, ObjFactory>): void {
  Object.assign(OBJECTS, extra);
}

/** Things that set the plane alight. */
export const FLAMES = ['candle', 'fireplace', 'tiki', 'bbq'];

/**
 * Where a plane thrown from a standstill would come to harm at once: in a flame or a cobweb (they stay where they
 * are; what flies about, a balloon or a dart, is somewhere else by the time anyone throws).
 */
export function stillHazards(objects: GameObject[]): Rect[] {
  const out: Rect[] = [];
  for (const o of objects) {
    if (!FLAMES.includes(o.def.t) && o.def.t !== 'cobweb') continue;
    const r = o.trigger?.();
    if (r) out.push(r);
  }
  return out;
}
