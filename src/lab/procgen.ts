/**
 * Procgen lab: generate a floor and look at every room (painted with the real room painter), laid out on the grid by
 * room key. Query: seed, floor, theme, twist, rooms, workbench=1, scale, debug, cols (contact sheet), only (one room).
 * `?debug` overlays the bot's validation flights (green = passed, red = failed) and the colliders.
 */

import { parseKey } from '../game/level';
import { paintRoom } from '../render/roomArt';
import { generateFloorWithReport, themeForFloor, validateLevel, validateLevelFlight, type ThemeId, type TwistId } from '../world/procgen';
import type { FlightRun } from '../world/procgen/types';
import type { ItemDef, RoomDef } from '../world/types';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') ?? 1);
const floor = Number(q.get('floor') ?? 0);
const theme = ((q.get('theme') || themeForFloor(floor)) as ThemeId) ?? 'home';
const twist = (q.get('twist') || 'none') as TwistId;
const rooms = q.get('rooms') ? Number(q.get('rooms')) : undefined;
const workbench = q.get('workbench') === '1';
const scale = Number(q.get('scale') ?? 1);
const debug = q.has('debug') && q.get('debug') !== '0';
const onlyParam = q.get('only'); // render a single room: a key like 2,0 or `start`
const cols = Number(q.get('cols') ?? 0); // >0: a contact sheet in reading order instead of the grid by room key

// reflect the query in the form
const form = document.getElementById('f') as HTMLFormElement;
for (const [k, v] of Object.entries({ seed, floor, theme, twist, rooms: rooms ?? '', scale })) {
  const el = form.elements.namedItem(k) as HTMLInputElement | null;
  if (el) el.value = String(v);
}
(form.elements.namedItem('workbench') as HTMLInputElement).checked = workbench;
(form.elements.namedItem('debug') as HTMLInputElement).checked = debug;

const t0 = performance.now();
const { level, report } = generateFloorWithReport({ seed, floor, theme, twist, rooms, workbenchRoom: workbench });
const genMs = performance.now() - t0;
const only = onlyParam === 'start' ? level.start.room : onlyParam;
const structural = validateLevel(level);
const flight = validateLevelFlight(level);

