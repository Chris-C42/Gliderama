import { describe, expect, it } from 'vitest';
import {
  DIR_DEADZONE,
  PAD_BUTTON,
  PAD_IDLE,
  PAD_RAW_IDLE,
  PITCH_DEADZONE,
  combinePadRaw,
  mapPad,
  mapPadRaw,
  padEdges,
  readNavigatorPads,
  readPad,
  rescaleDeadzone,
  selectPads,
  type PadLike,
} from '../src/input/gamepad';

/** A standard-mapping pad with 4 axes and 17 buttons. `pressed` lists the pressed button indices. */
function pad(axes: number[] = [0, 0, 0, 0], pressed: number[] = [], extra: Partial<PadLike> = {}): PadLike {
  return {
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
    mapping: 'standard',
    connected: true,
    ...extra,
  };
}

describe('constants', () => {
  it('match the spec', () => {
    expect(DIR_DEADZONE).toBe(0.35);
    expect(PITCH_DEADZONE).toBe(0.12);
    expect(PAD_BUTTON.A).toBe(0);
    expect(PAD_BUTTON.START).toBe(9);
    expect(PAD_BUTTON.DPAD_UP).toBe(12);
    expect(PAD_BUTTON.DPAD_DOWN).toBe(13);
    expect(PAD_BUTTON.DPAD_LEFT).toBe(14);
    expect(PAD_BUTTON.DPAD_RIGHT).toBe(15);
  });
});

describe('left stick X -> dir (deadzone 0.35)', () => {
  it('is 0 inside the deadzone, including exactly on its edge', () => {
    for (const x of [0, 0.1, -0.1, 0.34, -0.34, 0.35, -0.35]) expect(mapPad(pad([x, 0])).dir, String(x)).toBe(0);
  });

  it('is -1 / +1 outside it', () => {
    expect(mapPad(pad([-0.36, 0])).dir).toBe(-1);
    expect(mapPad(pad([0.36, 0])).dir).toBe(1);
    expect(mapPad(pad([-1, 0])).dir).toBe(-1);
    expect(mapPad(pad([1, 0])).dir).toBe(1);
  });

  it('is not affected by the vertical axis', () => {
    expect(mapPad(pad([0.1, -1])).dir).toBe(0);
    expect(mapPad(pad([0.8, 1])).dir).toBe(1);
  });
});

