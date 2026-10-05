/**
 * Longitudinal flight dynamics of a paper plane in the room plane, plus a 3D-ish turnaround.
 *
 * State is SI, room frame: x right (m), y UP (m) from the bottom edge of the room.
 * θ (theta) is the pitch of the nose relative to the horizontal in the direction the plane faces.
 */

import { CONTROL_MAX, G, RHO, coeffs, findTrim, type AeroModel } from '../paper/aero';
import type { Facing } from '../core/types';
import { PHYS, PX_PER_M, ROOM_H } from './config';
import { damageMods, freshDamage, tickDamage, type Damage, type DamageMods } from './damage';

export interface Wind {
  x: number;
  y: number;
}

export type WindFn = (x: number, y: number) => Wind;

export const NO_WIND: WindFn = () => ({ x: 0, y: 0 });

export interface FlightInput {
  /** -1 / 0 / +1 held direction. */
  dir: -1 | 0 | 1;
  /** Elevator command -1..1 (nose down .. nose up). */
  pitch: number;
  /** Battery boost held. */
  boost: boolean;
}

export interface Turn {
  t: number;
  dur: number;
  from: Facing;
  /** Horizontal airspeed along the heading during the turn. */
  vh: number;
}

export interface Plane {
  aero: AeroModel;
  x: number;
  y: number;
  vx: number;
  vy: number;
  theta: number;
  q: number;
  facing: Facing;
  ctrl: number;
  trimCtrl: number;
  turn: Turn | null;
  damage: Damage;
  mods: DamageMods;
  // diagnostics for HUD / render
  alpha: number;
  V: number;
  CL: number;
  CD: number;
  stall: number;
  bank: number;
  yaw: number;
  roll: number;
  rollRate: number;
  /** Auto-righting half-roll in progress (sim s remaining), for the renderer. */
  righting: number;
  boostLeft: number;
  boosting: boolean;
  heliumLeft: number;
  /** Sim s spent climbing in rising air, and the shove waiting / under way for when it is left (see PHYS.exit*). */
  liftT: number;
  exitPending: boolean;
  exitBoost: number;
  /** Sim time since launch. */
  time: number;
}

