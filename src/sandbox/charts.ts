/**
 * A tiny pixel-art line chart renderer for the hangar's polar and throw-sweep plots.
 *
 * It draws at native size on a canvas 2D context: every coordinate is an integer, lines are 1 px
 * Bresenham lines made of single-pixel `fillRect`s (no anti-aliasing, no `stroke`), points are 3x3
 * squares, and the background is graph paper (a faint line every 8 px, a stronger one every 40 px).
 * Only the text goes through `fillText`, so it follows whichever of Pixelify Sans / Silkscreen has loaded.
 *
 * The renderer only needs the handful of context members in `ChartContext`, so it also runs against a
 * recording stub in tests.
 */

export const CHART_COLORS = {
  paper: '#f4efe2',
  gridMinor: '#d9e4f0',
  gridMajor: '#bccfe4',
  ink: '#2b2340',
  red: '#d0533d',
  navy: '#3e5a8e',
  teal: '#3e8c78',
  mustard: '#dcb446',
} as const;

/** Series colours in the order to use them. */
export const SERIES_COLORS: readonly string[] = [CHART_COLORS.red, CHART_COLORS.navy, CHART_COLORS.teal, CHART_COLORS.mustard];

export const TITLE_FONT = '16px "Pixelify Sans", monospace';
export const TICK_FONT = '12px "Silkscreen", monospace';

/** The slice of CanvasRenderingContext2D the chart uses. */
export interface ChartContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartSeries {
  name: string;
  color: string;
  points: ChartPoint[];
  /** Draw a 3x3 square at every point (default: only for series of 40 points or fewer). */
  dots?: boolean;
}

export interface ChartMarker {
  x: number;
  y: number;
  label?: string;
  /** Default: the ink colour. */
  color?: string;
}

export interface LineChartSpec {
  title: string;
  xLabel?: string;
  yLabel?: string;
  series: ChartSeries[];
  markers?: ChartMarker[];
  /** Fixed axis ranges; by default they follow the data, rounded out to nice numbers. */
  xRange?: readonly [number, number];
  yRange?: readonly [number, number];
  /** Show the series names (default: when there are two or more series). */
  legend?: boolean;
}

export interface ChartLayout {
  /** The plotting area (the axes box), in canvas pixels. */
  plot: Rect;
  xRange: [number, number];
  yRange: [number, number];
  xTicks: number[];
  yTicks: number[];
  /** Data to canvas pixel (rounded, as drawn) and back. */
  toPx(x: number, y: number): { x: number; y: number };
  toData(px: number, py: number): { x: number; y: number };
}

// ---------------------------------------------------------------------------------------------
// Nice numbers
// ---------------------------------------------------------------------------------------------

/** A "nice" number (1, 2, 5 x 10^n) near `x`: rounded when `round`, else the next one up. */
export function niceNumber(x: number, round: boolean): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const exp = Math.floor(Math.log10(x));
  const f = x / 10 ** exp;
  const nf = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) : f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

export interface NiceTicks {
  /** The data range rounded out to whole steps. */
  lo: number;
  hi: number;
  step: number;
  /** The tick values from lo to hi. */
  ticks: number[];
}

/** How many decimals a tick step needs (0.25 needs two). */
function decimalsFor(step: number): number {
  for (let d = 0; d < 6; d++) {
    const m = step * 10 ** d;
    if (Math.abs(m - Math.round(m)) < 1e-9 * Math.max(1, Math.abs(m))) return d;
  }
  return 6;
}

/** Tick values at multiples of `step` inside [min, max]. */
export function tickValues(min: number, max: number, step: number): number[] {
  const d = decimalsFor(step);
  const out: number[] = [];
  const first = Math.ceil(min / step - 1e-9);
  const last = Math.floor(max / step + 1e-9);
  for (let i = first; i <= last; i++) out.push(Number((i * step).toFixed(d)) + 0);
  return out;
}