describe('left stick Y -> pitch (inverted, deadzone 0.12, rescaled)', () => {
  it('stick up (axis -1) is nose up (+1); stick down is -1', () => {
    expect(mapPad(pad([0, -1])).pitch).toBe(1);
    expect(mapPad(pad([0, 1])).pitch).toBe(-1);
  });

  it('is exactly 0 inside the deadzone (and never -0)', () => {
    for (const y of [0, 0.05, -0.05, 0.12, -0.12]) {
      const p = mapPad(pad([0, y])).pitch;
      expect(Object.is(p, 0), `y=${y} gave ${p}`).toBe(true);
    }
  });

  it('is rescaled so it starts from 0 at the edge of the deadzone and reaches 1 at full deflection', () => {
    expect(mapPad(pad([0, -0.12001])).pitch).toBeGreaterThan(0);
    expect(mapPad(pad([0, -0.12001])).pitch).toBeLessThan(0.001);
    expect(mapPad(pad([0, -0.56])).pitch).toBeCloseTo(0.5, 9); // (0.56 - 0.12) / 0.88
    expect(mapPad(pad([0, 0.56])).pitch).toBeCloseTo(-0.5, 9);
    expect(mapPad(pad([0, -1])).pitch).toBe(1);
  });

  it('rescaleDeadzone is symmetric and monotonic', () => {
    expect(rescaleDeadzone(0.3, 0.12)).toBeCloseTo(-rescaleDeadzone(-0.3, 0.12), 12);
    let prev = -1;
    for (let v = -1; v <= 1.0001; v += 0.05) {
      const r = rescaleDeadzone(v, 0.12);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
    expect(rescaleDeadzone(5, 0.12)).toBe(1); // clamps even if a pad reports more than 1
  });
});

describe('D-pad', () => {
  it('left / right give dir and win over the stick', () => {
    expect(mapPad(pad([0, 0], [PAD_BUTTON.DPAD_LEFT])).dir).toBe(-1);
    expect(mapPad(pad([0, 0], [PAD_BUTTON.DPAD_RIGHT])).dir).toBe(1);
    expect(mapPad(pad([0.9, 0], [PAD_BUTTON.DPAD_LEFT])).dir).toBe(-1);
  });

  it('left + right together cancel and fall back to the stick', () => {
    expect(mapPad(pad([0.9, 0], [PAD_BUTTON.DPAD_LEFT, PAD_BUTTON.DPAD_RIGHT])).dir).toBe(1);
    expect(mapPad(pad([0, 0], [PAD_BUTTON.DPAD_LEFT, PAD_BUTTON.DPAD_RIGHT])).dir).toBe(0);
  });

  it('up / down give full pitch and win over the stick', () => {
    expect(mapPad(pad([0, 0], [PAD_BUTTON.DPAD_UP])).pitch).toBe(1);
    expect(mapPad(pad([0, 0], [PAD_BUTTON.DPAD_DOWN])).pitch).toBe(-1);
    expect(mapPad(pad([0, 1], [PAD_BUTTON.DPAD_UP])).pitch).toBe(1); // stick says down, D-pad says up
    expect(mapPad(pad([0, -1], [PAD_BUTTON.DPAD_UP, PAD_BUTTON.DPAD_DOWN])).pitch).toBe(1); // cancel -> stick
  });
});

describe('buttons', () => {
  it('A is the gadget, Start is pause', () => {
    const idle = mapPad(pad());
    expect(idle.gadget).toBe(false);
    expect(idle.pause).toBe(false);
    expect(mapPad(pad([0, 0], [PAD_BUTTON.A])).gadget).toBe(true);
    expect(mapPad(pad([0, 0], [PAD_BUTTON.START])).pause).toBe(true);
    expect(mapPad(pad([0, 0], [PAD_BUTTON.A])).pause).toBe(false);
    expect(mapPad(pad([0, 0], [1, 2, 3, 4, 5, 6, 7, 8])).gadget).toBe(false); // other buttons do nothing
  });

  it('analog buttons count when value > 0.5 even if `pressed` is false', () => {
    const p = pad();
    const buttons = p.buttons.map((b, i) => (i === 0 ? { pressed: false, value: 0.8 } : b));
    expect(mapPad({ ...p, buttons }).gadget).toBe(true);
    const weak = p.buttons.map((b, i) => (i === 0 ? { pressed: false, value: 0.3 } : b));
    expect(mapPad({ ...p, buttons: weak }).gadget).toBe(false);
  });
});

describe('robustness', () => {
  it('missing axes and buttons read as neutral', () => {
    expect(mapPad({ axes: [], buttons: [] })).toEqual(PAD_IDLE);
    expect(mapPad({ axes: [0.9], buttons: [] }).dir).toBe(1);
    expect(readPad({ axes: [], buttons: [] })).toEqual(PAD_RAW_IDLE);
  });

  it('NaN and out-of-range axes are sanitised', () => {
    expect(mapPad(pad([NaN, NaN])).dir).toBe(0);
    expect(mapPad(pad([NaN, NaN])).pitch).toBe(0);
    expect(mapPad(pad([7, -7])).dir).toBe(1);
    expect(mapPad(pad([7, -7])).pitch).toBe(1);
  });

  it('padEdges reports rising edges only', () => {
    const none = { ...PAD_IDLE };
    const a = { ...PAD_IDLE, gadget: true };
    const start = { ...PAD_IDLE, pause: true };
    expect(padEdges(none, a)).toEqual({ gadget: true, hover: false, pause: false });
    expect(padEdges(a, a)).toEqual({ gadget: false, hover: false, pause: false });
    expect(padEdges(a, none)).toEqual({ gadget: false, hover: false, pause: false });
    expect(padEdges(none, start)).toEqual({ gadget: false, hover: false, pause: true });
    expect(padEdges(none, { ...a, pause: true })).toEqual({ gadget: true, hover: false, pause: true });
    const y = { ...PAD_IDLE, hover: true };
    expect(padEdges(none, y)).toEqual({ gadget: false, hover: true, pause: false });
    expect(padEdges(y, y)).toEqual({ gadget: false, hover: false, pause: false });
  });

  it('button 3 (Y) is the hover toggle', () => {
    const buttons = Array.from({ length: 16 }, (_, i) => ({ pressed: i === 3 }));
    expect(mapPad({ axes: [0, 0], buttons }).hover).toBe(true);
    expect(mapPad({ axes: [0, 0], buttons: buttons.map(() => ({ pressed: false })) }).hover).toBe(false);
  });
});

describe('several pads', () => {
  it('combinePadRaw ORs buttons and takes the stick with the biggest deflection', () => {
    expect(combinePadRaw([])).toEqual(PAD_RAW_IDLE);
    const p1 = readPad(pad([0.2, 0], [PAD_BUTTON.A]));
    const p2 = readPad(pad([-0.9, -0.5], [PAD_BUTTON.START, PAD_BUTTON.DPAD_UP]));
    const c = combinePadRaw([p1, p2]);
    expect(c.a).toBe(true);
    expect(c.start).toBe(true);
    expect(c.up).toBe(true);
    expect(c.x).toBe(-0.9);
    expect(c.y).toBe(0.5);
    expect(combinePadRaw([p1])).toBe(p1);
  });

  it('mapPadRaw works on the combined reading', () => {
    const c = combinePadRaw([readPad(pad([0, 0], [PAD_BUTTON.A])), readPad(pad([0.9, 0]))]);
    const m = mapPadRaw(c);
    expect(m.gadget).toBe(true);
    expect(m.dir).toBe(1);
  });

  it('selectPads skips empty slots and disconnected pads', () => {
    const live = pad();
    const dead = pad([0, 0], [], { connected: false });
    expect(selectPads([null, undefined, dead, live])).toEqual([live]);
    expect(selectPads([])).toEqual([]);
  });

  it('selectPads prefers standard-mapping pads, falling back to any connected pad', () => {
    const std = pad();
    const odd = pad([0, 0], [], { mapping: '' });
    expect(selectPads([odd, std])).toEqual([std]);
    expect(selectPads([odd])).toEqual([odd]);
    expect(selectPads([std, pad()]).length).toBe(2);
  });

  it('readNavigatorPads is safe without a gamepad API', () => {
    expect(readNavigatorPads()).toEqual([]);
  });
});
