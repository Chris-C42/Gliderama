/**
 * The helium balloon: while helium lifts the plane (gas from a Classic House's canister, or the helium sticker's
 * lift) a little silver foil balloon floats above it on a pink ribbon, blowing up as the helium comes on and going
 * down as it fades. It trails a little behind the way the plane is going, as if tugged along by its ribbon, and
 * bobs. (Silver and small: nothing like Glider PRO's rubber balloons, which are trouble.)
 */

import type { GameRenderer, SpriteHandle } from './GameRenderer';
import { R } from './palette';
import { Px } from './pixel';

const W = 40;
const H = 54;
/** Where the ribbon meets the plane, in the sprite (px): the sprite is placed so that this is on the plane. */
const AX = W / 2;
const AY = H - 6;

export class HeliumBalloon {
  private sprite: SpriteHandle | null = null;
  private px: Px | null = null;
  private key = '';
  private t = 0;
  private lean = 0;

  constructor(private readonly renderer: GameRenderer) {}

  /** The renderer cleared its sprites (a new room): the old one is gone. */
  reset(): void {
    this.sprite = null;
    this.px = null;
    this.key = '';
  }

  /** Each frame: where the plane is (room px), how full the balloon is (0..1) and how fast the plane is going across (px/s). */
  update(x: number, y: number, fill: number, vx: number, dt: number): void {
    this.t += dt;
    const k = Math.max(0, Math.min(1, fill));
    if (k < 0.05) {
      this.sprite?.set(0, 0, false);
      return;
    }
    if (!this.sprite) {
      this.sprite = this.renderer.createSprite(W, H, 0.25, 21);
      this.px = new Px(this.sprite.canvas, 5);
      this.key = '';
    }
    // tugged along by its ribbon: it leans back from the way the plane goes, and catches up when it slows
    const want = Math.max(-7, Math.min(7, -vx * 0.045));
    this.lean += (want - this.lean) * Math.min(1, dt * 3);
    const bob = Math.sin(this.t * 2.6) * 1.2;
    const key = `${Math.round(k * 12)}:${Math.round(this.lean)}:${Math.round(bob)}`;
    if (key !== this.key) {
      this.key = key;
      this.px!.ctx.clearRect(0, 0, W, H);
      paint(this.px!, k, Math.round(this.lean), Math.round(bob));
      this.sprite.refresh();
    }
    this.sprite.set(Math.round(x - AX), Math.round(y - AY), true);
  }
}

function paint(px: Px, k: number, lean: number, bob: number) {
  const rx = 2 + 6.5 * k;
  const ry = 2.4 + 7.4 * k;
  const ribbon = 8 + 12 * k;
  const bx = AX + lean;
  const by = AY - ribbon - ry + bob;
  // the ribbon, in two lengths with a slight kink as it streams back
  const kx = Math.round(bx);
  const ky = Math.round(by + ry + 1);
  const mx = Math.round((AX + kx) / 2 - lean * 0.3);
  const my = Math.round((AY + ky) / 2);
  px.line(AX, AY, mx, my, R.rose[3]);
  px.line(mx, my, kx, ky, R.rose[4]);
  // the foil: a silver ball with a soft pink sheen low on it, and its knot
  px.sphere(bx, by, rx, ry, R.steel.slice(1));
  if (k > 0.5) {
    px.px(Math.round(bx + rx * 0.35), Math.round(by + ry * 0.45), R.rose[5]);
    px.px(Math.round(bx + rx * 0.55), Math.round(by + ry * 0.15), R.rose[5]);
  }
  px.px(kx, ky, R.steel[2]);
  px.px(kx - 1, ky, R.steel[3]);
  px.px(kx + 1, ky, R.steel[3]);
}
