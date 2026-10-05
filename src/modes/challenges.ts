/**
 * Challenges: ten single-room puzzles, each asking one thing of a design. Every throw starts from the
 * launch point and sheets never run out; stars come from how well you did it (throws, distance, time
 * aloft, or how few folds you needed). Challenges unlock one after another.
 */

import type { PlayGoal, WorkshopLimits } from '../app/nav';
import type { LevelDef } from '../game/level';
import type { LevelResult } from '../game/session';
import type { Design } from '../paper/design';
import type { IconName } from '../ui/icons';
import * as L from '../world/levels/challenges';

export interface ChallengeDef {
  id: string;
  name: string;
  /** One line for the card. */
  blurb: string;
  /** A nudge towards the idea behind it. */
  hint: string;
  icon: IconName;
  level: () => LevelDef;
  goal: PlayGoal;
  limits?: WorkshopLimits;
  /** What each star asks for. */
  tiers: [string, string, string];
  /** Stars (1..3) for a successful run. */
  stars(r: LevelResult, d: Design): number;
}

const byThrows = (r: LevelResult) => (r.flights <= 1 ? 3 : r.flights <= 3 ? 2 : 1);
const THROW_TIERS: [string, string, string] = ['Do it', 'In three throws or fewer', 'On the first throw'];
const atLeast = (v: number, [a, b, c]: [number, number, number]) => (v >= c ? 3 : v >= b ? 2 : v >= a ? 1 : 0);

export const CHALLENGES: ChallengeDef[] = [
  {
    id: 'about-face',
    name: 'About Face',
    blurb: 'The exit is behind you.',
    hint: 'Tap the other direction early: the turn takes a moment. Short wings turn quicker.',
    icon: 'refresh',
    level: L.aboutFace,
    goal: { kind: 'exit' },
    tiers: THROW_TIERS,
    stars: byThrows,
  },
  {
    id: 'bin-it',
    name: 'Bin It',
    blurb: 'Land on the target behind the crate.',
    hint: 'Clear the crate, then pull up hard to bleed off speed and drop in. Draggy planes land shorter.',
    icon: 'target',
    level: L.binIt,
    goal: { kind: 'target' },
    tiers: THROW_TIERS,
    stars: byThrows,
  },
  {
    id: 'long-hall',
    name: 'Long Hall',
    blurb: 'Glide 12 m down the hall.',
    hint: 'Long, slender wings glide furthest. The radiators give a little lift if you pass over them.',
    icon: 'chart',
    level: L.longHall,
    goal: { kind: 'distance', meters: 12 },
    tiers: ['12 m', '15 m', '18 m'],
    stars: (r) => Math.max(1, atLeast(r.best.distance, [12, 15, 18])),
  },
  {
    id: 'needle',
    name: 'Thread the Needle',
    blurb: 'Three hoops, one flight.',
    hint: 'A stable plane holds its line. Small, early nudges beat big late ones.',
    icon: 'pin',
    level: L.threadTheNeedle,
    goal: { kind: 'hoops', count: 3 },
    tiers: THROW_TIERS,
    stars: byThrows,
  },
  {
    id: 'minimalist',
    name: 'Minimalist',
    blurb: 'Reach the exit with two folds or fewer.',
    hint: 'Every fold costs you here. A paperclip can do a fold’s job of keeping the nose down.',
    icon: 'fold',
    level: L.minimalist,
    goal: { kind: 'exit' },
    limits: { maxFolds: 2, title: 'Minimalist: two folds at most' },
    tiers: ['Two folds', 'One fold', 'No folds at all'],
    stars: (_r, d) => (d.folds.length === 0 ? 3 : d.folds.length === 1 ? 2 : 1),
  },
  {
    id: 'hot-stuff',
    name: 'Hot Stuff',
    blurb: 'Slip between the shelf and the flames.',
    hint: 'A foil coating shrugs off a singe. Without one, keep a level line.',
    icon: 'flame',
    level: L.hotStuff,
    goal: { kind: 'exit' },
    tiers: THROW_TIERS,
    stars: byThrows,
  },
  {
    id: 'gale',
    name: 'Gale Force',
    blurb: 'Punch through the fan and over it.',
    hint: 'Light planes get blown back. Heavy paper and extra clips fly faster and cut through.',
    icon: 'wing',
    level: L.galeForce,
    goal: { kind: 'exit' },
    tiers: THROW_TIERS,
    stars: byThrows,
  },
  {
    id: 'square-deal',
    name: 'Square Deal',
    blurb: 'Origami squares only: land on the small mat.',
    hint: 'Square sheets make short, broad planes: slow and steady, made for tight spaces.',
    icon: 'sheet',
    level: L.squareDeal,
    goal: { kind: 'target' },
    limits: { size: 'square', stock: 'origami', recipes: ['square'], title: 'Square Deal: origami squares only' },
    tiers: THROW_TIERS,
    stars: byThrows,
  },
  {
    id: 'hang-time',
    name: 'Hang Time',
    blurb: 'Stay in the air for 15 seconds.',
    hint: 'Turn back each time you leave the rising air. A low sink rate makes every pass count.',
    icon: 'clock',
    level: L.hangTime,
    goal: { kind: 'aloft', seconds: 15, autoAt: 45 },
    tiers: ['15 s', '30 s', '45 s'],
    stars: (r) => Math.max(1, atLeast(r.best.timeAloft, [15, 30, 45])),
  },
  {
    id: 'feather',
    name: 'Featherweight',
    blurb: 'Tissue only: float for 9 seconds in still air.',
    hint: 'Tissue is so light that a clip makes it nose-heavy. Re-trim the elevator for a slow, flat glide.',
    icon: 'balloon',
    level: L.featherweight,
    goal: { kind: 'aloft', seconds: 9, autoAt: 13 },
    limits: { stock: 'tissue', title: 'Featherweight: tissue paper only' },
    tiers: ['9 s', '11 s', '13 s'],
    stars: (r) => Math.max(1, atLeast(r.best.timeAloft, [9, 11, 13])),
  },
];

