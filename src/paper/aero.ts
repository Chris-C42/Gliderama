/**
 * Aerodynamic analysis of a folded plane.
 *
 * Everything is derived from the folded geometry: a rasterised planform (in the wing's own
 * (u, v) frame) for areas, chords, sweep and the aerodynamic centre, and the 3D pieces for mass,
 * centre of gravity and inertia. The coefficient model is a semi-empirical low-Reynolds flat-plate
 * model with stall, vortex lift for slender sharp-edged deltas, and a moving centre of pressure.
 */

import type { Design } from './design';
import { PAPER_STOCKS } from './design';
import type { PlaneBuild, V3 } from './build';
import { buildPlane } from './build';
import { P2, signedArea } from './geom';

export const RHO = 1.225; // kg/m³
export const G = 9.81; // m/s²
const NU = 1.5e-5; // m²/s
const DEG = Math.PI / 180;

/** Mass of extras (kg). */
const CLIP_MASS = 0.0006;
const TAPE_MASS = 0.00015;
const GADGET_MASS: Record<Design['extras']['gadget'], number> = {
  none: 0,
  battery: 0.0018,
  bands: 0.0004,
  helium: 0.0002,
};

/** Curled paper flaps act like reflex camber: boost to the flap's own pitching moment. */
const REFLEX = 1.8;

/** Player elevator authority: maximum control deflection (rad). */
export const CONTROL_MAX = 10 * DEG;

export interface Friendly {
  glide: number;
  speed: number;
  float: number;
  stability: number;
  agility: number;
  toughness: number;
}

export interface Perf {
  LDmax: number;
  alphaBest: number;
  vBest: number;
  sinkMin: number;
  vStall: number;
  /** Hands-off trim (null = no stable trim). */
  trim: { alpha: number; CL: number; v: number; LD: number; sink: number } | null;
  /** Estimated time for a turnaround (s, real time). */
  turnTime: number;
}

export interface AeroModel {
  ok: boolean;
  mass: number;
  /** Centre of gravity in plane-local mm (X forward, Y up). */
  cg: V3;
  Iyy: number;
  Ixx: number;
  S: number;
  Strue: number;
  span: number;
  AR: number;
  ARe: number;
  MAC: number;
  sweepLE: number;
  dihedral: number;
  keelArea: number;
  wingletArea: number;
  length: number;
  /** Positions measured aft of the nose tip, mm (for the engineer view). */
  posCG: number;
  posAC: number;
  SM: number;
  CLa: number;
  alphaStall: number;
  stallWidth: number;
  Kv: number;
  CD0: number;
  K: number;
  e: number;
  Cmq: number;
  /** Design elevator flaps: lift / moment derivatives per rad of TE-DOWN deflection (strip theory). */
  flapCLd: number;
  flapCmd: number;
  flapDrag: number;
  /** Player control authority (virtual trailing-edge control + real flaps), per rad TE-down. */
  ctrlCLd: number;
  ctrlCmd: number;
  /** Design elevator angle (rad, TE up positive). */
  trimDelta: number;
  wingLoading: number;
  toughness: number;
  layersAvg: number;
  noseLayers: number;
  waterproof: boolean;
  heatproof: boolean;
  absorbency: number;
  gadget: Design['extras']['gadget'];
  perf: Perf;
  friendly: Friendly;
  warnings: string[];
}

/** Optional modifiers from damage / environment. */
export interface AeroMods {
  liftMul: number;
  dragAdd: number;
  cmAdd: number;
  stallMul: number;
}

export const NO_MODS: AeroMods = { liftMul: 1, dragAdd: 0, cmAdd: 0, stallMul: 1 };

export interface Coeffs {
  CL: number;
  CD: number;
  Cm: number;
  /** 0 = attached flow, 1 = fully stalled. */
  stall: number;
}

