/** Screen routing: a tiny stack-based navigator over signals. */

import { signal } from '@preact/signals';
import type { Design } from '../paper/design';
import type { LevelDef } from '../game/level';
import type { LevelResult } from '../game/session';

export type PlayMode = 'campaign' | 'trail' | 'daily' | 'challenge' | 'test';

export interface PlaySpec {
  mode: PlayMode;
  level: LevelDef;
  design: Design;
  /** Extra session options (perks, charges, sheets). */
  bonusSheets?: number;
  airMul?: number;
  /** Mode-specific payload (e.g. challenge id, daily key, practice flag). */
  meta?: Record<string, unknown>;
  /** Called when the level ends; the handler decides where to go next. */
  onEnd?: (result: LevelResult, won: boolean) => void;
  /** Challenge goal evaluated by the play screen (default: reach the level exit). */
  goal?: PlayGoal;
  /** Never run out of sheets (challenges). */
  infiniteSheets?: boolean;
  /** Mode-specific lines for the end card (challenge stars, scores). */
  summary?: (r: LevelResult, won: boolean) => EndSummary;
}

export interface EndSummary {
  /** Stars earned out of three (challenges), or undefined. */
  stars?: number;
  /** Label / value rows. */
  rows: [string, string][];
  /** A line of advice (shown after a failed run). */
  note?: string;
}

export type PlayGoal =
  | { kind: 'exit' }
  | { kind: 'target' }
  | { kind: 'hoops'; count: number }
  | { kind: 'distance'; meters: number }
  | { kind: 'aloft'; seconds: number; /** End the level as soon as a flight lasts this long. */ autoAt?: number };

export interface WorkshopSpec {
  /** Design to edit (cloned on open). */
  design?: Design;
  /** Where this was opened from: changes the bottom bar (save to library vs use for this flight). */
  context: 'library' | 'workbench' | 'trail' | 'challenge' | 'daily';
  /** Constraints applied by modes (fold budget, forced stock...). */
  limits?: WorkshopLimits;
  onDone?: (d: Design | null) => void;
}

export interface WorkshopLimits {
  maxFolds?: number;
  stock?: Design['paper']['stock'];
  size?: Design['paper']['size'];
  minClips?: number;
  /** Tools available (unlock ids). Undefined = use campaign unlocks. */
  tools?: string[];
  /** Paper sizes & stocks available (ids). Undefined = campaign unlocks. */
  papers?: string[];
  /** Gadgets available. Undefined = campaign unlocks. */
  gadgets?: string[];
  /** Max paperclips allowed. */
  maxClips?: number;
  /** Recipes offered. Undefined = campaign unlocks. */
  recipes?: string[];
  title?: string;
}

export type Route =
  | { name: 'title' }
  | { name: 'campaign' }
  | { name: 'play'; play: PlaySpec }
  | { name: 'workshop'; spec: WorkshopSpec }
  | { name: 'hangar'; design?: Design }
  | { name: 'trail' }
  | { name: 'daily' }
  | { name: 'challenges' }
  | { name: 'settings' }
  | { name: 'library' };

export const route = signal<Route>({ name: 'title' });
const stack: Route[] = [];

export function go(r: Route, opts: { replace?: boolean } = {}): void {
  if (!opts.replace) stack.push(route.peek());
  route.value = r;
}

export function back(fallback: Route = { name: 'title' }): void {
  route.value = stack.pop() ?? fallback;
}

export function home(): void {
  stack.length = 0;
  route.value = { name: 'title' };
}
