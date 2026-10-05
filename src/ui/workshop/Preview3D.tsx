/**
 * Workshop 3D preview: the folded plane rendered at a low internal resolution with the in-game
 * paper material and a 1-px outline, upscaled crisp. Drag to spin; it idles with a slow turn.
 */

import { useEffect, useRef } from 'preact/hooks';
import * as THREE from 'three';
import type { PlaneMesh } from '../../paper/build';
import type { Look } from '../../paper/design';
import { createPlaneMaterial, setPlaneLook } from '../../render/planeMaterial';
import { planeGeometry } from '../../render/planeGeometry';

THREE.ColorManagement.enabled = false;

const IW = 240;
const IH = 160;

export function Preview3D(props: { mesh: PlaneMesh; look: Look; sheet: { width: number; length: number }; cg?: { x: number; y: number } }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    cam: THREE.OrthographicCamera;
    holder: THREE.Group;
    mesh: THREE.Mesh | null;
    mat: THREE.ShaderMaterial;
    rt: THREE.WebGLRenderTarget;
    quadScene: THREE.Scene;
    quadCam: THREE.OrthographicCamera;
    yaw: number;
    pitch: number;
    dragging: boolean;
    raf: number;
  } | null>(null);

  useEffect(() => {
    const el = canvas.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: el, antialias: false, alpha: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(1);
    renderer.setSize(IW, IH, false);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    cam.position.set(0, 0, 3);
    const holder = new THREE.Group();
    scene.add(holder);
    const mat = createPlaneMaterial({ look: props.look, sheet: props.sheet, bands: 5 });
    mat.uniforms.uAmbient.value = new THREE.Color(0.62, 0.62, 0.68);
    mat.uniforms.uKeyColor.value = new THREE.Color(0.55, 0.52, 0.46);
    const rt = new THREE.WebGLRenderTarget(IW, IH, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
    const quadScene = new THREE.Scene();
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      uniforms: { uMap: { value: rt.texture }, uTexel: { value: new THREE.Vector2(1 / IW, 1 / IH) } },
      vertexShader: `out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        precision highp float; in vec2 vUv; out vec4 fragColor; uniform sampler2D uMap; uniform vec2 uTexel;
        void main(){
          vec4 c = texture(uMap, vUv);
          if (c.a > 0.5) { fragColor = vec4(c.rgb, 1.0); return; }
          float a = texture(uMap, vUv + vec2(uTexel.x, 0.)).a + texture(uMap, vUv - vec2(uTexel.x, 0.)).a
                  + texture(uMap, vUv + vec2(0., uTexel.y)).a + texture(uMap, vUv - vec2(0., uTexel.y)).a;
          if (a > 0.5) fragColor = vec4(0.137, 0.11, 0.2, 1.0); else discard;
        }`,
    });
    quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat));
    state.current = { renderer, scene, cam, holder, mesh: null, mat, rt, quadScene, quadCam, yaw: -0.6, pitch: 0.42, dragging: false, raf: 0 };

    const tick = () => {
      const s = state.current!;
      if (!s.dragging) s.yaw += 0.006;
      s.holder.rotation.set(0, 0, 0);
      const q = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw));
      s.holder.quaternion.copy(q);
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.setRenderTarget(null);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(quadScene, quadCam);
      s.raf = requestAnimationFrame(tick);
    };
    state.current.raf = requestAnimationFrame(tick);

    let last: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
      state.current!.dragging = true;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!last || !state.current) return;
      state.current.yaw += (e.clientX - last.x) * 0.012;
      state.current.pitch = Math.max(-1.3, Math.min(1.3, state.current.pitch + (e.clientY - last.y) * 0.01));
      last = { x: e.clientX, y: e.clientY };
    };
    const up = () => {
      last = null;
      if (state.current) state.current.dragging = false;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      cancelAnimationFrame(state.current?.raf ?? 0);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      state.current?.mesh?.geometry.dispose();
      mat.dispose();
      quadMat.dispose();
      rt.dispose();
      renderer.dispose();
      state.current = null;
    };
  }, []);

  // update mesh / look
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    if (s.mesh) {
      s.holder.remove(s.mesh);
      s.mesh.geometry.dispose();
    }
    s.mesh = new THREE.Mesh(planeGeometry(props.mesh), s.mat);
    s.holder.add(s.mesh);
    setPlaneLook(s.mat, props.look, props.sheet);
    // fit the camera to the plane
    const ext = Math.max(props.mesh.max.x - props.mesh.min.x, (props.mesh.max.z - props.mesh.min.z) * 0.9, 0.12) * 0.62;
    const aspect = IW / IH;
    s.cam.left = -ext * aspect;
    s.cam.right = ext * aspect;
    s.cam.top = ext;
    s.cam.bottom = -ext;
    s.cam.updateProjectionMatrix();
  }, [props.mesh, props.look]);

  return <canvas ref={canvas} class="preview3d pixelated" width={IW} height={IH} />;
}