export function challengeById(id: string): ChallengeDef | undefined {
  return CHALLENGES.find((c) => c.id === id);
}

/** Open from the start: the first three, then each one after a challenge you have cleared. */
export function isChallengeUnlocked(index: number, starsOf: (id: string) => number): boolean {
  if (index < 3) return true;
  return starsOf(CHALLENGES[index - 1].id) > 0 || starsOf(CHALLENGES[index - 2].id) > 0;
}

/** Why a design can't fly this challenge (or null). */
export function designFitsChallenge(ch: ChallengeDef, d: Design): string | null {
  const l = ch.limits;
  if (!l) return null;
  if (l.maxFolds !== undefined && d.folds.length > l.maxFolds) return `Only ${l.maxFolds} fold${l.maxFolds === 1 ? '' : 's'} allowed: refold your plane first.`;
  if (l.size && d.paper.size !== l.size) return 'This one needs a square sheet: fold a plane from the Square recipe.';
  return null;
}

/** The design as it will fly: forced paper stock applied. */
export function applyChallengeLimits(ch: ChallengeDef, d: Design): Design {
  if (!ch.limits?.stock || d.paper.stock === ch.limits.stock) return d;
  return { ...d, paper: { ...d.paper, stock: ch.limits.stock } };
}

export function goalText(g: PlayGoal): string {
  switch (g.kind) {
    case 'exit':
      return 'Reach the exit';
    case 'target':
      return 'Land on the target';
    case 'hoops':
      return `Fly through ${g.count} hoops in one flight`;
    case 'distance':
      return `Glide ${g.meters} m in one flight`;
    case 'aloft':
      return `Stay in the air ${g.seconds} s`;
  }
}
