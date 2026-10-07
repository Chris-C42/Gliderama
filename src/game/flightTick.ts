/**
 * One game tick of flying: physics step + collisions + damage + grounding. Shared by the live
 * Session and the headless simulator (level validation, sandbox auto-tests).
 */

import type { AeroModel } from '../paper/aero';
import { PHYS, PX_PER_M } from '../physics/config';
import { applyImpact, ignite, soakUp, structural, type PartName } from '../physics/damage';
import { planePx, stepPlane, type FlightInput, type Plane, type WindFn } from '../physics/flight';
import type { Collider } from '../world/types';
import { bounds, polyVsBox, worldHull, type V } from './collide';

export interface TickState {
  plane: Plane;
  aero: AeroModel;
  hullLocal: V[];
  /** Half the plane length in pixels (for working out which part hit). */
  halfLen: number;
  groundT: number;
  stillT: number;
}

export interface TickEvents {
  impact?(part: PartName, impact: number, added: number, kind: string): void;
  water?(): void;
  fire?(): void;
  /** Skating along spilt grease. */
  slide?(): void;
}

export type TickOutcome = 'ok' | 'grounded' | 'crashed';

export function turnSquash(p: Plane): number {
  return p.turn ? Math.max(0.35, Math.abs(Math.cos(Math.PI * (p.turn.t / p.turn.dur)))) : 1;
}

export function planeHull(st: TickState): V[] {
  const p = st.plane;
  const pos = planePx(p);
  return worldHull(st.hullLocal, pos.x, pos.y, p.theta, p.facing, turnSquash(p));
}

function partAt(st: TickState, cx: number, cy: number, pos: { x: number; y: number }, ny: number, rand: () => number): PartName {
  const p = st.plane;
  const nose = { x: Math.cos(p.theta) * p.facing, y: -Math.sin(p.theta) };
  const s = ((cx - pos.x) * nose.x + (cy - pos.y) * nose.y) / Math.max(4, st.halfLen);
  if (s > 0.45) return 'nose';
  if (s < -0.5) return 'tail';
  if (ny > 0.6) return 'body';
  return rand() < 0.5 ? 'wingL' : 'wingR';
}

/**
 * Advance one tick. `colliders` are room-pixel boxes. Returns whether the flight continues.
 */
export function flightTick(
  st: TickState,
  input: FlightInput,
  wind: WindFn,
  colliders: Collider[],
  dt: number,
  opts: { slowMo?: boolean; rand?: () => number } = {},
  ev: TickEvents = {},
): TickOutcome {
  const p = st.plane;
  const rand = opts.rand ?? Math.random;
  stepPlane(p, input, wind, dt, { slowMo: opts.slowMo });
  // (a plane hanging from a helium balloon only bumps: as in Glider PRO, a wall or a ceiling does it no harm and
  // doesn't hold it back; something sharp still does)
  const hung = p.balloon;

  const pos0 = planePx(p);
  const squash = turnSquash(p);
  let hullW = worldHull(st.hullLocal, pos0.x, pos0.y, p.theta, p.facing, squash);
  let resting = false;
  // spilt grease lies on top of what it was spilt on: it is met first
  const ordered = colliders.some((c) => c.kind === 'slick') ? [...colliders].sort((a, b) => +(b.kind === 'slick') - +(a.kind === 'slick')) : colliders;
  for (let iter = 0; iter < 3; iter++) {
    let hit = false;
    const bb = bounds(hullW);
    for (const c of ordered) {
      if (bb.x1 < c.x || bb.x0 > c.x + c.w || bb.y1 < c.y || bb.y0 > c.y + c.h) continue;
      const ct = polyVsBox(hullW, c);
      if (!ct) continue;
      const nx = ct.nx;
      const ny = -ct.ny; // physics frame (y up)
      const kind = c.kind ?? 'solid';
      // a slick only holds a plane coming down onto it; from the side or below it is just a smear
      if (kind === 'slick' && ny < 0.5) continue;
      hit = true;
      const vn = p.vx * nx + p.vy * ny;
      if (ny > 0.65 && kind !== 'slick') resting = true;
      if (kind === 'slick') ev.slide?.();
      if (kind === 'fire') {
        if (ignite(p.damage, st.aero)) ev.fire?.();
      }
      if (kind === 'water') {
        soakUp(p.damage, 0.3, st.aero);
        ev.water?.();
      }
      if (vn < 0) {
        const impact = -vn;
        const sev = kind === 'slick' ? 0 : (impact - PHYS.safeImpact) * (kind === 'soft' ? 0.35 : kind === 'sharp' ? 2.5 : 1) * (kind === 'sharp' ? 1 : 1 - hung);
        if (sev > 0) {
          const pos = planePx(p);
          const part = partAt(st, ct.px, ct.py, pos, ny, rand);
          const added = applyImpact(p.damage, part, sev, st.aero.toughness, rand);
          ev.impact?.(part, impact, added, kind);
        } else if (impact > 0.4 && kind !== 'slick') ev.impact?.('body', impact, 0, kind);
        const e = kind === 'soft' || kind === 'slick' ? 0 : PHYS.restitution;
        let vx = p.vx - (1 + e) * vn * nx;
        let vy = p.vy - (1 + e) * vn * ny;
        const vn2 = vx * nx + vy * ny;
        const tx = vx - vn2 * nx;
        const ty = vy - vn2 * ny;
        const f0 = kind === 'slick' ? 1 : kind === 'sticky' ? 0.2 : kind === 'soft' ? 0.6 : PHYS.friction;
        const f = kind === 'sticky' ? f0 : f0 + (1 - f0) * hung;
        vx = vn2 * nx + tx * f;
        vy = vn2 * ny + ty * f;
        p.vx = vx;
        p.vy = vy;
        // skating on grease levels the plane off instead of kicking it (and doesn't stop a turnaround)
        if (kind === 'slick') {
          p.q *= 0.5;
          p.theta *= 0.9;
        } else p.q += -Math.sign(ny || 1) * Math.min(6, impact * 1.5) * 0.3 * (1 - hung);
        if (p.turn && kind !== 'slick') {
          p.turn = null;
          p.facing = p.vx >= 0 ? 1 : -1;
        }
      }
      p.x += (nx * ct.depth) / PX_PER_M;
      p.y += (ny * ct.depth) / PX_PER_M;
      const np = planePx(p);
      hullW = worldHull(st.hullLocal, np.x, np.y, p.theta, p.facing, squash);
      break;
    }
    if (!hit) break;
  }

  const speed = Math.hypot(p.vx, p.vy);
  if (resting && speed < PHYS.groundSpeed) st.groundT += dt * PHYS.timeScale;
  else st.groundT = Math.max(0, st.groundT - dt);
  if (speed < 0.12) st.stillT += dt;
  else st.stillT = 0;
  if (structural(p.damage) >= 1) return 'crashed';
  if (st.groundT > PHYS.groundTime || st.stillT > 1.5) return 'grounded';
  return 'ok';
}
