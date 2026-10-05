import { useEffect, useRef, useState } from 'preact/hooks';
import { back, go } from '../../app/nav';
import { activeDesign } from '../../app/library';
import { GameRenderer } from '../../render/GameRenderer';
import { Session, type FlightStats, type HudState } from '../../game/session';
import { InputManager } from '../../input/InputManager';
import { ThrowController } from '../../input/throw';
import { TouchControls } from '../../input/TouchControls';
import { createLoop } from '../../core/loop';
import { settings } from '../../core/settings';
import type { ThrowState } from '../../core/types';
import type { Design } from '../../paper/design';
import type { ItemDef } from '../../world/types';
import { HANGAR_BAYS, hangarLevel } from '../../world/levels/hangar';
import { Icon } from '../icons';
import { sfx } from '../../audio/bridge';
import { HangarTests } from './HangarTests';
import { Ambient } from '../../app/audio';
import './play.css';
import './hangar.css';

type Tool = 'vent' | 'fanR' | 'fanL' | 'candle' | 'block' | 'target' | 'hoop' | 'drip' | 'erase';

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'vent', label: 'Vent', icon: 'plus' },
  { id: 'fanR', label: 'Fan →', icon: 'next' },
  { id: 'fanL', label: 'Fan ←', icon: 'back' },
  { id: 'candle', label: 'Candle', icon: 'flame' },
  { id: 'block', label: 'Block', icon: 'cards' },
  { id: 'target', label: 'Target', icon: 'target' },
  { id: 'hoop', label: 'Hoop', icon: 'refresh' },
  { id: 'drip', label: 'Drip', icon: 'drop' },
  { id: 'erase', label: 'Erase', icon: 'trash' },
];

let uid = 0;

function itemsFor(tool: Tool, x: number, y: number): ItemDef[] {
  const id = `h${++uid}`;
  switch (tool) {
    case 'vent':
      return [{ t: 'floorVent', id, x: Math.round(x - 28), y: 330, w: 56 }];
    case 'fanR':
    case 'fanL': {
      const fy = Math.round(Math.min(276, Math.max(60, y - 16)));
      const stand = 340 - fy - 32 - 2;
      return [{ t: 'fan', id, x: Math.round(x - 16), y: fy, dir: tool === 'fanR' ? 1 : -1, stand: Math.max(10, stand), power: 3 }];
    }
    case 'candle':
      return [
        { t: 'block', id: `${id}b`, x: Math.round(x - 20), y: 300, w: 40, h: 40 },
        { t: 'candle', id, x: Math.round(x - 3), y: 276, wax: 18 },
      ];
    case 'block':
      return [{ t: 'block', id, x: Math.round(x - 20), y: Math.round(Math.min(300, y)), w: 40, h: Math.round(340 - Math.min(300, y)) }];
    case 'target':
      return [
        { t: 'targetMat', id: `${id}m`, x: Math.round(x - 45), y: 330, w: 90 },
        { t: 'target', id, x: Math.round(x - 45), y: 330, w: 90 },
      ];
    case 'hoop':
      return [{ t: 'hoop', id, x: Math.round(x), y: Math.round(Math.max(60, Math.min(290, y))), r: 26 }];
    case 'drip':
      return [{ t: 'drip', id, x: Math.round(x), y: 56, every: 1.2 }];
    default:
      return [];
  }
}

