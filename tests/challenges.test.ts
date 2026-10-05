import { describe, expect, it } from 'vitest';
import { CHALLENGES, applyChallengeLimits, designFitsChallenge, isChallengeUnlocked, type ChallengeDef } from '../src/modes/challenges';
import { RECIPES } from '../src/paper/recipes';
import { cloneDesign, type Design } from '../src/paper/design';
import { buildSimRoom } from '../src/game/sim';
import { hoopsPassed, simLevel, type Ctl, type LevelSim } from './helpers/simLevel';

const recipe = (id: string) => RECIPES.find((r) => r.id === id)!.make();
const hands: Ctl = () => ({ dir: 0, pitch: 0, boost: false });

/** Turn back whenever the plane leaves [a, b] (room px). */
const shuttle =
  (a: number, b: number, hold = 0): Ctl =>
  (p) => {
    const px = p.x * 128;
    const pitch = hold > 0 ? Math.max(-1, Math.min(1, -(p.alpha - hold) * 5)) : 0;
    if (px > b && p.facing > 0 && !p.turn) return { dir: -1, pitch, boost: false };
    if (px < a && p.facing < 0 && !p.turn) return { dir: 1, pitch, boost: false };
    return { dir: 0, pitch, boost: false };
  };
const turnBackAt =
  (t0: number): Ctl =>
  (_p, t) => ({ dir: t > t0 && t < t0 + 0.2 ? -1 : 0, pitch: 0, boost: false });

interface Attempt {
  design: Design;
  ctls: Ctl[];
  maxT?: number;
}

/** A small search: does any throw (angle x power x pilot) solve it? */
function solvable(ch: ChallengeDef, attempts: Attempt[], ok: (r: LevelSim) => boolean): boolean {
  for (const at of attempts) {
    const d = applyChallengeLimits(ch, at.design);
    expect(designFitsChallenge(ch, d), ch.id).toBeNull();
    for (const ctl of at.ctls)
      for (const angle of [-0.25, 0, 0.12, 0.25, 0.4])
        for (const power of [0.15, 0.3, 0.45, 0.6, 1]) {
          if (ok(simLevel(ch.level(), d, angle, power, ctl, at.maxT ?? 30))) return true;
        }
  }
  return false;
}

const byId = (id: string) => CHALLENGES.find((c) => c.id === id)!;
const exitOk = (r: LevelSim) => r.outcome === 'exit';
const restsIn = (x0: number, x1: number) => (r: LevelSim) => r.outcome === 'grounded' && !!r.plane && r.plane.x * 128 >= x0 && r.plane.x * 128 <= x1;

