import type { ObjFactory } from './types';
import { ceilingVent, deskFan, draft, floorVent, radiator } from './air';
import { cat, cuckooClock, fireplace, grandfatherClock, kettle, stove } from './cottage';
import { stairsDown, stairsUp } from './stairs';
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
};

export function registerObjects(extra: Record<string, ObjFactory>): void {
  Object.assign(OBJECTS, extra);
}
