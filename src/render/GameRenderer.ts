/**
 * The in-game compositor: a 640 × 360 WebGL canvas (scaled up with nearest-neighbour by CSS),
 * a lit room background, lit sprites for dynamic objects, the 3D plane sprite, its shadow and
 * pixel particles.
 */

import * as THREE from 'three';
import type { RoomArt } from './roomArt';
import { createLightUniforms, createRoomMaterial, createSpriteMaterial, MAX_LIGHTS, nearestTexture, type LightUniforms } from './lit';
import { PlaneView } from './PlaneView';
import { Particles } from './particles';
import type { Look } from '../paper/design';

THREE.ColorManagement.enabled = false;

export interface ActiveLight {
  x: number;
  y: number;
  r: number;
  color: THREE.Color;
  intensity: number;
}

export interface SpriteHandle {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  tex: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  /** Room-space top-left and size. */
  set(x: number, y: number, visible?: boolean): void;
  refresh(): void;
  dispose(): void;
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly lightU: LightUniforms;
  readonly plane: PlaneView;
  readonly particles = new Particles();
  readonly sprites = new THREE.Group();
  private guide: THREE.Points;
  private guidePos = new Float32Array(64 * 3);
  private guideCol = new Float32Array(64 * 4);
  private roomMat: THREE.ShaderMaterial;
  private roomMesh: THREE.Mesh;
  private albedoTex: THREE.CanvasTexture | null = null;
  private glowTex: THREE.CanvasTexture | null = null;

  constructor(readonly canvas: HTMLCanvasElement, look: Look) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(640, 360, false);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = true;
    this.camera = new THREE.OrthographicCamera(0, 640, 360, 0, -100, 100);
    this.camera.position.z = 50;
    this.lightU = createLightUniforms();
    this.roomMat = createRoomMaterial(this.lightU);
    this.roomMesh = new THREE.Mesh(new THREE.PlaneGeometry(640, 360), this.roomMat);
    this.roomMesh.position.set(320, 180, 0);
    this.scene.add(this.roomMesh);
    this.scene.add(this.sprites);
    this.plane = new PlaneView(look);
    this.scene.add(this.plane.shadow);
    this.scene.add(this.plane.quad);
    this.scene.add(this.particles.points);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.guidePos, 3));
    g.setAttribute('color4', new THREE.BufferAttribute(this.guideCol, 4));
    this.guide = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        transparent: true,
        depthWrite: false,
        vertexShader: `in vec4 color4; out vec4 vCol; void main(){ vCol = color4; gl_PointSize = 2.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `precision highp float; in vec4 vCol; out vec4 fragColor; void main(){ fragColor = vCol; }`,
      }),
    );
    this.guide.frustumCulled = false;
    this.guide.renderOrder = 40;
    this.guide.position.z = 40;
    this.scene.add(this.guide);
  }

  private ghost: THREE.Points | null = null;
  private ghostPos = new Float32Array(1500 * 3);

  /** Ghost trail of a previous flight (room px, already clipped to this room). */
  setGhost(pts: { x: number; y: number }[]): void {
    if (!this.ghost) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.ghostPos, 3));
      this.ghost = new THREE.Points(
        g,
        new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3,
          transparent: true,
          depthWrite: false,
          vertexShader: `void main(){ gl_PointSize = 2.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
          fragmentShader: `precision highp float; out vec4 fragColor; void main(){ fragColor = vec4(0.62, 0.8, 1.0, 0.75); }`,
        }),
      );
      this.ghost.frustumCulled = false;
      this.ghost.renderOrder = 39;
      this.ghost.position.z = 39;
      this.scene.add(this.ghost);
    }
    const n = Math.min(1500, pts.length);
    for (let i = 0; i < n; i++) {
      this.ghostPos[i * 3] = Math.round(pts[i].x);
      this.ghostPos[i * 3 + 1] = 360 - Math.round(pts[i].y);
    }
    const geo = this.ghost.geometry;
    geo.setDrawRange(0, n);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Aiming guide: dotted predicted trajectory (room px). */
  setGuide(pts: { x: number; y: number; a: number }[]): void {
    const n = Math.min(64, pts.length);
    for (let i = 0; i < n; i++) {
      this.guidePos[i * 3] = Math.round(pts[i].x);
      this.guidePos[i * 3 + 1] = 360 - Math.round(pts[i].y);
      this.guideCol.set([1, 1, 1, pts[i].a], i * 4);
    }
    const geo = this.guide.geometry;
    geo.setDrawRange(0, n);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.color4 as THREE.BufferAttribute).needsUpdate = true;
  }

  setRoom(art: RoomArt): void {
    this.albedoTex?.dispose();
    this.glowTex?.dispose();
    this.albedoTex = nearestTexture(art.albedo);
    this.glowTex = nearestTexture(art.glow);
    this.roomMat.uniforms.uAlbedo.value = this.albedoTex;
    this.roomMat.uniforms.uGlow.value = this.glowTex;
  }

  setGlow(strength: number): void {
    this.roomMat.uniforms.uGlowStrength.value = strength;
  }

  setLights(lights: ActiveLight[], ambient: THREE.Color): void {
    this.lightU.uAmbient.value.copy(ambient);
    const n = Math.min(MAX_LIGHTS, lights.length);
    for (let i = 0; i < n; i++) {
      const l = lights[i];
      this.lightU.uLights.value[i].set(l.x, l.y, l.r, l.intensity);
      this.lightU.uLightColors.value[i].copy(l.color);
    }
    this.lightU.uLightCount.value = n;
  }

  /** Create a lit (or emissive) sprite backed by its own small canvas. */
  createSprite(w: number, h: number, emissive = 0, z = 10): SpriteHandle {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const tex = nearestTexture(canvas);
    const mat = createSpriteMaterial(this.lightU, tex, emissive);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.z = z;
    mesh.renderOrder = z;
    this.sprites.add(mesh);
    const handle: SpriteHandle = {
      mesh,
      mat,
      tex,
      canvas,
      set: (x, y, visible = true) => {
        mesh.position.x = Math.round(x) + w / 2;
        mesh.position.y = 360 - (Math.round(y) + h / 2);
        mesh.visible = visible;
      },
      refresh: () => {
        tex.needsUpdate = true;
      },
      dispose: () => {
        this.sprites.remove(mesh);
        mesh.geometry.dispose();
        mat.dispose();
        tex.dispose();
      },
    };
    return handle;
  }

  clearSprites(): void {
    for (const c of [...this.sprites.children]) {
      const m = c as THREE.Mesh;
      this.sprites.remove(m);
      m.geometry.dispose();
      const mat = m.material as THREE.ShaderMaterial;
      (mat.uniforms?.uMap?.value as THREE.Texture | undefined)?.dispose();
      mat.dispose();
    }
  }

  render(time: number): void {
    this.lightU.uTime.value = time;
    this.plane.render(this.renderer);
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(0x120f18, 1);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.clearSprites();
    this.plane.dispose();
    this.albedoTex?.dispose();
    this.glowTex?.dispose();
    this.renderer.dispose();
  }
}
