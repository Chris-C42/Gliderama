/** Types for house.mjs (used by the tests). */

export interface GPPoint {
  v: number;
  h: number;
}

export interface GPRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** A decoded objectType; which fields are present depends on `family`. */
export interface GPObject {
  slot: number;
  what: number;
  type: string;
  family: 'blower' | 'furniture' | 'bonus' | 'transport' | 'switch' | 'light' | 'appliance' | 'enemy' | 'clutter' | 'unknown';
  topLeft?: GPPoint;
  bounds?: GPRect;
  distance?: number;
  initial?: boolean;
  state?: boolean;
  vector?: number;
  tall?: number;
  length?: number;
  points?: number;
  where?: number;
  who?: number;
  wide?: number;
  delay?: number;
  switchType?: number;
  pict?: number;
  [k: string]: unknown;
}

export interface GPRoom {
  index: number;
  name: string;
  bounds: number;
  leftStart: number;
  rightStart: number;
  background: number;
  tiles: number[];
  floor: number;
  suite: number;
  openings: number;
  numObjects: number;
  objects: GPObject[];
  deleted: boolean;
}

export interface GPHouse {
  version: number;
  timeStamp: number;
  flags: number;
  initial: GPPoint;
  banner: string;
  trailer: string;
  hasGame: boolean;
  firstRoom: number;
  nRooms: number;
  rooms: GPRoom[];
}

export const OBJECT_TYPES: Record<number, [string, string]>;
export const BACKGROUNDS: Record<number, string>;
export const HOUSE_HEADER: number;
export const ROOM_SIZE: number;
export const MAX_ROOM_OBJECTS: number;

export function parseObject(bytes: Uint8Array, offset: number): GPObject | null;
export function extractFloorSuite(where: number, houseVersion: number): { floor: number; suite: number } | null;
export function parseHouse(data: Uint8Array): GPHouse;
