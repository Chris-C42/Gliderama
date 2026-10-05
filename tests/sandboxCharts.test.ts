import { describe, expect, it } from 'vitest';
import {
  CHART_COLORS,
  SERIES_COLORS,
  TICK_FONT,
  TITLE_FONT,
  bresenham,
  clipSegment,
  drawGraphPaper,
  drawLineChart,
  formatTick,
  niceNumber,
  niceTicks,
  tickValues,
  type ChartContext,
  type LineChartSpec,
  type Rect,
} from '../src/sandbox/charts';

/** A canvas stand-in that only offers what the renderer may use, and rasterises fillRect into a pixel grid. */
class PixelCanvas implements ChartContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  font = '';
  textAlign: CanvasTextAlign = 'left';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  readonly rects: { x: number; y: number; w: number; h: number; color: string }[] = [];
  readonly texts: { text: string; x: number; y: number; font: string; color: string }[] = [];
  readonly px: string[];

  constructor(
    readonly w: number,
    readonly h: number,
    fill = '#ff00ff',
  ) {
    this.px = new Array(w * h).fill(fill);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const color = String(this.fillStyle);
    this.rects.push({ x, y, w, h, color });
    for (let j = Math.max(0, y); j < Math.min(this.h, y + h); j++) for (let i = Math.max(0, x); i < Math.min(this.w, x + w); i++) this.px[j * this.w + i] = color;
  }

  fillText(text: string, x: number, y: number): void {
    this.texts.push({ text, x, y, font: this.font, color: String(this.fillStyle) });
  }

  measureText(text: string): { width: number } {
    return { width: text.length * 7 };
  }

  at(x: number, y: number): string {
    return this.px[y * this.w + x];
  }

  count(color: string, r?: Rect): number {
    let n = 0;
    const x0 = r?.x ?? 0;
    const y0 = r?.y ?? 0;
    const x1 = r ? r.x + r.w : this.w;
    const y1 = r ? r.y + r.h : this.h;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (this.at(x, y) === color) n++;
    return n;
  }
}

const C = CHART_COLORS;

describe('chart palette', () => {
  it('uses the pixel-art style guide', () => {
    expect(C.paper).toBe('#f4efe2');
    expect(C.gridMinor).toBe('#d9e4f0');
    expect(C.gridMajor).toBe('#bccfe4');
    expect(C.ink).toBe('#2b2340');
    expect(SERIES_COLORS).toEqual(['#d0533d', '#3e5a8e', '#3e8c78', '#dcb446']);
    expect(TITLE_FONT).toBe('16px "Pixelify Sans", monospace');
    expect(TICK_FONT).toBe('12px "Silkscreen", monospace');
  });
});

