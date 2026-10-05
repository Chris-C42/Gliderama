import { useState } from 'preact/hooks';
import { back, go } from '../../app/nav';
import { updateSave, getSave } from '../../core/storage';
import { draftOffers, floorScore, loadRun, newRun, saveRun, workshopLimits, type Offer, type RunState } from '../../modes/trail';
import { generateFloorLevel, themeFor } from '../../modes/levelgen';
import { cloneDesign } from '../../paper/design';
import { Icon } from '../icons';
import { Blueprint } from './Library';
import './trail.css';

type View = 'hub' | 'draft' | 'over';

/** Module-level so the play screen's onEnd can hand results back. */
let pending: { view: View; run: RunState } | null = null;

function playFloor(run: RunState): void {
  // every other floor has a workbench room part-way: land on the desk to patch up or refold
  const level = generateFloorLevel({ seed: run.seed + run.floor * 7919, floor: run.floor, theme: themeFor(run.floor), workbenchRoom: run.floor % 2 === 1 });
  const bonus = run.sheets - level.sheets + (run.perks.includes('lucky') ? 1 : 0);
  go({
    name: 'play',
    play: {
      mode: 'trail',
      level,
      design: cloneDesign(run.design),
      bonusSheets: bonus,
      airMul: run.airMul,
      benchLimits: workshopLimits(run),
      onEnd: (r, won) => {
        if (won) {
          run.stars += r.stars;
          run.score += floorScore(r.stars, r.time, level.par, r.damage, run.floor);
          run.log.push({ floor: run.floor, stars: r.stars, time: r.time, damage: r.damage });
          run.sheets = Math.max(1, level.sheets + bonus - r.sheetsUsed);
          run.floor += 1;
          saveRun(run);
          pending = { view: 'draft', run };
        } else {
          run.over = true;
          saveRun(null);
          updateSave((s) => {
            const t = s.progress.roguelike;
            t.runs += 1;
            t.totalStars += run.stars;
            t.bestScore = Math.max(t.bestScore, run.score);
            t.bestFloor = Math.max(t.bestFloor, run.floor);
          });
          pending = { view: 'over', run };
        }
        go({ name: 'trail' }, { replace: true });
      },
    },
  });
}

export function Trail() {
  const [run, setRun] = useState<RunState | null>(() => pending?.run ?? loadRun());
  const [view, setView] = useState<View>(() => pending?.view ?? 'hub');
  pending = null;
  const [offers] = useState<Offer[]>(() => (run && view === 'draft' ? draftOffers(run) : []));
  const best = getSave().progress.roguelike;

  const start = () => {
    const r = newRun();
    saveRun(r);
    setRun(r);
    setView('hub');
  };

  const refold = (r: RunState) => {
    go({
      name: 'workshop',
      spec: {
        design: r.design,
        context: 'trail',
        limits: workshopLimits(r),
        onDone: (d) => {
          if (d) {
            r.design = d;
            saveRun(r);
          }
          pending = { view: 'hub', run: r };
          go({ name: 'trail' }, { replace: true });
        },
      },
    });
  };

  return (
    <div class="screen desk trail safe scroll">
      <header class="row">
        <button class="btn btn--icon" onClick={() => back()} aria-label="Back">
          <Icon name="back" />
        </button>
        <h1 class="trail__title">
          <span class="tape">Paper Trail</span>
        </h1>
        <span class="grow" />
        <span class="chip">
          <Icon name="trophy" /> best {best.bestScore} · floor {best.bestFloor}
        </span>
      </header>

      {!run && view !== 'over' && (
        <div class="trail__intro card">
          <h2>An endless house</h2>
          <p>
            Start with a plain printer sheet and a few basic folds. Clear each floor of procedurally built rooms, then pick <b>one of three</b> offers — new
            folds, paper, add-ons, perks — and refold your plane at the workbench. How far can you get?
          </p>
          <button class="btn btn--primary btn--big" onClick={start}>
            <Icon name="play" /> New run
          </button>
        </div>
      )}

      {run && view === 'hub' && (
        <div class="trail__hub">
          <div class="card trail__status">
            <h2>Floor {run.floor + 1}</h2>
            <div class="row">
              <span class="chip">
                <Icon name="sheet" /> {run.sheets} sheets
              </span>
              <span class="chip">
                <Icon name="star" /> {run.stars}
              </span>
              <span class="chip">
                <Icon name="trophy" /> {run.score}
              </span>
            </div>
            <p class="small muted">Theme: {themeFor(run.floor) === 'home' ? 'Home' : "Grandma's Cottage"} · perks: {run.perks.join(', ') || 'none'}</p>
            <div class="row">
              <button class="btn btn--primary btn--big" onClick={() => playFloor(run)}>
                <Icon name="play" /> Fly floor {run.floor + 1}
              </button>
              <button class="btn" onClick={() => refold(run)}>
                <Icon name="fold" /> Workbench
              </button>
            </div>
          </div>
          <div class="card card--plain trail__kit">
            <span class="label">Your kit</span>
            <div class="row">
              <Blueprint design={run.design} w={110} h={80} />
              <div class="col small" style={{ gap: '0.2em' }}>
                <span>
                  <b>{run.design.name}</b>
                </span>
                <span>Folds: {run.tools.join(', ')}</span>
                <span>Paper: {run.papers.join(', ')}</span>
                <span>Gadgets: {run.gadgets.join(', ') || '—'}</span>
                <span>Clips: up to {run.maxClips}</span>
              </div>
            </div>
          </div>
          <button
            class="btn btn--small btn--red"
            onClick={() => {
              if (!confirm('Abandon this run?')) return;
              saveRun(null);
              setRun(null);
            }}
          >
            Abandon run
          </button>
        </div>
      )}

      {run && view === 'draft' && (
        <div class="trail__draft">
          <h2 class="trail__draft-title">
            <span class="tape tape--green">Floor cleared!</span> Pick one
          </h2>
          <div class="trail__offers">
            {offers.map((o, i) => (
              <button
                class="trail__offer card"
                style={{ '--rot': `${(i - 1) * 2}deg` }}
                onClick={() => {
                  o.apply(run);
                  saveRun(run);
                  setView('hub');
                }}
              >
                <span class="trail__offer-kind label">{o.kind}</span>
                <span class="trail__offer-icon">
                  <Icon name={o.icon} />
                </span>
                <span class="trail__offer-title">{o.title}</span>
                <span class="small">{o.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'over' && run && (
        <div class="card trail__over">
          <h2>Out of paper</h2>
          <p>
            You cleared <b>{run.floor}</b> floor{run.floor === 1 ? '' : 's'}, collected <b>{run.stars}</b> stars and scored <b>{run.score}</b>.
          </p>
          <button class="btn btn--primary btn--big" onClick={start}>
            <Icon name="refresh" /> New run
          </button>
        </div>
      )}
    </div>
  );
}
