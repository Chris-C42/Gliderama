import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { degToRad } from '../src/core/math';
import type { Facing } from '../src/core/types';
import type { PadLike } from '../src/input/gamepad';
import {
  CHARGE_PERIOD,
  DEFAULT_ELEVATION,
  DEFAULT_MAX_DRAG_PX,
  MAX_ELEVATION,
  MIN_ELEVATION,
  MIN_THROW_POWER,
  ThrowController,
  aimFromDrag,
  angleToElevation,
  chargeMeter,
  dragPower,
  elevationToAngle,
  stepElevation,
  stickElevation,
} from '../src/input/throw';
import { FakeEl, fire, installFakeGlobals, type FakeGlobals } from './helpers/fakeDom';
import { A, DPAD_UP, pad } from './helpers/pads';

const deg = degToRad;

describe('constants', () => {
  it('match the spec', () => {
    expect(DEFAULT_MAX_DRAG_PX).toBe(160);
    expect(MIN_THROW_POWER).toBe(0.08);
    expect(CHARGE_PERIOD).toBe(1.6);
    expect(MIN_ELEVATION).toBeCloseTo(deg(-60), 12);
    expect(MAX_ELEVATION).toBeCloseTo(deg(75), 12);
    expect(DEFAULT_ELEVATION).toBeGreaterThan(0);
  });
});

describe('dragPower', () => {
  it('is drag length over maxDragPx, clamped to 0..1', () => {
    expect(dragPower(0)).toBe(0);
    expect(dragPower(80)).toBe(0.5);
    expect(dragPower(160)).toBe(1);
    expect(dragPower(1000)).toBe(1);
    expect(dragPower(-5)).toBe(0);
    expect(dragPower(50, 100)).toBe(0.5);
    expect(dragPower(50, 0)).toBe(0);
  });
});

describe('aimFromDrag: aim is opposite to the drag, with y flipped to point up', () => {
  it('cardinal directions', () => {
    expect(aimFromDrag(-100, 0)).toBeCloseTo(0, 12); // dragged left -> throws right
    expect(aimFromDrag(100, 0)).toBeCloseTo(Math.PI, 12); // dragged right -> throws left
    expect(aimFromDrag(0, 100)).toBeCloseTo(Math.PI / 2, 12); // dragged down (screen) -> throws up
    expect(aimFromDrag(0, -100)).toBeCloseTo(-Math.PI / 2, 12); // dragged up -> throws down
  });

  it('diagonals', () => {
    expect(aimFromDrag(-1, 1)).toBeCloseTo(deg(45), 12); // drag down-left -> aim up-right
    expect(aimFromDrag(1, 1)).toBeCloseTo(deg(135), 12); // drag down-right -> aim up-left
    expect(aimFromDrag(-1, -1)).toBeCloseTo(deg(-45), 12); // drag up-left -> aim down-right
    expect(aimFromDrag(1, -1)).toBeCloseTo(deg(-135), 12);
  });

  it('never returns -PI for a plain rightward drag, and returns 0 for no drag', () => {
    expect(aimFromDrag(100, 0)).toBe(Math.PI);
    expect(aimFromDrag(100, -0)).toBe(Math.PI);
    expect(aimFromDrag(0, 0)).toBe(0);
  });
});

describe('elevation <-> room angle', () => {
  it('facing right: identical; facing left: mirrored about the vertical', () => {
    expect(elevationToAngle(deg(20), 1)).toBeCloseTo(deg(20), 12);
    expect(elevationToAngle(deg(20), -1)).toBeCloseTo(deg(160), 12);
    expect(elevationToAngle(deg(-30), -1)).toBeCloseTo(deg(-150), 12);
    expect(elevationToAngle(0, -1)).toBeCloseTo(Math.PI, 12);
  });

  it('round-trips', () => {
    for (const facing of [1, -1] as Facing[]) {
      for (const e of [deg(-60), deg(-10), 0, deg(33), deg(75)]) {
        expect(angleToElevation(elevationToAngle(e, facing), facing)).toBeCloseTo(e, 12);
      }
    }
  });
});

