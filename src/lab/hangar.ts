/**
 * Hangar lab: runs the sandbox analysis engine on every recipe and draws what it finds with the
 * pixel-art chart renderer. Dev page only (hangar-lab.html).
 *
 *   ?recipe=glider   one plane only        ?recipe=demo   only the compare / ghost / test-room demos
 *   ?scale=2         integer zoom of the charts (nearest-neighbour)
 */

import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/silkscreen/latin-400.css';
import { analyzeDesign, type AeroModel } from '../paper/aero';
import { buildMesh, type PlaneMesh } from '../paper/build';
import { RECIPES } from '../paper/recipes';
import {
  CHART_COLORS as C,
  addPiece,
  compare,
  decodeGhost,
  drawLineChart,
  emptyRoom,
  glideTest,
  polar,
  recordGhost,
  reportCard,
  serializeRoom,
  simulateOpen,
  throwSweep,
  type LineChartSpec,
  type GlideTestResult,
  type ReportCard,
} from '../sandbox';

const q = new URLSearchParams(location.search);
const only = q.get('recipe');
const scale = Math.max(1, Math.round(Number(q.get('scale') ?? 1)));
const root = document.getElementById('root')!;

const CW = 320;
const CH = 220;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** A canvas at native size (CSS-scaled by an integer for inspection) with a chart drawn into it. */
function chart(spec: LineChartSpec, w = CW, h = CH): HTMLCanvasElement {
  const c = el('canvas');
  c.width = w;
  c.height = h;
  c.style.width = `${w * scale}px`;
  c.style.height = `${h * scale}px`;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  drawLineChart(ctx, { x: 0, y: 0, w, h }, spec);
  return c;
}

const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => v.toFixed(2);

function cardEl(rc: ReportCard): HTMLElement {
  const card = el('div', 'card report');
  card.style.width = `${CW * scale}px`;
  card.appendChild(el('h3', undefined, `Report card: ${rc.name}`));
  for (const l of rc.lines) {
    const row = el('div', `stat ${l.tone}`);
    row.appendChild(el('b', undefined, l.label));
    const bar = el('span', 'bar');
    for (let i = 0; i < 10; i++) bar.appendChild(el('i', i < Math.round(l.score) ? 'on' : ''));
    row.appendChild(bar);
    row.appendChild(el('span', 'remark', `${f1(l.score)}: ${l.remark}`));
    card.appendChild(row);
  }
  const m = rc.measured;
  if (m) {
    const meas = el('div', 'meas');
    const line = (a: string, b: string) => meas.appendChild(el('div', undefined, `<span>${a}</span><span>${b}</span>`));
    line(`Glide from ${f1(m.height)} m, power ${f2(m.power)}`, `${f1(m.distance)} m`);
    line('Time aloft', `${f1(m.timeAloft)} s real / ${f1(m.timeAloftSim)} s sim`);
    line('Sink rate', `${f2(m.avgSink)} m/s sim / ${f2(m.avgSink * 0.42)} per real s`);
    line('Glide ratio', `${f1(m.glideRatio)} : 1 (${f1(m.glideRatioEnergy)} by energy)`);
    line('Max height / stalls / damage', `${f2(m.maxHeight)} m / ${m.stallEvents} / ${m.finalDamage} %`);
    card.appendChild(meas);
  }
  for (const n of rc.notes) card.appendChild(el('div', `note ${n.tone}`, n.text));
  for (const w of rc.warnings) card.appendChild(el('div', 'note warn', `Engineer: ${w}`));
  return card;
}

interface Analysed {
  id: string;
  name: string;
  aero: AeroModel;
  mesh: PlaneMesh;
  glide: GlideTestResult;
  card: ReportCard;
}

function analyse(id: string): Analysed {
  const r = RECIPES.find((x) => x.id === id)!;
  const { build, aero } = analyzeDesign(r.make());
  const mesh = buildMesh(build, aero.cg);
  const glide = glideTest(aero, mesh);
  return { id, name: r.name, aero, mesh, glide, card: reportCard(aero, glide, r.name) };
}