describe('nice ticks', () => {
  it('rounds to 1, 2 and 5 times a power of ten', () => {
    expect(niceNumber(0.9, true)).toBe(1);
    expect(niceNumber(1.7, true)).toBe(2);
    expect(niceNumber(4, true)).toBe(5);
    expect(niceNumber(8, true)).toBe(10);
    expect(niceNumber(23, true)).toBe(20);
    expect(niceNumber(0.027, true)).toBeCloseTo(0.02, 12);
    expect(niceNumber(0.032, true)).toBeCloseTo(0.05, 12);
    expect(niceNumber(9, false)).toBe(10);
    expect(niceNumber(0, true)).toBe(1);
    expect(niceNumber(NaN, true)).toBe(1);
  });

  it('picks round bounds around the data', () => {
    const a = niceTicks(0, 9.2, 5);
    expect(a.step).toBe(2);
    expect([a.lo, a.hi]).toEqual([0, 10]);
    expect(a.ticks).toEqual([0, 2, 4, 6, 8, 10]);
    const b = niceTicks(-6, 40, 5);
    expect(b.lo).toBeLessThanOrEqual(-6);
    expect(b.hi).toBeGreaterThanOrEqual(40);
    expect(b.ticks.every((t) => Math.abs(t / b.step - Math.round(t / b.step)) < 1e-9)).toBe(true);
    const c = niceTicks(0.012, 0.047, 4);
    expect(c.lo).toBeLessThanOrEqual(0.012);
    expect(c.hi).toBeGreaterThanOrEqual(0.047);
    expect(c.ticks).toContain(0.02);
    expect(c.ticks.length).toBeLessThanOrEqual(8);
  });

  it('copes with flat, reversed and broken ranges', () => {
    const flat = niceTicks(3, 3);
    expect(flat.lo).toBeLessThan(3);
    expect(flat.hi).toBeGreaterThan(3);
    const zero = niceTicks(0, 0);
    expect(zero.lo).toBeLessThan(0);
    expect(zero.hi).toBeGreaterThan(0);
    expect(niceTicks(10, 0).lo).toBe(0);
    const broken = niceTicks(NaN, Infinity);
    expect(broken.lo).toBe(0);
    expect(broken.hi).toBe(1);
  });

  it('lists ticks without floating-point dust and formats them', () => {
    expect(tickValues(0, 1, 0.1)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(tickValues(-0.5, 0.5, 0.25)).toEqual([-0.5, -0.25, 0, 0.25, 0.5]);
    expect(tickValues(1, 6, 5)).toEqual([5]);
    expect(formatTick(0.30000000000000004, 0.1)).toBe('0.3');
    expect(formatTick(10, 5)).toBe('10');
    expect(formatTick(-0, 1)).toBe('0');
    expect(formatTick(2.5, 0.5)).toBe('2.5');
    expect(formatTick(0.02, 0.01)).toBe('0.02');
  });
});

describe('pixel lines', () => {
  const trace = (x0: number, y0: number, x1: number, y1: number) => {
    const pts: [number, number][] = [];
    bresenham(x0, y0, x1, y1, (x, y) => pts.push([x, y]));
    return pts;
  };

  it('draws horizontal, vertical and diagonal lines exactly', () => {
    expect(trace(2, 5, 6, 5)).toEqual([[2, 5], [3, 5], [4, 5], [5, 5], [6, 5]]);
    expect(trace(3, 1, 3, 4)).toEqual([[3, 1], [3, 2], [3, 3], [3, 4]]);
    expect(trace(0, 0, 3, 3)).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
    expect(trace(4, 4, 4, 4)).toEqual([[4, 4]]);
    expect(trace(5, 0, 2, 0)).toEqual([[5, 0], [4, 0], [3, 0], [2, 0]]);
  });

  it('is one pixel thick and connected in every direction', () => {
    let seed = 7;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296) * 60 - 10;
    for (let k = 0; k < 200; k++) {
      const [x0, y0, x1, y1] = [rnd(), rnd(), rnd(), rnd()].map((v) => Math.round(v) + 0);
      const pts = trace(x0, y0, x1, y1);
      expect(pts[0]).toEqual([x0, y0]);
      expect(pts[pts.length - 1]).toEqual([x1, y1]);
      // One pixel per step along the major axis: no gaps, no doubled pixels.
      expect(pts.length).toBe(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) + 1);
      for (let i = 1; i < pts.length; i++) {
        expect(Math.abs(pts[i][0] - pts[i - 1][0])).toBeLessThanOrEqual(1);
        expect(Math.abs(pts[i][1] - pts[i - 1][1])).toBeLessThanOrEqual(1);
        expect(pts[i]).not.toEqual(pts[i - 1]);
      }
      // Every pixel is within half a pixel of the ideal line.
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len > 0) for (const [x, y] of pts) expect(Math.abs((x - x0) * (y1 - y0) - (y - y0) * (x1 - x0)) / len).toBeLessThanOrEqual(0.71);
    }
  });

  it('rounds fractional ends to whole pixels', () => {
    for (const [x, y] of trace(0.4, 0.6, 3.2, 2.7)) {
      expect(Number.isInteger(x)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
    }
  });

  it('clips segments to a rectangle', () => {
    expect(clipSegment(1, 1, 5, 5, 0, 0, 10, 10)).toEqual([1, 1, 5, 5]);
    expect(clipSegment(-5, 5, 15, 5, 0, 0, 10, 10)).toEqual([0, 5, 10, 5]);
    expect(clipSegment(-5, -5, -1, -1, 0, 0, 10, 10)).toBeNull();
    expect(clipSegment(-5, 20, 25, 20, 0, 0, 10, 10)).toBeNull();
    const c = clipSegment(-10, -10, 20, 20, 0, 0, 10, 10)!;
    expect(c[0]).toBeCloseTo(0, 9);
    expect(c[2]).toBeCloseTo(10, 9);
    // Huge coordinates stay finite.
    const h = clipSegment(-1e12, 5, 1e12, 5, 0, 0, 10, 10)!;
    expect(h[0]).toBeCloseTo(0, 3);
    expect(h[2]).toBeCloseTo(10, 3);
  });
});

