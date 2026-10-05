/** Daily Flight: one seeded house per day + a twist. Results share as a Wordle-style card. */

import { dailyKey, dailyNumber } from '../core/rng';
import type { LevelDef } from '../game/level';
import type { LevelResult } from '../game/session';
import type { Design } from '../paper/design';
import { cloneDesign } from '../paper/design';
import type { WorkshopLimits } from '../app/nav';
import { dailyPlan, generateFloorLevel, TWISTS, type TwistId } from './levelgen';

export interface DailyInfo {
  key: string;
  number: number;
  twist: TwistId;
  twistName: string;
  twistText: string;
  level: LevelDef;
  airMul: number;
}

export function today(date = new Date()): DailyInfo {
  const key = dailyKey(date);
  const plan = dailyPlan(key);
  const level = generateFloorLevel(plan);
  level.id = `daily-${key}`;
  level.name = `Daily Flight #${dailyNumber(date)}`;
  if (plan.twist === 'one-sheet') level.sheets = 1;
  return {
    key,
    number: dailyNumber(date),
    twist: plan.twist,
    twistName: TWISTS[plan.twist].name,
    twistText: TWISTS[plan.twist].text,
    level,
    airMul: plan.twist === 'gusty' ? 1.25 : plan.twist === 'windy' ? 1.1 : 1,
  };
}

export function dailyLimits(info: DailyInfo): WorkshopLimits {
  const l: WorkshopLimits = { title: `Daily #${info.number}: ${info.twistName}` };
  if (info.twist === 'tissue') l.stock = 'tissue';
  if (info.twist === 'cardstock') l.stock = 'cardstock';
  if (info.twist === 'fold-budget') l.maxFolds = 5;
  if (info.twist === 'heavy-nose') l.minClips = 2;
  return l;
}

/** Apply the twist's forced changes to a design. */
export function applyTwist(info: DailyInfo, d0: Design): Design {
  const d = cloneDesign(d0);
  if (info.twist === 'tissue') d.paper.stock = 'tissue';
  if (info.twist === 'cardstock') d.paper.stock = 'cardstock';
  if (info.twist === 'heavy-nose') while (d.extras.clips.length < 2) d.extras.clips.push(10 + d.extras.clips.length * 10);
  return d;
}

export function designFitsDaily(info: DailyInfo, d: Design): string | null {
  if (info.twist === 'fold-budget' && d.folds.length > 5) return 'Today allows only 5 folds: refold your plane first.';
  return null;
}

export function dailyScore(r: LevelResult, won: boolean): number {
  if (!won) return r.roomLog.filter((x) => x !== 'crash').length * 50;
  return Math.round(1000 + r.stars * 40 - r.time * 4 - r.damage * 3 - r.sheetsUsed * 60);
}

export function shareCard(info: DailyInfo, r: { roomResults: string[]; stars: number; starsTotal: number; timeSec: number; damagePct: number; score: number }, url: string): string {
  const squares = r.roomResults.map((x) => (x === 'clear' ? '🟩' : x === 'damaged' ? '🟨' : x === 'crash' ? '🟥' : '⬜')).join('');
  const m = Math.floor(r.timeSec / 60);
  const s = Math.floor(r.timeSec % 60)
    .toString()
    .padStart(2, '0');
  return [`Gliderama Daily #${info.number} ✈️ ${info.twistName}`, squares, `⭐ ${r.stars}/${r.starsTotal}  ⏱ ${m}:${s}  🩹 ${r.damagePct}%  🏆 ${r.score}`, url].join('\n');
}