/** Elevator offset that trims the plane at its best-glide angle (auto-trim assist). */
export function autoTrimCtrl(aero: AeroModel): number {
  let lo = -CONTROL_MAX * 2;
  let hi = CONTROL_MAX * 2;
  const target = aero.perf.alphaBest;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    const t = findTrim(aero, mid);
    // more nose-up control → higher trim alpha
    if (!t || t.alpha < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function createPlane(aero: AeroModel, opts: { autoTrim?: boolean } = {}): Plane {
  const damage = freshDamage();
  return {
    aero,
    x: 1,
    y: 1.5,
    vx: 0,
    vy: 0,
    theta: 0,
    q: 0,
    facing: 1,
    ctrl: 0,
    trimCtrl: opts.autoTrim ? autoTrimCtrl(aero) : 0,
    turn: null,
    damage,
    mods: damageMods(damage, aero),
    alpha: 0,
    V: 0,
    CL: 0,
    CD: 0,
    stall: 0,
    bank: 0,
    yaw: 0,
    roll: 0,
    rollRate: 0,
    righting: 0,
    boostLeft: 0,
    boosting: false,
    heliumLeft: 0,
    liftT: 0,
    exitPending: false,
    exitBoost: 0,
    time: 0,
  };
}

/** The throw speed that suits the design best (m/s). */
export function idealThrowSpeed(aero: AeroModel): number {
  return (aero.perf.trim?.v ?? aero.perf.vBest) * 1.25;
}

export function throwSpeed(aero: AeroModel, power: number): number {
  const vb = aero.perf.vBest;
  return vb * (PHYS.throwMin + (PHYS.throwMax - PHYS.throwMin) * Math.max(0, Math.min(1, power)));
}

/** Power (0..1) that gives the ideal throw speed. */
export function idealThrowPower(aero: AeroModel): number {
  const vb = aero.perf.vBest;
  return Math.max(0, Math.min(1, (idealThrowSpeed(aero) / vb - PHYS.throwMin) / (PHYS.throwMax - PHYS.throwMin)));
}

/**
 * Launch from a room-pixel position. `angle` is the aim in room space (rad, 0 = right, +π/2 = up).
 */
export function launch(p: Plane, xPx: number, yPx: number, angle: number, power: number): void {
  const v = throwSpeed(p.aero, power);
  p.x = xPx / PX_PER_M;
  p.y = (ROOM_H - yPx) / PX_PER_M;
  p.vx = Math.cos(angle) * v;
  p.vy = Math.sin(angle) * v;
  p.facing = p.vx >= 0 ? 1 : -1;
  // pitch along the throw direction (relative to the facing direction)
  p.theta = Math.atan2(p.vy, Math.abs(p.vx));
  p.q = 0;
  p.turn = null;
  p.time = 0;
  p.ctrl = 0;
  p.roll = 0;
  p.rollRate = 0;
  p.liftT = 0;
  p.exitPending = false;
  p.exitBoost = 0;
}

export function planePx(p: Plane): { x: number; y: number } {
  return { x: p.x * PX_PER_M, y: ROOM_H - p.y * PX_PER_M };
}

const wrap = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

/**
 * Advance the plane by one game tick (real seconds). Wind is sampled in SI room coordinates.
 */
export function stepPlane(p: Plane, input: FlightInput, wind: WindFn, dtReal: number, opts: { slowMo?: boolean } = {}): void {
  const scale = PHYS.timeScale * (opts.slowMo ? PHYS.slowMoAssist : 1);
  const n = PHYS.substeps;
  const dt = (dtReal * scale) / n;
  p.mods = damageMods(p.damage, p.aero);

  // Start a turnaround when the player pushes the other way.
  if (!p.turn && input.dir !== 0 && input.dir !== p.facing) {
    const a = p.aero;
    const vRatio = Math.max(0.7, Math.min(1.4, a.perf.vBest / Math.max(0.5, p.V)));
    // Asymmetric damage: quicker turning towards the weaker wing, slower the other way.
    const asymF = 1 + p.mods.asym * 0.6 * input.dir;
    const dur = a.perf.turnTime * PHYS.turnMul * vRatio * Math.max(0.6, asymF);
    const vh = Math.abs(p.vx);
    p.turn = { t: 0, dur, from: p.facing, vh };
  }

  for (let i = 0; i < n; i++) substep(p, input, wind, dt);
  tickDamage(p.damage, dt * n);
}

function substep(p: Plane, input: FlightInput, wind: WindFn, dt: number): void {
  const a = p.aero;
  const mass = a.mass * p.mods.massMul;
  const w = wind(p.x, p.y);
  updraftExit(p, w.y, dt);

  // Elevator servo with a gentle expo curve on the command.
  const cmd = Math.sign(input.pitch) * Math.pow(Math.abs(input.pitch), 1.35);
  const target = p.trimCtrl + cmd * CONTROL_MAX;
  const maxD = PHYS.servoRate * dt;
  p.ctrl += Math.max(-maxD, Math.min(maxD, target - p.ctrl));

  let fx: number;
  let fy: number;
  let u: number; // along heading
  let wv: number; // vertical air-relative
  const turn = p.turn;
  let bank = 0;
  if (turn) {
    const s = Math.min(1, turn.t / turn.dur);
    bank = PHYS.turnBank * Math.sin(Math.PI * s);
    const psi = Math.PI * s;
    u = turn.vh - turn.from * w.x * Math.cos(psi);
    wv = p.vy - w.y;
  } else {
    u = p.facing * (p.vx - w.x);
    wv = p.vy - w.y;
  }
  const V = Math.max(1e-3, Math.hypot(u, wv));
  const gamma = Math.atan2(wv, u);
  const alpha = wrap(p.theta - gamma);
  const qhat = (p.q * a.MAC) / (2 * V);
  const c = coeffs(a, alpha, p.ctrl, qhat, p.mods);
  const qS = 0.5 * RHO * V * V * a.S;
  // Roll wobble from asymmetric damage reduces effective lift.
  const rollLift = Math.cos(p.roll);
  const L = qS * c.CL * Math.cos(bank) * rollLift;
  const D = qS * c.CD;
  // lift ⟂ airflow (rotate +90°), drag opposite airflow; in the heading frame (u, w)
  const fu = (-L * wv - D * u) / V;
  const fw = (L * u - D * wv) / V;

  // thrust / helium
  let tu = 0;
  let tw = 0;
  p.boosting = false;
  if (input.boost && p.boostLeft > 0) {
    tu = PHYS.boostThrust * Math.cos(p.theta);
    tw = PHYS.boostThrust * Math.sin(p.theta);
    p.boostLeft = Math.max(0, p.boostLeft - dt);
    p.boosting = true;
  }
  let lift2 = 0;
  if (p.heliumLeft > 0) {
    lift2 = PHYS.heliumLift;
    p.heliumLeft = Math.max(0, p.heliumLeft - dt);
  }

  if (turn) {
    turn.vh = Math.max(0, turn.vh + ((fu + tu) / mass) * dt);
    turn.vh *= 1 - ((1 - PHYS.turnSpeedKeep) * dt) / turn.dur;
    p.vy += ((fw + tw + lift2) / mass - G) * dt;
    turn.t += dt;
    const s = Math.min(1, turn.t / turn.dur);
    const psi = Math.PI * s;
    p.vx = turn.from * turn.vh * Math.cos(psi);
    p.yaw = psi;
    p.bank = PHYS.turnBank * Math.sin(Math.PI * s);
    if (s >= 1) {
      p.facing = (-turn.from) as Facing;
      p.turn = null;
      p.yaw = 0;
      p.bank = 0;
    }
  } else {
    fx = p.facing * (fu + tu);
    fy = fw + tw + lift2;
    p.vx += (fx / mass) * dt;
    p.vy += (fy / mass - G) * dt;
    p.yaw = 0;
    p.bank = 0;
  }
  // Coming out of an updraft slow: a gentle shove along the heading, back towards best-glide speed.
  if (p.exitBoost > 0 && !p.turn) {
    const target = a.perf.vBest * PHYS.exitTarget;
    if (p.V < target) {
      const dv = Math.min(PHYS.exitAccel * dt, target - p.V);
      p.vx += p.facing * Math.cos(p.theta) * dv;
      p.vy += Math.sin(p.theta) * dv;
    }
    p.exitBoost = Math.max(0, p.exitBoost - dt);
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;

  // Pitch dynamics.
  const I = a.Iyy * p.mods.massMul * PHYS.inertiaMul;
  const M = qS * a.MAC * c.Cm - PHYS.extraDamping * qS * a.MAC * ((p.q * a.MAC) / (2 * V)) * 0.5;
  p.q += (M / I) * dt;
  // Soft limit on spin rate
  p.q = Math.max(-25, Math.min(25, p.q));
  p.theta = wrap(p.theta + p.q * dt);

  // Upside down and not deliberately looping: dihedral and keel roll a paper plane upright.
  // Mirror the state so it flies on, upright, the other way (a half-roll / Immelmann).
  if (!p.turn && Math.abs(p.theta) > PHYS.invertLimit && Math.abs(p.q) < PHYS.loopRate) {
    p.facing = (-p.facing) as Facing;
    p.theta = wrap(Math.PI - p.theta);
    p.q = -p.q;
    p.righting = PHYS.rightingTime;
  }
  if (p.righting > 0) p.righting = Math.max(0, p.righting - dt);

  // Damage asymmetry: roll oscillator, unstable near the stall.
  const asym = p.mods.asym;
  const kRoll = 30;
  const zeta = c.stall > 0.6 ? -0.2 : 0.35;
  p.rollRate += (asym * 2.2 * (0.5 + c.stall) - kRoll * p.roll - 2 * zeta * Math.sqrt(kRoll) * p.rollRate) * dt;
  p.roll = Math.max(-1.3, Math.min(1.3, p.roll + p.rollRate * dt));

  p.alpha = alpha;
  p.V = V;
  p.CL = c.CL;
  p.CD = c.CD;
  p.stall = c.stall;
  p.time += dt;
}

/**
 * Track time spent climbing in rising air; when the plane leaves it (the air under it stops rising),
 * queue the exit shove, which starts as soon as the plane isn't mid-turnaround.
 */
function updraftExit(p: Plane, rise: number, dt: number): void {
  if (rise > PHYS.exitLiftMin) {
    p.liftT = Math.min(5, p.liftT + dt);
    p.exitPending = false;
  } else if (rise < PHYS.exitLiftOut) {
    if (p.liftT >= PHYS.exitLiftTime) p.exitPending = true;
    p.liftT = 0;
  }
  if (p.exitPending && !p.turn) {
    p.exitPending = false;
    p.exitBoost = PHYS.exitTime;
  }
}

/** Glide ratio right now (horizontal distance per height lost), for the flight-data HUD. */
export function currentLD(p: Plane): number {
  return p.CD > 1e-4 ? p.CL / p.CD : 0;
}
