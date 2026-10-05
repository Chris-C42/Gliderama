import { useMemo, useState } from 'preact/hooks';
import { back, go } from '../../app/nav';
import { activeDesign } from '../../app/library';
import { getSave, saveRevision, updateSave } from '../../core/storage';
import { shareOrCopy } from '../../core/share';
import { applyTwist, dailyLimits, dailyScore, designFitsDaily, shareCard, today } from '../../modes/daily';
import type { Design } from '../../paper/design';
import { Icon } from '../icons';
import { Blueprint } from './Library';

let dailyDesign: Design | null = null;

export function Daily() {
  saveRevision.value;
  const info = useMemo(() => today(), []);
  const save = getSave();
  const result = save.progress.daily[info.key];
  const [msg, setMsg] = useState<string | null>(null);
  const design = applyTwist(info, dailyDesign ?? activeDesign());
  const url = `${location.origin}${import.meta.env.BASE_URL}`;

  const fly = (official: boolean) => {
    const problem = designFitsDaily(info, design);
    if (problem) {
      setMsg(problem);
      return;
    }
    go({
      name: 'play',
      play: {
        mode: 'daily',
        level: info.level,
        design,
        airMul: info.airMul,
        meta: { official },
        onEnd: (r, won) => {
          if (official) {
            const score = dailyScore(r, won);
            updateSave((s) => {
              s.progress.daily[info.key] = {
                score,
                roomsCleared: r.roomLog.filter((x) => x !== 'crash').length,
                roomsTotal: Object.keys(info.level.rooms).length,
                stars: r.stars,
                starsTotal: r.starsTotal,
                timeSec: r.time,
                damagePct: r.damage,
                roomResults: r.roomLog,
                practiceRuns: s.progress.daily[info.key]?.practiceRuns ?? 0,
                official: true,
              };
            });
          } else {
            updateSave((s) => {
              const d = s.progress.daily[info.key];
              if (d) d.practiceRuns += 1;
            });
          }
          go({ name: 'daily' }, { replace: true });
        },
      },
    });
  };

  return (
    <div class="screen desk safe scroll" style={{ display: 'flex', flexDirection: 'column', gap: '0.8em' }}>
      <header class="row">
        <button class="btn btn--icon" onClick={() => back()} aria-label="Back">
          <Icon name="back" />
        </button>
        <h1 style={{ margin: 0, fontSize: '1.2em' }}>
          <span class="tape">Daily Flight #{info.number}</span>
        </h1>
        <span class="grow" />
        <span class="chip">{info.key}</span>
      </header>
      <div class="row" style={{ alignItems: 'stretch', gap: '0.9em' }}>
        <div class="card" style={{ flex: '1 1 18em', maxWidth: '30em' }}>
          <span class="tape tape--blue">Today's twist</span>
          <h2 style={{ margin: '0.4em 0 0.2em' }}>{info.twistName}</h2>
          <p>{info.twistText}</p>
          <p class="small muted">
            Everyone gets the same house today: {Object.keys(info.level.rooms).length} rooms. Your first flight counts — practise as much as you like after.
          </p>
          {msg && <p class="small" style={{ color: 'var(--red-d)' }}>{msg}</p>}
          <div class="row">
            {!result ? (
              <button class="btn btn--primary btn--big" onClick={() => fly(true)}>
                <Icon name="play" /> Fly for real
              </button>
            ) : (
              <button class="btn btn--big" onClick={() => fly(false)}>
                <Icon name="refresh" /> Practice
              </button>
            )}
            <button
              class="btn"
              onClick={() =>
                go({
                  name: 'workshop',
                  spec: {
                    design,
                    context: 'daily',
                    limits: dailyLimits(info),
                    onDone: (d) => {
                      if (d) dailyDesign = d;
                      go({ name: 'daily' }, { replace: true });
                    },
                  },
                })
              }
            >
              <Icon name="fold" /> Fold for today
            </button>
          </div>
        </div>
        <div class="card card--plain" style={{ flex: '0 1 16em' }}>
          <span class="label">Your plane</span>
          <div class="row" style={{ marginTop: '0.4em' }}>
            <Blueprint design={design} w={96} h={72} />
            <span class="label">{design.name}</span>
          </div>
        </div>
        {result && (
          <div class="card" style={{ flex: '1 1 16em', maxWidth: '24em' }}>
            <span class="tape tape--green">Today's result</span>
            <pre style={{ fontFamily: 'var(--font-ui)', whiteSpace: 'pre-wrap', fontSize: '0.95em' }}>
              {shareCard(info, { ...result, score: result.score }, url)}
            </pre>
            <button
              class="btn btn--primary"
              onClick={async () => {
                const text = shareCard(info, { ...result, score: result.score }, url);
                const r = await shareOrCopy({ title: 'Gliderama Daily', text });
                setMsg(r === 'shared' ? 'Shared!' : r === 'copied' ? 'Copied to clipboard!' : 'Could not share.');
              }}
            >
              <Icon name="share" /> Share
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