describe('stepElevation', () => {
  it('moves at 1.5 rad/s', () => {
    expect(stepElevation(0, 1, 0.1)).toBeCloseTo(0.15, 12);
    expect(stepElevation(0, -1, 0.2)).toBeCloseTo(-0.3, 12);
    expect(stepElevation(0.2, 0, 1)).toBe(0.2);
  });

  it('clamps to -60 / +75 degrees', () => {
    expect(stepElevation(deg(74), 1, 1)).toBeCloseTo(deg(75), 12);
    expect(stepElevation(deg(-59), -1, 1)).toBeCloseTo(deg(-60), 12);
  });
});

describe('chargeMeter: golf-style triangle wave, 0 -> 1 -> 0 over 1.6 s', () => {
  it('key points', () => {
    expect(chargeMeter(0)).toBe(0);
    expect(chargeMeter(0.4)).toBeCloseTo(0.5, 12);
    expect(chargeMeter(0.8)).toBe(1);
    expect(chargeMeter(1.2)).toBeCloseTo(0.5, 12);
    expect(chargeMeter(1.6)).toBeCloseTo(0, 12);
  });

  it('repeats while held', () => {
    expect(chargeMeter(1.6 + 0.4)).toBeCloseTo(0.5, 9);
    expect(chargeMeter(3.2 + 0.8)).toBeCloseTo(1, 9);
    expect(chargeMeter(16 + 0.2)).toBeCloseTo(0.25, 9);
  });

  it('stays within 0..1, rising for the first half-period and falling for the second', () => {
    let prev = 0;
    for (let i = 0; i <= 80; i++) {
      const m = chargeMeter(i / 100);
      expect(m).toBeGreaterThanOrEqual(prev);
      expect(m).toBeLessThanOrEqual(1);
      prev = m;
    }
    expect(prev).toBe(1); // peak at 0.8 s
    for (let i = 81; i <= 160; i++) {
      const m = chargeMeter(i / 100);
      expect(m).toBeLessThanOrEqual(prev);
      expect(m).toBeGreaterThanOrEqual(0);
      prev = m;
    }
  });

  it('handles negative time and a custom or nonsense period', () => {
    expect(chargeMeter(-0.4)).toBeCloseTo(chargeMeter(1.2), 12);
    expect(chargeMeter(1, 2)).toBe(1);
    expect(chargeMeter(1, 0)).toBe(0);
  });
});

describe('stickElevation', () => {
  it('is null inside the deadzone', () => {
    expect(stickElevation(0, 0, 1)).toBeNull();
    expect(stickElevation(0.2, 0.2, 1)).toBeNull();
  });

  it('follows the stick direction, relative to the facing', () => {
    expect(stickElevation(0.7, 0.7, 1)).toBeCloseTo(deg(45), 12);
    expect(stickElevation(0.7, -0.7, 1)).toBeCloseTo(deg(-45), 12);
    expect(stickElevation(-0.7, 0.7, -1)).toBeCloseTo(deg(45), 12); // facing left, stick up-left
    expect(stickElevation(1, 0, 1)).toBeCloseTo(0, 12);
    expect(stickElevation(-1, 0, -1)).toBeCloseTo(0, 12);
  });

  it('clamps to the elevation limits', () => {
    expect(stickElevation(0, 1, 1)).toBeCloseTo(deg(75), 12);
    expect(stickElevation(0, -1, 1)).toBeCloseTo(deg(-60), 12);
    expect(stickElevation(-1, 0.1, 1)).toBeCloseTo(deg(75), 12); // pushing "behind" clamps up or down
    expect(stickElevation(-1, -0.1, 1)).toBeCloseTo(deg(-60), 12);
  });
});

// ---------------------------------------------------------------------------------------------

function make(facing: Facing = 1) {
  const world = { facing, pads: [] as PadLike[] };
  const ctl = new ThrowController({
    // Room = client / 2, a uniform scale: room angles equal screen angles, lengths are halved.
    screenToRoom: (x, y) => ({ x: x / 2, y: y / 2 }),
    getAnchor: () => ({ x: 100, y: 200 }),
    getFacing: () => world.facing,
    readPads: () => world.pads,
  });
  return { ctl, world };
}

