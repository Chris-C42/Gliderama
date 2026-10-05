/**
 * Fittings from Glider PRO's houses, drawn the Gliderama way: a fluorescent tube and a track of spotlights on the
 * ceiling (both on the room's light switch), and a vent grille wherever a blower stands above the floor (on a
 * table, a shelf: its rising air is an invisible current).
 */

import { R } from '../../render/palette';
import type { ItemDef } from '../types';
import { LAYOUT } from '../types';
import { paintVentGrille } from './home';
import type { KindDef } from './types';

const W = (it: ItemDef, d: number) => Math.round(it.w ?? d);

/** A fluorescent tube in a steel housing under the ceiling (Glider PRO 64 × 12). */
export const tubeLightKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 80);
    const x = it.x;
    const y = Math.max(LAYOUT.ceiling, it.y);
    px.rect(x, y, w, 5, R.steel[2]);
    px.hline(x, y, w, R.steel[1]);
    px.rect(x + 3, y + 5, w - 6, 4, R.steel[6]);
    px.hline(x + 3, y + 8, w - 6, R.steel[5]);
    px.rect(x + 1, y + 5, 2, 4, R.steel[3]);
    px.rect(x + w - 3, y + 5, 2, 4, R.steel[3]);
  },
  lights(it) {
    const w = W(it, 80);
    return [{ x: it.x + w / 2, y: Math.max(LAYOUT.ceiling, it.y) + 10, r: Math.max(110, w * 1.3), color: '#e8f2ff', intensity: 0.85, switched: true }];
  },
};

/** A ceiling track with spotlights angled down (Glider PRO 64 × 24). */
export const trackLightKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 80);
    const x = it.x;
    const y = Math.max(LAYOUT.ceiling, it.y);
    px.rect(x, y, w, 3, R.ink[2]);
    px.hline(x, y + 2, w, R.ink[4]);
    const n = Math.max(2, Math.round(w / 32));
    for (let k = 0; k < n; k++) {
      const sx = x + ((k + 0.5) * w) / n;
      const lean = k % 2 ? 1 : -1;
      px.vline(sx, y + 3, 4, R.ink[3]);
      px.poly([[sx - 4, y + 6], [sx + 4, y + 6], [sx + 6 + lean * 3, y + 18], [sx - 6 + lean * 3, y + 18]], R.ink[2]);
      px.poly([[sx - 3, y + 7], [sx - 1, y + 7], [sx - 3 + lean * 3, y + 17], [sx - 5 + lean * 3, y + 17]], R.ink[4]);
      px.hline(sx - 5 + lean * 3, y + 18, 11, R.mustard[5]);
    }
  },
  lights(it) {
    const w = W(it, 80);
    const y = Math.max(LAYOUT.ceiling, it.y);
    const n = Math.max(2, Math.round(w / 32));
    return Array.from({ length: n }, (_, k) => ({ x: it.x + ((k + 0.5) * w) / n + (k % 2 ? 3 : -3), y: y + 22, r: 90, color: '#ffe2a8', intensity: 0.7, switched: true }));
  },
};

/** A vent's grille standing above the floor: x, y = the grille's top-left, `look` as for a floor vent. */
export const grilleKind: KindDef = {
  z: 2,
  paint(px, it) {
    paintVentGrille(px, it.x, it.y, W(it, 48), typeof it.look === 'string' ? it.look : 'vent');
  },
};
