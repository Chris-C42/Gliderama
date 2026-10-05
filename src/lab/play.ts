import { GameRenderer } from '../render/GameRenderer';
import { Session } from '../game/session';
import { RECIPES } from '../paper/recipes';
import { SAMPLE_LEVEL } from '../world/levels/sample';
import { allLevels, loadLevel } from '../world/campaign';
import { CHALLENGES } from '../modes/challenges';
import { generateFloor, themeForFloor } from '../world/procgen';
import { MENAGERIE } from './menagerie';
import type { ControlState, ThrowState } from '../core/types';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const hudEl = document.getElementById('hud')!;
const recipe = RECIPES.find((r) => r.id === (q.get('plane') ?? 'dart'))!;
const design = recipe.make();
const renderer = new GameRenderer(canvas, design.look);
// &noair hides the air-current lines (for checking the art underneath)
if (q.has('noair')) renderer.air.setVisible(false);
// ?level=cottage-1 plays a campaign level (classic-demo-house a Classic House), ?challenge=gale a Paper Lab challenge,
// ?seed=7&floor=2 a generated floor (&theme=cottage, &stairs=1: every change of storey a flight of stairs), ?menagerie
// Glider PRO's enemies and hazards
const campaignLevel = q.get('level') ? allLevels().find((l) => l.id === q.get('level')) : undefined;
const floor = Number(q.get('floor') ?? 0);
const theme = q.get('theme');
const level =
  (campaignLevel && (await loadLevel(campaignLevel))) ||
  (q.get('challenge') && CHALLENGES.find((c) => c.id === q.get('challenge'))?.level()) ||
  (q.get('seed') &&
    generateFloor({
      seed: Number(q.get('seed')),
      floor,
      theme: theme === 'home' || theme === 'cottage' ? theme : themeForFloor(floor),
      stairsChance: q.has('stairs') ? 1 : undefined,
    })) ||
  (q.has('menagerie') && structuredClone(MENAGERIE)) ||
  SAMPLE_LEVEL;
// &room=1,0 starts in another room of the level (for looking at its art and air)
if (q.get('room') && level.rooms[q.get('room')!]) level.start = { ...level.start, room: q.get('room')! };
// &det: knocks always damage the same wing, as in the headless bot pilot (so its flights replay exactly)
const opts = { autoTrim: q.has('autotrim'), slowMo: false, rand: q.has('det') ? () => 0.5 : undefined };
const session = new Session(renderer, level, design, opts, {
  hud(h) {
    hudEl.textContent = `${h.roomName}  phase:${h.phase}  sheets:${h.sheets}  stars:${h.stars}/${h.starsTotal}  dmg:${h.damage}%  t:${h.time.toFixed(1)}\nV ${h.speed.toFixed(2)} m/s  α ${h.alpha.toFixed(1)}°  L/D ${h.ld.toFixed(1)} ${h.stall > 0.5 ? 'STALL' : ''}  ${h.message ?? ''}`;
  },
  sfx(n) {
    (window as any).__sfx = ((window as any).__sfx ?? []).concat(n);
  },
});

function fit() {
  const s = Math.min(innerWidth / 640, innerHeight / 360);
  canvas.style.width = `${640 * s}px`;
  canvas.style.height = `${360 * s}px`;
  canvas.style.left = `${(innerWidth - 640 * s) / 2}px`;
  canvas.style.top = `${(innerHeight - 360 * s) / 2}px`;
}
addEventListener('resize', fit);
fit();

// --- dev input ---
const keys = new Set<string>();
let order: string[] = [];
let pitch = 0;
const ctl: ControlState = { dir: 0, pitch: 0, gadget: false, gadgetPressed: false, pausePressed: false };
const thr: ThrowState = { aiming: false, angle: 0, power: 0, released: false };
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  order = order.filter((k) => k !== e.code).concat(e.code);
  if (e.code === 'Space') ctl.gadgetPressed = true;
  if (e.code === 'Enter' && session.phase === 'aim') {
    thr.released = true;
    thr.angle = session.aim.angle;
    thr.power = session.aim.power;
  }
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
});
let drag: { x: number; y: number } | null = null;
const toRoom = (e: PointerEvent) => {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * 640, y: ((e.clientY - r.top) / r.height) * 360 };
};
canvas.addEventListener('pointerdown', (e) => {
  if (session.phase !== 'aim') return;
  drag = toRoom(e);
  thr.aiming = true;
});
addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = toRoom(e);
  const dx = drag.x - p.x;
  const dy = p.y - drag.y;
  thr.angle = Math.atan2(dy, dx);
  thr.power = Math.min(1, Math.hypot(dx, dy) / 120);
});
addEventListener('pointerup', () => {
  if (!drag) return;
  drag = null;
  thr.aiming = false;
  if (thr.power > 0.08) thr.released = true;
});