describe('ThrowController: slingshot drag', () => {
  it('aim is opposite the drag; power comes from the drag length in client px', () => {
    const { ctl } = make();
    expect(ctl.pointerDown(300, 200, 1)).toBe(true);
    ctl.pointerMove(220, 260, 1); // dragged (-80, +60) px: down-left
    const s = ctl.getState();
    expect(s.aiming).toBe(true);
    expect(s.released).toBe(false);
    expect(s.power).toBeCloseTo(100 / 160, 12);
    expect(s.angle).toBeCloseTo(Math.atan2(3, 4), 12); // up and to the right
  });

  it('releasing with enough power fires `released` until it is consumed, exactly once', () => {
    const { ctl } = make();
    ctl.pointerDown(300, 200, 1);
    ctl.pointerMove(220, 260, 1);
    ctl.pointerUp(220, 260, 1);

    for (let i = 0; i < 3; i++) {
      const s = ctl.getState(); // reading never clears it
      expect(s.released).toBe(true);
      expect(s.aiming).toBe(false);
      expect(s.power).toBeCloseTo(0.625, 12);
      expect(s.angle).toBeCloseTo(Math.atan2(3, 4), 12);
    }
    const taken = ctl.consume()!;
    expect(taken).toMatchObject({ released: true, aiming: false });
    expect(taken.power).toBeCloseTo(0.625, 12);
    expect(ctl.consume()).toBeNull();
    expect(ctl.getState().released).toBe(false);
  });

  it('uses the release position for the final aim', () => {
    const { ctl } = make();
    ctl.pointerDown(300, 200, 1);
    ctl.pointerMove(260, 200, 1);
    ctl.pointerUp(140, 200, 1); // finger flew further before lifting
    const t = ctl.consume()!;
    expect(t.power).toBe(1); // 160 px
    expect(t.angle).toBeCloseTo(0, 12); // dragged straight left -> aim right
  });

  it('power is capped at 1 for long drags', () => {
    const { ctl } = make();
    ctl.pointerDown(500, 500, 1);
    ctl.pointerMove(100, 100, 1);
    expect(ctl.getState().power).toBe(1);
  });

  it('a release below the minimum power cancels', () => {
    const { ctl } = make();
    ctl.pointerDown(300, 200, 1);
    ctl.pointerUp(305, 205, 1); // ~7 px = 0.044
    expect(ctl.getState()).toMatchObject({ aiming: false, released: false });
    expect(ctl.consume()).toBeNull();

    ctl.pointerDown(300, 200, 2);
    ctl.pointerUp(312, 200, 2); // 12 px = 0.075: still too weak
    expect(ctl.consume()).toBeNull();
    ctl.pointerDown(300, 200, 3);
    ctl.pointerUp(313, 200, 3); // 13 px = 0.081: throws
    expect(ctl.consume()).not.toBeNull();
  });

  it('pointercancel cancels without a throw', () => {
    const { ctl } = make();
    ctl.pointerDown(300, 200, 1);
    ctl.pointerMove(200, 200, 1);
    ctl.pointerCancel(1);
    expect(ctl.getState().aiming).toBe(false);
    expect(ctl.consume()).toBeNull();
  });

  it('follows only the pointer that started the drag', () => {
    const { ctl } = make();
    expect(ctl.pointerDown(300, 200, 1)).toBe(true);
    expect(ctl.pointerDown(50, 50, 2)).toBe(false);
    ctl.pointerMove(100, 100, 2); // some other finger
    ctl.pointerUp(100, 100, 2);
    ctl.pointerCancel(2);
    expect(ctl.getState().aiming).toBe(true);
    expect(ctl.getState().power).toBe(0);
    ctl.pointerMove(220, 200, 1);
    expect(ctl.getState().power).toBeCloseTo(0.5, 12);
  });

  it('a pending release blocks a new drag until it is consumed (no double throws)', () => {
    const { ctl } = make();
    ctl.pointerDown(300, 200, 1);
    ctl.pointerUp(150, 200, 1);
    expect(ctl.pointerDown(300, 200, 2)).toBe(false);
    expect(ctl.consume()).not.toBeNull();
    expect(ctl.pointerDown(300, 200, 3)).toBe(true);
  });

  it('a disabled controller ignores input; disabling mid-drag cancels it', () => {
    const { ctl } = make();
    ctl.setEnabled(false);
    expect(ctl.pointerDown(300, 200, 1)).toBe(false);
    ctl.keyDown('Space');
    expect(ctl.getState().aiming).toBe(false);
    ctl.setEnabled(true);
    expect(ctl.pointerDown(300, 200, 1)).toBe(true);
    ctl.setEnabled(false);
    expect(ctl.getState().aiming).toBe(false);
    ctl.setEnabled(true);
    ctl.pointerUp(100, 200, 1);
    expect(ctl.consume()).toBeNull();
  });

  it('the view exposes the drag points in room and client coordinates', () => {
    const { ctl } = make();
    expect(ctl.getView()).toMatchObject({
      mode: 'none',
      anchor: { x: 100, y: 200 },
      dragStart: null,
      dragCurrent: null,
      maxDragPx: 160,
      minPower: 0.08,
    });
    ctl.pointerDown(300, 200, 1);
    ctl.pointerMove(220, 260, 1);
    const v = ctl.getView();
    expect(v.mode).toBe('pointer');
    expect(v.dragStart).toEqual({ x: 150, y: 100 });
    expect(v.dragCurrent).toEqual({ x: 110, y: 130 });
    expect(v.dragStartClient).toEqual({ x: 300, y: 200 });
    expect(v.dragCurrentClient).toEqual({ x: 220, y: 260 });
    expect(v.power).toBeCloseTo(0.625, 12);
  });
});