function smooth01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function wrapPi(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Aerodynamic coefficients about the CG.
 * @param alpha angle of attack (rad), any value (wrapped)
 * @param ctrl player elevator deflection (rad, TE up positive = nose up)
 * @param qhat non-dimensional pitch rate q·MAC/(2V)
 */
export function coeffs(m: AeroModel, alpha: number, ctrl: number, qhat: number, mods: AeroMods = NO_MODS): Coeffs {
  let a = wrapPi(alpha);
  // Flying backwards: treat as a plate with reversed chord; lift sign handled by sin/cos forms.
  const backwards = Math.abs(a) > Math.PI / 2;
  const sa = Math.sin(a);
  const ca = Math.cos(a);
  const as = m.alphaStall * mods.stallMul;
  const absA = backwards ? Math.PI - Math.abs(a) : Math.abs(a);
  const stall = backwards ? 1 : smooth01((absA - as) / m.stallWidth);

  const CLa = m.CLa * mods.liftMul;
  // Attached: potential + vortex lift.
  const clPot = CLa * sa * ca;
  const clVort = m.Kv * mods.liftMul * sa * Math.abs(sa) * Math.abs(ca);
  const clAtt = clPot + clVort;
  // Separated: flat-plate normal force.
  const cn = 1.15 * sa;
  const clSep = cn * ca;
  let CL = (1 - stall) * clAtt + stall * clSep;

  // Elevator flaps (design trim + player control), losing authority when stalled.
  const flapEff = 1 - 0.65 * stall;
  const dCLtrim = -m.flapCLd * m.trimDelta * flapEff;
  const dCLctrl = -m.ctrlCLd * ctrl * flapEff;
  CL += dCLtrim + dCLctrl;

  const cd0 = m.CD0 + mods.dragAdd;
  const cdAtt = cd0 + m.K * clAtt * clAtt + clVort * Math.abs(Math.tan(Math.min(absA, 1.2))) * 0.5;
  const cdSep = cd0 + Math.abs(cn * sa) + 0.02;
  const CD =
    (1 - stall) * cdAtt +
    stall * cdSep +
    m.flapDrag * (m.trimDelta * m.trimDelta + ctrl * ctrl) +
    (backwards ? 0.3 : 0);

  // Moment: normal force at the centre of pressure. CP moves aft when stalled.
  const CN = clAtt * ca * (1 - stall) + cn * stall + cdAtt * sa * (1 - stall) * 0.0;
  const smEff = m.SM + stall * 0.22 + (backwards ? -0.6 : 0);
  let Cm = -CN * smEff;
  Cm += -(m.flapCmd * m.trimDelta + m.ctrlCmd * ctrl) * flapEff;
  Cm += m.Cmq * qhat;
  Cm += mods.cmAdd;
  return { CL, CD, Cm, stall };
}

// ---------------------------------------------------------------------------------------------

interface Grid {
  h: number;
  u0: number;
  v0: number;
  nu: number;
  nv: number;
  /** Layer counts per cell. */
  count: Uint16Array;
}

function rasterize(polys: P2[][], h: number): Grid {
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const p of polys)
    for (const q of p) {
      uMin = Math.min(uMin, q.x);
      uMax = Math.max(uMax, q.x);
      vMin = Math.min(vMin, q.y);
      vMax = Math.max(vMax, q.y);
    }
  if (!Number.isFinite(uMin)) return { h, u0: 0, v0: 0, nu: 0, nv: 0, count: new Uint16Array(0) };
  const u0 = Math.floor(uMin / h) * h;
  const v0 = Math.floor(vMin / h) * h;
  const nu = Math.max(1, Math.ceil((uMax - u0) / h) + 1);
  const nv = Math.max(1, Math.ceil((vMax - v0) / h) + 1);
  const count = new Uint16Array(nu * nv);
  for (const poly of polys) {
    // ensure positive orientation for the inside test
    const pts = signedArea(poly) >= 0 ? poly : poly.slice().reverse();
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const q of pts) {
      a0 = Math.min(a0, q.x);
      a1 = Math.max(a1, q.x);
      b0 = Math.min(b0, q.y);
      b1 = Math.max(b1, q.y);
    }
    const i0 = Math.max(0, Math.floor((a0 - u0) / h));
    const i1 = Math.min(nu - 1, Math.ceil((a1 - u0) / h));
    const j0 = Math.max(0, Math.floor((b0 - v0) / h));
    const j1 = Math.min(nv - 1, Math.ceil((b1 - v0) / h));
    const n = pts.length;
    for (let j = j0; j <= j1; j++) {
      const cv = v0 + (j + 0.5) * h;
      for (let i = i0; i <= i1; i++) {
        const cu = u0 + (i + 0.5) * h;
        let inside = true;
        for (let k = 0; k < n; k++) {
          const p = pts[k];
          const q = pts[(k + 1) % n];
          if ((q.x - p.x) * (cv - p.y) - (q.y - p.y) * (cu - p.x) < -1e-9) {
            inside = false;
            break;
          }
        }
        if (inside) count[j * nu + i]++;
      }
    }
  }
  return { h, u0, v0, nu, nv, count };
}

