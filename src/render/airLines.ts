/**
 * Air currents drawn the Glider way: squiggly blue lines from each vent, fan, candle or fire to exactly
 * where its air stops. Each line is a static strip of pixel points; the squiggle, its drift along the
 * flow and the dashes are animated in the vertex shader, so nothing is rebuilt per frame. Switching a
 * fan on grows its lines out of the blades; switching it off lets the last of the air flow away.
 */

import * as THREE from 'three';
import { LIGHT_GLSL, type LightUniforms } from './lit';

export interface AirPoint {
  x: number;
  y: number;
}

/** The shape of one air current (room px), described by the object that makes it. */
export interface AirFlow {
  /** Streamlines from the source to where the air stops, each a polyline in flow order. */
  lines: AirPoint[][];
  /** Peak strength (m/s): sets how fast the squiggles drift. */
  power: number;
  /** Rising heat (candles, fires, radiators, drafts) shimmers; blown air (vents, fans, steam) streams. */
  warm?: boolean;
  /** Px at the end of each line over which the air dies away gradually; 0 is a crisp stop. */
  fade?: number;
  /** Whether the air is moving right now (fans and vents on a switch). */
  on?(): boolean;
}

const MAX_FLOWS = 32;
/** The drift wraps at a common multiple of the wavelengths and the dash period, so it never jumps. */
const WRAP = 96;
/** Seconds for lines to grow out of a source that switches on (or flow away when it stops). */
const GROW = 0.7;

const CORE = new THREE.Color('#a9dcff');
const DEEP = new THREE.Color('#3567c2');

interface FlowState {
  def: AirFlow;
  on: boolean;
  head: number;
  tail: number;
  shift: number;
  speed: number;
}

export class AirLines {
  readonly points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private flows: FlowState[] = [];
  private head = new Array<number>(MAX_FLOWS).fill(1);
  private tail = new Array<number>(MAX_FLOWS).fill(0);
  private shift = new Array<number>(MAX_FLOWS).fill(0);
  private last = -1;
  private shown = true;

  constructor(light: LightUniforms) {
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      uniforms: {
        ...light,
        uHead: { value: this.head },
        uTail: { value: this.tail },
        uShift: { value: this.shift },
        uCore: { value: CORE },
        uDeep: { value: DEEP },
      },
      vertexShader: /* glsl */ `
        in vec2 nrm;  // the axis the squiggle swings along (across the line)
        in vec4 a0;   // s (px from the source), line length, phase, flow index
        in vec2 a1;   // warm, fade px
        uniform float uHead[${MAX_FLOWS}];
        uniform float uTail[${MAX_FLOWS}];
        uniform float uShift[${MAX_FLOWS}];
        uniform vec3 uCore;
        uniform vec3 uDeep;
        out float vKeep;
        out vec3 vCol;
        ${LIGHT_GLSL}

        float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

        void main() {
          float s = a0.x;
          float len = a0.y;
          float ph = a0.z;
          int fi = int(a0.w + 0.5);
          float warm = a1.x;
          float fade = a1.y;
          float u = s / len;
          float travel = s - uShift[fi];
          // the squiggle widens away from the source; heat shimmers as it rises
          float amp = mix(0.6, 2.0, sqrt(u)) * (1.0 + warm * 0.3 * sin(uTime * 2.1 + ph * 3.0));
          float wl = mix(24.0, 32.0, warm);
          vec2 p = position.xy + nrm * (sin(travel * 6.2831853 / wl + ph) * amp);
          // dashes drifting along the flow: a bright head leading, a thin tail trailing
          float d = fract((travel + ph * 9.5) / 48.0);
          float keep = step(d, 0.7);
          float edge = position.z;
          if (edge > 0.5 && d < 0.1) keep = 0.0;
          // dithered start at the source, and where the air dies away
          keep *= step(hash(s + ph * 31.0), s / 4.0);
          if (fade > 0.0) keep *= step(hash(s * 1.37 + ph), (len - s) / fade);
          // switched on: lines grow out of the source; switched off: the air flows away
          keep *= step(u, uHead[fi]) * step(uTail[fi], u);
          // position.z marks the deep-blue edge, one pixel beside the core (right of a rising line,
          // below a sideways one)
          vec2 pix = floor(p) + nrm * edge;
          vec3 light = roomLight(pix + 0.5);
          float lum = max(light.r, max(light.g, light.b));
          vec3 col = edge > 0.5 ? uDeep : mix(uCore, vec3(0.94, 0.98, 1.0), step(0.62, d));
          vCol = col * clamp(lum / 0.74, 0.34, 1.12);
          vKeep = keep;
          gl_PointSize = 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pix.x + 0.5, 360.0 - pix.y - 0.5, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        in float vKeep;
        in vec3 vCol;
        out vec4 fragColor;
        void main() {
          if (vKeep < 0.5) discard;
          fragColor = vec4(vCol, 1.0);
        }
      `,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    // above the room art, below object sprites (fan blades, flames) and the plane
    this.points.renderOrder = 5;
    this.points.position.z = 5;
  }