function readInput(dt: number) {
  const left = keys.has('ArrowLeft') || keys.has('KeyA');
  const right = keys.has('ArrowRight') || keys.has('KeyD');
  const lastDir = [...order].reverse().find((k) => (k === 'ArrowLeft' || k === 'KeyA' ? left : k === 'ArrowRight' || k === 'KeyD' ? right : false));
  ctl.dir = left || right ? (lastDir === 'ArrowLeft' || lastDir === 'KeyA' ? -1 : 1) : 0;
  const up = keys.has('ArrowUp') || keys.has('KeyW');
  const down = keys.has('ArrowDown') || keys.has('KeyS');
  const target = up ? 1 : down ? -1 : 0;
  const rate = target === 0 ? 6 : 4;
  pitch += Math.max(-rate * dt, Math.min(rate * dt, target - pitch));
  ctl.pitch = pitch;
  ctl.gadget = keys.has('Space');
}

// test hooks
const w = window as any;
w.__session = session;
w.__throw = (angle: number, power: number) => {
  thr.released = true;
  thr.angle = angle;
  thr.power = power;
};
w.__hold = (code: string, ms: number) => {
  keys.add(code);
  order = order.filter((k) => k !== code).concat(code);
  setTimeout(() => keys.delete(code), ms);
};

// __autopilot(plan) replays flights tick for tick: { flights: [{ angle, power, stepTicks, steps: [{ dir, pitch }] }] }
// (the bot pilot's solutions, tests/helpers/houseSolver.ts); __pilotLog collects what happened
interface PilotFlight {
  from?: { room: string; x: number; y: number };
  angle: number;
  power: number;
  /** Game ticks per entry of `steps`. */
  stepTicks: number;
  steps: { dir: -1 | 0 | 1; pitch: number }[];
}
let pilot: { flights: PilotFlight[]; i: number; tick: number; thrown: boolean } | null = null;
w.__pilotLog = [] as string[];
w.__autopilot = (plan: { flights: PilotFlight[] }) => {
  pilot = { ...plan, i: 0, tick: 0, thrown: false };
};
function drive() {
  const p = pilot!;
  const f = p.flights[p.i];
  ctl.dir = 0;
  ctl.pitch = 0;
  if (!f) return;
  if (session.phase === 'aim' && !p.thrown) {
    const cp = session.checkpoint;
    const planned = f.from ? `${f.from.room} (${Math.round(f.from.x)},${Math.round(f.from.y)})` : '?';
    w.__pilotLog.push(`flight ${p.i} from ${cp.room} (${Math.round(cp.x)},${Math.round(cp.y)}), planned from ${planned}`);
    thr.released = true;
    thr.angle = f.angle;
    thr.power = f.power;
    p.thrown = true;
    p.tick = 0;
  } else if (session.phase === 'fly' && p.thrown) {
    const s = f.steps[Math.floor(p.tick / f.stepTicks)];
    if (s) {
      ctl.dir = s.dir;
      ctl.pitch = s.pitch;
    }
    p.tick++;
  } else if (p.thrown && session.phase !== 'fly') {
    w.__pilotLog.push(`flight ${p.i} over: ${session.phase} in ${session.room.key} after ${(p.tick / 120).toFixed(1)}s`);
    p.i++;
    p.thrown = false;
  }
}

// &autopilot (with &det): the tests' bot pilot finds a way through the level here in the browser (floating point
// differs a hair between JS engines, enough to tip a scrape the other way, so a plan only replays exactly where it
// was made), then flies it: an end-to-end check of a Classic House in the real game. Dev page only.
if (q.has('autopilot') && campaignLevel) {
  const { solveHouse } = await import('../../tests/helpers/houseSolver');
  const t0 = performance.now();
  const plan = solveHouse(level, design, { maxSteps: Number(q.get('steps') ?? 4000) });
  w.__plan = { ...plan, ms: performance.now() - t0 };
  w.__autopilot(plan);
}

const STEP = 1 / 120;
let acc = 0;
let last = performance.now();
function frame(now: number) {
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  while (acc >= STEP) {
    acc -= STEP;
    if (pilot) drive();
    else readInput(STEP);
    session.update(STEP, ctl, thr);
    ctl.gadgetPressed = false;
    thr.released = false;
  }
  session.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
w.__ready = true;
