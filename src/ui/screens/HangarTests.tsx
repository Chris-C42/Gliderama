import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Design } from '../../paper/design';
import { analyzeDesign } from '../../paper/aero';
import { buildMesh } from '../../paper/build';
import { listDesigns } from '../../app/library';
import { RECIPES } from '../../paper/recipes';
import { compare, glideTest, polar, reportCard, throwSweep, type ReportCard, type ThrowSweep, type Tone } from '../../sandbox/tests';
import { CHART_COLORS, drawLineChart, type LineChartSpec } from '../../sandbox/charts';
import { Icon } from '../icons';
import { StatBar } from '../components/Stats';

type Tab = 'report' | 'polar' | 'throws' | 'compare';

const TONE: Record<Tone, string> = { good: 'var(--teal)', ok: 'var(--mustard)', poor: 'var(--red)' };
const NOTE_ICON = { good: 'check', warn: 'info', bad: 'close' } as const;

/** A pixel chart sized to its box (drawn at CSS-pixel resolution, scaled up crisp). */
function Chart(props: { spec: LineChartSpec; h?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => {
      const w = Math.max(160, Math.floor(c.clientWidth));
      const h = props.h ?? 150;
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      drawLineChart(ctx, { x: 0, y: 0, w, h }, props.spec);
    };
    draw();
    // fonts may arrive after the first paint
    void document.fonts?.ready.then(draw);
  }, [props.spec, props.h]);
  return <canvas ref={ref} class="hangar__chart pixelated" style={{ height: `${props.h ?? 150}px` }} />;
}

function analyse(d: Design) {
  const { build, aero } = analyzeDesign(d);
  return { aero, mesh: buildMesh(build, aero.cg) };
}

