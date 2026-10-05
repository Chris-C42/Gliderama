/**
 * The folding mat: the sheet seen from above on a cutting mat.
 *
 * Fold step: grab any corner (or edge point) and drag it to where it should land. The fold line is
 * the perpendicular bisector of grab → drop; drops snap to useful targets (the centre line at the
 * spot that makes the fold pass through another corner, other corners, the centre line). The
 * result is previewed live; release to commit. Planes are symmetric, so either half works.
 *
 * Wing / Shape / Extras steps: drag the wing-fold line, winglet line, elevator hinge, paperclips.
 */

import { useEffect, useRef } from 'preact/hooks';
import type { Design, FoldOp } from '../../paper/design';
import { sheetDims } from '../../paper/design';
import { applyFold, foldSequence, stateVertices, topFacetAt, type FlatState } from '../../paper/fold';
import { sideValue, type P2 } from '../../paper/geom';

export type MatStep = 'paper' | 'fold' | 'wing' | 'shape' | 'extras' | 'look';

export interface FoldMatProps {
  design: Design;
  step: MatStep;
  mountain: boolean;
  flapMode: boolean;
  /** Fold tool disabled (fold budget reached / locked). */
  canFold: boolean;
  onFold(op: FoldOp): void;
  onError(msg: string): void;
  onWing(d0: number, d1: number): void;
  onWinglet(x: number): void;
  onElevatorDepth(depth: number): void;
  onClips(clips: number[]): void;
}

interface View {
  scale: number;
  cx: number;
  top: number;
  W: number;
  L: number;
}

interface Drag {
  kind: 'fold' | 'wing0' | 'wing1' | 'winglet' | 'hinge' | 'clip';
  /** Grabbed point (half coords) and whether it was grabbed on the mirrored half. */
  v: P2;
  mirror: boolean;
  t: P2;
  idx?: number;
  pointerId: number;
}

const INK = '#2b2340';