function recipeCard(a: Analysed): HTMLElement {
  const { aero, glide } = a;
  const t0 = performance.now();
  const p = polar(aero);
  const t1 = performance.now();
  const sw = throwSweep(aero, a.mesh);
  const t2 = performance.now();
  const g2 = glideTest(aero, a.mesh);
  const t3 = performance.now();
  const box = el('section', 'recipe');
  const trim = aero.perf.trim;
  box.appendChild(
    el(
      'h2',
      undefined,
      `${a.name}<small>mass ${f2(aero.mass * 1000)} g · span ${f1(aero.span * 100)} cm · trim ${trim ? `α ${f1(p.trim!.alphaDeg)}° ${f2(trim.v)} m/s L/D ${f2(trim.LD)}` : 'none'} · glide ${f1(glide.distance)} m, ${f1(glide.timeAloft)} s, ${f2(glide.glideRatioEnergy)} vs trim L/D ${trim ? f2(trim.LD) : '-'}</small>`,
    ),
  );
  const cells = el('div', 'cells');
  cells.appendChild(cardEl(a.card));

  // Glide path.
  const x0 = glide.path[0].x;
  const touch = glide.path.reduce((best, pt) => (Math.abs(pt.t - glide.timeAloft) < Math.abs(best.t - glide.timeAloft) ? pt : best));
  cells.appendChild(
    chart({
      title: 'Glide path',
      xLabel: 'distance (m)',
      yLabel: `height (m), ${f1(glide.timeAloft)} s aloft`,
      series: [{ name: '', color: C.red, points: glide.path.filter((_, i) => i % 4 === 0).map((pt) => ({ x: Math.abs(pt.x - x0), y: pt.y })) }],
      markers: [
        { x: 0, y: glide.height, label: 'launch', color: C.navy },
        { x: Math.abs(touch.x - x0), y: touch.y, label: `${f1(glide.distance)} m`, color: C.mustard },
      ],
      yRange: [0, Math.max(2, Math.ceil(glide.maxHeight * 2) / 2)],
    }),
  );

  // Flight data over the glide: airspeed and sink rate against time.
  const air = glide.path.filter((pt) => pt.t <= glide.timeAloft);
  cells.appendChild(
    chart({
      title: 'Flight data',
      xLabel: 'time (s, real)',
      yLabel: 'm/s (sim)',
      series: [
        { name: 'speed', color: C.red, points: air.map((pt) => ({ x: pt.t, y: pt.V })), dots: false },
        { name: 'sink', color: C.navy, points: air.map((pt) => ({ x: pt.t, y: -pt.vy })), dots: false },
      ],
      markers: glide.predicted ? [{ x: 0, y: glide.predicted.V, label: 'trim speed', color: C.mustard }] : [],
      yRange: [-1, 5],
    }),
  );

  // Lift and drag.
  const pts = (ys: number[]) => p.alphaDeg.map((x, i) => ({ x, y: ys[i] }));
  cells.appendChild(
    chart({
      title: 'Lift and drag',
      xLabel: 'angle of attack (deg)',
      yLabel: 'coefficient',
      series: [
        { name: 'CL', color: C.red, points: pts(p.CL), dots: false },
        { name: 'CD', color: C.navy, points: pts(p.CD), dots: false },
      ],
      markers: [
        ...(p.trim ? [{ x: p.trim.alphaDeg, y: p.trim.CL, label: 'trim', color: C.mustard }] : []),
        { x: p.alphaStallDeg, y: p.CLmax, label: 'stall', color: C.teal },
      ],
      xRange: [-6, 40],
      yRange: [-0.4, 1.2],
    }),
  );

  // Glide ratio.
  cells.appendChild(
    chart({
      title: 'Glide ratio',
      xLabel: 'angle of attack (deg)',
      yLabel: 'lift / drag',
      series: [{ name: '', color: C.teal, points: pts(p.LD).map((pt) => ({ x: pt.x, y: Math.max(-1, pt.y) })), dots: false }],
      markers: [
        { x: p.bestLD.alphaDeg, y: p.bestLD.LD, label: `best ${f1(p.bestLD.LD)}`, color: C.red },
        ...(p.trim ? [{ x: p.trim.alphaDeg, y: p.trim.LD, label: 'trim', color: C.mustard }] : []),
      ],
      xRange: [-6, 40],
      yRange: [-1, Math.max(6, Math.ceil(p.bestLD.LD + 1))],
    }),
  );

  // Pitching moment.
  cells.appendChild(
    chart({
      title: 'Pitching moment',
      xLabel: 'angle of attack (deg)',
      yLabel: 'Cm (nose up is positive)',
      series: [
        { name: '', color: C.mustard, points: pts(p.Cm), dots: false },
        { name: '', color: C.ink, points: [{ x: -6, y: 0 }, { x: 40, y: 0 }], dots: false },
      ],
      markers: p.trim ? [{ x: p.trim.alphaDeg, y: 0, label: 'trim', color: C.red }] : [],
      xRange: [-6, 40],
      yRange: [-0.3, 0.3],
    }),
  );

  // Speed polar.
  cells.appendChild(
    chart({
      title: 'Speed polar',
      xLabel: 'airspeed (m/s)',
      yLabel: 'sink rate (m/s)',
      series: [{ name: '', color: C.red, points: p.glide.V.map((v, i) => ({ x: v, y: p.glide.sink[i] })), dots: false }],
      markers: [
        { x: p.minSink.V, y: p.minSink.sink, label: 'min sink', color: C.navy },
        { x: p.bestLD.V, y: p.bestLD.sink, label: 'best L/D', color: C.teal },
        ...(p.trim ? [{ x: p.trim.V, y: p.trim.sink, label: 'trim', color: C.mustard }] : []),
      ],
      xRange: [1.5, 6],
      yRange: [0, 1.5],
    }),
  );

  // Throw sweeps.
  cells.appendChild(
    chart({
      title: 'Throw power',
      xLabel: `power at ${f1(sw.best.angleDeg)} deg`,
      yLabel: 'distance (m)',
      series: [{ name: '', color: C.navy, points: sw.byPower.map((s) => ({ x: s.power, y: s.distance })) }],
      markers: [
        { x: sw.best.power, y: sw.best.distance, label: `best ${f1(sw.best.distance)} m`, color: C.red },
        { x: sw.ideal.power, y: sw.ideal.distance, label: 'ideal', color: C.mustard },
      ],
      xRange: [0, 1],
      yRange: [0, Math.max(10, Math.ceil(sw.best.distance / 5) * 5)],
    }),
  );
  cells.appendChild(
    chart({
      title: 'Throw angle',
      xLabel: `angle (deg) at power ${f2(sw.best.power)}`,
      yLabel: 'distance (m)',
      series: [{ name: '', color: C.teal, points: sw.byAngle.map((s) => ({ x: s.angleDeg, y: s.distance })) }],
      markers: [{ x: sw.best.angleDeg, y: sw.best.distance, label: `best ${f1(sw.best.distance)} m`, color: C.red }],
      xRange: [-20, 40],
      yRange: [0, Math.max(10, Math.ceil(sw.best.distance / 5) * 5)],
    }),
  );
  // The polar's numbers, and what it all costs to compute.
  const nums = el('div', 'card');
  nums.style.width = `${CW * scale}px`;
  nums.style.minHeight = `${CH * scale}px`;
  nums.appendChild(el('h3', undefined, 'Polar numbers'));
  const row = (a: string, b: string) => nums.appendChild(el('div', 'row', `<span>${a}</span><span>${b}</span>`));
  row('as flown', 'α / CL / speed');
  row('best L/D', `${f2(p.bestLD.LD)} @ ${f1(p.bestLD.alphaDeg)}° / ${f2(p.bestLD.CL)} / ${f2(p.bestLD.V)}`);
  row('min sink', `${f2(p.minSink.sink)} @ ${f1(p.minSink.alphaDeg)}° / ${f2(p.minSink.CL)} / ${f2(p.minSink.V)}`);
  row('stall', `${f1(p.alphaStallDeg)}° / ${f2(p.CLmax)} / ${f2(p.vStall)}`);
  row('hands-off trim', p.trim ? `${f1(p.trim.alphaDeg)}° / ${f2(p.trim.CL)} / ${f2(p.trim.V)}` : 'none: dives');
  row('trim L/D, sink', p.trim ? `${f2(p.trim.LD)}, ${f2(p.trim.sink)} m/s` : '-');
  row('flaps flat (aero.perf)', 'L/D, sink, vStall');
  row('', `${f2(p.potential.LDmax)}, ${f2(p.potential.sinkMin)}, ${f2(p.potential.vStall)}`);
  row('throw sweep best', `${f1(sw.best.distance)} m at power ${f2(sw.best.power)}, ${f1(sw.best.angleDeg)}°`);
  row('game ideal throw', `${f1(sw.ideal.distance)} m at power ${f2(sw.ideal.power)}`);
  row('cost: polar / sweep / glide', `${(t1 - t0).toFixed(1)} / ${(t2 - t1).toFixed(0)} / ${(t3 - t2).toFixed(1)} ms`);
  row('glide repeats exactly', g2.distance === glide.distance && g2.timeAloft === glide.timeAloft ? 'yes' : 'NO');
  cells.appendChild(nums);
  box.appendChild(cells);
  return box;
}