function clamp(x: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, x));
}

function scale10(x: number, lo: number, hi: number): number {
  return clamp(((x - lo) / (hi - lo)) * 10, 0, 10);
}

export function analyzeBuild(design: Design, build: PlaneBuild): AeroModel {
  const warnings: string[] = [...build.errors];
  const stock = PAPER_STOCKS[design.paper.stock];
  const areal = stock.gsm * 1e-9; // kg per mm²

  // ---- Mass properties (both halves) -----------------------------------------------------------
  let mass = 0;
  let mx = 0;
  let my = 0;
  interface PM {
    m: number;
    x: number;
    y: number;
    z: number;
    self: number;
  }
  const pms: PM[] = [];
  for (const piece of build.pieces) {
    const p3 = piece.p3;
    for (let i = 1; i < p3.length - 1; i++) {
      const a = p3[0];
      const b = p3[i];
      const c = p3[i + 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const abz = b.z - a.z;
      const acx = c.x - a.x;
      const acy = c.y - a.y;
      const acz = c.z - a.z;
      const cx = aby * acz - abz * acy;
      const cy = abz * acx - abx * acz;
      const cz = abx * acy - aby * acx;
      const area = 0.5 * Math.hypot(cx, cy, cz);
      const m = area * areal * 2; // both halves
      const gx = (a.x + b.x + c.x) / 3;
      const gy = (a.y + b.y + c.y) / 3;
      const gz = (a.z + b.z + c.z) / 3;
      const e2 = abx * abx + aby * aby + abz * abz + acx * acx + acy * acy + acz * acz;
      pms.push({ m, x: gx, y: gy, z: gz, self: (m * e2) / 36 });
      mass += m;
      mx += m * gx;
      my += m * gy;
    }
  }
  const paperMass = mass;
  // keel helper: position on the keel at table y (fraction down the keel depth)
  const { r0, dir, out } = build.root;
  const keelPos = (yTable: number, depthFrac: number): V3 => {
    const d = design.wing.d0 + ((design.wing.d1 - design.wing.d0) * yTable) / build.length;
    const p = { x: d * (1 - depthFrac), y: yTable };
    const u = (p.x - r0.x) * dir.x + (p.y - r0.y) * dir.y;
    const v = (p.x - r0.x) * out.x + (p.y - r0.y) * out.y;
    return { x: -u, y: Math.min(0, v), z: 0 };
  };
  const addPoint = (m: number, p: V3) => {
    pms.push({ m, x: p.x, y: p.y, z: p.z, self: 0 });
    mass += m;
    mx += m * p.x;
    my += m * p.y;
  };
  for (const y of design.extras.clips.slice(0, 3)) addPoint(CLIP_MASS, keelPos(clamp(y, 0, build.length), 0.55));
  for (let i = 0; i < design.extras.tape; i++) addPoint(TAPE_MASS, keelPos(build.length * 0.18, 0.3));
  if (design.extras.gadget !== 'none') addPoint(GADGET_MASS[design.extras.gadget], keelPos(build.length * 0.25, 0.4));
  let coatingMul = 1;
  if (design.extras.coating === 'wax') coatingMul = 1.06;
  if (design.extras.coating === 'foil') coatingMul = 1.2;
  mass = paperMass * coatingMul + (mass - paperMass);
  // coatings scale the paper mass uniformly → CG unchanged by that part (approx).
  const cg: V3 = { x: mx / (mass - paperMass * (coatingMul - 1)), y: my / (mass - paperMass * (coatingMul - 1)), z: 0 };
  let Iyy = 0;
  let Ixx = 0;
  for (const p of pms) {
    const dx = (p.x - cg.x) / 1000;
    const dy = (p.y - cg.y) / 1000;
    const dz = p.z / 1000;
    Iyy += p.m * (dx * dx + dy * dy) + (p.self * 0.5) / 1e6;
    Ixx += p.m * (dy * dy + dz * dz) + (p.self * 0.5) / 1e6;
  }
  Iyy *= coatingMul;
  Ixx *= coatingMul;

  // ---- Planform (right half, flat wing frame u/v) ----------------------------------------------
  const H = 2; // mm grid
  const wingPolys = build.pieces.filter((p) => p.region === 'wing' || p.region === 'flap').map((p) => p.uv);
  const wingletPolys = build.pieces.filter((p) => p.region === 'winglet').map((p) => p.uv);
  const keelPolys = build.pieces.filter((p) => p.region === 'keel').map((p) => p.uv);
  const grid = rasterize(wingPolys, H);
  const cellA = H * H;
  let cells = 0;
  let layerSum = 0;
  const rowChord: number[] = [];
  const rowLE: number[] = [];
  const rowTE: number[] = [];
  const rowV: number[] = [];
  for (let j = 0; j < grid.nv; j++) {
    let n = 0;
    let le = Infinity;
    let te = -Infinity;
    for (let i = 0; i < grid.nu; i++) {
      const c = grid.count[j * grid.nu + i];
      if (c > 0) {
        n++;
        layerSum += c;
        const u = grid.u0 + (i + 0.5) * H;
        le = Math.min(le, u - H / 2);
        te = Math.max(te, u + H / 2);
      }
    }
    const v = grid.v0 + (j + 0.5) * H;
    if (n > 0 && v > 0) {
      cells += n;
      rowChord.push(n * H);
      rowLE.push(le);
      rowTE.push(te);
      rowV.push(v);
    }
  }
  const Shalf = cells * cellA; // mm²
  const layersAvg = cells > 0 ? layerSum / cells : 1;
  const G_ = build.dihedral;
  const cosG = Math.cos(G_);
  const vMax = rowV.length ? Math.max(...rowV) + H / 2 : 1;

  // winglet geometry
  const wlGrid = rasterize(wingletPolys, H);
  let wlCells = 0;
  for (let k = 0; k < wlGrid.count.length; k++) if (wlGrid.count[k] > 0) wlCells++;
  const wingletArea = wlCells * cellA * 2; // both sides, mm²
  const wlAngle = build.winglet ? Math.abs(build.winglet.angle) * DEG : 0;
  let wlSpan = 0;
  if (build.winglet) {
    for (const p of wingletPolys) for (const q of p) wlSpan = Math.max(wlSpan, q.y);
    wlSpan = Math.max(0, wlSpan - Math.min(...wingletPolys.flat().map((q) => q.y)));
  }
  const wlHeight = wlSpan * Math.sin(wlAngle);
  const wlSpanProj = wlSpan * Math.cos(wlAngle);
  // A shallow winglet still counts as wing area (projected).
  const wlPlanform = wlAngle < 50 * DEG ? (wingletArea / 2) * Math.cos(wlAngle) : 0;

  const SprojHalf = Shalf * cosG + wlPlanform;
  const S = (2 * SprojHalf) / 1e6; // m²
  const Strue = (2 * Shalf + wingletArea) / 1e6;
  const spanMm = 2 * (vMax * cosG + (build.winglet ? wlSpanProj : 0));
  const span = spanMm / 1000;
  const AR = S > 0 ? (span * span) / S : 0.1;

  // MAC and AC
  let mac = 0;
  let uqc = 0;
  for (let k = 0; k < rowChord.length; k++) {
    const c = rowChord[k];
    mac += c * c * H;
    uqc += c * (rowLE[k] + 0.25 * c) * H;
  }
  mac = Shalf > 0 ? mac / Shalf : 50;
  uqc = Shalf > 0 ? uqc / Shalf : 0;
  // Area centroid (cells counted once)
  let uc = 0;
  for (let j = 0; j < grid.nv; j++)
    for (let i = 0; i < grid.nu; i++)
      if (grid.count[j * grid.nu + i] > 0 && grid.v0 + (j + 0.5) * H > 0) uc += grid.u0 + (i + 0.5) * H;
  const uArea = cells > 0 ? uc / cells : uqc;
  const wSlender = clamp((3 - AR) / 2.5, 0, 0.4);
  const uAC = uqc + (uArea - uqc) * wSlender;

  // Sweep (chord-weighted regression of LE and mid-chord vs v)
  const regress = (ys: number[]) => {
    let sw = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let k = 0; k < rowV.length; k++) {
      const w = rowChord[k];
      const x = rowV[k];
      const y = ys[k];
      sw += w;
      sx += w * x;
      sy += w * y;
      sxx += w * x * x;
      sxy += w * x * y;
    }
    const den = sw * sxx - sx * sx;
    return Math.abs(den) < 1e-9 ? 0 : (sw * sxy - sx * sy) / den;
  };
  const sweepLE = Math.atan(Math.max(0, regress(rowLE)));
  const sweepMid = Math.atan(regress(rowLE.map((le, k) => le + 0.5 * rowChord[k])));

  // Keel
  const keelGrid = rasterize(keelPolys, H);
  let keelCells = 0;
  for (let k = 0; k < keelGrid.count.length; k++) if (keelGrid.count[k] > 0) keelCells++;
  const keelArea = (keelCells * cellA) / 1e6; // one side, m²

  // Length / nose position
  let uMin = Infinity;
  let uMax = -Infinity;
  for (const p of build.pieces)
    for (const q of p.uv) {
      uMin = Math.min(uMin, q.x);
      uMax = Math.max(uMax, q.x);
    }
  const length = (uMax - uMin) / 1000;
  const uCG = -cg.x;

  // Static margin
  const MACm = mac / 1000;
  const SM = mac > 0 ? (uAC - uCG) / mac : 0;

  // Effective aspect ratio with winglets
  const ARe = AR * (1 + (1.9 * wlHeight) / Math.max(1, spanMm));
  const kappa = 0.9;
  const tanL = Math.tan(sweepMid);
  let CLa = (2 * Math.PI * ARe) / (2 + Math.sqrt((ARe * ARe * (1 + tanL * tanL)) / (kappa * kappa) + 4));
  CLa *= cosG * cosG;
  const e = clamp(0.9 - 0.035 * AR, 0.62, 0.88) * (build.winglet ? 1.04 : 1);
  const K = 1 / (Math.PI * e * Math.max(0.3, ARe));
  // Sharp paper leading edges keep a leading-edge vortex attached a little longer at low Re.
  const alphaStall = (11 + 21 * Math.exp(-(AR - 0.3) / 1.2)) * DEG;
  const stallWidth = (3.5 + 7 * Math.exp(-(AR - 0.3) / 1.5)) * DEG;
  const Kv = Math.PI * clamp((sweepLE - 45 * DEG) / (25 * DEG), 0, 1) * 0.8;

  // Profile drag
  const Re = (5 * MACm) / NU;
  const Cf = (1.328 / Math.sqrt(Math.max(2000, Re))) * stock.roughness * (design.extras.coating === 'wax' ? 0.94 : 1);
  const Swet = (2 * Shalf * 2 + keelArea * 1e6 * 2 + wingletArea * 2) / 1e6;
  // leading-edge bulk: mean layer count just behind the LE
  let leLayers = 0;
  let leN = 0;
  for (let j = 0; j < grid.nv; j++) {
    for (let i = 0; i < grid.nu; i++) {
      const c = grid.count[j * grid.nu + i];
      if (c > 0) {
        leLayers += c;
        leN++;
        break;
      }
    }
  }
  const leBulk = leN ? leLayers / leN : 1;
  const CD0 =
    (S > 0 ? (Cf * Swet) / S : 0.05) + 0.009 + 0.0022 * Math.max(0, leBulk - 1) + (build.winglet ? 0.003 : 0) + (design.extras.tape > 0 ? 0.0015 * design.extras.tape : 0);

  // Elevator flaps — thin-airfoil plain-flap theory applied strip by strip (TE-down positive).
  const k3D = CLa / (0.9 * 2 * Math.PI);
  const stripFlap = (inRow: (v: number) => boolean, cfOf: (c: number) => number, gain: number) => {
    let cl = 0;
    let cm = 0;
    let area = 0;
    for (let k = 0; k < rowV.length; k++) {
      if (!inRow(rowV[k])) continue;
      const c = rowChord[k];
      const cf = Math.min(0.6, Math.max(0.02, cfOf(c)));
      const th = Math.acos(2 * cf - 1);
      const dCl = 2 * (Math.PI - th + Math.sin(th));
      const dCm = -0.5 * Math.sin(th) * (1 - Math.cos(th));
      const w = c * H;
      const uqcRow = rowLE[k] + 0.25 * c;
      // Paper flaps curl rather than hinge: treat the curl as extra reflex camber (×REFLEX).
      cl += k3D * dCl * w;
      cm += (k3D * dCl * ((uCG - uqcRow) / mac) + REFLEX * k3D * dCm * (c / mac)) * w;
      area += w;
    }
    return { cl: (gain * cl) / Math.max(1, Shalf), cm: (gain * cm) / Math.max(1, Shalf), area };
  };
  let flapCLd = 0;
  let flapCmd = 0;
  let flapStripArea = 0;
  if (build.elevator) {
    const { v0, v1 } = build.elevator;
    const depth = Math.max(3, build.yTE - build.elevator.yh);
    const f = stripFlap((v) => v >= v0 && v <= v1, (c) => depth / Math.max(1, c), 1);
    flapCLd = f.cl;
    flapCmd = f.cm;
    flapStripArea = f.area;
  }
  const flapDrag = 0.5 * (flapStripArea / Math.max(1, Shalf)) + 0.04;

  // Player control: virtual trailing-edge control on the outer 60 % of the span + real flaps.
  const base = stripFlap((v) => v >= 0.4 * vMax, () => 0.16, 0.75);
  const ctrlCLd = base.cl + flapCLd * 0.8;
  const ctrlCmd = base.cm + flapCmd * 0.8;

  // Pitch damping from the planform's second moment about the CG.
  let Iarea = 0;
  for (let j = 0; j < grid.nv; j++)
    for (let i = 0; i < grid.nu; i++)
      if (grid.count[j * grid.nu + i] > 0) {
        const du = grid.u0 + (i + 0.5) * H - uCG;
        Iarea += du * du * cellA;
      }
  const Cmq = Shalf > 0 && mac > 0 ? (-2 * CLa * Iarea) / (Shalf * mac * mac) : -1;

  const trimDelta = build.elevator ? build.elevator.angle * DEG : 0;

  // Toughness & nose layers
  const noseU = uMin + (uMax - uMin) * 0.15;
  let noseCount = 0;
  let noseN = 0;
  const allGrid = rasterize(
    build.pieces.map((p) => p.uv),
    3,
  );
  for (let j = 0; j < allGrid.nv; j++)
    for (let i = 0; i < allGrid.nu; i++) {
      const c = allGrid.count[j * allGrid.nu + i];
      if (c > 0 && allGrid.u0 + (i + 0.5) * 3 < noseU) {
        noseCount += c;
        noseN++;
      }
    }
  const noseLayers = noseN ? noseCount / noseN : 1;
  const toughness =
    stock.toughness * (0.6 + 0.25 * Math.min(4, layersAvg) + 0.1 * Math.min(6, noseLayers)) *
    (1 + 0.35 * design.extras.tape) *
    (design.extras.coating === 'foil' ? 1.25 : 1);

  const wingLoading = S > 0 ? (mass * G) / S : 99;

  const model: AeroModel = {
    ok: build.errors.length === 0 && Shalf > 0,
    mass,
    cg,
    Iyy: Math.max(Iyy, 1e-8),
    Ixx: Math.max(Ixx, 1e-8),
    S: Math.max(S, 1e-4),
    Strue,
    span,
    AR,
    ARe,
    MAC: Math.max(MACm, 0.005),
    sweepLE,
    dihedral: G_,
    keelArea,
    wingletArea: wingletArea / 1e6,
    length,
    posCG: uCG - uMin,
    posAC: uAC - uMin,
    SM,
    CLa,
    alphaStall,
    stallWidth,
    Kv,
    CD0,
    K,
    e,
    Cmq,
    flapCLd,
    flapCmd,
    flapDrag,
    ctrlCLd,
    ctrlCmd,
    trimDelta,
    wingLoading,
    toughness,
    layersAvg,
    noseLayers,
    waterproof: design.extras.coating === 'wax',
    heatproof: design.extras.coating === 'foil',
    absorbency: stock.absorbency * (design.extras.coating === 'wax' ? 0.1 : 1),
    gadget: design.extras.gadget,
    perf: { LDmax: 0, alphaBest: 0, vBest: 0, sinkMin: 0, vStall: 0, trim: null, turnTime: 1 },
    friendly: { glide: 0, speed: 0, float: 0, stability: 0, agility: 0, toughness: 0 },
    warnings,
  };

  model.perf = performance(model);
  model.friendly = friendly(model);
  model.warnings.push(...designWarnings(model));
  return model;
}

