/** Small geometry helpers and the flight-corridor "band" the generator dresses rooms around. */

import type { Box } from './types';

export function overlaps(a: Box, b: Box, gap = 0): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

export function translate(b: Box, dx: number, dy = 0): Box {
  return { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h };
}

export function inflate(b: Box, m: number): Box {
  return { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m };
}

export function unionX(boxes: Box[]): { x0: number; x1: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const b of boxes) {
    if (b.x < x0) x0 = b.x;
    if (b.x + b.w > x1) x1 = b.x + b.w;
  }
  return { x0, x1 };
}

export const ROOM_W = 640;
export const ROOM_H = 360;

/** px from the entry wall -> x (the direction of progress `dirX` says which wall that is). */
export const toX = (dirX: 1 | -1, u: number) => (dirX > 0 ? u : ROOM_W - u);

const COL = 4;
const NCOL = ROOM_W / COL;

/**
 * Where the plane flies, per 4-px column: the highest and lowest y any validation flight reached (plus margins).
 * Furniture has to sit below the band, ceiling things above it; the band is the "flight corridor".
 */
export class Band {
  readonly top: number[] = new Array(NCOL).fill(Infinity);
  readonly bot: number[] = new Array(NCOL).fill(-Infinity);

  private col(x: number): number {
    const c = Math.floor(x / COL);
    return c < 0 ? 0 : c >= NCOL ? NCOL - 1 : c;
  }

  /** Reserve a rectangle of air (whole columns). */
  addBox(x0: number, x1: number, y0: number, y1: number): void {
    for (let c = this.col(x0); c <= this.col(x1); c++) {
      if (y0 < this.top[c]) this.top[c] = y0;
      if (y1 > this.bot[c]) this.bot[c] = y1;
    }
  }

  /** Add a flown path as a ribbon: `up` / `down` px above / below the plane's centre. */
  addPath(path: { x: number; y: number }[], up: number, down: number): void {
    for (let i = 0; i < path.length; i++) {
      const a = path[i];
      const b = path[i + 1] ?? a;
      const steps = Math.max(1, Math.ceil(Math.abs(b.x - a.x) / COL));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const c = this.col(x);
        if (y - up < this.top[c]) this.top[c] = y - up;
        if (y + down > this.bot[c]) this.bot[c] = y + down;
      }
    }
  }

  /** Highest / lowest reserved y over an x-range (Infinity / -Infinity when nothing flies there). */
  rangeTop(x0: number, x1: number): number {
    let t = Infinity;
    for (let c = this.col(x0); c <= this.col(x1); c++) if (this.top[c] < t) t = this.top[c];
    return t;
  }

  rangeBot(x0: number, x1: number): number {
    let b = -Infinity;
    for (let c = this.col(x0); c <= this.col(x1); c++) if (this.bot[c] > b) b = this.bot[c];
    return b;
  }

  /**
   * Is the box out of the plane's way? In every column it spans (plus `side` px either side) it must lie entirely
   * below the lowest the plane flies there (+ `below` margin) or entirely above the highest (- `above` margin).
   */
  clear(box: Box, below: number, above: number, side = 6): boolean {
    const y0 = box.y;
    const y1 = box.y + box.h;
    for (let c = this.col(box.x - side); c <= this.col(box.x + box.w + side); c++) {
      if (this.bot[c] === -Infinity) continue;
      if (y0 >= this.bot[c] + below) continue;
      if (y1 <= this.top[c] - above) continue;
      return false;
    }
    return true;
  }

  /** Is the point at least `m` px away from every flown column's [top, bottom] range? */
  pointClear(x: number, y: number, m: number): boolean {
    const c = this.col(x);
    if (this.bot[c] === -Infinity) return true;
    return y > this.bot[c] + m || y < this.top[c] - m;
  }
}