/** Nice axis bounds and ticks for a data range, aiming for about `target` ticks. */
export function niceTicks(min: number, max: number, target = 5): NiceTicks {
  let a = min;
  let b = max;
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    a = 0;
    b = 1;
  }
  if (b < a) [a, b] = [b, a];
  if (b - a < 1e-12) {
    const pad = Math.abs(a) > 1e-9 ? Math.abs(a) * 0.1 : 1;
    a -= pad;
    b += pad;
  }
  const range = niceNumber(b - a, false);
  const step = niceNumber(range / Math.max(1, target - 1), true);
  const lo = Math.floor(a / step + 1e-9) * step;
  const hi = Math.ceil(b / step - 1e-9) * step;
  const d = decimalsFor(step);
  return { lo: Number(lo.toFixed(d)) + 0, hi: Number(hi.toFixed(d)) + 0, step, ticks: tickValues(lo, hi, step) };
}

/** A tick value as text with only the decimals the step needs. */
export function formatTick(v: number, step: number): string {
  const s = v.toFixed(decimalsFor(step));
  return s === '-0' ? '0' : s;
}

// ---------------------------------------------------------------------------------------------
// Pixel drawing
// ---------------------------------------------------------------------------------------------

/** Integer points of the 1 px line from (x0, y0) to (x1, y1), both ends included (Bresenham). */
export function bresenham(x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number) => void): void {
  let x = Math.round(x0) + 0; // + 0 turns -0 into 0
  let y = Math.round(y0) + 0;
  const ex = Math.round(x1) + 0;
  const ey = Math.round(y1) + 0;
  const dx = Math.abs(ex - x);
  const dy = -Math.abs(ey - y);
  const sx = x < ex ? 1 : -1;
  const sy = y < ey ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x, y);
    if (x === ex && y === ey) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Liang-Barsky: the part of a segment inside the rectangle, or null. */
export function clipSegment(x0: number, y0: number, x1: number, y1: number, xmin: number, ymin: number, xmax: number, ymax: number): [number, number, number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - xmin, xmax - x0, y0 - ymin, ymax - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  const cx = (v: number) => Math.min(xmax, Math.max(xmin, v));
  const cy = (v: number) => Math.min(ymax, Math.max(ymin, v));
  return [cx(x0 + t0 * dx), cy(y0 + t0 * dy), cx(x0 + t1 * dx), cy(y0 + t1 * dy)];
}

function dot(ctx: ChartContext, x: number, y: number): void {
  ctx.fillRect(x, y, 1, 1);
}

function setColor(ctx: ChartContext, color: string): void {
  ctx.fillStyle = color;
}

/** Graph paper over a rectangle: a line every 8 px, a stronger one every 40 px, counted from its corner. */
export function drawGraphPaper(ctx: ChartContext, r: Rect): void {
  setColor(ctx, CHART_COLORS.paper);
  ctx.fillRect(r.x, r.y, r.w, r.h);
  for (const [step, color] of [
    [8, CHART_COLORS.gridMinor],
    [40, CHART_COLORS.gridMajor],
  ] as const) {
    setColor(ctx, color);
    for (let gx = 0; gx < r.w; gx += step) ctx.fillRect(r.x + gx, r.y, 1, r.h);
    for (let gy = 0; gy < r.h; gy += step) ctx.fillRect(r.x, r.y + gy, r.w, 1);
  }
}

function text(ctx: ChartContext, s: string, x: number, y: number, font: string, align: CanvasTextAlign, baseline: CanvasTextBaseline, color: string): void {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  setColor(ctx, color);
  ctx.fillText(s, Math.round(x), Math.round(y));
}

// ---------------------------------------------------------------------------------------------
// The chart
// ---------------------------------------------------------------------------------------------