export function HangarTests(props: { design: Design; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('report');
  const { aero, mesh } = useMemo(() => analyse(props.design), [props.design]);
  const glide = useMemo(() => glideTest(aero, mesh, { height: 2 }), [aero, mesh]);
  const card = useMemo(() => reportCard(aero, glide, props.design.name), [aero, glide, props.design.name]);

  return (
    <div class="hangar__tests card" data-ui>
      <div class="row">
        <span class="tape tape--green">Lab tests</span>
        <span class="grow" />
        <button class="btn btn--ghost btn--small" onClick={props.onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      <div class="hangar__tabs" role="tablist">
        {(
          [
            ['report', 'Report'],
            ['polar', 'Polar'],
            ['throws', 'Throws'],
            ['compare', 'Compare'],
          ] as const
        ).map(([id, label]) => (
          <button role="tab" aria-selected={tab === id} class={`btn btn--small ${tab === id ? 'is-on' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'report' && <Report card={card} />}
      {tab === 'polar' && <PolarTab aero={aero} />}
      {tab === 'throws' && <ThrowsTab aero={aero} mesh={mesh} />}
      {tab === 'compare' && <CompareTab design={props.design} card={card} />}
    </div>
  );
}

function Report(props: { card: ReportCard }) {
  const { card } = props;
  const m = card.measured;
  return (
    <div class="lab__report">
      {m && (
        <p class="small">
          <b>Glide test:</b> thrown level from {m.height} m, it flew <b>{m.distance.toFixed(1)} m</b> in {m.timeAloft.toFixed(1)} s (glide{' '}
          {m.glideRatioEnergy.toFixed(1)}:1{m.stallEvents ? `, ${m.stallEvents} stall${m.stallEvents > 1 ? 's' : ''}` : ''}).
        </p>
      )}
      <div class="hangar__lines">
        {card.lines.map((l) => (
          <div class="hangar__line">
            <StatBar label={l.label} value={l.score} color={TONE[l.tone]} />
            <span class="small muted">{l.remark}</span>
          </div>
        ))}
      </div>
      {card.notes.length > 0 && (
        <ul class="hangar__notes">
          {card.notes.map((n) => (
            <li class={`is-${n.tone}`}>
              <Icon name={NOTE_ICON[n.tone]} /> {n.text}
            </li>
          ))}
        </ul>
      )}
      <p class="small muted">
        {card.facts.massG.toFixed(1)} g · span {card.facts.spanCm.toFixed(0)} cm · wing loading {card.facts.wingLoading.toFixed(1)} N/m² · stall {card.facts.stallSpeed.toFixed(1)} m/s
      </p>
    </div>
  );
}

function PolarTab(props: { aero: ReturnType<typeof analyzeDesign>['aero'] }) {
  const p = useMemo(() => polar(props.aero), [props.aero]);
  const lift: LineChartSpec = useMemo(() => {
    const pts = (ys: number[], k = 1) => p.alphaDeg.map((a, i) => ({ x: a, y: ys[i] * k }));
    const markers: { x: number; y: number; label: string; color: string }[] = [
      { x: p.bestLD.alphaDeg, y: p.bestLD.LD, label: 'best glide', color: CHART_COLORS.teal },
      { x: p.alphaStallDeg, y: p.CLmax * 10, label: 'stall', color: CHART_COLORS.red },
    ];
    if (p.trim) markers.push({ x: p.trim.alphaDeg, y: p.trim.LD, label: 'trim', color: CHART_COLORS.ink });
    return {
      title: 'Lift and glide ratio',
      xLabel: 'angle of attack °',
      series: [
        { name: 'L/D', color: CHART_COLORS.teal, points: pts(p.LD) },
        { name: 'CL ×10', color: CHART_COLORS.red, points: pts(p.CL, 10) },
      ],
      markers,
      xRange: [-6, 40],
    };
  }, [p]);
  const speed: LineChartSpec = useMemo(
    () => ({
      title: 'Speed polar',
      xLabel: 'airspeed m/s',
      yLabel: 'sink m/s',
      series: [{ name: 'sink', color: CHART_COLORS.navy, points: p.glide.V.map((v, i) => ({ x: v, y: p.glide.sink[i] })).sort((a, b) => a.x - b.x) }],
      markers: [
        { x: p.bestLD.V, y: p.bestLD.sink, label: 'best glide', color: CHART_COLORS.teal },
        { x: p.minSink.V, y: p.minSink.sink, label: 'min sink', color: CHART_COLORS.mustard },
      ],
    }),
    [p],
  );
  return (
    <div class="hangar__charts">
      <Chart spec={lift} />
      <Chart spec={speed} />
      <p class="small muted">
        As folded: best glide {p.bestLD.LD.toFixed(1)}:1 at {p.bestLD.V.toFixed(1)} m/s, slowest sink {p.minSink.sink.toFixed(2)} m/s
        {p.trim ? `, hands-off it settles at ${p.trim.V.toFixed(1)} m/s (${p.trim.LD.toFixed(1)}:1)` : ', and hands-off it has no steady glide'}. With flat
        elevators it could reach {p.potential.LDmax.toFixed(1)}:1.
      </p>
    </div>
  );
}

function ThrowsTab(props: { aero: ReturnType<typeof analyzeDesign>['aero']; mesh: ReturnType<typeof buildMesh> }) {
  const [sweep, setSweep] = useState<ThrowSweep | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSweep(null), [props.aero]);
  const run = () => {
    setBusy(true);
    // let the button repaint before the ~0.2 s of number crunching
    setTimeout(() => {
      setSweep(throwSweep(props.aero, props.mesh, { height: 2 }));
      setBusy(false);
    }, 30);
  };
  if (!sweep)
    return (
      <div class="hangar__charts">
        <p class="small">Throws the plane about a hundred times from 2 m, at every power and angle, to find its best throw.</p>
        <button class="btn btn--primary" disabled={busy} onClick={run}>
          <Icon name="chart" /> {busy ? 'Throwing…' : 'Run throw sweep'}
        </button>
      </div>
    );
  const s = sweep;
  const byPower: LineChartSpec = {
    title: `Distance by power (at ${s.best.angleDeg.toFixed(0)}°)`,
    xLabel: 'power',
    yLabel: 'm',
    series: [{ name: 'distance', color: CHART_COLORS.red, points: s.byPower.map((q) => ({ x: q.power, y: q.distance })) }],
    markers: [{ x: s.ideal.power, y: s.ideal.distance, label: 'suggested', color: CHART_COLORS.ink }],
    xRange: [0, 1],
  };
  const byAngle: LineChartSpec = {
    title: `Distance by angle (at power ${s.best.power.toFixed(2)})`,
    xLabel: 'throw angle °',
    yLabel: 'm',
    series: [{ name: 'distance', color: CHART_COLORS.navy, points: s.byAngle.map((q) => ({ x: q.angleDeg, y: q.distance })) }],
    markers: [{ x: s.best.angleDeg, y: s.best.distance, label: 'best', color: CHART_COLORS.teal }],
  };
  return (
    <div class="hangar__charts">
      <Chart spec={byPower} />
      <Chart spec={byAngle} />
      <p class="small">
        Best throw: power {s.best.power.toFixed(2)} at {s.best.angleDeg.toFixed(0)}° for <b>{s.best.distance.toFixed(1)} m</b>
        {s.best.finalDamage > 5 ? ` (but it lands hard: ${s.best.finalDamage}% damage)` : ''}. The suggested gentle throw goes {s.ideal.distance.toFixed(1)} m.
      </p>
    </div>
  );
}

function CompareTab(props: { design: Design; card: ReportCard }) {
  const others = useMemo(() => {
    const mine = listDesigns().filter((d) => d.id !== props.design.id);
    const blueprints = RECIPES.map((r) => {
      const d = r.make();
      return { ...d, id: `recipe:${r.id}`, name: `${d.name} (blueprint)` };
    });
    return [...mine, ...blueprints];
  }, [props.design.id]);
  const [otherId, setOtherId] = useState<string>(others[0]?.id ?? '');
  const other = others.find((d) => d.id === otherId);
  const cmp = useMemo(() => {
    if (!other) return null;
    const { aero, mesh } = analyse(other);
    return compare(reportCard(aero, glideTest(aero, mesh, { height: 2 }), other.name), props.card);
  }, [other, props.card]);
  return (
    <div class="hangar__compare">
      <label class="small">
        Compare with{' '}
        <select value={otherId} onChange={(e) => setOtherId((e.target as HTMLSelectElement).value)}>
          {others.map((d) => (
            <option value={d.id}>{d.name}</option>
          ))}
        </select>
      </label>
      {cmp && (
        <>
          <table class="hangar__table small">
            <thead>
              <tr>
                <th />
                <th>{cmp.a}</th>
                <th>{cmp.b}</th>
              </tr>
            </thead>
            <tbody>
              {cmp.rows.map((r) => (
                <tr>
                  <td class="label">{r.label}</td>
                  <td class={r.better === 'a' ? 'is-better' : ''}>
                    {fmt(r.a)}
                    {r.unit}
                  </td>
                  <td class={r.better === 'b' ? 'is-better' : ''}>
                    {fmt(r.b)}
                    {r.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul class="hangar__notes">
            {cmp.summary.map((t) => (
              <li>{t}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