  /** Lay out the current room's air currents. */
  set(flows: AirFlow[]): void {
    this.flows = flows.slice(0, MAX_FLOWS).map((def) => {
      const on = def.on ? def.on() : true;
      return { def, on, head: 1, tail: on ? 0 : 1.01, shift: 0, speed: 12 + Math.min(6, def.power) * 6 * (def.warm ? 0.6 : 1) };
    });
    // sample every line once, then lay the samples out twice: all the deep-blue edges first, then the
    // pale cores, so a core is never painted over by a neighbouring line's edge
    const samples: number[] = []; // x, y, swing axis x, y, s, len, phase, flow, warm, fade
    this.flows.forEach((f, fi) => {
      f.def.lines.forEach((line, li) => {
        const ph = (li * 2.39996 + fi * 1.618) % (Math.PI * 2);
        let len = 0;
        for (let k = 1; k < line.length; k++) len += Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y);
        if (len < 2) return;
        let s = 0;
        for (let k = 1; k < line.length; k++) {
          const a = line[k - 1];
          const b = line[k];
          const seg = Math.hypot(b.x - a.x, b.y - a.y);
          if (seg <= 0) continue;
          // one sample per pixel along the major axis and the squiggle across it: a clean
          // single-pixel line with no doubled corners, like a hand-drawn one
          const vert = Math.abs(b.y - a.y) >= Math.abs(b.x - a.x);
          const steps = Math.max(1, Math.round(Math.abs(vert ? b.y - a.y : b.x - a.x)));
          for (let q = 0; q < steps; q++) {
            const t = q / steps;
            samples.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, vert ? 1 : 0, vert ? 0 : 1, s + seg * t, len, ph, fi, f.def.warm ? 1 : 0, f.def.fade ?? 0);
          }
          s += seg;
        }
      });
    });
    const count = samples.length / 10;
    const n = count * 2;
    const pos = new Float32Array(n * 3);
    const nrm = new Float32Array(n * 2);
    const a0 = new Float32Array(n * 4);
    const a1 = new Float32Array(n * 2);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < count; i++) {
        const j = pass * count + i;
        const q = i * 10;
        pos[j * 3] = samples[q];
        pos[j * 3 + 1] = samples[q + 1];
        pos[j * 3 + 2] = pass === 0 ? 1 : 0;
        nrm[j * 2] = samples[q + 2];
        nrm[j * 2 + 1] = samples[q + 3];
        for (let c = 0; c < 4; c++) a0[j * 4 + c] = samples[q + 4 + c];
        a1[j * 2] = samples[q + 8];
        a1[j * 2 + 1] = samples[q + 9];
      }
    }
    this.geo.dispose();
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('nrm', new THREE.BufferAttribute(nrm, 2));
    this.geo.setAttribute('a0', new THREE.BufferAttribute(a0, 4));
    this.geo.setAttribute('a1', new THREE.BufferAttribute(a1, 2));
    this.points.geometry = this.geo;
    this.sync();
  }

  /** Hide or show the lines (a setting). */
  setVisible(on: boolean): void {
    this.shown = on;
    this.points.visible = on;
  }

  /** Advance the drift and follow switches; `time` in seconds. */
  update(time: number): void {
    const dt = this.last < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.last));
    this.last = time;
    if (!this.shown) return;
    for (const f of this.flows) {
      const on = f.def.on ? f.def.on() : true;
      if (on !== f.on) {
        f.on = on;
        if (on) {
          f.head = 0;
          f.tail = 0;
        } else f.tail = 0;
      }
      if (f.on) f.head = Math.min(1, f.head + dt / GROW);
      else f.tail = Math.min(1.01, f.tail + dt / GROW);
      f.shift = (f.shift + dt * f.speed) % WRAP;
    }
    this.sync();
  }

  private sync(): void {
    this.flows.forEach((f, i) => {
      this.head[i] = f.on ? f.head : 1;
      this.tail[i] = f.tail;
      this.shift[i] = f.shift;
    });
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
