import { signal } from '@preact/signals';
import { back, go } from '../../app/nav';
import { activeDesign, unlock } from '../../app/library';
import { getSave, saveRevision, updateSave, createLevelProgress } from '../../core/storage';
import { PLACES, isLevelOpen, levelById, loadLevel, type CampaignLevel, type Unlock } from '../../world/campaign';
import type { LevelResult } from '../../game/session';
import { Icon } from '../icons';
import { Blueprint } from './Library';
import './campaign.css';

export function recordCampaignResult(levelId: string, r: LevelResult, won: boolean, par: number): Unlock[] {
  const gained: Unlock[] = [];
  updateSave((s) => {
    const lp = s.progress.campaign[levelId] ?? createLevelProgress();
    s.progress.stats.flights += 1;
    s.progress.stats.crashes += r.crashes;
    s.progress.stats.stars += r.stars;
    s.progress.stats.roomsFlown += r.roomsVisited;
    if (won) {
      lp.completed = true;
      lp.medals.escape = true;
      if (r.starsTotal > 0 && r.stars >= r.starsTotal) lp.medals.allStars = true;
      if (r.damage < 20 && r.crashes === 0) lp.medals.pristine = true;
      if (par > 0 && r.time <= par) lp.medals.swift = true;
      lp.bestTime = lp.bestTime === null ? r.time : Math.min(lp.bestTime, r.time);
      lp.bestStars = Math.max(lp.bestStars, r.stars);
    }
    s.progress.campaign[levelId] = lp;
  });
  if (won) {
    const lvl = levelById(levelId);
    for (const u of lvl?.unlocks ?? []) if (unlock(u.kind, u.id)) gained.push(u);
  }
  return gained;
}

/** The level being loaded (Classic Houses are fetched when first played). */
const loading = signal<string | null>(null);

export async function startCampaignLevel(cl: CampaignLevel): Promise<void> {
  if (loading.peek()) return;
  loading.value = cl.id;
  let level;
  try {
    level = await loadLevel(cl);
  } catch (e) {
    alert(`Couldn't load ${cl.name}${navigator.onLine ? '' : ' (offline: a house you have not played yet is not saved on this device)'}.`);
    console.error(e);
    return;
  } finally {
    loading.value = null;
  }
  go({
    name: 'play',
    play: {
      mode: 'campaign',
      level,
      design: activeDesign(),
      onEnd: (r, won) => {
        const gained = recordCampaignResult(cl.id, r, won, level.par);
        go({ name: 'campaign' }, { replace: true });
        if (gained.length) setTimeout(() => alert(`Unlocked: ${gained.map((g) => g.label).join(', ')}`), 50);
      },
    },
  });
}

export function Campaign() {
  saveRevision.value;
  const save = getSave();
  const done = (id: string) => !!save.progress.campaign[id]?.completed;
  const design = activeDesign();
  return (
    <div class="screen desk camp">
      <header class="camp__top safe">
        <button class="btn btn--icon" onClick={() => back()} aria-label="Back">
          <Icon name="back" />
        </button>
        <h1 class="camp__title">
          <span class="tape">A journey of places</span>
        </h1>
        <span class="grow" />
        <button class="camp__plane card card--plain" onClick={() => go({ name: 'library' })} title="Change plane">
          <Blueprint design={design} w={54} h={40} />
          <span class="col" style={{ gap: 0 }}>
            <span class="small muted">Flying</span>
            <span class="label">{design.name}</span>
          </span>
        </button>
      </header>
      <main class="camp__road safe scroll">
        {PLACES.map((p, pi) => (
          <section class={`camp__place ${p.comingSoon ? 'is-soon' : ''}`} style={{ '--place': p.color, '--rot': `${((pi * 41) % 5) - 2}deg` }}>
            <div class="camp__place-head">
              <span class="camp__place-icon">
                <Icon name={p.icon} />
              </span>
              <div class="col" style={{ gap: '0.1em' }}>
                <h2>{p.name}</h2>
                <span class="small muted">{p.blurb}</span>
              </div>
            </div>
            {p.comingSoon ? (
              <div class="camp__soon">
                <Icon name="lock" /> Coming soon
              </div>
            ) : (
              <div class="camp__levels">
                {p.levels.map((l, li) => {
                  const lp = save.progress.campaign[l.id];
                  const open = isLevelOpen(l.id, done);
                  const busy = loading.value === l.id;
                  const medals = lp?.medals;
                  return (
                    <button class={`camp__level ${open ? '' : 'is-locked'} ${lp?.completed ? 'is-done' : ''}`} disabled={!open} onClick={() => startCampaignLevel(l)}>
                      <span class="camp__num">{li + 1}</span>
                      <span class="col" style={{ gap: '0.1em', alignItems: 'flex-start' }}>
                        <span class="label">{l.name}</span>
                        <span class="small muted">{busy ? 'Loading…' : open ? l.blurb : 'Finish the previous flight'}</span>
                        <span class="camp__medals">
                          {(['escape', 'allStars', 'pristine', 'swift'] as const).map((m) => (
                            <span class={`camp__medal ${medals?.[m] ? 'is-got' : ''}`} title={{ escape: 'Escape', allStars: 'All stars', pristine: 'Pristine', swift: 'Swift' }[m]}>
                              <Icon name={m === 'escape' ? 'check' : m === 'allStars' ? 'star' : m === 'pristine' ? 'plane' : 'clock'} />
                            </span>
                          ))}
                        </span>
                      </span>
                      {!open && <Icon name="lock" class="camp__lock" />}
                      {open && l.unlocks.length > 0 && !lp?.completed && <span class="camp__unlock small">Unlocks: {l.unlocks.map((u) => u.label).join(', ')}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        ))}
      </main>
    </div>
  );
}
