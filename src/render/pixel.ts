/**
 * Pixel-art toolkit over a 2D canvas. Everything snaps to whole pixels; gradients are ordered-
 * dithered (Bayer 4×4) so painters produce crisp, palette-faithful art.
 */

import { mixHex } from './palette';

export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

export function bayer(x: number, y: number): number {
  return BAYER4[(y & 3) * 4 + (x & 3)];
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Pt = [number, number];

export class Px {
  readonly ctx: CanvasRenderingContext2D;
  readonly w: number;
  readonly h: number;
  rand: () => number;

  constructor(
    readonly canvas: HTMLCanvasElement | OffscreenCanvas,
    seed = 1,
  ) {
    this.ctx = canvas.getContext('2d', { willReadFrequently: false }) as CanvasRenderingContext2D;
    this.ctx.imageSmoothingEnabled = false;
    this.w = canvas.width;
    this.h = canvas.height;
    this.rand = mulberry(seed);
  }

  static create(w: number, h: number, seed = 1): Px {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return new Px(c, seed);
  }

  ri(a: number, b: number): number {
    return Math.floor(a + this.rand() * (b - a + 1));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.rand() * arr.length)];
  }

  rect(x: number, y: number, w: number, h: number, c: string): void {
    if (w <= 0 || h <= 0) return;
    this.ctx.fillStyle = c;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  px(x: number, y: number, c: string): void {
    this.ctx.fillStyle = c;
    this.ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  }

  hline(x: number, y: number, w: number, c: string): void {
    this.rect(x, y, w, 1, c);
  }

  vline(x: number, y: number, h: number, c: string): void {
    this.rect(x, y, 1, h, c);
  }

  frame(x: number, y: number, w: number, h: number, c: string): void {
    this.hline(x, y, w, c);
    this.hline(x, y + h - 1, w, c);
    this.vline(x, y, h, c);
    this.vline(x + w - 1, y, h, c);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: string): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    this.ctx.fillStyle = c;
    for (;;) {
      this.ctx.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Fill pixels where the Bayer threshold is below `level` (0..1): a dithered tint. */
  dither(x: number, y: number, w: number, h: number, c: string, level: number): void {
    if (level <= 0) return;
    this.ctx.fillStyle = c;
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    for (let j = 0; j < Math.round(h); j++)
      for (let i = 0; i < Math.round(w); i++) if (bayer(x0 + i, y0 + j) < level) this.ctx.fillRect(x0 + i, y0 + j, 1, 1);
  }

  /** Vertical gradient through a list of colours with ordered dithering between bands. */
  vgrad(x: number, y: number, w: number, h: number, cols: readonly string[]): void {
    const n = cols.length;
    if (n === 1) return this.rect(x, y, w, h, cols[0]);
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    const H = Math.round(h);
    const W = Math.round(w);
    for (let j = 0; j < H; j++) {
      const t = (j / Math.max(1, H - 1)) * (n - 1);
      const i0 = Math.min(n - 2, Math.floor(t));
      const f = t - i0;
      for (let i = 0; i < W; i++) {
        this.ctx.fillStyle = bayer(x0 + i, y0 + j) < f ? cols[i0 + 1] : cols[i0];
        this.ctx.fillRect(x0 + i, y0 + j, 1, 1);
      }
    }
  }

  hgrad(x: number, y: number, w: number, h: number, cols: readonly string[]): void {
    const n = cols.length;
    if (n === 1) return this.rect(x, y, w, h, cols[0]);
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    const H = Math.round(h);
    const W = Math.round(w);
    for (let i = 0; i < W; i++) {
      const t = (i / Math.max(1, W - 1)) * (n - 1);
      const i0 = Math.min(n - 2, Math.floor(t));
      const f = t - i0;
      for (let j = 0; j < H; j++) {
        this.ctx.fillStyle = bayer(x0 + i, y0 + j) < f ? cols[i0 + 1] : cols[i0];
        this.ctx.fillRect(x0 + i, y0 + j, 1, 1);
      }
    }
  }

  /** Filled ellipse, pixel exact. */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: string): void {
    this.ctx.fillStyle = c;
    const r2 = (rx + 0.25) * (rx + 0.25);
    for (let j = -Math.ceil(ry); j <= Math.ceil(ry); j++) {
      const yy = j / Math.max(0.5, ry);
      const half = Math.sqrt(Math.max(0, 1 - yy * yy) * r2);
      if (half <= 0) continue;
      const x0 = Math.round(cx - half);
      const x1 = Math.round(cx + half);
      this.ctx.fillRect(x0, Math.round(cy + j), x1 - x0, 1);
    }
  }

  /** Filled polygon (even-odd scanline). */
  poly(pts: Pt[], c: string): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    this.ctx.fillStyle = c;
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const yc = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
          xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = Math.round(xs[k]);
        const x1 = Math.round(xs[k + 1]);
        if (x1 > x0) this.ctx.fillRect(x0, y, x1 - x0, 1);
      }
    }
  }

  /** Random speckles (texture noise) inside a rect. */
  speckle(x: number, y: number, w: number, h: number, cols: readonly string[], density: number): void {
    const n = Math.round(w * h * density);
    for (let k = 0; k < n; k++) {
      this.px(x + Math.floor(this.rand() * w), y + Math.floor(this.rand() * h), cols[Math.floor(this.rand() * cols.length)]);
    }
  }

  /**
   * A front-facing box seen slightly from above: a top face `depth` pixels tall, a front face,
   * outline, top-left highlight and right-side shading. `ramp` is dark → light (≥5 entries).
   */
  box(x: number, y: number, w: number, h: number, depth: number, ramp: readonly string[], outline = true): void {
    const r = (i: number) => ramp[Math.max(0, Math.min(ramp.length - 1, i))];
    const top = Math.max(0, depth);
    // top face
    if (top > 0) {
      this.rect(x, y, w, top, r(ramp.length - 1));
      this.hline(x, y + top - 1, w, r(ramp.length - 2));
    }
    // front face
    this.rect(x, y + top, w, h - top, r(ramp.length - 3));
    this.vline(x + w - 2, y + top, h - top, r(ramp.length - 4));
    this.dither(x + Math.floor(w * 0.75), y + top, Math.ceil(w * 0.25) - 1, h - top, r(ramp.length - 4), 0.35);
    this.hline(x, y + h - 2, w, r(ramp.length - 4));
    this.vline(x + 1, y + top, h - top - 1, r(ramp.length - 2));
    if (outline) this.frame(x, y, w, h, r(1));
  }

  /** Soft contact shadow (dithered) under furniture on the floor. */
  contactShadow(x: number, y: number, w: number, h: number, c: string, strength = 0.6): void {
    for (let j = 0; j < h; j++) {
      const f = strength * (1 - j / h);
      this.dither(x - j, y + j, w + 2 * j, 1, c, f);
    }
  }

  /** Copy another canvas onto this one (no smoothing). */
  blit(src: CanvasImageSource, x: number, y: number): void {
    this.ctx.drawImage(src, Math.round(x), Math.round(y));
  }

  /** Mix helper exposed for painters. */
  mix(a: string, b: string, t: number): string {
    return mixHex(a, b, t);
  }
}