describe('challenges', () => {
  it('every level builds and matches its goal', () => {
    for (const ch of CHALLENGES) {
      const lv = ch.level();
      expect(lv.rooms[lv.start.room], ch.id).toBeDefined();
      for (const def of Object.values(lv.rooms)) expect(() => buildSimRoom(def)).not.toThrow();
      const items = Object.values(lv.rooms).flatMap((r) => r.items);
      if (ch.goal.kind === 'target') expect(items.some((i) => i.t === 'target'), ch.id).toBe(true);
      if (ch.goal.kind === 'hoops') expect(items.filter((i) => i.t === 'hoop').length, ch.id).toBeGreaterThanOrEqual(ch.goal.count);
      if (ch.goal.kind === 'exit') expect(Object.values(lv.rooms).some((r) => Object.values(r.exits).some((e) => (e as { exit?: boolean } | undefined)?.exit)), ch.id).toBe(true);
    }
  });

  it('unlock one after another', () => {
    const none = () => 0;
    expect(CHALLENGES.map((_, i) => isChallengeUnlocked(i, none)).filter(Boolean).length).toBe(3);
    const firstDone = (id: string) => (id === CHALLENGES[0].id ? 1 : 0);
    expect(isChallengeUnlocked(3, firstDone)).toBe(false);
    const thirdDone = (id: string) => (id === CHALLENGES[2].id ? 2 : 0);
    expect(isChallengeUnlocked(3, thirdDone)).toBe(true);
  });

  it('limits are enforced', () => {
    const min = byId('minimalist');
    expect(designFitsChallenge(min, recipe('nakamura'))).not.toBeNull();
    expect(designFitsChallenge(min, recipe('dart'))).toBeNull();
    const sq = byId('square-deal');
    expect(designFitsChallenge(sq, recipe('dart'))).not.toBeNull();
    expect(designFitsChallenge(sq, recipe('square'))).toBeNull();
    expect(applyChallengeLimits(byId('feather'), recipe('glider')).paper.stock).toBe('tissue');
  });

  it('About Face can be solved by turning back early', () => {
    expect(solvable(byId('about-face'), [{ design: recipe('dart'), ctls: [turnBackAt(0.3), turnBackAt(0.05)] }], exitOk)).toBe(true);
  });

  it('Bin It can be solved', () => {
    expect(solvable(byId('bin-it'), [{ design: recipe('dart'), ctls: [hands] }, { design: recipe('square'), ctls: [hands] }], restsIn(376, 506))).toBe(true);
  });

  it('Long Hall: a good glider reaches 12 m, a nose-heavy dart design does not reach 18', () => {
    const lh = byId('long-hall');
    const far = (m: number) => (r: LevelSim) => (r.path[r.path.length - 1].x - lh.level().start.x) / 128 >= m;
    expect(solvable(lh, [{ design: recipe('delta'), ctls: [hands] }], far(12))).toBe(true);
    expect(solvable(lh, [{ design: recipe('nakamura'), ctls: [hands] }], far(18))).toBe(false);
  });

  it('Thread the Needle can be solved', () => {
    const lv = byId('needle').level();
    const hoops = lv.rooms['0,0'].items.filter((i) => i.t === 'hoop').map((i) => ({ x: i.x, y: i.y, r: 26 }));
    const designs = ['hammerhead', 'square', 'dart'].map((id) => ({ design: recipe(id), ctls: [hands] }));
    expect(solvable(byId('needle'), designs, (r) => hoopsPassed(r.path, hoops) === 3)).toBe(true);
  });

  it('Minimalist can be solved with no folds at all (a clip does the job)', () => {
    const d = cloneDesign(recipe('dart'));
    d.folds = [];
    d.extras.clips = [10];
    expect(solvable(byId('minimalist'), [{ design: d, ctls: [hands] }], exitOk)).toBe(true);
  });

  it('Hot Stuff and Gale Force can be solved', () => {
    expect(solvable(byId('hot-stuff'), [{ design: recipe('glider'), ctls: [hands] }], exitOk)).toBe(true);
    expect(solvable(byId('gale'), [{ design: recipe('hammerhead'), ctls: [hands] }], exitOk)).toBe(true);
  });

  it('Square Deal can be solved with the square recipe', () => {
    expect(solvable(byId('square-deal'), [{ design: recipe('square'), ctls: [hands] }], restsIn(470, 550))).toBe(true);
  });

  it('Hang Time: thermalling over a vent keeps a glider up for 15 s', () => {
    expect(solvable(byId('hang-time'), [{ design: recipe('glider'), ctls: [shuttle(170, 220)], maxT: 20 }], (r) => r.t >= 15)).toBe(true);
  });

  it('Featherweight: a re-trimmed tissue plane floats 9 s', () => {
    const d = cloneDesign(recipe('nakamura'));
    d.extras.clips = [];
    d.shape.elevator!.angle = 6;
    expect(solvable(byId('feather'), [{ design: d, ctls: [shuttle(100, 540), shuttle(100, 540, 0.16)], maxT: 15 }], (r) => r.outcome !== 'crashed' && r.t >= 9)).toBe(true);
  });
});