const GAP = 14;
const CAP = 16;
const cellW = 640 * scale + GAP;
const cellH = 360 * scale + GAP + CAP;
const grid = document.getElementById('grid')!;

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, edge: string) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 === 0 ? r : r * 0.45;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Simple stand-ins for the things that are runtime sprites in the game. */
function runtimeGlyphs(ctx: CanvasRenderingContext2D, room: RoomDef) {
  for (const it of room.items) {
    switch (it.t) {
      case 'star':
        star(ctx, it.x, it.y, 8, '#ffe070', '#9a7024');
        break;
      case 'tape':
        ctx.fillStyle = '#ddc9a6';
        ctx.beginPath();
        ctx.arc(it.x, it.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2b2340';
        ctx.beginPath();
        ctx.arc(it.x, it.y, 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'sheet':
        ctx.fillStyle = '#f8f4ea';
        ctx.fillRect(it.x - 7, it.y - 6, 14, 12);
        ctx.fillStyle = '#7a99c8';
        ctx.fillRect(it.x - 5, it.y - 3, 9, 1);
        ctx.fillRect(it.x - 5, it.y, 7, 1);
        break;
      case 'fan': {
        const cx = it.x + 16;
        const cy = it.y + 16;
        ctx.strokeStyle = '#9ea6b8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#96c2e4';
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2;
          ctx.beginPath();
          ctx.ellipse(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7, 5, 3, a, 0, Math.PI * 2);
          ctx.fill();
        }
        const dir = typeof it.dir === 'number' && it.dir < 0 ? -1 : 1;
        ctx.strokeStyle = 'rgba(234,242,255,0.55)';
        ctx.lineWidth = 1;
        for (let k = -1; k <= 1; k++) {
          ctx.beginPath();
          ctx.moveTo(cx + dir * 18, cy + k * 7);
          ctx.lineTo(cx + dir * 70, cy + k * 14);
          ctx.stroke();
        }
        break;
      }
      case 'candle': {
        ctx.fillStyle = '#f8a02c';
        ctx.beginPath();
        ctx.ellipse(it.x + 3, it.y - 6, 2.5, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff4b8';
        ctx.beginPath();
        ctx.ellipse(it.x + 3, it.y - 4, 1.2, 2.4, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'drip': {
        const fy = typeof it.floorY === 'number' ? it.floorY : 338;
        ctx.strokeStyle = 'rgba(169,212,240,0.45)';
        ctx.setLineDash([2, 8]);
        ctx.beginPath();
        ctx.moveTo(it.x, it.y);
        ctx.lineTo(it.x, fy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#7fb4e0';
        ctx.fillRect(it.x - 1, it.y + 4, 3, 5);
        break;
      }
      case 'ceilingVent': {
        const w = it.w ?? 48;
        ctx.fillStyle = '#545a6c';
        ctx.fillRect(it.x, 12, w, 6);
        ctx.strokeStyle = '#c8ced8';
        for (let k = 4; k < w; k += 5) {
          ctx.beginPath();
          ctx.moveTo(it.x + k, 13);
          ctx.lineTo(it.x + k, 17);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(234,242,255,0.4)';
        for (let k = 8; k < w; k += 14) {
          ctx.beginPath();
          ctx.moveTo(it.x + k, 22);
          ctx.lineTo(it.x + k, 60);
          ctx.stroke();
        }
        break;
      }
      case 'switch':
        ctx.strokeStyle = '#ffd98a';
        ctx.lineWidth = 1;
        ctx.strokeRect(it.x - 3.5, it.y - 3.5, 17, 23);
        break;
      case 'workbench': {
        const w = it.w ?? 120;
        ctx.fillStyle = 'rgba(160,220,255,0.55)';
        ctx.fillRect(it.x + 6, it.y - 4, w - 12, 3);
        break;
      }
      case 'floorVent': {
        if (!debug) break;
        const w = it.w ?? 48;
        const top = typeof it.reach === 'number' ? it.reach : 14;
        ctx.strokeStyle = 'rgba(234,242,255,0.5)';
        for (let k = 8; k < w; k += 14) {
          ctx.beginPath();
          ctx.moveTo(it.x + k, 326);
          ctx.lineTo(it.x + k, Math.max(top, 4));
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(160,220,255,0.7)';
        ctx.font = '8px monospace';
        ctx.fillText(`top ${top}`, it.x, Math.max(top, 10) - 2);
        break;
      }
      default:
    }
  }
}

function drawRun(ctx: CanvasRenderingContext2D, run: FlightRun, nominal: boolean) {
  ctx.strokeStyle = run.ok ? (nominal ? '#33ff66' : 'rgba(51,255,102,0.35)') : 'rgba(255,60,60,0.8)';
  ctx.lineWidth = nominal ? 1.6 : 1;
  ctx.beginPath();
  run.path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
}

function sideLabel(room: RoomDef): string {
  return (['left', 'right', 'up', 'down'] as const).filter((s) => room.exits[s]).join('/');
}

const problems: string[] = [];
let index = 0;
for (const [key, room] of Object.entries(level.rooms)) {
  if (only && key !== only) continue;
  const [gx, gy] = cols > 0 ? [index % cols, Math.floor(index / cols)] : parseKey(key);
  index++;
  const art = paintRoom(room);
  const rr = report.rooms.find((r) => r.key === key)!;
  const fr = flight.rooms.find((r) => r.key === key);
  const cell = document.createElement('div');
  cell.className = 'room';
  cell.dataset.key = key;
  cell.style.left = `${(only ? 0 : gx) * cellW}px`;
  cell.style.top = `${(only ? 0 : gy) * cellH}px`;
  const cap = document.createElement('div');
  cap.className = 'cap';
  const flags = [room.dark ? 'dark' : '', room.night ? 'night' : '', room.items.some((i) => i.t === 'workbench') ? 'bench' : ''].filter(Boolean).join(' ');
  const state = rr.fallback ? 'FALLBACK' : `try ${rr.attempts}`;
  const ok = fr && fr.ok ? `<span class="good">ok${fr.both ? '+both' : ''}</span>` : '<span class="bad">FAIL</span>';
  cap.innerHTML = `${key} ${room.name} [${rr.template}] ${sideLabel(room)} ${flags} ${state} ${ok}`;
  const canvas = document.createElement('canvas');
  canvas.width = 640 * scale;
  canvas.height = 360 * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(art.albedo, 0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(scale, scale);
  runtimeGlyphs(ctx, room);
  if (debug) {
    ctx.strokeStyle = 'rgba(255,255,0,0.8)';
    ctx.lineWidth = 0.5;
    for (const c of art.colliders) ctx.strokeRect(c.x + 0.25, c.y + 0.25, c.w - 0.5, c.h - 0.5);
    for (const run of rr.runs) drawRun(ctx, run, false);
    const nominal = rr.runs.find((r) => r.ok && (r.entry === 'door-lo' || r.entry === 'start' || r.entry === 'above' || r.entry === 'below'));
    if (nominal) drawRun(ctx, nominal, true);
    if (level.start.room === key) {
      ctx.fillStyle = '#ff3cf0';
      ctx.beginPath();
      ctx.arc(level.start.x, level.start.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  cell.append(cap, canvas);
  grid.append(cell);
  if (fr && !fr.ok) problems.push(`${key}: flight FAIL ${fr.runs.filter((r) => !r.ok).map((r) => `${r.plane}/${r.entry}: ${r.why}`).join('; ')}`);
}
const keys = cols > 0 ? Object.keys(level.rooms).map((_, i) => [i % cols, Math.floor(i / cols)]) : Object.keys(level.rooms).map(parseKey);
const maxX = Math.max(...keys.map((k) => k[0])) + 1;
const maxY = Math.max(...keys.map((k) => k[1])) + 1;
grid.style.width = `${(only ? 1 : maxX) * cellW}px`;
grid.style.height = `${(only ? 1 : maxY) * cellH}px`;

const stats = document.getElementById('stats')!;
stats.textContent = `${level.name} · ${Object.keys(level.rooms).length} rooms · sheets ${level.sheets} · par ${level.par}s · generated in ${genMs.toFixed(0)} ms · structural ${structural.ok ? 'ok' : 'PROBLEMS'} · flight ${flight.ok ? 'ok' : 'FAIL'}${flight.both ? ' (both planes)' : ''}`;
document.getElementById('problems')!.textContent = [...structural.problems, ...problems].join('\n');

(window as unknown as { __ready: boolean; __result: unknown }).__result = {
  level: level.id,
  rooms: Object.keys(level.rooms).length,
  ms: genMs,
  structural: structural.ok,
  flight: flight.ok,
  both: flight.both,
  items: Object.values(level.rooms).reduce((n: number, r: RoomDef) => n + r.items.length, 0) as number,
};
(window as unknown as { __ready: boolean }).__ready = true;
export type { ItemDef };
