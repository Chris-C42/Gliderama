/**
 * Renders the folded 3D plane into a small pixel-scale render target, then shows it in the room
 * as a pixel-aligned sprite with a 1-px outline. Also owns the plane's floor shadow.
 */

import * as THREE from 'three';
import type { PlaneMesh } from '../paper/build';
import type { Look } from '../paper/design';
import { PX_PER_M } from '../physics/config';
import { createPlaneMaterial, setPlaneLook } from './planeMaterial';
import { planeGeometry } from './planeGeometry';

export const PLANE_RT = 96;
const VIEW_TILT = 0.48; // rad: look down on the wings a little
const VIEW_YAW = 0.26; // rad: nose turned a little towards the viewer

export interface PlanePose {
  /** Room pixels (y down). */
  x: number;
  y: number;
  /** Pitch (rad, nose up +) relative to facing. */
  theta: number;
  facing: 1 | -1;
  /** Turnaround progress 0..1 and the facing it started from (null when not turning). */
  turn: { s: number; from: 1 | -1 } | null;
  /** Bank (rad) during turns, roll wobble from damage, righting roll. */
  bank: number;
  roll: number;
  righting: number;
  visible: boolean;
}

export class PlaneView {
  readonly rt: THREE.WebGLRenderTarget;
  readonly scene = new THREE.Scene();
  readonly cam: THREE.OrthographicCamera;
  readonly holder = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  readonly quad: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  private mesh: THREE.Mesh | null = null;
  private outlineMat: THREE.ShaderMaterial;
  private shadowMat: THREE.ShaderMaterial;

  constructor(look: Look) {
    this.rt = new THREE.WebGLRenderTarget(PLANE_RT, PLANE_RT, {
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    const half = PLANE_RT / 2 / PX_PER_M;
    this.cam = new THREE.OrthographicCamera(-half, half, half, -half, -5, 5);
    this.cam.position.set(0, 0, 2);
    this.scene.add(this.holder);
    this.material = createPlaneMaterial({ look, sheet: { width: 210, length: 297 }, bands: 4 });

    this.outlineMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uMap: { value: this.rt.texture },
        uTexel: { value: new THREE.Vector2(1 / PLANE_RT, 1 / PLANE_RT) },
        uOutline: { value: new THREE.Color('#231c33') },
        uFlash: { value: 0 },
      },
      vertexShader: /* glsl */ `
        out vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        in vec2 vUv;
        out vec4 fragColor;
        uniform sampler2D uMap;
        uniform vec2 uTexel;
        uniform vec3 uOutline;
        uniform float uFlash;
        void main() {
          vec4 c = texture(uMap, vUv);
          if (c.a > 0.5) { fragColor = vec4(mix(c.rgb, vec3(1.0, 0.95, 0.8), uFlash), 1.0); return; }
          float a = texture(uMap, vUv + vec2(uTexel.x, 0.0)).a + texture(uMap, vUv - vec2(uTexel.x, 0.0)).a
                  + texture(uMap, vUv + vec2(0.0, uTexel.y)).a + texture(uMap, vUv - vec2(0.0, uTexel.y)).a;
          if (a > 0.5) fragColor = vec4(uOutline, 1.0); else discard;
        }
      `,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_RT, PLANE_RT), this.outlineMat);
    this.quad.position.z = 20;
    this.quad.renderOrder = 20;