/** Steady-glide speed for a given aerodynamic state. */
export function glideSpeed(m: AeroModel, CL: number, CD: number): number {
  const CR = Math.hypot(CL, CD);
  return Math.sqrt((2 * m.mass * G) / (RHO * m.S * Math.max(0.02, CR)));
}

/** Hands-off trim: find the stable equilibrium AoA (Cm = 0, dCm/dα < 0). */
export function findTrim(m: AeroModel, ctrl = 0, mods: AeroMods = NO_MODS): { alpha: number; CL: number; CD: number } | null {
  let prev = coeffs(m, -12 * DEG, ctrl, 0, mods).Cm;
  for (let a = -12 * DEG + 0.25 * DEG; a < 45 * DEG; a += 0.25 * DEG) {
    const c = coeffs(m, a, ctrl, 0, mods).Cm;
    if (prev > 0 && c <= 0) {
      // refine
      let lo = a - 0.25 * DEG;
      let hi = a;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        if (coeffs(m, mid, ctrl, 0, mods).Cm > 0) lo = mid;
        else hi = mid;
      }
      const al = (lo + hi) / 2;
      const r = coeffs(m, al, ctrl, 0, mods);
      return { alpha: al, CL: r.CL, CD: r.CD };
    }
    prev = c;
  }
  return null;
}