function compareDemo(a: Analysed, b: Analysed): HTMLElement {
  const box = el('section', 'recipe');
  box.appendChild(el('h2', undefined, `Compare<small>${a.name} (A) against ${b.name} (B)</small>`));
  const cells = el('div', 'cells');
  const path = (g: GlideTestResult) => g.path.filter((_, i) => i % 4 === 0).map((pt) => ({ x: pt.x, y: pt.y }));
  cells.appendChild(
    chart({
      title: 'Glide paths',
      xLabel: 'distance (m)',
      yLabel: 'height (m)',
      series: [
        { name: a.name, color: C.red, points: path(a.glide), dots: false },
        { name: b.name, color: C.navy, points: path(b.glide), dots: false },
      ],
      yRange: [0, 2],
    }),
  );
  const cmp = compare(a.card, b.card);
  const card = el('div', 'card');
  card.style.gridColumn = 'span 2';
  card.style.width = `${(CW * 2 + 8) * scale}px`;
  card.appendChild(el('h3', undefined, 'Side by side'));
  const table = el('table', 'cmp');
  table.innerHTML = `<tr><th></th><th class="n">A: ${a.name}</th><th class="n">B: ${b.name}</th><th class="n">B - A</th></tr>`;
  for (const r of cmp.rows) {
    const tr = el('tr', r.better === 'tie' ? '' : r.better);
    tr.innerHTML = `<td>${r.label}</td><td class="n A">${f2(r.a)}</td><td class="n B">${f2(r.b)}</td><td class="n">${r.delta >= 0 ? '+' : ''}${f2(r.delta)} ${r.unit}</td>`;
    table.appendChild(tr);
  }
  card.appendChild(table);
  cells.appendChild(card);
  const sum = el('div', 'card');
  sum.style.width = `${CW * scale}px`;
  sum.appendChild(el('h3', undefined, 'In words'));
  for (const s of cmp.summary) sum.appendChild(el('div', 'note good', s));
  cells.appendChild(sum);
  box.appendChild(cells);
  return box;
}

