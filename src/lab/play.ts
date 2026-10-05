import { GameRenderer } from '../render/GameRenderer';
import { Session } from '../game/session';
import { RECIPES } from '../paper/recipes';
import { SAMPLE_LEVEL } from '../world/levels/sample';
import { allLevels } from '../world/campaign';
import { CHALLENGES } from '../modes/challenges';
import type { ControlState, ThrowState } from '../core/types';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const hudEl = document.getElementById('hud')!;
const recipe = RECIPES.find((r) => r.id === (q.get('plane') ?? 'dart'))!;
const design = recipe.make();
const renderer = new GameRenderer(canvas, design.look);
// &noair hides the air-current lines (for checking the art underneath)
if (q.has('noair')) renderer.air.setVisible(false);
// ?level=cottage-1 plays a campaign level, ?challenge=gale a Paper Lab challenge
const level =
  (q.get('level') && allLevels().find((l) => l.id === q.get('level'))?.build()) ||
  (q.get('challenge') && CHALLENGES.find((c) => c.id === q.get('challenge'))?.level()) ||
  SAMPLE_LEVEL;
// &room=1,0 starts in another room of the level (for looking at its art and air)
if (q.get('room') && level.rooms[q.get('room')!]) level.start = { ...level.start, room: q.get('room')! };
const session = new Session(renderer, level, design, { autoTrim: q.has('autotrim'), slowMo: false }, {
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

const STEP = 1 / 120;
let acc = 0;
let last = performance.now();
function frame(now: number) {
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  while (acc >= STEP) {
    acc -= STEP;
    readInput(STEP);
    session.update(STEP, ctl, thr);
    ctl.gadgetPressed = false;
    thr.released = false;
  }
  session.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
w.__ready = true;
