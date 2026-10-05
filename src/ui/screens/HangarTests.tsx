import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { Design } from '../../paper/design';
import { analyzeDesign, coeffs, glideSpeed } from '../../paper/aero';
import { Icon } from '../icons';
import { FriendlyStats } from '../components/Stats';

const DEG = Math.PI / 180;

function drawChart(c: HTMLCanvasElement, series: { color: string; pts: [number, number][] }[], xl: string, yl: string) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = c.clientWidth;
  const H = c.clientHeight;
  c.width = W * dpr;
  c.height = H * dpr;
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#fbfaf4';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#e2eaf4';
  for (let x = 0; x < W; x += 8) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 8) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
    ctx.stroke();
  }
  const all = series.flatMap((s) => s.pts);
  if (!all.length) return;
  const x0 = Math.min(...all.map((p) => p[0]));
  const x1 = Math.max(...all.map((p) => p[0]));
  const y0 = Math.min(0, ...all.map((p) => p[1]));
  const y1 = Math.max(...all.map((p) => p[1]));
  const pad = { l: 30, r: 8, t: 8, b: 22 };
  const X = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const Y = (v: number) => H - pad.b - ((v - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);
  ctx.strokeStyle = '#2b2340';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, H - pad.b);
  ctx.lineTo(W - pad.r, H - pad.b);
  ctx.stroke();
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    s.pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
    ctx.stroke();
  }
  ctx.fillStyle = '#2b2340';
  ctx.font = '11px Silkscreen, monospace';
  ctx.fillText(xl, W - pad.r - ctx.measureText(xl).width, H - 6);
  ctx.fillText(yl, 4, 12);
  ctx.fillText(y1.toFixed(1), 2, pad.t + 10);
  ctx.fillText(x0.toFixed(0), pad.l, H - 6);
}

export function HangarTests(props: { design: Design; onClose: () => void }) {
  const { aero } = useMemo(() => analyzeDesign(props.design), [props.design]);
  const a = useRef<HTMLCanvasElement>(null);
  const b = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ld: [number, number][] = [];
    const cl: [number, number][] = [];
    const sink: [number, number][] = [];
    for (let al = -4; al <= 30; al += 0.5) {
      const c = coeffs({ ...aero }, al * DEG, 0, 0);
      cl.push([al, c.CL]);
      ld.push([al, c.CD > 0 ? Math.max(-2, c.CL / c.CD) : 0]);
      if (c.CL > 0.05 && al < (aero.alphaStall + aero.stallWidth) / DEG) {
        const v = glideSpeed(aero, c.CL, c.CD);
        sink.push([v, (v * c.CD) / Math.hypot(c.CL, c.CD)]);
      }
    }
    sink.sort((p, q) => p[0] - q[0]);
    if (a.current) drawChart(a.current, [{ color: '#3e8c78', pts: ld }, { color: '#d0533d', pts: cl.map(([x, y]) => [x, y * 5]) }], 'angle of attack °', 'L/D  (red: CL×5)');
    if (b.current) drawChart(b.current, [{ color: '#3e5a8e', pts: sink }], 'speed m/s', 'sink m/s');
  }, [aero]);
  return (
    <div class="hangar__tests card" data-ui>
      <div class="row">
        <span class="tape tape--green">Lab tests</span>
        <span class="grow" />
        <button class="btn btn--ghost btn--small" onClick={props.onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div class="hangar__charts">
        <canvas ref={a} class="hangar__chart" />
        <canvas ref={b} class="hangar__chart" />
      </div>
      <FriendlyStats aero={aero} details />
      <p class="small muted">
        Best glide {aero.perf.LDmax.toFixed(1)}:1 at {aero.perf.vBest.toFixed(1)} m/s · stall {aero.perf.vStall.toFixed(1)} m/s · min sink {aero.perf.sinkMin.toFixed(2)} m/s
      </p>
    </div>
  );
}