function performance(m: AeroModel): Perf {
  let LDmax = 0;
  let alphaBest = 0;
  let sinkMin = Infinity;
  for (let a = 0.5 * DEG; a < m.alphaStall + m.stallWidth; a += 0.25 * DEG) {
    // Polar without trim deflections: the plane's potential.
    const c = coeffs({ ...m, trimDelta: 0 }, a, 0, 0);
    if (c.CL <= 0.01) continue;
    const ld = c.CL / c.CD;
    if (ld > LDmax) {
      LDmax = ld;
      alphaBest = a;
    }
    const v = glideSpeed(m, c.CL, c.CD);
    const sink = (v * c.CD) / Math.hypot(c.CL, c.CD);
    sinkMin = Math.min(sinkMin, sink);
  }
  const best = coeffs({ ...m, trimDelta: 0 }, alphaBest, 0, 0);
  const vBest = glideSpeed(m, best.CL, best.CD);
  const st = coeffs({ ...m, trimDelta: 0 }, m.alphaStall, 0, 0);
  const vStall = glideSpeed(m, st.CL, st.CD);
  let trim: Perf['trim'] = null;
  const t = findTrim(m);
  if (t && t.CL > 0.02) {
    const v = glideSpeed(m, t.CL, t.CD);
    trim = { alpha: t.alpha, CL: t.CL, v, LD: t.CL / t.CD, sink: (v * t.CD) / Math.hypot(t.CL, t.CD) };
  }
  // Turnaround: bank-and-yank; slower for big span/inertia/dihedral, faster when fast.
  const rollRef = Math.sqrt(m.Ixx / Math.max(1e-6, m.mass)) / 0.05; // radius of gyration vs 5 cm
  const turnTime = clamp(0.32 + 0.38 * rollRef + 0.5 * Math.sin(Math.max(0, m.dihedral)) + (m.keelArea / Math.max(1e-4, m.S)) * 0.25, 0.3, 1.6);
  return { LDmax, alphaBest, vBest, sinkMin: Number.isFinite(sinkMin) ? sinkMin : 9, vStall, trim, turnTime };
}

