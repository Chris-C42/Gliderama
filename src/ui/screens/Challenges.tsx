import { useState } from 'preact/hooks';
import { back, go } from '../../app/nav';
import { activeDesign } from '../../app/library';
import { createChallengeProgress, getSave, saveRevision, updateSave } from '../../core/storage';
import type { LevelResult } from '../../game/session';
import { applyChallengeLimits, CHALLENGES, designFitsChallenge, goalText, isChallengeUnlocked, type ChallengeDef } from '../../modes/challenges';
import type { Design } from '../../paper/design';
import { Modal } from '../components/Modal';
import { Icon } from '../icons';
import { Blueprint } from './Library';
import './challenges.css';

/** The plane picked for each challenge this session, and the card to reopen after a flight. */
const picked: Record<string, Design> = {};
let reopen: string | null = null;

const starsOf = (id: string) => getSave().progress.challenges[id]?.stars ?? 0;

function record(ch: ChallengeDef, r: LevelResult, d: Design): void {
  updateSave((s) => {
    const c = s.progress.challenges[ch.id] ?? createChallengeProgress();
    c.stars = Math.max(c.stars, ch.stars(r, d));
    c.bestFolds = c.bestFolds === null ? d.folds.length : Math.min(c.bestFolds, d.folds.length);
    c.bestTime = c.bestTime === null ? r.time : Math.min(c.bestTime, r.time);
    s.progress.challenges[ch.id] = c;
    s.progress.stats.flights += r.flights;
  });
}

function rowsFor(ch: ChallengeDef, r: LevelResult, d: Design): [string, string][] {
  const rows: [string, string][] = [['Throws', String(r.flights)]];
  if (ch.goal.kind === 'distance') rows.push(['Best glide', `${r.best.distance.toFixed(1)} m`]);
  if (ch.goal.kind === 'aloft') rows.push(['Longest flight', `${r.best.timeAloft.toFixed(1)} s`]);
  if (ch.limits?.maxFolds !== undefined) rows.push(['Folds', String(d.folds.length)]);
  rows.push(['Damage', `${r.damage}%`]);
  return rows;
}

function fly(ch: ChallengeDef, design: Design): void {
  go({
    name: 'play',
    play: {
      mode: 'challenge',
      level: ch.level(),
      design,
      goal: ch.goal,
      infiniteSheets: true,
      meta: { challenge: ch.id },
      summary: (r, won) =>
        won
          ? { stars: ch.stars(r, design), rows: rowsFor(ch, r, design), note: `Stars: ${ch.tiers.join(' · ')}` }
          : { rows: rowsFor(ch, r, design), note: ch.hint },
      onEnd: (r, won) => {
        if (won) record(ch, r, design);
        reopen = ch.id;
        go({ name: 'challenges' }, { replace: true });
      },
    },
  });
}

function Stars(props: { n: number }) {
  return (
    <span class="ch__stars" aria-label={`${props.n} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <span class={i < props.n ? 'is-got' : ''}>
          <Icon name="star" />
        </span>
      ))}
    </span>
  );
}

export function Challenges() {
  saveRevision.value;
  const [open, setOpen] = useState<string | null>(() => {
    const r = reopen;
    reopen = null;
    return r;
  });
  const total = CHALLENGES.reduce((n, c) => n + starsOf(c.id), 0);
  const ch = open ? CHALLENGES.find((c) => c.id === open) : undefined;

  return (
    <div class="screen desk safe scroll ch">
      <header class="row">
        <button class="btn btn--icon" onClick={() => back()} aria-label="Back">
          <Icon name="back" />
        </button>
        <h1 class="ch__title">
          <span class="tape">Challenges</span>
        </h1>
        <span class="grow" />
        <span class="chip">
          <Icon name="star" /> {total} / {CHALLENGES.length * 3}
        </span>
      </header>
      <p class="ch__intro small">Ten puzzles in the Paper Lab. Each asks one thing of your plane: work out what, fold it, and fly it. Sheets never run out.</p>
      <div class="ch__grid">
        {CHALLENGES.map((c, i) => {
          const unlocked = isChallengeUnlocked(i, starsOf);
          return (
            <button class={`ch__card card ${unlocked ? '' : 'is-locked'}`} disabled={!unlocked} onClick={() => setOpen(c.id)} style={{ '--rot': `${((i * 37) % 5) - 2}deg` }}>
              <span class="ch__num label">{String(i + 1).padStart(2, '0')}</span>
              <span class="ch__icon">
                <Icon name={unlocked ? c.icon : 'lock'} />
              </span>
              <span class="ch__name">{c.name}</span>
              <span class="ch__blurb small">{unlocked ? c.blurb : 'Clear the one before to open it.'}</span>
              <Stars n={starsOf(c.id)} />
            </button>
          );
        })}
      </div>
      {ch && <Detail ch={ch} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Detail(props: { ch: ChallengeDef; onClose: () => void }) {
  const { ch } = props;
  const [msg, setMsg] = useState<string | null>(null);
  const design = applyChallengeLimits(ch, picked[ch.id] ?? activeDesign());
  const earned = starsOf(ch.id);
  const problem = designFitsChallenge(ch, design);
  return (
    <Modal onClose={props.onClose}>
      <div class="row">
        <span class="tape tape--blue">{ch.name}</span>
        <span class="grow" />
        <Stars n={earned} />
      </div>
      <p>{ch.blurb}</p>
      <div class="ch__facts">
        <span class="label">Goal</span>
        <span>{goalText(ch.goal)}</span>
        {ch.limits?.title && (
          <>
            <span class="label">Rule</span>
            <span>{ch.limits.title.split(': ')[1] ?? ch.limits.title}</span>
          </>
        )}
        {ch.tiers.map((t, i) => (
          <>
            <span class="label">{'★'.repeat(i + 1)}</span>
            <span class={i < earned ? 'ch__tier is-got' : 'ch__tier'}>
              {t} {i < earned && <Icon name="check" />}
            </span>
          </>
        ))}
      </div>
      {earned === 0 && <p class="small muted">Hint: {ch.hint}</p>}
      <div class="card card--plain ch__plane">
        <Blueprint design={design} w={96} h={72} />
        <div class="col small" style={{ gap: '0.15em' }}>
          <b>{design.name}</b>
          <span>
            {design.folds.length} fold{design.folds.length === 1 ? '' : 's'} · {design.paper.stock}
          </span>
        </div>
      </div>
      {(msg ?? problem) && <p class="small" style={{ color: 'var(--red-d)' }}>{msg ?? problem}</p>}
      <div class="row" style={{ marginTop: '0.6em' }}>
        <button
          class="btn"
          onClick={() =>
            go({
              name: 'workshop',
              spec: {
                design,
                context: 'challenge',
                limits: ch.limits ?? { title: ch.name },
                onDone: (d) => {
                  if (d) picked[ch.id] = d;
                  reopen = ch.id;
                  go({ name: 'challenges' }, { replace: true });
                },
              },
            })
          }
        >
          <Icon name="fold" /> Fold for this
        </button>
        <span class="grow" />
        <button
          class="btn btn--primary btn--big"
          onClick={() => {
            const p = designFitsChallenge(ch, design);
            if (p) {
              setMsg(p);
              return;
            }
            fly(ch, design);
          }}
        >
          <Icon name="play" /> Fly
        </button>
      </div>
    </Modal>
  );
}
