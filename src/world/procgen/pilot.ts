/**
 * The reference pilot: a small autopilot that flies a paper plane through one generated room.
 *
 * What it does (and why it is enough to prove a room flyable):
 * - holds the plane's hands-off trim speed with the elevator (damps the phugoid, recovers dives and stalls);
 * - climbs in floor-vent columns by turning back and forth over them (each turnaround hovers in the updraft);
 *   it only climbs where it needs to, leaves on the exit side once the updraft has topped out, and dives a little if
 *   it would arrive above the doorway's lintel;
 * - leaves up through a ceiling opening by thermalling under it, and goes down a floor opening by spiralling over it;
 * - lands on the workbench desk by hovering down over it.
 * It never reads obstacles: the generator keeps the flight corridor clear, and the simulator is the judge.
 */

import { PX_PER_M, ROOM_H } from '../../physics/config';
import type { FlightInput, Plane } from '../../physics/flight';
import type { RefPlane } from './fleet';
import type { Side } from './types';

export interface PilotSpec {
  /** Direction of progress along x (+1 = right). */
  dirX: 1 | -1;
  exit: Side;
  /** Floor vents the pilot may climb in: centre x, width and the height (px) the updraft tops out at. */
  vents: { cx: number; w: number; top: number }[];
  /** Horizontal exits: leave below this height (px, y down) so the next room can be entered. */
  yc: number;
  /** The exit leads out of the house: nobody enters a next room, so the height it is reached at does not matter. */
  final?: boolean;
  /** Top of the exit doorway (px): never arrive above it. */
  doorTop: number;
  /** Centre x of the ceiling / floor opening for `up` / `down` exits. */
  holeCx?: number;
  /** Land on this desk top (x-range and surface y) instead of leaving the room. */
  land?: { x0: number; x1: number; top: number };
}

/** The pilot leaves a vent once it has climbed to within this many px of the height the updraft tops out at. */
const TOP_MARGIN = 45;
/** Give up on a vent after this long (real s). */
const THERMAL_MAX = 14;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Glide slope (px dropped per px) of a design flying at its trim, used for planning. */
export function glideSlope(plane: RefPlane): number {
  const ld = plane.aero.perf.trim?.LD ?? plane.aero.perf.LDmax;
  return clamp(1 / Math.max(2, ld), 0.15, 0.32);
}

/** Elevator command that holds the trim speed, with a dead band; strong nose-down below the stall margin. */
function holdSpeed(plane: RefPlane, p: Plane): number {
  if (p.V < 0.5) return 0; // the first tick has no airspeed yet
  const dv = p.V - plane.vTrim;
  let pitch = 0;
  if (Math.abs(dv) > 0.3) pitch = clamp(0.9 * (dv - Math.sign(dv) * 0.3), -1, 1);
  if (p.V < plane.vLow || p.stall > 0.4) pitch = -0.7;
  // never let a dive get steep once the wings are flying again (recover early: a plane pulls out slowly)
  else if (p.theta < -0.5) pitch = 1;
  return pitch;
}

export type Pilot = (p: Plane, t: number) => FlightInput;

