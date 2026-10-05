/**
 * Public and internal types of the procedural house generator ("Paper Trail" floors and the Daily Flight).
 */

import type { ExitSpan, RoomDef } from '../types';

export type ThemeId = 'home' | 'cottage';

export type TwistId =
  | 'none'
  | 'tissue'
  | 'cardstock'
  | 'lights-out'
  | 'windy'
  | 'heavy-nose'
  | 'fold-budget'
  | 'night'
  | 'gusty'
  | 'one-sheet';

export const TWIST_IDS: readonly TwistId[] = [
  'none',
  'tissue',
  'cardstock',
  'lights-out',
  'windy',
  'heavy-nose',
  'fold-budget',
  'night',
  'gusty',
  'one-sheet',
];

export interface FloorOptions {
  seed: number;
  /** 0-based difficulty step (roguelike floor number). */
  floor: number;
  theme: ThemeId;
  /** Total number of rooms (including the workbench room). Default: 6 + 0..2 (+1 with a workbench room). */
  rooms?: number;
  twist?: TwistId;
  /** Roguelike: the last room is a calm workbench room before the exit. */
  workbenchRoom?: boolean;
}

export type Side = 'left' | 'right' | 'up' | 'down';

export const OPPOSITE: Record<Side, Side> = { left: 'right', right: 'left', up: 'down', down: 'up' };

/** How the plane gets into a room. */
export type EntrySide =
  /** Room 0: thrown from the start point. */
  | 'start'
  /** Through a side opening (`left` = arrives through the left wall). */
  | 'left'
  | 'right'
  /** Dropping in through the ceiling opening (`exits.up`), e.g. after a floor hole above. */
  | 'up'
  /** Rising through the floor opening (`exits.down`), e.g. after a ceiling opening below. */
  | 'down';

/** Where a room sits on the route and how its openings connect (derived from the layout). */
export interface RoomIO {
  index: number;
  count: number;
  gx: number;
  gy: number;
  key: string;
  /** Horizontal direction of progress on this floor (+1 = towards the right). */
  dirX: 1 | -1;
  entry: EntrySide;
  /** Span of the entry opening (undefined for the start room). */
  entrySpan?: ExitSpan;
  exit: Side;
  exitSpan: ExitSpan;
}

/** Plane identifiers used by the reference pilots. */
export type RefPlaneId = 'glider' | 'dart';

/** Result of flying the bot through a room with one plane from one entry. */
export interface FlightRun {
  plane: RefPlaneId;
  entry: string;
  ok: boolean;
  outcome: string;
  /** Short reason when not ok. */
  why: string;
  t: number;
  damage: number;
  /** Where the flight ended (room px). */
  end: { x: number; y: number };
  /** Height (px) at which the plane crossed the exit edge, if it did. */
  exitY?: number;
  path: { x: number; y: number }[];
}

export interface RoomReport {
  key: string;
  template: string;
  /** Generation attempts it took (1 = first try). */
  attempts: number;
  /** True when it fell back to the plain safe layout. */
  fallback: boolean;
  /** Every plane passed every entry. */
  both: boolean;
  /** At least one plane passed every entry. */
  ok: boolean;
  runs: FlightRun[];
}

export interface FloorReport {
  rooms: RoomReport[];
  /** Milliseconds spent generating (informational only; never feeds back into generation). */
  ms: number;
}

export interface GeneratedFloor {
  level: import('../../game/level').LevelDef;
  report: FloorReport;
}

export type Difficulty = {
  floor: number;
  twist: TwistId;
};

/** Axis-aligned box in room pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RoomShell = Pick<RoomDef, 'wall' | 'floor' | 'exits'>;
