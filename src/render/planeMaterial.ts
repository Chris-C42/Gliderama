/**
 * Paper material for the folded plane.
 *
 * - Two-sided paper: the geometric front face is the paper's front (see paper/build.ts), so
 *   gl_FrontFacing picks front/back colour. Patterns are printed in full-sheet paper coordinates,
 *   so prints run continuously across folds.
 * - Flat shading from screen-space derivatives, banded into a few tones for the pixel-art look,
 *   plus paper translucency when lit from behind.
 * - Per-part damage: crumple (vertex jitter), scorch, soak.
 */

import * as THREE from 'three';
import type { Look, PatternId } from '../paper/design';

export const PATTERN_IDS: PatternId[] = [
  'plain',
  'lined',
  'graph',
  'newspaper',
  'kraft',
  'stars',
  'waves',
  'chevron',
  'dots',
  'camo',
  'blueprint',
  'flames',
];

const vertex = /* glsl */ `
in float part;
in float layer;
out vec2 vUv;
out vec3 vWorld;
out vec3 vView;
flat out int vPart;
out float vLayer;
uniform float uCrumple[5];
uniform float uTime;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 p = position;
  int pi = int(part + 0.5);
  float c = uCrumple[pi];
  if (c > 0.0) {
    vec3 q = floor(p * 90.0);
    vec3 j = vec3(hash(q), hash(q + 11.3), hash(q + 27.1)) - 0.5;
    p += j * c * 0.012;
  }
  vec4 world = modelMatrix * vec4(p, 1.0);
  vec4 mv = viewMatrix * world;
  vUv = uv;
  vWorld = world.xyz;
  vView = mv.xyz;
  vPart = pi;
  vLayer = layer;
  gl_Position = projectionMatrix * mv;
}
`;

const fragment = /* glsl */ `
precision highp float;
in vec2 vUv;
in vec3 vWorld;
in vec3 vView;
flat in int vPart;
in float vLayer;
out vec4 fragColor;

uniform vec3 uFront;
uniform vec3 uBack;
uniform vec3 uInk;
uniform int uPattern;
uniform vec3 uKeyDir;    // direction TOWARDS the key light (world)
uniform vec3 uKeyColor;
uniform vec3 uAmbient;
uniform vec3 uPointPos;  // strongest nearby point light (world)
uniform vec3 uPointColor;
uniform float uPointRange;
uniform float uBands;    // 0 = smooth shading
uniform float uScorch[5];
uniform float uSoak[5];
uniform vec2 uSheet;     // sheet size (mm) for pattern scale

float line(float x, float w) {
  float d = abs(fract(x) - 0.5);
  float fw = fwidth(x);
  return 1.0 - smoothstep(w - fw, w + fw, d);
}

float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), u.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), u.x), u.y);
}

float star(vec2 p, float r) {
  float a = atan(p.y, p.x);
  float k = 0.55 + 0.45 * cos(5.0 * a);
  return 1.0 - smoothstep(r * k - fwidth(p.x) , r * k + fwidth(p.x), length(p));
}

/** Ink coverage 0..1 for the printed pattern, in millimetres of paper. */
float pattern(vec2 mm) {
  if (uPattern == 1) { // lined (rule lines + margin)
    float rule = line(mm.y / 8.0 + 0.5, 0.06);
    float margin = (abs(mm.x - 30.0) < 0.6) ? 1.0 : 0.0;
    return max(rule * 0.8, margin);
  }
  if (uPattern == 2) { // graph
    float g = max(line(mm.x / 5.0 + 0.5, 0.06), line(mm.y / 5.0 + 0.5, 0.06));
    float G = max(line(mm.x / 25.0 + 0.5, 0.02), line(mm.y / 25.0 + 0.5, 0.02));
    return max(g * 0.55, G);
  }
  if (uPattern == 3) { // newspaper: columns of text-ish bars
    float col = step(0.12, fract(mm.x / 48.0));
    float rowy = fract(mm.y / 3.2);
    float word = step(0.35, noise2(vec2(floor(mm.x / 2.5), floor(mm.y / 3.2)) * 0.9));
    float headline = step(fract(mm.y / 140.0), 0.06);
    return col * (step(rowy, 0.45) * word * 0.75 + headline * 0.9);
  }
  if (uPattern == 4) { // kraft: fibres
    float n = noise2(mm * vec2(0.9, 0.08)) * 0.6 + noise2(mm * 0.35) * 0.4;
    return smoothstep(0.62, 0.8, n) * 0.5;
  }
  if (uPattern == 5) { // stars
    vec2 cell = floor(mm / 26.0);
    vec2 f = fract(mm / 26.0) - 0.5;
    f += (vec2(hash2(cell), hash2(cell + 7.0)) - 0.5) * 0.35;
    return star(f, 0.22);
  }
  if (uPattern == 6) { // waves
    float y = mm.y / 10.0 + sin(mm.x / 9.0) * 0.35;
    return line(y + 0.5, 0.12);
  }
  if (uPattern == 7) { // chevron
    float y = mm.y / 14.0 + abs(fract(mm.x / 28.0) - 0.5) * 1.2;
    return line(y + 0.5, 0.16);
  }
  if (uPattern == 8) { // dots
    vec2 f = fract(mm / 12.0) - 0.5;
    float d = length(f);
    return 1.0 - smoothstep(0.18 - fwidth(d), 0.18 + fwidth(d), d);
  }
  if (uPattern == 9) { // camo
    float n = noise2(mm / 22.0) + 0.5 * noise2(mm / 9.0);
    return step(0.85, n) * 1.0 + step(0.62, n) * 0.45 - step(0.85, n) * 0.45;
  }
  if (uPattern == 10) { // blueprint grid
    float g = max(line(mm.x / 10.0 + 0.5, 0.04), line(mm.y / 10.0 + 0.5, 0.04));
    return g * 0.8;
  }
  if (uPattern == 11) { // flames from the tail
    float t = (uSheet.y - mm.y) / uSheet.y;
    float f = t + noise2(vec2(mm.x / 14.0, mm.y / 30.0)) * 0.25 + sin(mm.x / 11.0) * 0.06;
    return step(f, 0.38);
  }
  return 0.0;
}

void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  // Make the normal face the viewer (thin sheet: we always see one side).
  vec3 toEye = normalize(cameraPosition - vWorld);
  if (dot(n, toEye) < 0.0) n = -n;

  bool front = gl_FrontFacing;
  vec2 mm = vUv * uSheet;
  vec3 base = front ? uFront : uBack;
  float ink = pattern(mm);
  // reduce pattern contrast when it would alias at small sizes
  float minify = clamp(length(fwidth(mm)) / 3.0, 0.0, 1.0);
  ink = mix(ink, ink * 0.35, minify);
  base = mix(base, uInk, ink * (front ? 1.0 : 0.12));

  // damage tints
  float sc = uScorch[vPart];
  float sk = uSoak[vPart];
  float scorchN = noise2(mm / 6.0);
  base = mix(base, vec3(0.18, 0.12, 0.08), clamp(sc * 1.3 - scorchN * 0.6, 0.0, 1.0));
  base = mix(base, base * vec3(0.72, 0.76, 0.85), sk * 0.8);

  float key = dot(n, uKeyDir);
  float lit = max(key, 0.0);
  float through = max(-key, 0.0) * 0.35; // translucent paper lit from behind
  vec3 light = uAmbient + uKeyColor * (lit + through);
  if (uPointRange > 0.0) {
    vec3 d = uPointPos - vWorld;
    float att = clamp(1.0 - length(d) / uPointRange, 0.0, 1.0);
    float pl = max(dot(n, normalize(d)), 0.0) * 0.8 + 0.2;
    light += uPointColor * att * att * pl;
  }
  if (uBands > 0.0) {
    float lum = dot(light, vec3(0.299, 0.587, 0.114));
    float q = floor(lum * uBands + 0.5) / uBands;
    light *= q / max(lum, 1e-3);
  }
  // fold layers read slightly darker at their edges
  vec3 col = base * light * (1.0 - vLayer * 0.06);
  fragColor = vec4(col, 1.0);
}
`;

