import { describe, expect, it } from 'vitest';
import { journeyLevels } from '../src/world/campaign';
import { RECIPES } from '../src/paper/recipes';
import { solveLevel } from './helpers/solver';

/**
 * Every campaign level can be flown start to exit by one of the starter designs, found by a beam-search pilot
 * with the player's controls (turn or not, pitch). A level that fails here needs a layout fix, not a better pilot.
 */
describe('campaign levels are passable', () => {
  for (const cl of journeyLevels()) {
    it(cl.id, () => {
      const results = [];
      for (const id of ['glider', 'dart']) {
        const r = solveLevel(cl.build(), RECIPES.find((q) => q.id === id)!.make());
        results.push(`${id}: ${r.solved ? 'solved' : `stuck in ${r.stuck}`}`);
        if (r.solved) {
          expect(r.damage).toBeLessThan(80);
          return;
        }
      }
      expect.fail(`${cl.id} not passable: ${results.join(', ')}`);
    }, 120000);
  }
});
