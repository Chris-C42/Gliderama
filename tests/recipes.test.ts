import { describe, expect, it } from 'vitest';
import { RECIPES } from '../src/paper/recipes';
import { analyzeDesign } from '../src/paper/aero';
import { buildMesh } from '../src/paper/build';

const DEG = 180 / Math.PI;

describe('recipes', () => {
  for (const r of RECIPES) {
    it(`${r.id} folds and analyses cleanly`, () => {
      const d = r.make();
      const { build, aero } = analyzeDesign(d);
      const mesh = buildMesh(build, aero.cg);
      const t = aero.perf.trim;
      if (process.env.VERBOSE) {
        process.stderr.write(
          [
            `== ${r.name}`,
            `facets=${build.flat.facets.length} pieces=${build.pieces.length} tris=${mesh.indices.length / 3} errors=${build.errors.join('; ') || '-'}`,
            `mass=${(aero.mass * 1000).toFixed(2)}g S=${(aero.S * 1e4).toFixed(1)}cm² span=${(aero.span * 100).toFixed(1)}cm AR=${aero.AR.toFixed(2)} ARe=${aero.ARe.toFixed(2)} MAC=${(aero.MAC * 100).toFixed(1)}cm len=${(aero.length * 100).toFixed(1)}cm`,
            `sweepLE=${(aero.sweepLE * DEG).toFixed(1)}° CG@${aero.posCG.toFixed(0)}mm AC@${aero.posAC.toFixed(0)}mm SM=${(aero.SM * 100).toFixed(1)}% keel=${(aero.keelArea * 1e4).toFixed(1)}cm²`,
            `CLa=${aero.CLa.toFixed(2)} αs=${(aero.alphaStall * DEG).toFixed(1)}° Kv=${aero.Kv.toFixed(2)} CD0=${aero.CD0.toFixed(4)} K=${aero.K.toFixed(3)} e=${aero.e.toFixed(2)} Cmq=${aero.Cmq.toFixed(2)}`,
            `flapCLd=${aero.flapCLd.toFixed(3)} flapCmd=${aero.flapCmd.toFixed(3)} ctrlCLd=${aero.ctrlCLd.toFixed(3)} ctrlCmd=${aero.ctrlCmd.toFixed(3)} trimδ=${(aero.trimDelta * DEG).toFixed(1)}°`,
            `W/S=${aero.wingLoading.toFixed(2)}N/m² Iyy=${aero.Iyy.toExponential(2)} Ixx=${aero.Ixx.toExponential(2)} tough=${aero.toughness.toFixed(2)} layers=${aero.layersAvg.toFixed(2)} nose=${aero.noseLayers.toFixed(2)}`,
            `L/Dmax=${aero.perf.LDmax.toFixed(2)} @${(aero.perf.alphaBest * DEG).toFixed(1)}° vBest=${aero.perf.vBest.toFixed(2)} sinkMin=${aero.perf.sinkMin.toFixed(2)} vStall=${aero.perf.vStall.toFixed(2)} turn=${aero.perf.turnTime.toFixed(2)}s`,
            t
              ? `TRIM α=${(t.alpha * DEG).toFixed(1)}° CL=${t.CL.toFixed(2)} v=${t.v.toFixed(2)} L/D=${t.LD.toFixed(2)} sink=${t.sink.toFixed(2)}`
              : 'TRIM none',
            `friendly ${JSON.stringify(Object.fromEntries(Object.entries(aero.friendly).map(([k, v]) => [k, +v.toFixed(1)])))}`,
            `warnings: ${aero.warnings.join(' | ') || '-'}`,
          ].join("\n") + "\n",
        );
      }
      expect(build.errors).toEqual([]);
      expect(aero.mass).toBeGreaterThan(0);
      expect(mesh.indices.length).toBeGreaterThan(0);
    });
  }
});
