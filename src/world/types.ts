/** Room & level data model (authored in room pixels, y down, 640 × 360). */

import type { RampName } from '../render/palette';

export type WallPattern =
  | 'plain'
  | 'stripes'
  | 'pinstripe'
  | 'damask'
  | 'dots'
  | 'planes'
  | 'plaid'
  | 'floral'
  | 'diamonds'
  | 'tile'
  | 'brick'
  | 'boards'
  | 'corrugated';

export interface WallStyle {
  pattern: WallPattern;
  base: RampName;
  accent: RampName;
  /** Wainscot panelling below the dado rail (null = wallpaper all the way down). */
  wainscot: RampName | null;
  trim: RampName;
}

export type FloorKind = 'planks' | 'carpet' | 'tiles' | 'checker' | 'stone' | 'concrete';

export interface FloorStyle {
  kind: FloorKind;
  ramp: RampName;
  accent?: RampName;
}

export interface ExitSpan {
  /** Opening along the edge: y range for left/right exits, x range for up/down exits. */
  from: number;
  to: number;
  /** Leaving through this opening finishes the level. */
  exit?: boolean;
}

export interface ItemDef {
  /** Item kind id (see world/items). */
  t: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** Variant / colourway index. */
  v?: number;
  /** Free-form per-kind parameters. */
  [k: string]: unknown;
}

export interface RoomDef {
  id: string;
  name: string;
  wall: WallStyle;
  floor: FloorStyle;
  /** Lights off until a switch is flipped. */
  dark?: boolean;
  /** Night outside the windows. */
  night?: boolean;
  exits: { left?: ExitSpan; right?: ExitSpan; up?: ExitSpan; down?: ExitSpan };
  items: ItemDef[];
  /** Optional seed for art variation. */
  seed?: number;
  /** Continuous open space (hangar): no side walls or door casings are drawn at openings. */
  open?: boolean;
  /**
   * Outdoors (the Classic Houses' gardens, roofs and skies): a sky backdrop instead of wallpaper and ceiling.
   * ground = daytime sky with hills on the horizon and a floor of grass, sky = open sky, space = night sky.
   */
  outdoor?: 'ground' | 'sky' | 'space';
}

/** Layout constants shared by art and collisions. */
export const LAYOUT = {
  ceiling: 14,
  dado: 214,
  baseboard: 292,
  wallBase: 302,
  /** The plane's depth line on the floor: collisions, furniture fronts' bottoms. */
  floor: 340,
  sideWall: 12,
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Collider extends Rect {
  /** What the surface is made of / does on contact. */
  kind?: 'solid' | 'soft' | 'water' | 'fire' | 'sticky' | 'sharp';
}