describe('graph paper', () => {
  it('has a faint line every 8 px and a stronger one every 40 px', () => {
    const c = new PixelCanvas(130, 90);
    drawGraphPaper(c, { x: 10, y: 5, w: 100, h: 80 });
    expect(c.at(13, 8)).toBe(C.paper);
    expect(c.at(10 + 8, 8)).toBe(C.gridMinor); // minor vertical line
    expect(c.at(13, 5 + 16)).toBe(C.gridMinor); // minor horizontal line
    expect(c.at(10 + 40, 8)).toBe(C.gridMajor); // major vertical line
    expect(c.at(13, 5 + 40)).toBe(C.gridMajor); // major horizontal line
    expect(c.at(10, 5)).toBe(C.gridMajor); // the corner is a major crossing
    expect(c.at(10 + 80, 5 + 40)).toBe(C.gridMajor);
    expect(c.at(10 + 16, 5 + 40)).toBe(C.gridMajor); // a major line wins at crossings
    // Nothing outside the rectangle is touched.
    expect(c.at(9, 5)).toBe('#ff00ff');
    expect(c.at(110, 5)).toBe('#ff00ff');
    expect(c.at(10, 85)).toBe('#ff00ff');
  });
});

const spec = (over: Partial<LineChartSpec> = {}): LineChartSpec => ({
  title: 'Lift',
  xLabel: 'alpha',
  yLabel: 'CL',
  series: [
    {
      name: 'CL',
      color: C.red,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 1 },
        { x: 10, y: 4 },
      ],
    },
    {
      name: 'CD',
      color: C.navy,
      points: [
        { x: 0, y: 2 },
        { x: 10, y: 0 },
      ],
    },
  ],
  ...over,
});