export function Hangar(props: { design?: Design }) {
  const [design, setDesign] = useState<Design>(() => props.design ?? activeDesign());
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [last, setLast] = useState<FlightStats | null>(null);
  const [best, setBest] = useState<number>(0);
  const [panel, setPanel] = useState<'none' | 'build' | 'tests'>('none');
  const [tool, setTool] = useState<Tool>('vent');
  const [hoops, setHoops] = useState(0);
  const sessionRef = useRef<Session | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const extras = useRef<Record<number, ItemDef[]>>({});
  const ghost = useRef<{ x: number; y: number }[]>([]);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useEffect(() => {
    const el = canvas.current!;
    const host = wrap.current!;
    const renderer = new GameRenderer(el, design.look);
    const input = new InputManager(() => settings.peek());
    inputRef.current = input;
    input.attach(window);
    const s = settings.peek();
    const session = new Session(
      renderer,
      hangarLevel(extras.current),
      design,
      { autoTrim: s.autoTrim, slowMo: s.slowMo, infiniteSheets: true, record: true },
      {
        hud: (h) => setHud(h),
        sfx: (n, o) => sfx(n, o),
        flightEnded: (st) => {
          setLast(st);
          setBest((b) => Math.max(b, st.distance));
          ghost.current = st.path;
        },
        goal: (kind) => {
          if (kind === 'hoop') setHoops((n) => n + 1);
        },
      },
    );
    session.message = null;
    sessionRef.current = session;
    const toRoom = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      return { x: ((cx - r.left) / r.width) * 640, y: ((cy - r.top) / r.height) * 360 };
    };
    const thr = new ThrowController({
      screenToRoom: toRoom,
      getAnchor: () => ({ x: session.checkpoint.x, y: session.checkpoint.y }),
      getFacing: () => session.checkpoint.facing,
      maxDragPx: Math.min(200, Math.max(110, Math.min(innerWidth, innerHeight) * 0.42)),
    });
    thr.attach(host);

    // builder: tap to place in the current bay
    const place = (e: PointerEvent) => {
      if (panelRef.current !== 'build') return;
      if ((e.target as HTMLElement).closest('[data-ui]')) return;
      const p = toRoom(e.clientX, e.clientY);
      if (p.x < 0 || p.x > 640 || p.y < 0 || p.y > 360) return;
      const bay = Number(session.room.key.split(',')[0]);
      const list = extras.current[bay] ?? [];
      if (toolRef.current === 'erase') {
        // remove the nearest placed item (and its companions)
        let bi = -1;
        let bd = 50;
        list.forEach((it, i) => {
          const d = Math.hypot(it.x - p.x, it.y - p.y);
          if (d < bd) {
            bd = d;
            bi = i;
          }
        });
        if (bi < 0) return;
        const base = String(list[bi].id ?? '').replace(/[bm]$/, '');
        extras.current[bay] = list.filter((it) => !String(it.id ?? '').startsWith(base));
      } else extras.current[bay] = [...list, ...itemsFor(toolRef.current, p.x, p.y)];
      session.reloadRooms(hangarLevel(extras.current).rooms);
      sfx('click');
    };
    host.addEventListener('pointerdown', place);

    const idle: ThrowState = { aiming: false, angle: 0, power: 0, released: false };
    const ambient = new Ambient();
    const loop = createLoop({
      update(dt) {
        input.update(dt);
        const ctl = input.getControls();
        const edges = input.consumeEdges();
        const aiming = session.phase === 'aim' && panelRef.current !== 'build';
        thr.setEnabled(aiming);
        let ts: ThrowState = idle;
        if (aiming) {
          thr.update(dt);
          const rel = thr.consume();
          ts = rel ? { ...rel, released: true } : thr.getState();
          if (rel) setHoops(0);
        }
        session.update(dt, { ...ctl, gadgetPressed: edges.gadgetPressed, pausePressed: false }, ts);
        ambient.update(dt, session.ambience());
        // after a landing, go back to the launcher
        if (session.phase === 'aim' && session.checkpoint.room !== '0,0') {
          session.checkpoint = { room: '0,0', x: 76, y: 176, facing: 1 };
          session.beginAim();
        }
      },
      render() {
        // ghost of the previous flight, clipped to the visible bay
        const key = session.room.key;
        const [gx] = key.split(',').map(Number);
        const pts = ghost.current.filter((q) => q.x >= gx * 640 && q.x < (gx + 1) * 640).map((q) => ({ x: q.x - gx * 640, y: q.y }));
        renderer.setGhost(pts);
        session.render();
      },
    });
    loop.start();
    const fit = () => {
      const k = Math.min(innerWidth / 640, innerHeight / 360);
      el.style.width = `${Math.floor(640 * k)}px`;
      el.style.height = `${Math.floor(360 * k)}px`;
    };
    fit();
    addEventListener('resize', fit);
    return () => {
      removeEventListener('resize', fit);
      host.removeEventListener('pointerdown', place);
      loop.stop();
      ambient.stop();
      thr.detach();
      input.detach();
      session.dispose();
      renderer.dispose();
    };
  }, [design]);

  const h = hud;
  return (
    <div class={`screen play hangar ${design.extras.gadget === 'none' ? 'no-gadget' : ''}`} ref={wrap}>
      <canvas ref={canvas} class="play__canvas pixelated" width={640} height={360} />
      <div class="hangar__top safe" data-ui>
        <button class="btn btn--icon btn--small" onClick={() => back()} aria-label="Back">
          <Icon name="back" />
        </button>
        <button class="chip hangar__plane" onClick={() => go({ name: 'workshop', spec: { design, context: 'library', onDone: (d) => (d ? setDesign(d) : back()) } })}>
          <Icon name="plane" /> {design.name} <Icon name="fold" />
        </button>
        <span class="grow" />
        <button class={`btn btn--small ${panel === 'build' ? 'is-on' : ''}`} onClick={() => setPanel(panel === 'build' ? 'none' : 'build')}>
          <Icon name="cards" /> Build
        </button>
        <button class={`btn btn--small ${panel === 'tests' ? 'is-on' : ''}`} onClick={() => setPanel(panel === 'tests' ? 'none' : 'tests')}>
          <Icon name="chart" /> Tests
        </button>
      </div>
      {h && h.phase === 'fly' && (
        <div class="hud__data">
          <span>{h.speed.toFixed(1)} m/s</span>
          <span>α {h.alpha.toFixed(0)}°</span>
          <span>L/D {h.ld.toFixed(1)}</span>
          {h.stall > 0.5 && <span class="hud__alert">STALL</span>}
          {hoops > 0 && <span>hoops {hoops}</span>}
        </div>
      )}
      {h && h.phase === 'aim' && panel !== 'build' && (
        <div class="hud__aim" style={{ top: '30%' }}>
          <div class="hud__meter">
            <div class="hud__meter-fill" style={{ height: `${Math.round(h.power * 100)}%` }} />
            <div class="hud__meter-ideal" style={{ bottom: `${Math.round(h.idealPower * 100)}%` }} />
          </div>
        </div>
      )}
      {last && panel === 'none' && (
        <div class="hangar__report card" data-ui>
          <div class="row">
            <span class="tape tape--blue">Flight report</span>
            <span class="grow" />
            <button class="btn btn--ghost btn--small" onClick={() => setLast(null)}>
              <Icon name="close" />
            </button>
          </div>
          <div class="endcard__grid">
            <span class="label">Distance</span>
            <span>
              {last.distance.toFixed(2)} m {last.distance >= best - 1e-6 && best > 0 && <span class="chip">best!</span>}
            </span>
            <span class="label">Time aloft</span>
            <span>{last.timeAloft.toFixed(1)} s</span>
            <span class="label">Max height</span>
            <span>{last.maxHeight.toFixed(2)} m</span>
            <span class="label">Glide</span>
            <span>{last.heightLost > 0.05 ? `${(last.distance / last.heightLost).toFixed(1)} : 1` : '—'}</span>
            <span class="label">Ending</span>
            <span>{last.reason === 'target' ? 'Bullseye!' : last.reason === 'crashed' ? 'Crumpled' : 'Landed'}</span>
          </div>
          <span class="small muted">Best {best.toFixed(2)} m · blue dots show your last flight</span>
        </div>
      )}
      {panel === 'build' && (
        <div class="hangar__palette safe" data-ui>
          {TOOLS.map((t) => (
            <button class={`btn btn--small ${tool === t.id ? 'is-on' : ''}`} onClick={() => setTool(t.id)}>
              <Icon name={t.icon} /> {t.label}
            </button>
          ))}
          <button
            class="btn btn--small btn--red"
            onClick={() => {
              extras.current = {};
              sessionRef.current?.reloadRooms(hangarLevel({}).rooms);
            }}
          >
            Clear all
          </button>
          <span class="small hangar__tip">Tap the hangar to place. Fly into the next bays to build there too ({HANGAR_BAYS} bays).</span>
        </div>
      )}
      {panel === 'tests' && <HangarTests design={design} onClose={() => setPanel('none')} />}
      {inputRef.current && panel !== 'build' && <TouchControls input={inputRef.current} settings={() => settings.peek()} />}
    </div>
  );
}
