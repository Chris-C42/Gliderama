import { useEffect, useRef, useState } from 'preact/hooks';
import { back, type PlaySpec } from '../../app/nav';
import { GameRenderer } from '../../render/GameRenderer';
import { Session, type HudState, type LevelResult } from '../../game/session';
import { InputManager } from '../../input/InputManager';
import { ThrowController } from '../../input/throw';
import { TouchControls } from '../../input/TouchControls';
import { createLoop } from '../../core/loop';
import { settings } from '../../core/settings';
import type { ThrowState } from '../../core/types';
import type { Design } from '../../paper/design';
import { Hud } from './Hud';
import { Modal } from '../components/Modal';
import { Icon } from '../icons';
import { Workshop } from './Workshop';
import { sfx } from '../../audio/bridge';
import { Ambient, playTrack, resumeScreenTrack } from '../../app/audio';
import './play.css';

export interface EndState {
  result: LevelResult;
  won: boolean;
}

export function Play(props: { spec: PlaySpec }) {
  const { spec } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [end, setEnd] = useState<EndState | null>(null);
  const [bench, setBench] = useState<'menu' | 'fold' | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const [epoch, setEpoch] = useState(0);

  const setPause = (v: boolean) => {
    pausedRef.current = v;
    setPaused(v);
  };

  useEffect(() => {
    const el = canvas.current!;
    const host = wrap.current!;
    const renderer = new GameRenderer(el, spec.design.look);
    const input = new InputManager(() => settings.peek());
    inputRef.current = input;
    input.attach(window);
    const s = settings.peek();
    const goal = spec.goal ?? { kind: 'exit' };
    let hoops = 0;
    let session!: Session;
    let done = false;
    const goalDone = () => {
      if (done) return;
      done = true;
      setTimeout(() => session.finish(), 250);
    };
    session = new Session(
      renderer,
      spec.level,
      spec.design,
      {
        autoTrim: s.autoTrim,
        slowMo: s.slowMo,
        airMul: spec.airMul,
        bonusSheets: spec.bonusSheets,
        infiniteSheets: spec.infiniteSheets,
        fixedStart: spec.mode === 'challenge',
        record: false,
      },
      {
        hud: (h) => {
          let g: string | undefined;
          if (goal.kind === 'hoops') g = `Hoops ${hoops}/${goal.count}`;
          else if (goal.kind === 'distance' || goal.kind === 'aloft') {
            const f = h.phase === 'fly' ? session.lastFlight() : null;
            g = goal.kind === 'distance' ? `${(f?.distance ?? 0).toFixed(1)} / ${goal.meters} m` : `${(f?.timeAloft ?? 0).toFixed(1)} / ${goal.seconds} s`;
          }
          setHud(g ? { ...h, goal: g } : h);
          if (goal.kind === 'aloft' && goal.autoAt && h.phase === 'fly' && session.lastFlight().timeAloft >= goal.autoAt) goalDone();
        },
        complete: (r) =>
          setTimeout(() => {
            setEnd({ result: r, won: true });
            playTrack('clear');
          }, 900),
        failed: (r) => {
          setEnd({ result: r, won: false });
          playTrack(null, 0.6);
        },
        workbench: () => setBench('menu'),
        sfx: (n, o) => sfx(n, o),
        goal: (kind) => {
          if (kind === 'hoop') hoops++;
          if (goal.kind === 'target' && kind === 'target') goalDone();
          if (goal.kind === 'hoops' && kind === 'hoop' && hoops >= goal.count) goalDone();
        },
        flightEnded: (st) => {
          if (goal.kind === 'distance' && st.distance >= goal.meters) goalDone();
          else if (goal.kind === 'aloft' && st.timeAloft >= goal.seconds) goalDone();
          hoops = 0;
        },
      },
    );
    sessionRef.current = session;
    resumeScreenTrack();
    const ambient = new Ambient();

    const toRoom = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      return {
        x: ((cx - r.left) / r.width) * 640,
        y: ((cy - r.top) / r.height) * 360,
      };
    };
    const thr = new ThrowController({
      screenToRoom: toRoom,
      getAnchor: () => ({ x: session.checkpoint.x, y: session.checkpoint.y }),
      getFacing: () => session.checkpoint.facing,
      maxDragPx: Math.min(200, Math.max(110, Math.min(innerWidth, innerHeight) * 0.42)),
    });
    thr.attach(host);

    const idle: ThrowState = {
      aiming: false,
      angle: 0,
      power: 0,
      released: false,
    };
    const loop = createLoop({
      update(dt) {
        input.update(dt);
        const ctl = input.getControls();
        const edges = input.consumeEdges();
        if (edges.pausePressed && session.phase !== 'complete' && session.phase !== 'failed') {
          setPause(!pausedRef.current);
        }
        ambient.update(dt, pausedRef.current ? null : session.ambience());
        if (pausedRef.current) return;
        const aiming = session.phase === 'aim';
        thr.setEnabled(aiming);
        let ts: ThrowState = idle;
        if (aiming) {
          thr.update(dt);
          const rel = thr.consume();
          ts = rel ? { ...rel, released: true } : thr.getState();
        }
        session.update(dt, { ...ctl, gadgetPressed: edges.gadgetPressed, pausePressed: false }, ts);
      },
      render() {
        session.render();
      },
    });
    loop.start();

    const fit = () => {
      const s = Math.min(innerWidth / 640, innerHeight / 360);
      el.style.width = `${Math.floor(640 * s)}px`;
      el.style.height = `${Math.floor(360 * s)}px`;
    };
    fit();
    addEventListener('resize', fit);
    const blur = () => setPause(true);
    addEventListener('blur', blur);
    return () => {
      removeEventListener('resize', fit);
      removeEventListener('blur', blur);
      loop.stop();
      ambient.stop();
      thr.detach();
      input.detach();
      session.dispose();
      renderer.dispose();
      sessionRef.current = null;
    };
  }, [epoch]);

  const restart = () => {
    setEnd(null);
    setPause(false);
    setBench(null);
    setEpoch((e) => e + 1);
  };
  const quit = () => {
    if (spec.onEnd && end) spec.onEnd(end.result, end.won);
    else back();
  };

  const finishBench = (design: Design | null, repaired: boolean) => {
    sessionRef.current?.resumeFromWorkbench(design, repaired);
    setBench(null);
  };

  return (
    <div class={`screen play ${spec.design.extras.gadget === 'none' ? 'no-gadget' : ''}`} ref={wrap}>
      <canvas ref={canvas} class="play__canvas pixelated" width={640} height={360} />
      {hud && <Hud hud={hud} onPause={() => setPause(true)} flightData={settings.value.flightData} />}
      {inputRef.current && !end && !paused && !bench && (
        <TouchControls input={inputRef.current} settings={() => settings.peek()} onPause={() => setPause(true)} />
      )}
      {paused && !end && (
        <Modal onClose={() => setPause(false)}>
          <h2>Paused</h2>
          <p class="muted small">{spec.level.name}</p>
          <div class="col">
            <button class="btn btn--primary btn--big" onClick={() => setPause(false)}>
              <Icon name="play" /> Resume
            </button>
            <button class="btn" onClick={restart}>
              <Icon name="refresh" /> Restart
            </button>
            <button class="btn btn--red" onClick={() => (spec.onEnd ? spec.onEnd(sessionRef.current!.result(), false) : back())}>
              <Icon name="back" /> Quit
            </button>
          </div>
        </Modal>
      )}
      {bench === 'menu' && (
        <Modal>
          <div class="row">
            <span class="tape tape--blue">Workbench</span>
          </div>
          <p>A desk with fresh paper, tape and scissors. Take a breather.</p>
          <div class="col">
            <button class="btn btn--green" onClick={() => finishBench(null, true)}>
              <Icon name="tape" /> Patch it up &amp; fly on
            </button>
            <button class="btn btn--primary" onClick={() => setBench('fold')}>
              <Icon name="fold" /> Refold a new plane
            </button>
            <button class="btn" onClick={() => finishBench(null, false)}>
              <Icon name="play" /> Just keep flying
            </button>
          </div>
        </Modal>
      )}
      {bench === 'fold' && (
        <div class="play__overlay">
          <Workshop
            spec={{
              design: sessionRef.current?.design,
              context: 'workbench',
              limits: spec.benchLimits,
              onDone: (d) => finishBench(d, true),
            }}
          />
        </div>
      )}
      {end && <EndCard spec={spec} end={end} onRetry={restart} onContinue={quit} />}
    </div>
  );
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function EndCard(props: { spec: PlaySpec; end: EndState; onRetry: () => void; onContinue: () => void }) {
  const { result: r, won } = props.end;
  const lvl = props.spec.level;
  const summary = props.spec.summary?.(r, won);
  const medals = [
    { id: 'escape', name: 'Escape', got: won },
    {
      id: 'allStars',
      name: 'All Stars',
      got: won && r.starsTotal > 0 && r.stars >= r.starsTotal,
    },
    {
      id: 'pristine',
      name: 'Pristine',
      got: won && r.damage < 20 && r.crashes === 0,
    },
    {
      id: 'swift',
      name: 'Swift',
      got: won && lvl.par > 0 && r.time <= lvl.par,
    },
  ];
  return (
    <Modal>
      <div class="row">
        <span class={`tape ${won ? 'tape--green' : 'tape--red'}`}>
          {won ? (props.spec.mode === 'challenge' ? 'Solved!' : 'Escaped!') : props.spec.mode === 'challenge' ? 'Not yet' : 'Out of paper'}
        </span>
        <span class="grow" />
        <span class="muted small">{lvl.name}</span>
      </div>
      {summary ? (
        <>
          {summary.stars !== undefined && (
            <div class="endcard__stars" aria-label={`${summary.stars} of 3 stars`}>
              {[0, 1, 2].map((i) => (
                <span class={i < (summary.stars ?? 0) ? 'is-got' : ''}>
                  <Icon name="star" />
                </span>
              ))}
            </div>
          )}
          <div class="endcard__grid">
            {summary.rows.map(([k, v]) => (
              <>
                <span class="label">{k}</span>
                <span>{v}</span>
              </>
            ))}
          </div>
          {summary.note && <p class="small muted">{summary.note}</p>}
        </>
      ) : (
        <div class="endcard__grid">
          <span class="label">Time</span>
          <span>
            {fmtTime(r.time)} {lvl.par > 0 && <span class="muted small">par {fmtTime(lvl.par)}</span>}
          </span>
          <span class="label">Stars</span>
          <span>
            <Icon name="star" /> {r.stars} / {r.starsTotal}
          </span>
          <span class="label">Damage</span>
          <span>{r.damage}%</span>
          <span class="label">Sheets used</span>
          <span>{r.sheetsUsed}</span>
        </div>
      )}
      {props.spec.mode === 'campaign' && (
        <div class="row endcard__medals">
          {medals.map((m) => (
            <span class={`chip ${m.got ? 'is-got' : 'is-missed'}`}>
              <Icon name={m.got ? 'medal' : 'lock'} /> {m.name}
            </span>
          ))}
        </div>
      )}
      <div class="row" style={{ marginTop: '0.8em' }}>
        <button class="btn" onClick={props.onRetry}>
          <Icon name="refresh" /> Retry
        </button>
        <span class="grow" />
        <button class="btn btn--primary btn--big" onClick={props.onContinue}>
          Continue <Icon name="next" />
        </button>
      </div>
    </Modal>
  );
}
