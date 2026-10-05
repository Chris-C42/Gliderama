import * as THREE from 'three';
import { RECIPES } from '../paper/recipes';
import { analyzeDesign } from '../paper/aero';
import { buildMesh, type PlaneBuild } from '../paper/build';
import type { Design } from '../paper/design';
import { createPlaneMaterial } from '../render/planeMaterial';
import { planeGeometry } from '../render/planeGeometry';

const DEG = 180 / Math.PI;
const grid = document.getElementById('grid')!;

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

function flatSvg(build: PlaneBuild, design: Design): SVGSVGElement {
  const W = build.width;
  const L = build.length;
  const pad = 6;
  const scale = 230 / Math.max(W, L);
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  const w = W * scale + pad * 2;
  const h = L * scale + pad * 2;
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  const cx = pad + (W / 2) * scale;
  const facets = [...build.flat.facets].sort((a, b) => a.layer - b.layer);
  for (const mirror of [false, true]) {
    for (const f of facets) {
      const poly = document.createElementNS(svgNS, 'polygon');
      poly.setAttribute(
        'points',
        f.pts.map((p) => `${cx + (mirror ? -p.x : p.x) * scale},${pad + p.y * scale}`).join(' '),
      );
      poly.setAttribute('fill', f.up ? design.look.color : design.look.backColor);
      poly.setAttribute('fill-opacity', '0.92');
      poly.setAttribute('stroke', '#5b4f78');
      poly.setAttribute('stroke-width', '0.8');
      svg.appendChild(poly);
    }
  }
  const lineEl = (x1: number, y1: number, x2: number, y2: number, color: string) => {
    for (const s of [1, -1]) {
      const l = document.createElementNS(svgNS, 'line');
      l.setAttribute('x1', String(cx + s * x1 * scale));
      l.setAttribute('y1', String(pad + y1 * scale));
      l.setAttribute('x2', String(cx + s * x2 * scale));
      l.setAttribute('y2', String(pad + y2 * scale));
      l.setAttribute('stroke', color);
      l.setAttribute('stroke-dasharray', '4 3');
      l.setAttribute('stroke-width', '1.2');
      svg.appendChild(l);
    }
  };
  lineEl(build.root.r0.x, 0, build.root.r1.x, L, '#e0533d');
  if (build.winglet) lineEl(build.winglet.x, 0, build.winglet.x, L, '#3d9be0');
  if (build.elevator) lineEl(0, build.elevator.yh, W / 2, build.elevator.yh, '#41b36a');
  return svg;
}

function outline(ctx: CanvasRenderingContext2D, w: number, h: number, color: [number, number, number]) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const src = new Uint8ClampedArray(d);
  const alpha = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : src[(y * w + x) * 4 + 3]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3] > 0) continue;
      if (alpha(x + 1, y) || alpha(x - 1, y) || alpha(x, y + 1) || alpha(x, y - 1)) {
        d[i] = color[0];
        d[i + 1] = color[1];
        d[i + 2] = color[2];
        d[i + 3] = 255;
      }
    }
  ctx.putImageData(img, 0, 0);
}

for (const r of RECIPES) {
  const design = r.make();
  const { build, aero } = analyzeDesign(design);
  const mesh = buildMesh(build, aero.cg);
  const geo = planeGeometry(mesh);
  const mat = createPlaneMaterial({ look: design.look, sheet: { width: build.width, length: build.length }, bands: 0 });
  const plane = new THREE.Mesh(geo, mat);

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h3>${r.name}</h3>`;
  const views = document.createElement('div');
  views.className = 'views';
  card.appendChild(views);
  views.appendChild(flatSvg(build, design));

  // 3/4 perspective view
  const persp = document.createElement('canvas');
  persp.width = 260;
  persp.height = 220;
  views.appendChild(persp);
  {
    const scene = new THREE.Scene();
    scene.add(plane);
    const cam = new THREE.PerspectiveCamera(30, persp.width / persp.height, 0.01, 10);
    cam.position.set(0.42, 0.3, 0.55);
    cam.lookAt(0, -0.01, 0);
    renderer.setSize(persp.width, persp.height, false);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, cam);
    persp.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
    scene.remove(plane);
  }

  // In-game pixel view: ortho, 128 px per metre, 3/4 tilt, upscaled ×4 with an outline.
  const pw = 64;
  const ph = 40;
  const pix = document.createElement('canvas');
  pix.width = pw;
  pix.height = ph;
  const big = document.createElement('canvas');
  big.width = pw * 4;
  big.height = ph * 4;
  views.appendChild(big);
  {
    const scene = new THREE.Scene();
    const holder = new THREE.Group();
    holder.add(plane);
    // view tilt: show the top of the wings; small yaw towards the viewer
    plane.rotation.set(0, 0, 0);
    holder.rotation.set(0.42, -0.32, 0.06, 'XYZ');
    scene.add(holder);
    const m = 1 / 128; // metres per pixel
    const cam = new THREE.OrthographicCamera((-pw / 2) * m, (pw / 2) * m, (ph / 2) * m, (-ph / 2) * m, -5, 5);
    cam.position.set(0, 0, 1);
    renderer.setSize(pw, ph, false);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, cam);
    const ctx = pix.getContext('2d')!;
    ctx.clearRect(0, 0, pw, ph);
    ctx.drawImage(renderer.domElement, 0, 0);
    outline(ctx, pw, ph, [43, 35, 64]);
    const bctx = big.getContext('2d')!;
    bctx.imageSmoothingEnabled = false;
    bctx.fillStyle = '#c9b48f';
    bctx.fillRect(0, 0, big.width, big.height);
    bctx.drawImage(pix, 0, 0, big.width, big.height);
  }

  const t = aero.perf.trim;
  const pre = document.createElement('pre');
  pre.textContent = [
    `mass ${(aero.mass * 1000).toFixed(2)} g · span ${(aero.span * 100).toFixed(1)} cm · S ${(aero.S * 1e4).toFixed(0)} cm² · AR ${aero.AR.toFixed(2)}`,
    `sweep ${(aero.sweepLE * DEG).toFixed(0)}° · SM ${(aero.SM * 100).toFixed(1)}% · L/Dmax ${aero.perf.LDmax.toFixed(2)}`,
    t ? `trim: α ${(t.alpha * DEG).toFixed(1)}° CL ${t.CL.toFixed(2)} v ${t.v.toFixed(2)} m/s L/D ${t.LD.toFixed(2)}` : 'trim: none',
    Object.entries(aero.friendly)
      .map(([k, v]) => `${k} ${v.toFixed(1)}`)
      .join(' · '),
    build.errors.join('; '),
  ].join('\n');
  card.appendChild(pre);
  grid.appendChild(card);
}
(window as unknown as { __labReady: boolean }).__labReady = true;