    this.shadowMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      uniforms: { uStrength: { value: 0.6 }, uColor: { value: new THREE.Color('#1c1727') } },
      vertexShader: /* glsl */ `
        out vec2 vUv; out vec2 vWorld;
        void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xy; gl_Position = projectionMatrix * viewMatrix * w; }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        in vec2 vUv; in vec2 vWorld;
        out vec4 fragColor;
        uniform float uStrength;
        uniform vec3 uColor;
        float bayer4(vec2 p) {
          int x = int(mod(p.x, 4.0)); int y = int(mod(p.y, 4.0));
          int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
          return (float(m[y * 4 + x]) + 0.5) / 16.0;
        }
        void main() {
          vec2 q = vUv * 2.0 - 1.0;
          float d = length(q);
          float a = (1.0 - smoothstep(0.55, 1.0, d)) * uStrength;
          if (a < bayer4(floor(vWorld))) discard;
          fragColor = vec4(uColor, 0.85);
        }
      `,
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.shadowMat);
    this.shadow.position.z = 5;
    this.shadow.renderOrder = 5;
  }

  setMesh(mesh: PlaneMesh, look: Look, sheet: { width: number; length: number }): void {
    if (this.mesh) {
      this.holder.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    this.mesh = new THREE.Mesh(planeGeometry(mesh), this.material);
    this.holder.add(this.mesh);
    setPlaneLook(this.material, look, sheet);
  }

  setLighting(ambient: THREE.Color, key: THREE.Color, point?: { x: number; y: number; color: THREE.Color; range: number }): void {
    const u = this.material.uniforms;
    (u.uAmbient.value as THREE.Color).copy(ambient);
    (u.uKeyColor.value as THREE.Color).copy(key);
    if (point) {
      (u.uPointPos.value as THREE.Vector3).set(point.x / PX_PER_M, point.y / PX_PER_M, 0.6);
      (u.uPointColor.value as THREE.Color).copy(point.color);
      u.uPointRange.value = point.range / PX_PER_M;
    } else u.uPointRange.value = 0;
  }

  setDamage(crumple: number[], scorch: number[], soak: number[]): void {
    this.material.uniforms.uCrumple.value = crumple;
    this.material.uniforms.uScorch.value = scorch;
    this.material.uniforms.uSoak.value = soak;
  }

  setFlash(f: number): void {
    this.outlineMat.uniforms.uFlash.value = f;
  }

  /** Orient the plane and render it into its target. Returns nothing; position via `place`. */
  pose(p: PlanePose): void {
    const facing = p.facing;
    let yaw: number;
    if (p.turn) {
      const s = p.turn.s;
      if (p.turn.from > 0) yaw = -VIEW_YAW - s * (Math.PI - 2 * VIEW_YAW);
      else yaw = -Math.PI + VIEW_YAW + s * (Math.PI - 2 * VIEW_YAW);
    } else yaw = facing > 0 ? -VIEW_YAW : Math.PI + VIEW_YAW;
    const dir = p.turn ? p.turn.from : facing;
    const roll = p.bank * dir + p.roll + (p.righting > 0 ? Math.PI * (p.righting / 0.3) : 0);
    const q = new THREE.Quaternion();
    const qTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), VIEW_TILT);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), p.theta);
    const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll);
    q.copy(qTilt).multiply(qYaw).multiply(qPitch).multiply(qRoll);
    this.holder.quaternion.copy(q);
    // sub-pixel motion inside the target; the sprite itself snaps to whole pixels
    const fx = p.x - Math.round(p.x);
    const fy = p.y - Math.round(p.y);
    this.holder.position.set(fx / PX_PER_M, -fy / PX_PER_M, 0);
    this.quad.position.x = Math.round(p.x);
    this.quad.position.y = 360 - Math.round(p.y);
    this.quad.visible = p.visible;
  }

  render(renderer: THREE.WebGLRenderer): void {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prev);
  }

  /** Place the floor shadow: centre x, surface y (room px), width, strength 0..1. */
  placeShadow(x: number, y: number, w: number, strength: number): void {
    this.shadow.visible = strength > 0.03;
    this.shadow.position.set(Math.round(x), 360 - Math.round(y), 5);
    this.shadow.scale.set(Math.max(4, w), Math.max(3, w * 0.22), 1);
    this.shadowMat.uniforms.uStrength.value = strength;
  }

  dispose(): void {
    this.rt.dispose();
    this.mesh?.geometry.dispose();
    this.material.dispose();
    this.outlineMat.dispose();
    this.shadowMat.dispose();
  }
}
