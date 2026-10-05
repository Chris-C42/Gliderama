/** Shared cross-module types. Keep this file dependency-free. */

export interface Settings {
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  /** Swap pitch direction for the sliders / up-down keys. */
  invertPitch: boolean;
  /** Touch slider travel for full deflection, in CSS px (smaller = more sensitive). */
  sliderTravel: number;
  /** Mirror the touch layout (gadget buttons etc.) for left-handed players. */
  leftHanded: boolean;
  /** Assist: trims every design for its best glide hands-off. */
  autoTrim: boolean;
  /** Assist: slows the game further (accessibility). */
  slowMo: boolean;
  /** Show live flight data (speed / AoA / L:D) during normal play. */
  flightData: boolean;
  /** Reduce screen shake / flashing. */
  reducedMotion: boolean;
  /** Haptic feedback on touch devices where supported. */
  haptics: boolean;
  /** Show the engineer view by default in the workshop. */
  engineerView: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  musicVolume: 0.6,
  sfxVolume: 0.8,
  invertPitch: false,
  sliderTravel: 70,
  leftHanded: false,
  autoTrim: false,
  slowMo: false,
  flightData: false,
  reducedMotion: false,
  haptics: true,
  engineerView: false,
};

/**
 * Per-frame flight controls, merged from touch, keyboard and gamepad.
 * Produced by the input module, consumed by the flight model.
 */
export interface ControlState {
  /** Direction currently held: -1 left, +1 right, 0 none. If both held, the most recent wins. */
  dir: -1 | 0 | 1;
  /** Elevator command -1 (full nose down) .. +1 (full nose up). 0 when no direction is held on touch. */
  pitch: number;
  /** Gadget button currently held. */
  gadget: boolean;
  /** Gadget button went down this frame. */
  gadgetPressed: boolean;
  /** Pause requested this frame. */
  pausePressed: boolean;
}

/** Slingshot-style throw input, active while the game is waiting for a throw. */
export interface ThrowState {
  /** True while the player is dragging/aiming. */
  aiming: boolean;
  /** Aim angle in radians in room space (0 = right, +PI/2 = up). */
  angle: number;
  /** 0..1 throw power. */
  power: number;
  /** Set for exactly one frame when the throw is released. */
  released: boolean;
}

export type Facing = -1 | 1;
