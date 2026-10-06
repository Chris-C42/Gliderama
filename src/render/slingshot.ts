/**
 * The aiming slingshot: a rubber band between two pegs at the launch point, cradling the plane's tail. It shows the
 * player where the throw comes from and how hard they are pulling: the band stretches back, away from the aim, as
 * they pull (the plane drawn pulled back with it), and reddens towards full power. It sways a little while nobody is
 * pulling, as an invitation. On release it snaps forward, quivers and fades away; it is back for the next throw.
 */

import type { GameRenderer, SpriteHandle } from './GameRenderer';
import { R } from './palette';
import { Px } from './pixel';

/** Sprite size (px); the launch point is its centre. */
const S = 128;
const C = S / 2;
/** Half the distance between the pegs (px): wide enough to show either side of the plane. */
const SPREAD = 15;
/** How far back a full pull draws the band (px). */
export const PULL_PX = 34;
/** Seconds the band quivers after the throw, and fades. */
const SNAP = 0.4;

export class Slingshot {
  private sprite: SpriteHandle | null = null;
  private px: Px | null = null;
  private key = '';
  private at = { x: 0, y: 0, angle: 0, tail: 15 };
  /** Seconds since the throw (snapping and fading), or -1. */
  private snapT = -1;
  private time = 0;

  constructor(private readonly renderer: GameRenderer) {}

  /** The renderer cleared its sprites (a new room): the old one is gone. */
  reset(): void {
    this.sprite = null;
    this.px = null;
    this.key = '';
  }

  /**
   * While aiming: launch point (room px), aim angle (room radians, 0 = right, + up), pull (0..1), whether nobody is
   * pulling yet, and how far behind the launch point the plane's tail is (px): the band cradles it there.
   */
  aim(x: number, y: number, angle: number, pull: number, idle: boolean, tail: number, dt: number): void {
    this.time += dt;
    this.snapT = -1;
    this.at = { x, y, angle, tail: Math.max(8, Math.min(30, Math.round(tail))) };
    // nobody pulling yet: a gentle sway
    const sway = idle ? Math.sin(this.time * 4) * 0.06 + 0.06 : 0;
    this.draw(Math.max(pull, sway), 1);
  }

  /** The throw: the band snaps forward, quivers and fades. */
  release(): void {
    if (this.sprite) this.snapT = 0;
  }

  /** While flying: the snap and fade after a throw, then nothing. */
  update(dt: number): void {
    if (this.snapT < 0) {
      this.sprite?.set(0, 0, false);
      return;
    }
    this.snapT += dt;
    const k = this.snapT / SNAP;
    if (k >= 1) {
      this.snapT = -1;
      this.sprite?.set(0, 0, false);
      return;
    }
    // past its rest and back, quivering less and less (a negative pull: forward of the rest line)
    const quiver = -Math.cos(k * Math.PI * 5) * 0.35 * (1 - k);
    this.draw(quiver, 1 - k * k);
  }

  private draw(pull: number, alpha: number): void {
    if (!this.sprite) {
      this.sprite = this.renderer.createSprite(S, S, 0.5, 19);
      this.px = new Px(this.sprite.canvas, 3);
      this.key = '';
    }
    const s = this.sprite;
    const px = this.px!;
    const { x, y, angle, tail } = this.at;
    const key = `${Math.round(angle * 90)}:${Math.round(pull * 40)}:${tail}`;
    if (key !== this.key) {
      this.key = key;
      px.ctx.clearRect(0, 0, S, S);
      paint(px, angle, pull, tail);
      s.refresh();
    }
    s.mat.uniforms.uAlpha.value = alpha;
    s.set(x - C, y - C, true);
  }
}

/** Where a plane pulled back by `pull` sits, relative to the launch point (room px). */
export function pulledBack(angle: number, pull: number): { dx: number; dy: number } {
  const d = Math.max(0, pull) * PULL_PX;
  return { dx: -Math.cos(angle) * d, dy: Math.sin(angle) * d };
}

function paint(px: Px, angle: number, pull: number, tail: number) {
  // along the aim and across it, in sprite pixels (y down)
  const ux = Math.cos(angle);
  const uy = -Math.sin(angle);
  const nx = -uy;
  const ny = ux;
  const back = tail + pull * PULL_PX;
  const pegA = { x: C - ux * tail + nx * SPREAD, y: C - uy * tail + ny * SPREAD };
  const pegB = { x: C - ux * tail - nx * SPREAD, y: C - uy * tail - ny * SPREAD };
  const pouch = { x: C - ux * back, y: C - uy * back };
  // two-pixel rubber with a dark edge, reddening as it stretches
  const p = Math.max(0, Math.min(1, pull));
  const band = p > 0.7 ? R.red[4] : p > 0.35 ? R.peach[3] : R.peach[4];
  const edge = p > 0.7 ? R.red[1] : R.walnut[1];
  for (const [peg, side] of [
    [pegA, 1],
    [pegB, -1],
  ] as const) {
    const ox = nx * side;
    const oy = ny * side;
    px.line(peg.x + ox, peg.y + oy, pouch.x + ox * 0.5, pouch.y + oy * 0.5, edge);
    px.line(peg.x, peg.y, pouch.x, pouch.y, band);
    px.line(peg.x - ox * 0.6, peg.y - oy * 0.6, pouch.x - ox * 0.3, pouch.y - oy * 0.3, band);
  }
  // the pouch the tail sits in
  px.ellipse(pouch.x, pouch.y, 3, 3, R.walnut[1]);
  px.ellipse(pouch.x, pouch.y, 2, 2, R.walnut[3]);
  px.px(pouch.x - 1, pouch.y - 1, R.walnut[5]);
  // the pegs
  for (const peg of [pegA, pegB]) {
    px.ellipse(peg.x, peg.y, 3.5, 3.5, R.walnut[1]);
    px.ellipse(peg.x, peg.y, 2.5, 2.5, R.brass[3]);
    px.ellipse(peg.x - 0.5, peg.y - 0.5, 1.5, 1.5, R.brass[4]);
    px.px(peg.x - 1, peg.y - 1, R.brass[5]);
  }
}