describe('ThrowController: keyboard', () => {
  it('starts at a gentle lob in the facing direction, not aiming yet', () => {
    const right = make(1).ctl;
    expect(right.getState()).toMatchObject({ aiming: false, released: false, power: 0 });
    expect(right.getState().angle).toBeCloseTo(DEFAULT_ELEVATION, 12);
    expect(make(-1).ctl.getState().angle).toBeCloseTo(Math.PI - DEFAULT_ELEVATION, 12);
    expect(right.getView().mode).toBe('none');
  });

  it('Up / Down change the elevation at 1.5 rad/s', () => {
    const { ctl } = make();
    ctl.keyDown('ArrowUp');
    expect(ctl.getState().aiming).toBe(true);
    ctl.update(0.1);
    expect(ctl.getView().elevation).toBeCloseTo(DEFAULT_ELEVATION + 0.15, 12);
    expect(ctl.getView().mode).toBe('keyboard');
    ctl.keyUp('ArrowUp');
    ctl.update(0.5);
    expect(ctl.getView().elevation).toBeCloseTo(DEFAULT_ELEVATION + 0.15, 12); // holds
    ctl.keyDown('ArrowDown');
    ctl.update(0.2);
    expect(ctl.getView().elevation).toBeCloseTo(DEFAULT_ELEVATION + 0.15 - 0.3, 12);
  });

  it('W / S work like the arrows', () => {
    const { ctl } = make();
    ctl.keyDown('KeyW');
    ctl.update(0.1);
    expect(ctl.getView().elevation).toBeCloseTo(DEFAULT_ELEVATION + 0.15, 12);
    ctl.keyUp('KeyW');
    ctl.keyDown('KeyS');
    ctl.update(0.1);
    expect(ctl.getView().elevation).toBeCloseTo(DEFAULT_ELEVATION, 12);
  });

  it('is clamped to [-60, +75] degrees', () => {
    const { ctl } = make();
    ctl.keyDown('ArrowUp');
    ctl.update(10);
    expect(ctl.getView().elevation).toBeCloseTo(deg(75), 12);
    expect(ctl.getState().angle).toBeCloseTo(deg(75), 12);
    ctl.keyUp('ArrowUp');
    ctl.keyDown('ArrowDown');
    ctl.update(10);
    expect(ctl.getView().elevation).toBeCloseTo(deg(-60), 12);
    expect(ctl.getState().angle).toBeCloseTo(deg(-60), 12);
  });

  it('Up and Down together cancel out', () => {
    const { ctl } = make();
    ctl.keyDown('ArrowUp');
    ctl.keyDown('ArrowDown');
    ctl.update(1);
    expect(ctl.getView().elevation).toBeCloseTo(DEFAULT_ELEVATION, 12);
  });

  it('facing left mirrors the angle but Up still aims higher', () => {
    const { ctl, world } = make(-1);
    ctl.keyDown('ArrowUp');
    ctl.update(0.2); // +0.3 rad
    expect(ctl.getState().angle).toBeCloseTo(Math.PI - (DEFAULT_ELEVATION + 0.3), 12);
    expect(ctl.getState().angle).toBeGreaterThan(Math.PI / 2); // up and to the left
    world.facing = 1; // turning around flips the aim, keeping the elevation
    expect(ctl.getState().angle).toBeCloseTo(DEFAULT_ELEVATION + 0.3, 12);
  });

  it('Space charges a golf meter (0 -> 1 -> 0 over 1.6 s); releasing throws at that power', () => {
    const { ctl } = make();
    ctl.keyDown('Space');
    expect(ctl.getState()).toMatchObject({ aiming: true, power: 0 });
    expect(ctl.getView().charging).toBe(true);
    ctl.update(0.4);
    expect(ctl.getState().power).toBeCloseTo(0.5, 12);
    ctl.update(0.4);
    expect(ctl.getState().power).toBeCloseTo(1, 12);
    ctl.update(0.4);
    expect(ctl.getState().power).toBeCloseTo(0.5, 12);

    ctl.keyUp('Space');
    const t = ctl.consume()!;
    expect(t.released).toBe(true);
    expect(t.power).toBeCloseTo(0.5, 12);
    expect(t.angle).toBeCloseTo(DEFAULT_ELEVATION, 12);
    expect(ctl.consume()).toBeNull();
  });

  it('the throw uses the elevation set before and during the charge', () => {
    const { ctl } = make();
    ctl.keyDown('ArrowUp');
    ctl.update(0.2);
    ctl.keyDown('Space');
    ctl.update(0.4);
    ctl.keyUp('Space');
    expect(ctl.consume()!.angle).toBeCloseTo(DEFAULT_ELEVATION + 0.3 + 0.6, 12); // Up was still held
  });

  it('a very quick tap is below the minimum power and cancels (the aim stays up)', () => {
    const { ctl } = make();
    ctl.keyDown('Space');
    ctl.update(0.02);
    ctl.keyUp('Space');
    expect(ctl.consume()).toBeNull();
    expect(ctl.getState()).toMatchObject({ aiming: true, released: false, power: 0 });
    expect(ctl.getView().charging).toBe(false);
  });

  it('releasing at the bottom of the wave cancels too', () => {
    const { ctl } = make();
    ctl.keyDown('Space');
    ctl.update(1.6);
    ctl.keyUp('Space');
    expect(ctl.consume()).toBeNull();
  });

  it('auto-repeat does not restart the meter', () => {
    const { ctl } = make();
    ctl.keyDown('Space');
    ctl.update(0.4);
    ctl.keyDown('Space');
    ctl.keyDown('Space');
    expect(ctl.getState().power).toBeCloseTo(0.5, 12);
  });

  it('J charges like Space; with both held the throw happens when the last is released', () => {
    const { ctl } = make();
    ctl.keyDown('KeyJ');
    ctl.keyDown('Space');
    ctl.update(0.4);
    ctl.keyUp('KeyJ');
    expect(ctl.getState().released).toBe(false);
    ctl.keyUp('Space');
    expect(ctl.consume()!.power).toBeCloseTo(0.5, 12);
  });

  it('a pending release blocks further keys until consumed, then the aim is remembered', () => {
    const { ctl } = make();
    ctl.keyDown('ArrowUp');
    ctl.update(0.2);
    ctl.keyUp('ArrowUp');
    ctl.keyDown('Space');
    ctl.update(0.4);
    ctl.keyUp('Space');
    ctl.keyDown('ArrowDown'); // ignored while a release is pending
    ctl.update(1);
    expect(ctl.getState().released).toBe(true);
    expect(ctl.getView().elevation).toBeCloseTo(DEFAULT_ELEVATION + 0.3, 12);
    ctl.consume();
    expect(ctl.getState()).toMatchObject({ aiming: false, released: false, power: 0 });
    expect(ctl.getView().elevation).toBeCloseTo(DEFAULT_ELEVATION + 0.3, 12); // next throw starts here
  });

  it('one gesture can never throw twice, even across devices', () => {
    const { ctl } = make();
    // Space is charging when a slingshot drag completes: the pointer throw wins, the charge is dropped.
    ctl.keyDown('Space');
    ctl.update(0.4);
    ctl.pointerDown(300, 200, 1);
    ctl.pointerUp(150, 200, 1);
    ctl.keyUp('Space');
    const first = ctl.consume()!;
    expect(first.power).toBe(0.9375); // 150 px / 160: the drag, not the 0.5 charge
    expect(ctl.consume()).toBeNull();

    // And the other way round: a drag in progress is dropped when a keyboard throw fires.
    ctl.keyDown('Space');
    ctl.update(0.4);
    expect(ctl.pointerDown(300, 200, 2)).toBe(true);
    ctl.keyUp('Space');
    ctl.pointerUp(100, 200, 2);
    expect(ctl.consume()!.power).toBeCloseTo(0.5, 12);
    expect(ctl.consume()).toBeNull();
  });

  it('a press that started before consume() is dropped, so its release does not throw', () => {
    const { ctl } = make();
    ctl.keyDown('Space');
    ctl.update(0.4);
    ctl.keyUp('Space');
    ctl.consume();
    ctl.keyDown('Space'); // a genuinely new press...
    ctl.reset(); // ...abandoned by a reset (e.g. the screen changed)
    ctl.update(0.4);
    ctl.keyUp('Space'); // the old press ending must not throw
    expect(ctl.consume()).toBeNull();
  });

  it('reset() cancels everything but keeps the remembered aim', () => {
    const { ctl } = make();
    ctl.keyDown('ArrowUp');
    ctl.update(0.1);
    ctl.keyUp('ArrowUp');
    ctl.keyDown('Space');
    ctl.update(0.4);
    ctl.reset();
    expect(ctl.getState()).toMatchObject({ aiming: false, power: 0, released: false });
    ctl.keyUp('Space');
    expect(ctl.consume()).toBeNull();
    expect(ctl.getView().elevation).toBeCloseTo(DEFAULT_ELEVATION + 0.15, 12);
  });

  it('update() ignores non-positive dt and does nothing while idle', () => {
    const { ctl } = make();
    ctl.keyDown('ArrowUp');
    ctl.update(0);
    ctl.update(-1);
    ctl.update(NaN);
    expect(ctl.getView().elevation).toBeCloseTo(DEFAULT_ELEVATION, 12);
  });
});