function friendly(m: AeroModel): Friendly {
  const ld = m.perf.trim ? Math.max(m.perf.trim.LD, m.perf.LDmax * 0.6) : m.perf.LDmax * 0.5;
  const v = m.perf.trim ? m.perf.trim.v : m.perf.vBest;
  return {
    glide: scale10(ld, 2, 7),
    speed: scale10(v, 1.8, 5.5),
    float: scale10(Math.log(1 / m.wingLoading), Math.log(1 / 6), Math.log(1 / 0.6)),
    stability: m.SM <= 0 ? 0 : scale10(Math.min(m.SM, 0.3), -0.01, 0.16),
    agility: clamp(10 - (m.perf.turnTime - 0.3) * 8 - Math.max(0, m.SM - 0.15) * 15, 0, 10),
    toughness: scale10(m.toughness, 0.3, 3.2),
  };
}

function designWarnings(m: AeroModel): string[] {
  const w: string[] = [];
  if (m.SM < 0) w.push('Unstable: it will tumble. Add nose weight (more nose folds or a paperclip).');
  else if (m.SM < 0.03) w.push('Twitchy: barely stable. A little nose weight would calm it down.');
  else if (m.SM > 0.3) w.push('Very nose-heavy: sluggish and dives. Bend the elevators up or lose some weight.');
  if (m.SM >= 0) {
    if (!m.perf.trim) w.push('Dives when hands-off: bend the elevator flaps up a little.');
    else if (m.perf.trim.CL < 0.12) w.push('Noses down hands-off: a touch more up-elevator would help.');
    else if (m.perf.trim.alpha > m.alphaStall * 0.95) w.push('Stalls when hands-off: reduce the elevator bend.');
  }
  if (m.AR > 9) w.push('Very long, thin wings: fragile and slow to turn.');
  return w;
}

/** Convenience: build + analyse in one go. */
export function analyzeDesign(design: Design): { build: PlaneBuild; aero: AeroModel } {
  const build = buildPlane(design);
  const aero = analyzeBuild(design, build);
  return { build, aero };
}