function extent(values: number[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * Draws a line chart into `rect` (canvas pixels; the rectangle is repainted entirely). Returns the
 * layout, so callers can map between data and pixels (for hover read-outs, say).
 */
export function drawLineChart(ctx: ChartContext, rect: Rect, spec: LineChartSpec): ChartLayout {
  const R: Rect = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.max(40, Math.round(rect.w)), h: Math.max(40, Math.round(rect.h)) };
  const ink = CHART_COLORS.ink;
  drawGraphPaper(ctx, R);

  // Ranges.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of spec.series)
    for (const p of s.points) {
      xs.push(p.x);
      ys.push(p.y);
    }
  for (const m of spec.markers ?? []) {
    xs.push(m.x);
    ys.push(m.y);
  }
  const xe = extent(xs) ?? [0, 1];
  const ye = extent(ys) ?? [0, 1];
  const wantY = Math.max(3, Math.round((R.h - 70) / 36) + 1);
  const yNice = spec.yRange ? null : niceTicks(ye[0], ye[1], wantY);
  const yRange: [number, number] = spec.yRange ? [spec.yRange[0], spec.yRange[1]] : [yNice!.lo, yNice!.hi];
  if (yRange[1] - yRange[0] < 1e-12) yRange[1] = yRange[0] + 1;
  const yStep = spec.yRange ? niceNumber((yRange[1] - yRange[0]) / (wantY - 1), true) : yNice!.step;
  const yTicks = tickValues(yRange[0], yRange[1], yStep);

  // Margins: title row, optional y-label row, tick labels.
  ctx.font = TICK_FONT;
  const labelW = Math.max(8, ...yTicks.map((v) => Math.ceil(ctx.measureText(formatTick(v, yStep)).width)));
  const legendOn = spec.legend ?? spec.series.length > 1;
  const named = spec.series.filter((s) => s.name);
  const top = 26 + (legendOn && named.length > 0 ? 14 : 0) + (spec.yLabel ? 18 : 8);
  const left = labelW + 12;
  const right = 12;
  const bottom = 22 + (spec.xLabel ? 16 : 0);
  const plot: Rect = { x: R.x + left, y: R.y + top, w: Math.max(16, R.w - left - right), h: Math.max(16, R.h - top - bottom) };

  const wantX = Math.max(3, Math.round(plot.w / 64) + 1);
  const xNice = spec.xRange ? null : niceTicks(xe[0], xe[1], wantX);
  const xRange: [number, number] = spec.xRange ? [spec.xRange[0], spec.xRange[1]] : [xNice!.lo, xNice!.hi];
  if (xRange[1] - xRange[0] < 1e-12) xRange[1] = xRange[0] + 1;
  const xStep = spec.xRange ? niceNumber((xRange[1] - xRange[0]) / (wantX - 1), true) : xNice!.step;
  const xTicks = tickValues(xRange[0], xRange[1], xStep);

  const fx = (x: number) => plot.x + ((x - xRange[0]) / (xRange[1] - xRange[0])) * plot.w;
  const fy = (y: number) => plot.y + plot.h - ((y - yRange[0]) / (yRange[1] - yRange[0])) * plot.h;
  const layout: ChartLayout = {
    plot,
    xRange,
    yRange,
    xTicks,
    yTicks,
    toPx: (x, y) => ({ x: Math.round(fx(x)), y: Math.round(fy(y)) }),
    toData: (px, py) => ({
      x: xRange[0] + ((px - plot.x) / plot.w) * (xRange[1] - xRange[0]),
      y: yRange[0] + ((plot.y + plot.h - py) / plot.h) * (yRange[1] - yRange[0]),
    }),
  };

  // Plot area on clean paper with the grid showing through, then ticks, axes and labels.
  setColor(ctx, ink);
  for (const v of xTicks) {
    const px = Math.round(fx(v));
    ctx.fillRect(px, plot.y + plot.h, 1, 4);
  }
  for (const v of yTicks) {
    const py = Math.round(fy(v));
    ctx.fillRect(plot.x - 4, py, 4, 1);
  }
  ctx.fillRect(plot.x, plot.y + plot.h, plot.w + 1, 1); // x axis
  ctx.fillRect(plot.x, plot.y, 1, plot.h + 1); // y axis
  for (const v of xTicks) text(ctx, formatTick(v, xStep), fx(v), plot.y + plot.h + 6, TICK_FONT, 'center', 'top', ink);
  for (const v of yTicks) text(ctx, formatTick(v, yStep), plot.x - 7, fy(v), TICK_FONT, 'right', 'middle', ink);
  if (spec.xLabel) text(ctx, spec.xLabel, plot.x + plot.w / 2, R.y + R.h - 4, TICK_FONT, 'center', 'bottom', ink);

  // Title, legend, then the y label right above the axis.
  text(ctx, spec.title, R.x + 8, R.y + 6, TITLE_FONT, 'left', 'top', ink);
  const showLegend = legendOn && named.length > 0;
  if (showLegend) {
    let lx = R.x + 8;
    const ly = R.y + 26;
    for (const s of named) {
      setColor(ctx, s.color);
      ctx.fillRect(lx, ly + 2, 5, 5);
      text(ctx, s.name, lx + 9, ly, TICK_FONT, 'left', 'top', ink);
      lx += 9 + Math.ceil(ctx.measureText(s.name).width) + 12;
    }
  }
  if (spec.yLabel) text(ctx, spec.yLabel, R.x + 8, R.y + 26 + (showLegend ? 14 : 0), TICK_FONT, 'left', 'top', ink);

  // Series: clipped to the plot, 1 px Bresenham lines, optional 3x3 point squares.
  const x0 = plot.x;
  const y0 = plot.y;
  const x1 = plot.x + plot.w;
  const y1 = plot.y + plot.h;
  const inside = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  for (const s of spec.series) {
    setColor(ctx, s.color);
    // Absurd data is pinned a million pixels out, where clipping is still exact.
    const far = (v: number) => Math.max(-1e6, Math.min(1e6, v));
    const pts = s.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => ({ x: far(fx(p.x)), y: far(fy(p.y)) }));
    for (let i = 0; i + 1 < pts.length; i++) {
      const c = clipSegment(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, x0, y0, x1, y1);
      if (c) bresenham(c[0], c[1], c[2], c[3], (x, y) => dot(ctx, x, y));
    }
    if (pts.length === 1 && inside(Math.round(pts[0].x), Math.round(pts[0].y))) dot(ctx, Math.round(pts[0].x), Math.round(pts[0].y));
    if (s.dots ?? s.points.length <= 40) {
      for (const p of pts) {
        const px = Math.round(p.x);
        const py = Math.round(p.y);
        if (inside(px, py)) ctx.fillRect(px - 1, py - 1, 3, 3);
      }
    }
  }

  // Markers: 3x3 squares, then their labels placed where they overlap neither each other nor another marker.
  const placed: Rect[] = [];
  const marks: { m: ChartMarker; px: number; py: number }[] = [];
  for (const m of spec.markers ?? []) {
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
    const px = Math.round(fx(m.x));
    const py = Math.round(fy(m.y));
    if (!inside(px, py)) continue;
    marks.push({ m, px, py });
    placed.push({ x: px - 3, y: py - 3, w: 7, h: 7 });
  }
  for (const { m, px, py } of marks) {
    const color = m.color ?? ink;
    // A coloured square gets a 1 px ink outline so it reads over any line.
    if (color !== ink) {
      setColor(ctx, ink);
      ctx.fillRect(px - 2, py - 2, 5, 5);
    }
    setColor(ctx, color);
    ctx.fillRect(px - 1, py - 1, 3, 3);
  }
  for (const { m, px, py } of marks) {
    if (!m.label) continue;
    ctx.font = TICK_FONT;
    const w = Math.ceil(ctx.measureText(m.label).width);
    const h = 12;
    const own = placed.findIndex((r) => r.x === px - 3 && r.y === py - 3);
    // Candidate positions around the marker; the first that fits wins.
    const candidates: { r: Rect; align: CanvasTextAlign; base: CanvasTextBaseline; tx: number; ty: number }[] = [
      { r: { x: px + 5, y: py - 4 - h, w, h }, align: 'left', base: 'bottom', tx: px + 5, ty: py - 4 },
      { r: { x: px + 5, y: py + 4, w, h }, align: 'left', base: 'top', tx: px + 5, ty: py + 4 },
      { r: { x: px - 5 - w, y: py - 4 - h, w, h }, align: 'right', base: 'bottom', tx: px - 5, ty: py - 4 },
      { r: { x: px - 5 - w, y: py + 4, w, h }, align: 'right', base: 'top', tx: px - 5, ty: py + 4 },
      { r: { x: px + 7, y: py - h / 2, w, h }, align: 'left', base: 'middle', tx: px + 7, ty: py },
      { r: { x: px - 7 - w, y: py - h / 2, w, h }, align: 'right', base: 'middle', tx: px - 7, ty: py },
    ];
    const fits = (r: Rect) => r.x >= x0 + 2 && r.x + r.w <= x1 && r.y >= y0 && r.y + r.h <= y1;
    const clear = (r: Rect) => placed.every((o, i) => i === own || r.x + r.w <= o.x || r.x >= o.x + o.w || r.y + r.h <= o.y || r.y >= o.y + o.h);
    const pick = candidates.find((c) => fits(c.r) && clear(c.r)) ?? candidates.find((c) => fits(c.r)) ?? candidates[0];
    placed.push(pick.r);
    text(ctx, m.label, pick.tx, pick.ty, TICK_FONT, pick.align, pick.base, ink);
  }
  return layout;
}