describe('ThrowController: gamepad', () => {
  it('without a pad nothing happens', () => {
    const { ctl } = make();
    ctl.update(0.1);
    expect(ctl.getState()).toMatchObject({ aiming: false, power: 0 });
  });

  it('left stick aims; the aim holds when the stick is released', () => {
    const { ctl, world } = make();
    world.pads = [pad([0.7, -0.7])]; // right + up
    ctl.update(1 / 120);
    expect(ctl.getView().elevation).toBeCloseTo(deg(45), 6);
    expect(ctl.getState().aiming).toBe(true);
    expect(ctl.getView().mode).toBe('gamepad');
    world.pads = [pad()];
    ctl.update(1 / 120);
    expect(ctl.getView().elevation).toBeCloseTo(deg(45), 6);
    expect(ctl.getState().angle).toBeCloseTo(deg(45), 6);
  });

  it('stick aim is mirrored when facing left', () => {
    const { ctl, world } = make(-1);
    world.pads = [pad([-0.7, -0.7])]; // left + up
    ctl.update(1 / 120);
    expect(ctl.getState().angle).toBeCloseTo(deg(135), 6);
  });

  it('D-pad up / down nudge the aim', () => {
    const { ctl, world } = make();
    world.pads = [pad([0, 0], [DPAD_UP])];
    ctl.update(0.1);
    expect(ctl.getView().elevation).toBeCloseTo(DEFAULT_ELEVATION + 0.15, 12);
  });

  it('hold A to charge, release to throw', () => {
    const { ctl, world } = make();
    world.pads = [pad()];
    ctl.update(0.01); // first sample: A is up
    world.pads = [pad([0, 0], [A])];
    ctl.update(0.01);
    expect(ctl.getView().charging).toBe(true);
    ctl.update(0.4);
    expect(ctl.getState().power).toBeCloseTo(0.5 + 0.01 / 0.8, 6);
    world.pads = [pad()];
    ctl.update(0.01);
    const t = ctl.consume()!;
    expect(t.released).toBe(true);
    expect(t.power).toBeGreaterThan(0.5);
  });

  it('an A press that was already down when the controller started is not a charge', () => {
    const { ctl, world } = make();
    world.pads = [pad([0, 0], [A])];
    ctl.update(0.1);
    ctl.update(0.1);
    expect(ctl.getView().charging).toBe(false);
    world.pads = [pad()];
    ctl.update(0.1);
    expect(ctl.consume()).toBeNull();
    world.pads = [pad([0, 0], [A])];
    ctl.update(0.1);
    expect(ctl.getView().charging).toBe(true);
  });

  it('a pad pulled out mid-charge abandons the throw', () => {
    const { ctl, world } = make();
    world.pads = [pad()];
    ctl.update(0.01);
    world.pads = [pad([0, 0], [A])];
    ctl.update(0.4);
    world.pads = [];
    ctl.update(0.1);
    expect(ctl.getView().charging).toBe(false);
    expect(ctl.consume()).toBeNull();
  });

  it('a weak tap on A cancels like a weak Space tap', () => {
    const { ctl, world } = make();
    world.pads = [pad()];
    ctl.update(0.01);
    world.pads = [pad([0, 0], [A])];
    ctl.update(0.01);
    world.pads = [pad()];
    ctl.update(0.01);
    expect(ctl.consume()).toBeNull();
  });
});

