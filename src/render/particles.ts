/**
 * Pixel particles: square points in room space (1 point-size unit = 1 room pixel).
 * Used for vent wisps, dust motes, sparks, splashes, confetti, crumple bits.
 */

import * as THREE from 'three';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  r: number;
  g: number;
  b: number;
  a: number;
  /** Gravity (px/s²) and drag (1/s). */
  grav: number;
  drag: number;
  /** Fade alpha with life. */
  fade: boolean;
}

const MAX = 1200;

export class Particles {
  readonly points: THREE.Points;
  private list: Particle[] = [];
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 4);
  private size = new Float32Array(MAX);
  private geo = new THREE.BufferGeometry();

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color4', new THREE.BufferAttribute(this.col, 4));
    this.geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        in vec4 color4;
        in float psize;
        out vec4 vCol;
        void main() {
          vCol = color4;
          gl_PointSize = psize;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        in vec4 vCol;
        out vec4 fragColor;
        void main() {
          if (vCol.a < 0.02) discard;
          fragColor = vCol;
        }
      `,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 30;
    this.points.position.z = 30;
  }

  spawn(p: Partial<Particle> & { x: number; y: number }): void {
    if (this.list.length >= MAX) this.list.shift();
    this.list.push({
      vx: 0,
      vy: 0,
      life: 1,
      max: 1,
      size: 1,
      r: 1,
      g: 1,
      b: 1,
      a: 1,
      grav: 0,
      drag: 0,
      fade: true,
      ...p,
    } as Particle);
  }

  clear(): void {
    this.list = [];
  }

  update(dt: number): void {
    const keep: Particle[] = [];
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += p.grav * dt;
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      keep.push(p);
    }
    this.list = keep;
    const n = Math.min(MAX, keep.length);
    for (let i = 0; i < n; i++) {
      const p = keep[i];
      this.pos[i * 3] = Math.round(p.x) + (p.size % 2 ? 0.5 : 0);
      this.pos[i * 3 + 1] = 360 - Math.round(p.y) - (p.size % 2 ? 0.5 : 0);
      this.pos[i * 3 + 2] = 0;
      const a = p.fade ? p.a * Math.min(1, (p.life / p.max) * 2) : p.a;
      this.col[i * 4] = p.r;
      this.col[i * 4 + 1] = p.g;
      this.col[i * 4 + 2] = p.b;
      this.col[i * 4 + 3] = a;
      this.size[i] = p.size;
    }
    this.geo.setDrawRange(0, n);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color4 as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.psize as THREE.BufferAttribute).needsUpdate = true;
  }
}

export function rgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