describe('drawLineChart', () => {
  const rect = { x: 12, y: 9, w: 300, h: 200 };

  it('only paints inside its rectangle and repaints it completely', () => {
    const c = new PixelCanvas(340, 230);
    drawLineChart(c, rect, spec());
    for (let y = 0; y < c.h; y++)
      for (let x = 0; x < c.w; x++) {
        const inside = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
        if (!inside) expect(c.at(x, y)).toBe('#ff00ff');
        else expect(c.at(x, y)).not.toBe('#ff00ff');
      }
  });

  it('draws with whole numbers only: no sub-pixel rects or text', () => {
    const c = new PixelCanvas(340, 230);
    drawLineChart(c, { x: 12.4, y: 9.6, w: 300.3, h: 199.7 }, spec({ markers: [{ x: 3.3, y: 1.7, label: 'trim', color: C.mustard }] }));
    expect(c.rects.length).toBeGreaterThan(50);
    for (const r of c.rects) for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(v)).toBe(true);
    for (const t of c.texts) {
      expect(Number.isInteger(t.x)).toBe(true);
      expect(Number.isInteger(t.y)).toBe(true);
    }
  });

  it('uses the style guide palette and fonts', () => {
    const c = new PixelCanvas(340, 230);
    drawLineChart(c, rect, spec());
    const colors = new Set(c.rects.map((r) => r.color));
    for (const col of [C.paper, C.gridMinor, C.gridMajor, C.ink, C.red, C.navy]) expect(colors.has(col)).toBe(true);
    expect([...colors].every((col) => [C.paper, C.gridMinor, C.gridMajor, C.ink, C.red, C.navy].includes(col as never))).toBe(true);
    const title = c.texts.find((t) => t.text === 'Lift')!;
    expect(title.font).toBe(TITLE_FONT);
    expect(title.color).toBe(C.ink);
    const ticks = c.texts.filter((t) => /^-?[0-9.]+$/.test(t.text));
    expect(ticks.length).toBeGreaterThan(4);
    for (const t of ticks) expect(t.font).toBe(TICK_FONT);
    for (const label of ['alpha', 'CL', 'CD']) expect(c.texts.find((t) => t.text === label)!.font).toBe(TICK_FONT);
  });

  it('draws each series as a connected 1 px line between its points, with 3 x 3 point squares', () => {
    const c = new PixelCanvas(340, 230);
    // One series, so that no other line crosses over it.
    const layout = drawLineChart(c, rect, spec({ series: [spec().series[0]], legend: false }));
    const pts = spec().series[0].points.map((p) => layout.toPx(p.x, p.y));
    for (let i = 0; i + 1 < pts.length; i++)
      bresenham(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, (x, y) => expect(c.at(x, y), `pixel ${x},${y}`).toBe(C.red));
    for (const p of pts) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(c.at(p.x + dx, p.y + dy)).toBe(C.red);
    // The point squares are exactly 3 x 3: the pixel beyond is not part of one.
    const first = pts[0];
    expect(c.at(first.x - 2, first.y + 2)).not.toBe(C.red);
  });

  it('keeps the plot inside the rectangle and maps data both ways', () => {
    const c = new PixelCanvas(340, 230);
    const layout = drawLineChart(c, rect, spec({ xRange: [0, 10], yRange: [0, 5] }));
    const p = layout.plot;
    expect(p.x).toBeGreaterThan(rect.x);
    expect(p.y).toBeGreaterThan(rect.y);
    expect(p.x + p.w).toBeLessThanOrEqual(rect.x + rect.w);
    expect(p.y + p.h).toBeLessThanOrEqual(rect.y + rect.h);
    expect(layout.xRange).toEqual([0, 10]);
    expect(layout.yRange).toEqual([0, 5]);
    expect(layout.toPx(0, 0)).toEqual({ x: p.x, y: p.y + p.h });
    expect(layout.toPx(10, 5)).toEqual({ x: p.x + p.w, y: p.y });
    for (const [x, y] of [[2.5, 1.25], [7, 4], [0.1, 0.1]]) {
      const px = layout.toPx(x, y);
      const back = layout.toData(px.x, px.y);
      expect(Math.abs(back.x - x)).toBeLessThanOrEqual(10 / p.w);
      expect(Math.abs(back.y - y)).toBeLessThanOrEqual(5 / p.h);
    }
  });

  it('rounds automatic ranges out to nice numbers that contain the data', () => {
    const c = new PixelCanvas(340, 230);
    const layout = drawLineChart(c, rect, spec({ series: [{ name: 'a', color: C.teal, points: [{ x: 0.3, y: -0.7 }, { x: 9.2, y: 3.4 }] }] }));
    expect(layout.xRange[0]).toBeLessThanOrEqual(0.3);
    expect(layout.xRange[1]).toBeGreaterThanOrEqual(9.2);
    expect(layout.yRange[0]).toBeLessThanOrEqual(-0.7);
    expect(layout.yRange[1]).toBeGreaterThanOrEqual(3.4);
    expect(layout.xTicks.length).toBeGreaterThanOrEqual(3);
    expect(layout.yTicks.length).toBeGreaterThanOrEqual(3);
    const step = layout.yTicks[1] - layout.yTicks[0];
    expect([1, 2, 5].includes(step / 10 ** Math.floor(Math.log10(step)))).toBe(true);
    // One tick label per tick.
    for (const t of layout.xTicks) expect(c.texts.some((x) => x.font === TICK_FONT && x.text === formatTick(t, layout.xTicks[1] - layout.xTicks[0]))).toBe(true);
  });

  it('clips what lies outside a fixed range and survives absurd values', () => {
    const c = new PixelCanvas(340, 230);
    const layout = drawLineChart(
      c,
      rect,
      spec({
        legend: false,
        xRange: [0, 10],
        yRange: [0, 5],
        series: [
          {
            name: '',
            color: C.red,
            points: [
              { x: -1e12, y: 2 },
              { x: 5, y: 1e300 },
              { x: 1e12, y: -1e300 },
              { x: NaN, y: 1 },
              { x: 3, y: Infinity },
              { x: 4, y: 3 },
            ],
          },
        ],
      }),
    );
    const p = layout.plot;
    // Red appears only inside the plot box (no legend, no markers, so nothing else is red).
    for (let y = 0; y < c.h; y++)
      for (let x = 0; x < c.w; x++) {
        if (c.at(x, y) !== C.red) continue;
        expect(x).toBeGreaterThanOrEqual(p.x);
        expect(x).toBeLessThanOrEqual(p.x + p.w);
        expect(y).toBeGreaterThanOrEqual(p.y);
        expect(y).toBeLessThanOrEqual(p.y + p.h);
      }
    expect(c.count(C.red)).toBeGreaterThan(10);
  });

  it('draws markers as 3 x 3 squares with labels that stay inside the plot', () => {
    const c = new PixelCanvas(340, 230);
    const layout = drawLineChart(
      c,
      rect,
      spec({
        xRange: [0, 10],
        yRange: [0, 5],
        markers: [
          { x: 2, y: 2.5, label: 'trim', color: C.mustard },
          { x: 5.1, y: 2.6, label: 'best', color: C.teal },
          { x: 5, y: 2.5, label: 'near', color: C.navy },
          { x: 10, y: 0, label: 'a very long label here', color: C.red },
        ],
      }),
    );
    const m = layout.toPx(2, 2.5);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(c.at(m.x + dx, m.y + dy)).toBe(C.mustard);
    expect(c.at(m.x + 2, m.y)).toBe(C.ink); // the outline
    const p = layout.plot;
    for (const t of c.texts.filter((q) => ['trim', 'best', 'near', 'a very long label here'].includes(q.text))) {
      const w = t.text.length * 7;
      // A label's anchor is inside the plot, and the long one is pushed to the side that fits.
      expect(t.x).toBeGreaterThanOrEqual(p.x);
      expect(t.x).toBeLessThanOrEqual(p.x + p.w);
      if (t.text.length > 10) expect(t.x - w).toBeGreaterThanOrEqual(p.x - 1);
    }
    // Two markers almost on top of each other get labels in different places.
    const a = c.texts.find((t) => t.text === 'near')!;
    const b = c.texts.find((t) => t.text === 'best')!;
    expect(a.x !== b.x || a.y !== b.y).toBe(true);
  });

  it('leaves out markers that are off the chart', () => {
    const c = new PixelCanvas(340, 230);
    drawLineChart(c, rect, spec({ xRange: [0, 10], yRange: [0, 5], markers: [{ x: 50, y: 2, label: 'gone', color: C.mustard }, { x: NaN, y: 1, label: 'nan' }] }));
    expect(c.texts.some((t) => t.text === 'gone' || t.text === 'nan')).toBe(false);
    expect(c.count(C.mustard)).toBe(0);
  });

  it('handles empty, single-point and flat series', () => {
    for (const series of [[], [{ name: 'e', color: C.red, points: [] }], [{ name: 's', color: C.red, points: [{ x: 2, y: 3 }] }], [{ name: 'f', color: C.red, points: [{ x: 0, y: 1 }, { x: 4, y: 1 }] }]]) {
      const c = new PixelCanvas(340, 230);
      const layout = drawLineChart(c, rect, spec({ series }));
      expect(layout.xRange[1]).toBeGreaterThan(layout.xRange[0]);
      expect(layout.yRange[1]).toBeGreaterThan(layout.yRange[0]);
      if (series.length && series[0].points.length) expect(c.count(C.red)).toBeGreaterThan(0);
    }
  });

  it('shows a legend only for several named series, unless told otherwise', () => {
    const named = (s: LineChartSpec) => {
      const c = new PixelCanvas(340, 230);
      drawLineChart(c, rect, s);
      return c.texts.filter((t) => t.text === 'CL' || t.text === 'CD').length;
    };
    // The y label is also "CL" in spec(); use a different one to isolate the legend.
    expect(named(spec({ yLabel: 'coefficient' }))).toBe(2);
    expect(named(spec({ yLabel: 'coefficient', legend: false }))).toBe(0);
    expect(named(spec({ yLabel: 'coefficient', series: [spec().series[0]] }))).toBe(0);
    expect(named(spec({ yLabel: 'coefficient', series: [spec().series[0]], legend: true }))).toBe(1);
  });

  it('is repeatable and fast on dense series', () => {
    const dense = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: Math.sin(i / 40) * 3 + (i % 7) * 0.1 }));
    const s = spec({ series: SERIES_COLORS.map((color, i) => ({ name: `s${i}`, color, points: dense(3000) })) });
    const a = new PixelCanvas(340, 230);
    const t0 = performance.now();
    drawLineChart(a, rect, s);
    expect(performance.now() - t0).toBeLessThan(500);
    const b = new PixelCanvas(340, 230);
    drawLineChart(b, rect, s);
    expect(b.px).toEqual(a.px);
    // Dense series get no point squares: the red line is thin.
    expect(a.count(C.red)).toBeLessThan(3000 * 4);
  });
});
