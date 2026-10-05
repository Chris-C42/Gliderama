import { paintRoom } from '../render/roomArt';
import { BEDROOM } from '../world/levels/sample';
import { allLevels, loadLevel } from '../world/campaign';

const q = new URLSearchParams(location.search);
const scale = Number(q.get('scale') ?? 2);
// ?level=cottage-1&room=1,0 previews a campaign room (Classic Houses too: ?level=classic-demo-house&room=63,-1)
const cl = q.get('level') ? allLevels().find((l) => l.id === q.get('level')) : undefined;
const lv = cl ? await loadLevel(cl) : undefined;
const art = paintRoom(lv ? lv.rooms[q.get('room') ?? lv.start.room] : BEDROOM);
const show = (src: HTMLCanvasElement, overlay?: (ctx: CanvasRenderingContext2D) => void) => {
  const c = document.createElement('canvas');
  c.width = 640 * scale;
  c.height = 360 * scale;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  if (overlay) {
    ctx.save();
    ctx.scale(scale, scale);
    overlay(ctx);
    ctx.restore();
  }
  document.body.appendChild(c);
};
show(art.albedo);
if (q.has('debug')) {
  show(art.albedo, (ctx) => {
    ctx.strokeStyle = '#ff0';
    ctx.lineWidth = 0.5;
    for (const c of art.colliders) ctx.strokeRect(c.x + 0.25, c.y + 0.25, c.w - 0.5, c.h - 0.5);
    for (const l of art.lights) {
      ctx.strokeStyle = l.color;
      ctx.beginPath();
      ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
  show(art.glow);
}
(window as unknown as { __ready: boolean }).__ready = true;
