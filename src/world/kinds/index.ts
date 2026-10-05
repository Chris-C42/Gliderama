import type { KindDef } from './types';
import * as home from './home';

export const KINDS: Record<string, KindDef> = {
  window: home.windowKind,
  bed: home.bedKind,
  desk: home.deskKind,
  chair: home.chairKind,
  deskLamp: home.deskLampKind,
  pendant: home.pendantLampKind,
  bookshelf: home.bookshelfKind,
  poster: home.posterKind,
  frame: home.frameKind,
  wallClock: home.wallClockKind,
  toyBox: home.toyBoxKind,
  rug: home.rugKind,
  nightstand: home.nightstandKind,
  dresser: home.dresserKind,
  books: home.booksStackKind,
  pencils: home.pencilCupKind,
  switchPlate: home.switchKind,
  floorVent: home.floorVentKind,
  sideTable: home.sideTableKind,
  candle: home.candleStickKind,
  fan: home.fanStandKind,
  frontDoor: home.frontDoorKind,
};

export function registerKinds(extra: Record<string, KindDef>): void {
  Object.assign(KINDS, extra);
}