function snapTargets(state: FlatState, v: P2): P2[] {
  const verts = stateVertices(state);
  const out: P2[] = [];
  for (const p of verts) {
    if (Math.hypot(p.x - v.x, p.y - v.y) < 0.5) continue;
    out.push(p);
    // fold through p bringing v onto the centre line (x = 0)
    const r2 = (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
    const dx2 = p.x * p.x;
    if (r2 > dx2) {
      const dy = Math.sqrt(r2 - dx2);
      out.push({ x: 0, y: p.y + dy }, { x: 0, y: p.y - dy });
    }
  }
  return out;
}

export function foldFromDrag(v: P2, t: P2, opts: { mountain: boolean; flap: boolean }): FoldOp | null {
  const dx = t.x - v.x;
  const dy = t.y - v.y;
  const len = Math.hypot(dx, dy);
  if (len < 3) return null;
  const m = { x: (v.x + t.x) / 2, y: (v.y + t.y) / 2 };
  const d = { x: -dy / len, y: dx / len };
  const a = { x: m.x - d.x * 400, y: m.y - d.y * 400 };
  const b = { x: m.x + d.x * 400, y: m.y + d.y * 400 };
  const side = sideValue(v, a, b) > 0 ? 1 : -1;
  // grab point nudged a hair towards the fold line so it lies inside the flap
  const g = { x: v.x + dx * 0.02, y: v.y + dy * 0.02 };
  return { a, b, side, mountain: opts.mountain, flap: opts.flap ? g : null };
}

export function FoldMat(props: FoldMatProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const viewRef = useRef<View | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const stateRef = useRef<FlatState | null>(null);
  const failedAtRef = useRef(-1);

  // Recompute the flat state when the design changes.
  const { width, length } = sheetDims(props.design);
  const seq = foldSequence(width, length, props.design.folds);
  stateRef.current = seq.state;
  failedAtRef.current = seq.failedAt;

  const draw = () => {
    const c = canvas.current;
    const b = box.current;
    if (!c || !b) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cw = b.clientWidth;
    const ch = b.clientHeight;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
      c.width = Math.round(cw * dpr);
      c.height = Math.round(ch * dpr);
      c.style.width = `${cw}px`;
      c.style.height = `${ch}px`;
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const p = propsRef.current;
    const { width: W, length: L } = sheetDims(p.design);
    const margin = 26;
    const scale = Math.min((cw - margin * 2) / W, (ch - margin * 2) / L);
    const view: View = { scale, cx: cw / 2, top: (ch - L * scale) / 2, W, L };
    viewRef.current = view;
    const S = (q: P2, mirror = false): [number, number] => [view.cx + (mirror ? -q.x : q.x) * scale, view.top + q.y * scale];

    let state = stateRef.current!;
    const d = drag.current;
    let preview: FlatState | null = null;
    let previewErr: string | null = null;
    let foldLine: [P2, P2] | null = null;
    if (d && d.kind === 'fold') {
      const op = foldFromDrag(d.v, d.t, { mountain: p.mountain, flap: p.flapMode });
      if (op) {
        foldLine = [op.a, op.b];
        const r = applyFold(state, op);
        if (r.ok) preview = r.state;
        else previewErr = r.reason;
      }
    }
    const shown = preview ?? state;

    // sheet outline ghost (unfolded sheet) for orientation
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(230, 245, 220, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(view.cx - (W / 2) * scale, view.top, W * scale, L * scale);
    ctx.setLineDash([]);

    // facets, both halves, by layer
    const facets = [...shown.facets].sort((a, b) => a.layer - b.layer);
    const maxLayer = Math.max(1, ...facets.map((f) => f.layer));
    const front = p.design.look.color;
    const backC = p.design.look.backColor;
    for (const mirror of [true, false]) {
      for (const f of facets) {
        ctx.beginPath();
        f.pts.forEach((q, i) => {
          const [x, y] = S(q, mirror);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = f.up ? front : backC;
        ctx.fill();
        // stacked layers read a touch lighter / shaded
        const shade = f.layer / maxLayer;
        ctx.fillStyle = `rgba(255,255,255,${0.08 * shade})`;
        ctx.fill();
        ctx.fillStyle = `rgba(43,35,64,${0.06 * (1 - shade)})`;
        ctx.fill();
        ctx.strokeStyle = 'rgba(43,35,64,0.55)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
    // centre crease
    ctx.strokeStyle = 'rgba(43,35,64,0.35)';
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(view.cx, view.top - 6);
    ctx.lineTo(view.cx, view.top + L * scale + 6);
    ctx.stroke();
    ctx.setLineDash([]);

    const dashLine = (a: P2, b: P2, color: string, mirrorToo = true) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      for (const m of mirrorToo ? [false, true] : [false]) {
        const [x0, y0] = S(a, m);
        const [x1, y1] = S(b, m);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };
    const handle = (q: P2, color: string, r = 7) => {
      for (const m of [false, true]) {
        const [x, y] = S(q, m);
        ctx.fillStyle = color;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.rect(x - r, y - r, r * 2, r * 2);
        ctx.fill();
        ctx.stroke();
      }
    };

    if (p.step === 'fold') {
      if (foldLine) {
        // clip the long fold line to the sheet area for display
        const a = foldLine[0];
        const b = foldLine[1];
        dashLine(a, b, previewErr ? '#e0533d' : '#f0d470');
      }
      if (!d) {
        // grabbable corners
        for (const v of stateVertices(state)) {
          for (const m of [false, true]) {
            const [x, y] = S(v, m);
            ctx.fillStyle = 'rgba(240, 212, 112, 0.95)';
            ctx.strokeStyle = INK;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(x, y, 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      } else {
        for (const t of snapTargets(state, d.v)) {
          if (t.y < -5 || t.y > L + 5 || t.x < -1) continue;
          const [x, y] = S(t, d.mirror);
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.stroke();
        }
        const [gx, gy] = S(d.v, d.mirror);
        const [tx, ty] = S(d.t, d.mirror);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.fillStyle = previewErr ? '#e0533d' : '#f0d470';
        ctx.beginPath();
        ctx.arc(tx, ty, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.stroke();
        if (previewErr) {
          ctx.font = '13px "Pixelify Sans", monospace';
          ctx.fillStyle = '#fff';
          ctx.fillText(previewErr, 10, 18);
        }
      }
    }

    // wing line & keel
    const des = p.design;
    const wing0: P2 = { x: des.wing.d0, y: 0 };
    const wing1: P2 = { x: des.wing.d1, y: L };
    if (p.step === 'wing' || p.step === 'shape' || p.step === 'extras') {
      // keel region tint
      for (const m of [false, true]) {
        ctx.beginPath();
        const pts = [{ x: 0, y: 0 }, wing0, wing1, { x: 0, y: L }];
        pts.forEach((q, i) => {
          const [x, y] = S(q, m);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(224, 83, 61, 0.18)';
        ctx.fill();
      }
      dashLine(wing0, wing1, '#e0533d');
      if (p.step === 'wing') {
        handle(wing0, '#f09a72');
        handle(wing1, '#f09a72');
      }
    }
    if (p.step === 'shape') {
      const wl = des.shape.winglet;
      if (wl) {
        dashLine({ x: wl.x, y: 0 }, { x: wl.x, y: L }, '#3d9be0');
        handle({ x: wl.x, y: L * 0.5 }, '#86a8d0');
      }
      const el = des.shape.elevator;
      if (el) {
        let yTE = 0;
        for (const f of state.facets) for (const q of f.pts) if (q.x > Math.min(des.wing.d0, des.wing.d1)) yTE = Math.max(yTE, q.y);
        const yh = yTE - el.depth;
        dashLine({ x: 0, y: yh }, { x: W / 2, y: yh }, '#41b36a');
        handle({ x: W / 4, y: yh }, '#96ceb0');
      }
    }
    if (p.step === 'extras') {
      for (const y of des.extras.clips) {
        const [x, yy] = S({ x: 0, y });
        ctx.strokeStyle = '#9ea6b8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(x - 5, yy - 10, 10, 22, 5);
        ctx.stroke();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    if (failedAtRef.current >= 0) {
      ctx.font = '13px "Pixelify Sans", monospace';
      ctx.fillStyle = '#ffb4a8';
      ctx.fillText(`Fold ${failedAtRef.current + 1} could not be made`, 10, ch - 10);
    }
  };

  useEffect(() => {
    draw();
  });

  useEffect(() => {
    const b = box.current!;
    const ro = new ResizeObserver(() => draw());
    ro.observe(b);
    return () => ro.disconnect();
  }, []);

  const toHalf = (e: PointerEvent): { p: P2; mirror: boolean } | null => {
    const v = viewRef.current;
    const c = canvas.current;
    if (!v || !c) return null;
    const r = c.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const x = (sx - v.cx) / v.scale;
    const y = (sy - v.top) / v.scale;
    return { p: { x: Math.abs(x), y }, mirror: x < 0 };
  };

  const onDown = (e: PointerEvent) => {
    const p = propsRef.current;
    const hit = toHalf(e);
    const v = viewRef.current;
    if (!hit || !v) return;
    const rad = 22 / v.scale; // mm
    const st = stateRef.current!;
    if (p.step === 'fold') {
      if (!p.canFold) {
        p.onError('No folds left for this design.');
        return;
      }
      let best: P2 | null = null;
      let bd = rad;
      for (const q of stateVertices(st)) {
        const dd = Math.hypot(q.x - hit.p.x, q.y - hit.p.y);
        if (dd < bd) {
          bd = dd;
          best = q;
        }
      }
      // otherwise grab the paper itself at the touch point (edge or interior)
      if (!best && topFacetAt(st, hit.p)) best = hit.p;
      if (!best) return;
      drag.current = { kind: 'fold', v: best, mirror: hit.mirror, t: best, pointerId: e.pointerId };
    } else if (p.step === 'wing') {
      const d0 = Math.hypot(p.design.wing.d0 - hit.p.x, hit.p.y);
      const d1 = Math.hypot(p.design.wing.d1 - hit.p.x, hit.p.y - v.L);
      if (Math.min(d0, d1) > rad * 1.6) {
        // tap elsewhere: move the nearer end
        if (hit.p.y < v.L / 2) drag.current = { kind: 'wing0', v: hit.p, mirror: hit.mirror, t: hit.p, pointerId: e.pointerId };
        else drag.current = { kind: 'wing1', v: hit.p, mirror: hit.mirror, t: hit.p, pointerId: e.pointerId };
      } else drag.current = { kind: d0 < d1 ? 'wing0' : 'wing1', v: hit.p, mirror: hit.mirror, t: hit.p, pointerId: e.pointerId };
    } else if (p.step === 'shape') {
      const wl = p.design.shape.winglet;
      const el = p.design.shape.elevator;
      let kind: Drag['kind'] | null = null;
      if (wl && Math.abs(hit.p.x - wl.x) < rad) kind = 'winglet';
      if (el) kind = kind ?? 'hinge';
      if (!kind) return;
      drag.current = { kind, v: hit.p, mirror: hit.mirror, t: hit.p, pointerId: e.pointerId };
    } else if (p.step === 'extras') {
      const clips = p.design.extras.clips;
      const near = clips.findIndex((y) => Math.abs(y - hit.p.y) < rad && hit.p.x < rad * 1.5);
      if (near >= 0) drag.current = { kind: 'clip', v: hit.p, mirror: false, t: hit.p, idx: near, pointerId: e.pointerId };
      else if (hit.p.x < rad * 2 && clips.length < 3) {
        p.onClips([...clips, Math.max(0, Math.min(v.L, hit.p.y))]);
        return;
      } else return;
    } else return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    draw();
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const hit = toHalf(e);
    const v = viewRef.current;
    if (!hit || !v) return;
    const p = propsRef.current;
    // keep the grab's half: mirror the pointer if it crossed over
    const raw = { x: d.mirror === hit.mirror ? hit.p.x : -hit.p.x, y: hit.p.y };
    if (d.kind === 'fold') {
      let t = raw;
      const snapR = 16 / v.scale;
      let best = snapR;
      for (const c of snapTargets(stateRef.current!, d.v)) {
        const dd = Math.hypot(c.x - raw.x, c.y - raw.y);
        if (dd < best) {
          best = dd;
          t = c;
        }
      }
      if (best === snapR && Math.abs(raw.x) < snapR) t = { x: 0, y: raw.y };
      d.t = t;
    } else if (d.kind === 'wing0' || d.kind === 'wing1') {
      const x = Math.max(0, Math.min(v.W / 2 - 10, Math.round(Math.abs(raw.x))));
      if (d.kind === 'wing0') p.onWing(x, p.design.wing.d1);
      else p.onWing(p.design.wing.d0, x);
    } else if (d.kind === 'winglet') {
      p.onWinglet(Math.round(Math.max(10, Math.min(v.W / 2 - 4, Math.abs(raw.x)))));
    } else if (d.kind === 'hinge') {
      let yTE = 0;
      for (const f of stateRef.current!.facets) for (const q of f.pts) yTE = Math.max(yTE, q.y);
      p.onElevatorDepth(Math.round(Math.max(4, Math.min(60, yTE - raw.y))));
    } else if (d.kind === 'clip' && d.idx !== undefined) {
      const clips = [...p.design.extras.clips];
      clips[d.idx] = Math.round(Math.max(0, Math.min(v.L, raw.y)));
      p.onClips(clips);
    }
    draw();
  };

  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    const p = propsRef.current;
    if (d.kind === 'fold') {
      const op = foldFromDrag(d.v, d.t, { mountain: p.mountain, flap: p.flapMode });
      if (op) {
        const r = applyFold(stateRef.current!, op);
        if (r.ok) p.onFold(op);
        else p.onError(r.reason);
      }
    } else if (d.kind === 'clip' && d.idx !== undefined) {
      // dragging a clip off the keel removes it
      const hit = toHalf(e);
      const v = viewRef.current;
      if (hit && v && hit.p.x > 40 / v.scale) p.onClips(p.design.extras.clips.filter((_, i) => i !== d.idx));
    }
    draw();
  };

  return (
    <div class="foldmat mat" ref={box}>
      <canvas
        ref={canvas}
        onPointerDown={(e) => onDown(e as unknown as PointerEvent)}
        onPointerMove={(e) => onMove(e as unknown as PointerEvent)}
        onPointerUp={(e) => onUp(e as unknown as PointerEvent)}
        onPointerCancel={() => {
          drag.current = null;
          draw();
        }}
      />
    </div>
  );
}