function roomDemo(a: Analysed): HTMLElement {
  const box = el('section', 'recipe');
  let room = emptyRoom('Vent, hoop, target');
  room = addPiece(room, 'floorVent', 2.4, 0);
  room = addPiece(room, 'hoop', 4.6, 0.65, { h: 0.9 });
  room = addPiece(room, 'candle', 9.0, 0, { h: 0.18 });
  room = addPiece(room, 'target', 9.8, 0, { w: 1.2 });
  room = { ...room, launch: { x: 0, y: 1.0, angle: 0.05 } };
  const start = { x: room.launch.x, y: room.launch.y, angle: room.launch.angle, power: 0.5 };
  const inRoom = simulateOpen(a.aero, a.mesh, start, undefined, { room });
  const empty = simulateOpen(a.aero, a.mesh, start);
  const score = inRoom.roomScore!;
  const ghost = recordGhost(empty.path, { designId: 'demo', designName: a.name, color: C.navy, createdAt: 1 });
  const replay = decodeGhost(ghost);
  box.appendChild(
    el(
      'h2',
      undefined,
      `Test room<small>${a.name} through a floor vent, a hoop and a candle · flew ${f1(inRoom.distance)} m, peak ${f2(inRoom.maxHeight)} m · hoops ${score.hoops.passed}/${score.hoops.total}, targets ${score.targets.hit}/${score.targets.total}, damage ${inRoom.finalDamage} % · ghost ${JSON.stringify(ghost).length} bytes for ${f1(ghost.duration)} s (${ghost.n} samples) · room JSON ${serializeRoom(room).length} bytes</small>`,
    ),
  );
  const cells = el('div', 'wide');
  const markers = room.pieces.map((p) => ({
    x: p.x + p.w / 2,
    y: p.kind === 'hoop' ? p.y + p.h / 2 : p.kind === 'candle' ? p.y + p.h + 0.1 : 0.04,
    label: p.kind,
    color: p.kind === 'candle' ? C.red : p.kind === 'hoop' ? C.teal : p.kind === 'target' ? C.mustard : C.navy,
  }));
  cells.appendChild(
    chart(
      {
        title: 'In the room',
        xLabel: 'distance (m)',
        yLabel: 'height (m)',
        series: [
          { name: 'room', color: C.red, points: inRoom.path.filter((_, i) => i % 4 === 0).map((pt) => ({ x: pt.x, y: pt.y })), dots: false },
          { name: 'ghost', color: C.navy, points: replay.map((pt) => ({ x: pt.x, y: pt.y })).filter((_, i) => i % 2 === 0), dots: false },
        ],
        markers,
        yRange: [0, 3],
      },
      CW * 2,
      CH,
    ),
  );
  box.appendChild(cells);
  return box;
}

async function main(): Promise<void> {
  try {
    await Promise.race([
      Promise.all([document.fonts.load('16px "Pixelify Sans"'), document.fonts.load('12px "Silkscreen"')]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch {
    /* fonts are optional */
  }
  const ids = only && only !== 'demo' ? [only] : RECIPES.map((r) => r.id);
  const results: Analysed[] = [];
  if (only !== 'demo') {
    for (const id of ids) {
      const a = analyse(id);
      results.push(a);
      root.appendChild(recipeCard(a));
    }
  }
  if (!only || only === 'demo') {
    const glider = results.find((a) => a.id === 'glider') ?? analyse('glider');
    const dart = results.find((a) => a.id === 'dart') ?? analyse('dart');
    root.appendChild(compareDemo(glider, dart));
    root.appendChild(roomDemo(glider));
  }
  (window as unknown as { __ready: boolean }).__ready = true;
}

void main();
