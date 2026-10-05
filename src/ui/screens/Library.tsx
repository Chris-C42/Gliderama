import { useEffect, useRef, useState } from 'preact/hooks';
import { back, go } from '../../app/nav';
import { deleteDesign, duplicateDesign, saveDesign, setActiveDesign, isUnlocked } from '../../app/library';
import { getSave, saveRevision } from '../../core/storage';
import type { Design } from '../../paper/design';
import { sheetDims } from '../../paper/design';
import { foldSequence } from '../../paper/fold';
import { analyzeDesign } from '../../paper/aero';
import { RECIPES } from '../../paper/recipes';
import { decodeDesign } from '../../paper/codec';
import { Icon } from '../icons';
import { Modal } from '../components/Modal';
import { StatBar } from '../components/Stats';
import './library.css';

/** Tiny blueprint: the folded sheet seen from above. */
export function Blueprint(props: { design: Design; w?: number; h?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = props.w ?? 96;
  const h = props.h ?? 72;
  useEffect(() => {
    const c = ref.current!;
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const { width, length } = sheetDims(props.design);
    const st = foldSequence(width, length, props.design.folds).state;
    const s = Math.min((w - 8) / width, (h - 8) / length);
    const cx = w / 2;
    const top = (h - length * s) / 2;
    for (const mirror of [true, false])
      for (const f of [...st.facets].sort((a, b) => a.layer - b.layer)) {
        ctx.beginPath();
        f.pts.forEach((p, i) => {
          const x = cx + (mirror ? -p.x : p.x) * s;
          const y = top + p.y * s;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = f.up ? props.design.look.color : props.design.look.backColor;
        ctx.fill();
        ctx.strokeStyle = 'rgba(43,35,64,0.7)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
  }, [props.design]);
  return <canvas ref={ref} style={{ width: `${w}px`, height: `${h}px` }} class="blueprint" />;
}

export function Library() {
  saveRevision.value; // re-render on save changes
  const save = getSave();
  const [importing, setImporting] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);

  return (
    <div class="screen desk lib">
      <header class="lib__top safe">
        <button class="btn btn--icon" onClick={() => back()} aria-label="Back">
          <Icon name="back" />
        </button>
        <h1 class="lib__title">
          <span class="tape">My planes</span>
        </h1>
        <span class="grow" />
        <button class="btn btn--small" onClick={() => setImporting(true)}>
          <Icon name="copy" /> Import code
        </button>
        <button class="btn btn--primary" onClick={() => setFresh(true)}>
          <Icon name="plus" /> New plane
        </button>
      </header>
      <main class="lib__grid safe scroll">
        {save.designs.map((d) => {
          const a = analyzeDesign(d).aero;
          const active = d.id === save.activeDesignId;
          return (
            <div class={`lib__card card card--plain ${active ? 'is-active' : ''}`}>
              <div class="row">
                <Blueprint design={d} />
                <div class="col grow" style={{ gap: '0.1em' }}>
                  <span class="label">{d.name}</span>
                  <span class="small muted">
                    {d.folds.length} folds · {(a.mass * 1000).toFixed(1)} g
                  </span>
                  {active && <span class="tape tape--green small">Flying this</span>}
                </div>
              </div>
              <div class="lib__stats">
                <StatBar label="Glide" value={a.friendly.glide} color="var(--teal-l)" />
                <StatBar label="Speed" value={a.friendly.speed} color="var(--red)" />
                <StatBar label="Float" value={a.friendly.float} color="var(--sky)" />
              </div>
              <div class="row">
                <button class="btn btn--small btn--green" disabled={active} onClick={() => setActiveDesign(d.id)}>
                  <Icon name="plane" /> Fly
                </button>
                <button class="btn btn--small" onClick={() => go({ name: 'workshop', spec: { design: d, context: 'library' } })}>
                  <Icon name="fold" /> Edit
                </button>
                <button class="btn btn--small btn--icon" title="Duplicate" onClick={() => saveDesign(duplicateDesign(d))}>
                  <Icon name="copy" />
                </button>
                <button
                  class="btn btn--small btn--icon"
                  title="Delete"
                  disabled={save.designs.length <= 1}
                  onClick={() => {
                    if (confirm(`Recycle "${d.name}"?`)) deleteDesign(d.id);
                  }}
                >
                  <Icon name="trash" />
                </button>
              </div>
            </div>
          );
        })}
      </main>
      {fresh && (
        <Modal onClose={() => setFresh(false)}>
          <h2>Start a new plane</h2>
          <div class="ws__recipes">
            {RECIPES.map((r) => {
              const ok = isUnlocked('recipes', r.id);
              return (
                <button
                  class="ws__recipe card card--plain"
                  disabled={!ok}
                  onClick={() => {
                    const d = r.make();
                    setFresh(false);
                    go({ name: 'workshop', spec: { design: d, context: 'library' } });
                  }}
                >
                  <span class="label">
                    {!ok && <Icon name="lock" />} {r.name}
                  </span>
                  <span class="small muted">{ok ? r.blurb : 'Unlock it in the campaign.'}</span>
                </button>
              );
            })}
            <button
              class="ws__recipe card card--plain"
              onClick={() => {
                const d = RECIPES[0].make();
                d.folds = [];
                d.name = 'Blank sheet';
                d.recipe = null;
                d.shape.elevator = null;
                d.wing = { d0: 20, d1: 30 };
                setFresh(false);
                go({ name: 'workshop', spec: { design: d, context: 'library' } });
              }}
            >
              <span class="label">Blank sheet</span>
              <span class="small muted">Freestyle from scratch.</span>
            </button>
          </div>
        </Modal>
      )}
      {importing && (
        <Modal onClose={() => setImporting(false)}>
          <h2>Import a plane</h2>
          <p class="small">Paste a share code (it starts with GLD1-).</p>
          <textarea class="ws__code" rows={3} value={code} onInput={(e) => setCode((e.target as HTMLTextAreaElement).value)} />
          {err && <p class="small" style={{ color: 'var(--red-d)' }}>{err}</p>}
          <div class="row">
            <button
              class="btn btn--primary"
              onClick={() => {
                const d = decodeDesign(code.trim());
                if (!d) {
                  setErr("That code didn't unfold into a plane. Check it was copied completely.");
                  return;
                }
                saveDesign(d);
                setImporting(false);
                setCode('');
                setErr(null);
              }}
            >
              <Icon name="check" /> Import
            </button>
            <button class="btn btn--ghost" onClick={() => setImporting(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