/** Colours are kept in display space (ColorManagement is disabled by the game renderer). */
function hex(c: string): THREE.Color {
  return new THREE.Color(c);
}

export interface PlaneMaterialOptions {
  look: Look;
  sheet: { width: number; length: number };
  bands?: number;
}

export function createPlaneMaterial(opts: PlaneMaterialOptions): THREE.ShaderMaterial {
  const { look } = opts;
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: vertex,
    fragmentShader: fragment,
    side: THREE.DoubleSide,
    uniforms: {
      uFront: { value: hex(look.color) },
      uBack: { value: hex(look.backColor) },
      uInk: { value: hex(look.ink) },
      uPattern: { value: Math.max(0, PATTERN_IDS.indexOf(look.pattern)) },
      uKeyDir: { value: new THREE.Vector3(-0.45, 0.8, 0.4).normalize() },
      uKeyColor: { value: new THREE.Color(1.0, 0.96, 0.9) },
      uAmbient: { value: new THREE.Color(0.42, 0.42, 0.5) },
      uPointPos: { value: new THREE.Vector3() },
      uPointColor: { value: new THREE.Color(0, 0, 0) },
      uPointRange: { value: 0 },
      uBands: { value: opts.bands ?? 4 },
      uCrumple: { value: [0, 0, 0, 0, 0] },
      uScorch: { value: [0, 0, 0, 0, 0] },
      uSoak: { value: [0, 0, 0, 0, 0] },
      uSheet: { value: new THREE.Vector2(opts.sheet.width, opts.sheet.length) },
      uTime: { value: 0 },
    },
  });
  return mat;
}

export function setPlaneLook(mat: THREE.ShaderMaterial, look: Look, sheet: { width: number; length: number }): void {
  mat.uniforms.uFront.value = hex(look.color);
  mat.uniforms.uBack.value = hex(look.backColor);
  mat.uniforms.uInk.value = hex(look.ink);
  mat.uniforms.uPattern.value = Math.max(0, PATTERN_IDS.indexOf(look.pattern));
  (mat.uniforms.uSheet.value as THREE.Vector2).set(sheet.width, sheet.length);
}