export function makePilot(plane: RefPlane, spec: PilotSpec, debug?: (s: string) => void): Pilot {
  const st = { thermal: -1, done: new Set<number>(), t0: 0, spiral: false };
  const dirX = spec.dirX;
  const land = spec.land;
  const landCx = land ? (land.x0 + land.x1) / 2 : 0;
  // where the pilot is heading: the exit wall, or the middle of the desk it wants to land on
  const goalX = land ? landCx : dirX > 0 ? 640 : 0;
  // the height it wants to be at when it gets there
  const goalY = land ? land.top - 40 : spec.yc;
  const slope = glideSlope(plane);
  let last = '';

  return (p, t) => {
    const x = p.x * PX_PER_M;
    const y = ROOM_H - p.y * PX_PER_M;
    if (debug) {
      const s = `th${st.thermal} sp${st.spiral ? 1 : 0}`;
      if (s !== last) debug(`${t.toFixed(2)}s x${Math.round(x)} y${Math.round(y)} -> ${s}`);
      last = s;
    }
    const pitch = holdSpeed(plane, p);

    /** Fly straight in the direction of progress (turning round first if needed). */
    const heading = (pit = pitch): FlightInput => (p.facing !== dirX && !p.turn ? { dir: dirX, pitch: pit, boost: false } : { dir: 0, pitch: pit, boost: false });

    /** Turn back and forth over `c` (hovering in the column during each turnaround). */
    const oscillate = (c: number): FlightInput => {
      if (p.turn) return { dir: 0, pitch, boost: false };
      if (x > c && p.facing > 0) return { dir: -1, pitch, boost: false };
      if (x < c && p.facing < 0) return { dir: 1, pitch, boost: false };
      return { dir: 0, pitch, boost: false };
    };

    // ---- ceiling opening: climb the column under it
    if (!land && spec.exit === 'up') {
      const c = spec.holeCx ?? 320;
      if (!st.spiral && (c - x) * dirX < 60) st.spiral = true;
      return st.spiral ? oscillate(c) : heading();
    }

    // ---- floor opening: fly over it and spiral down
    if (!land && spec.exit === 'down') {
      const c = spec.holeCx ?? 320;
      if (!st.spiral && (c - x) * dirX < 30) st.spiral = true;
      return st.spiral ? oscillate(c) : heading();
    }

    // ---- side exit or desk landing: climb in vents only as far as needed
    if (st.thermal < 0) {
      for (let i = 0; i < spec.vents.length; i++) {
        if (st.done.has(i)) continue;
        const v = spec.vents[i];
        const ahead = (v.cx - x) * dirX;
        if (ahead < -10) continue;
        if (land && (landCx - v.cx) * dirX < 30) continue; // beyond the desk: not on the way
        const predicted = y + (slope + 0.02) * Math.abs(goalX - v.cx);
        if (ahead < 70 && predicted > goalY - 25) {
          st.thermal = i;
          st.t0 = t;
          break;
        }
      }
    }
    if (st.thermal >= 0) {
      const v = spec.vents[st.thermal];
      // The updraft tops out at `v.top`, so the plane cannot overshoot into the ceiling. It leaves on the exit side of
      // the column as soon as it is near that height (a turnaround would only waste the lift).
      if (y <= v.top + TOP_MARGIN && p.facing === dirX && !p.turn) {
        st.done.add(st.thermal);
        st.thermal = -1;
      } else if (t - st.t0 > THERMAL_MAX) {
        st.done.add(st.thermal);
        st.thermal = -1;
      } else {
        return oscillate(v.cx);
      }
    }

    // ---- landing: hover down over the desk (turnarounds lose height quickly) until the plane settles on it
    if (land) {
      if (!st.spiral && (landCx - x) * dirX < 30) st.spiral = true;
      return st.spiral ? oscillate(landCx) : heading();
    }

    // ---- cruise: do not arrive above the doorway's lintel (dive if the glide would end too high; vent columns
    // passed on the way hold the plane up, so look at the height now rather than trusting the nominal glide alone)
    let pit = pitch;
    if (spec.exit === 'left' || spec.exit === 'right') {
      const D = Math.abs(goalX - x);
      const limit = spec.doorTop + 36;
      // the slope needed to arrive at the limit, against the plane's natural glide: dive in proportion to the shortfall
      // (a climbing plane zooms on for vy^2 / 2g more before it levels off)
      const climb = Math.max(0, p.vy);
      const yEff = y - climb * climb * 6.5;
      const sReq = (limit - yEff) / Math.max(30, D);
      if (sReq > slope * 1.05 && D > 20) pit = Math.min(pit, -clamp((sReq - slope) * 6, 0, 0.85));
    }
    return heading(pit);
  };
}