describe('ThrowController: DOM listeners (fake window)', () => {
  let g: FakeGlobals;
  beforeEach(() => {
    g = installFakeGlobals();
  });
  afterEach(() => {
    g.restore();
  });

  const pointer = (target: EventTarget, type: string, x: number, y: number, props: Record<string, unknown> = {}) =>
    fire(target, type, { clientX: x, clientY: y, pointerId: 1, button: 0, ...props });

  it('a drag on the surface becomes a throw; the pointer is captured', () => {
    const { ctl } = make();
    const surface = new FakeEl('DIV');
    ctl.attach(surface as unknown as HTMLElement);

    pointer(surface, 'pointerdown', 300, 200);
    expect(surface.captured).toEqual([1]);
    pointer(g.window, 'pointermove', 220, 260);
    expect(ctl.getState()).toMatchObject({ aiming: true });
    expect(ctl.getState().power).toBeCloseTo(0.625, 12);
    pointer(g.window, 'pointerup', 220, 260);
    expect(ctl.consume()!.power).toBeCloseTo(0.625, 12);
  });

  it('ignores pointerdowns that land on [data-ui] elements', () => {
    const { ctl } = make();
    const surface = new FakeEl('DIV');
    ctl.attach(surface as unknown as HTMLElement);
    const button = new FakeEl('BUTTON');
    button.insideUi = true;
    pointer(surface, 'pointerdown', 300, 200, { target: button });
    pointer(g.window, 'pointermove', 100, 200);
    expect(ctl.getState().aiming).toBe(false);
    expect(surface.captured).toEqual([]);
    pointer(g.window, 'pointerup', 100, 200);
    expect(ctl.consume()).toBeNull();
  });

  it('only the primary mouse button starts a drag', () => {
    const { ctl } = make();
    const surface = new FakeEl('DIV');
    ctl.attach(surface as unknown as HTMLElement);
    pointer(surface, 'pointerdown', 300, 200, { button: 2 });
    expect(ctl.getState().aiming).toBe(false);
    pointer(surface, 'pointerdown', 300, 200, { button: 0 });
    expect(ctl.getState().aiming).toBe(true);
  });

  it('pointercancel aborts', () => {
    const { ctl } = make();
    const surface = new FakeEl('DIV');
    ctl.attach(surface as unknown as HTMLElement);
    pointer(surface, 'pointerdown', 300, 200);
    pointer(g.window, 'pointermove', 100, 200);
    pointer(g.window, 'pointercancel', 100, 200);
    pointer(g.window, 'pointerup', 100, 200);
    expect(ctl.consume()).toBeNull();
  });

  it('keyboard: arrows / Space are preventDefault-ed, repeats and text fields are ignored', () => {
    const { ctl } = make();
    ctl.attach(new FakeEl('DIV') as unknown as HTMLElement);

    const up = fire(g.window, 'keydown', { code: 'ArrowUp', repeat: false });
    expect(up.defaultPrevented).toBe(true);
    ctl.update(0.1);
    expect(ctl.getView().elevation).toBeCloseTo(DEFAULT_ELEVATION + 0.15, 12);
    fire(g.window, 'keyup', { code: 'ArrowUp' });

    expect(fire(g.window, 'keydown', { code: 'Space', repeat: false }).defaultPrevented).toBe(true);
    ctl.update(0.4);
    fire(g.window, 'keydown', { code: 'Space', repeat: true }); // auto-repeat
    expect(ctl.getState().power).toBeCloseTo(0.5, 12);
    fire(g.window, 'keyup', { code: 'Space' });
    expect(ctl.consume()!.power).toBeCloseTo(0.5, 12);

    // typing in a field, or holding a modifier: not ours
    expect(fire(g.window, 'keydown', { code: 'Space', repeat: false, target: new FakeEl('INPUT') }).defaultPrevented).toBe(false);
    fire(g.window, 'keydown', { code: 'ArrowUp', repeat: false, ctrlKey: true });
    ctl.update(0.5);
    expect(ctl.getState().aiming).toBe(false);
  });

  it('blur abandons a drag or charge in progress', () => {
    const { ctl } = make();
    const surface = new FakeEl('DIV');
    ctl.attach(surface as unknown as HTMLElement);
    pointer(surface, 'pointerdown', 300, 200);
    fire(g.window, 'blur');
    pointer(g.window, 'pointerup', 100, 200);
    expect(ctl.consume()).toBeNull();

    fire(g.window, 'keydown', { code: 'Space', repeat: false });
    ctl.update(0.4);
    fire(g.window, 'blur');
    fire(g.window, 'keyup', { code: 'Space' });
    expect(ctl.consume()).toBeNull();
  });

  it('blur keeps a throw that has already fired (it was complete and is still waiting to be consumed)', () => {
    const { ctl } = make();
    const surface = new FakeEl('DIV');
    ctl.attach(surface as unknown as HTMLElement);
    pointer(surface, 'pointerdown', 300, 200);
    pointer(g.window, 'pointerup', 140, 200);
    expect(ctl.getState().released).toBe(true);
    fire(g.window, 'blur');
    expect(ctl.getState().released).toBe(true);
    expect(ctl.consume()!.power).toBe(1);
  });

  it('hiding the tab abandons gestures in progress, like blur', () => {
    const { ctl } = make();
    const surface = new FakeEl('DIV');
    ctl.attach(surface as unknown as HTMLElement);
    pointer(surface, 'pointerdown', 300, 200);
    g.document.hidden = true;
    fire(g.document, 'visibilitychange');
    expect(ctl.getState().aiming).toBe(false);

    g.document.hidden = false;
    fire(g.window, 'keydown', { code: 'Space', repeat: false });
    ctl.update(0.4);
    g.document.hidden = true;
    fire(g.document, 'visibilitychange');
    fire(g.window, 'keyup', { code: 'Space' });
    expect(ctl.consume()).toBeNull();

    // becoming visible again changes nothing by itself
    g.document.hidden = false;
    fire(g.document, 'visibilitychange');
    expect(ctl.getView().charging).toBe(false);
  });

  it('detach() stops listening and cancels what was in progress', () => {
    const { ctl } = make();
    const surface = new FakeEl('DIV');
    ctl.attach(surface as unknown as HTMLElement);
    pointer(surface, 'pointerdown', 300, 200);
    ctl.detach();
    expect(ctl.getState().aiming).toBe(false);
    pointer(surface, 'pointerdown', 300, 200);
    pointer(g.window, 'pointerup', 100, 200);
    fire(g.window, 'keydown', { code: 'Space', repeat: false });
    expect(ctl.getState().aiming).toBe(false);
    expect(ctl.consume()).toBeNull();
    ctl.detach(); // idempotent
  });
});
