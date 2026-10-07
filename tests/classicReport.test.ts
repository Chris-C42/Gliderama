/**
 * The flight check of the Classic Houses: the bot pilot (tests/helpers/houseSolver.ts) flies each house from its
 * start, star after star, and says how far it got. It takes minutes per house, so it only runs when asked:
 *
 *   CLASSIC_REPORT=all npx vitest run tests/classicReport.test.ts --silent=false
 *   CLASSIC_REPORT=titanic,metropolis CLASSIC_STEPS=20000 CLASSIC_OUT=/tmp/report npx vitest run tests/classicReport.test.ts
 *
 * A house the bot does not finish going for switches early (as soon as the way to the next star needs one) is flown
 * again going for them late (only once every star still to find got nowhere), and the better of the two counts.
 * Each house prints a suggested entry for STATUS in scripts/glider-map.mjs (convert again afterwards); with
 * CLASSIC_OUT the full result (route, flights) is written there as <slug>.json.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CLASSIC_HOUSES, loadClassicHouse } from '../src/world/classic';
import { RECIPES } from '../src/paper/recipes';
import { goalStarIds } from '../src/game/level';
import { solveHouse } from './helpers/houseSolver';

const which = process.env.CLASSIC_REPORT;
const slugs = !which || which === 'all' ? CLASSIC_HOUSES.map((h) => h.slug) : which.split(',');

/** Par for the Swift medal: the bot's flying time plus a few seconds per throw, with 30% to spare, in 5 s steps. */
function parFor(t: number, sheetsUsed: number): number {
  return Math.ceil(((t + 6 * (sheetsUsed + 1)) * 1.3) / 5) * 5;
}

describe.skipIf(!which)('Classic Houses flight check', () => {
  for (const slug of slugs)
    it(
      slug,
      async () => {
        const level = await loadClassicHouse(slug);
        const plane = process.env.CLASSIC_PLANE ?? 'glider';
        const t0 = Date.now();
        const log = (s: string) => console.log(`[${slug}] ${s}`);
        const design = RECIPES.find((q) => q.id === plane)!.make();
        const maxSteps = Number(process.env.CLASSIC_STEPS ?? 12000);
        const n = goalStarIds(level).length;
        // (CLASSIC_SWITCHES=late: only the second way of choosing targets)
        const lateOnly = process.env.CLASSIC_SWITCHES === 'late';
        let r = solveHouse(level, design, { maxSteps, log, switches: lateOnly ? 'late' : 'early' });
        if (n && !r.solved && !lateOnly) {
          // the other way of choosing targets: each star tried first, switches only once they got nowhere
          log(`not solved with switches early (${r.stars.length}/${n} stars): again with switches late`);
          const r2 = solveHouse(level, design, { maxSteps, log, switches: 'late' });
          if (r2.stars.length > r.stars.length || (r2.stars.length === r.stars.length && r2.sheetsUsed < r.sheetsUsed)) r = r2;
        }
        const secs = Math.round(r.t);
        const lost = r.sheetsUsed ? `${r.sheetsUsed} sheet${r.sheetsUsed === 1 ? '' : 's'} lost` : 'no sheet lost';
        const rooms = `${r.rooms.length} room${r.rooms.length === 1 ? '' : 's'}`;
        let status: Record<string, unknown>;
        if (!n) status = { flyable: false, reached: 'no stars to find (free flight)', note: 'the house has no stars, as in Glider PRO' };
        else if (r.solved)
          status = {
            flyable: true,
            reached: `${n === 1 ? 'the star' : `all ${n} stars`}, through ${rooms}`,
            par: parFor(r.t, r.sheetsUsed),
            lost: r.sheetsUsed,
            // (a house's floor on its sheets stays: see STATUS)
            ...(level.meta.status.minSheets ? { minSheets: level.meta.status.minSheets } : {}),
            note: `bot pilot: ${secs} s of flying, ${lost}`,
          };
        else {
          const key = r.stuck!.split(' ')[0];
          const short = r.roomsShort ?? '?';
          status = {
            flyable: false,
            reached: `${n === 1 ? 'not the star' : `${r.stars.length} of ${n} stars`}, through ${rooms}; stuck in "${level.rooms[key]?.name}" (${key}), ${short} room${short === 1 ? '' : 's'} from the next star`,
            lost: r.sheetsUsed,
            ...(level.meta.status.minSheets ? { minSheets: level.meta.status.minSheets } : {}),
            note: `bot pilot: ${secs} s of flying, ${lost}`,
          };
        }
        const wall = ((Date.now() - t0) / 1000).toFixed(0);
        log(`${r.solved ? 'SOLVED' : 'NOT SOLVED'} ${r.stars.length}/${n} stars, ${r.rooms.length} rooms, ${r.steps} steps, ${wall} s wall`);
        log(`STATUS ${JSON.stringify(level.name)}: ${JSON.stringify(status)}`);
        const out = process.env.CLASSIC_OUT;
        if (out) {
          fs.mkdirSync(out, { recursive: true });
          fs.writeFileSync(path.join(out, `${slug}.json`), JSON.stringify({ slug, name: level.name, plane, wall: Number(wall), status, result: r }));
        }
        expect(r.starsTotal).toBe(n);
      },
      6 * 3600_000,
    );
});
