/** Global physics/feel tuning. One place to tweak how the game feels. */

/** Pixels per metre in room space (a 640 × 360 room is 5.0 × 2.81 m). */
export const PX_PER_M = 128;
export const ROOM_W = 640;
export const ROOM_H = 360;

export const PHYS = {
  /** Simulation seconds per real second (slow motion so 4 m/s planes feel graceful). */
  timeScale: 0.42,
  /** Extra time scale applied by the slow-mo assist. */
  slowMoAssist: 0.7,
  /** Fixed physics substeps per 120 Hz game tick. */
  substeps: 3,
  /** Pitch inertia multiplier (>1 = lazier pitch response). */
  inertiaMul: 1.2,
  /** Extra pitch damping on top of Cmq (game feel). */
  extraDamping: 1.5,
  /** Elevator servo rate (rad of deflection per sim second) for a design of middling agility (see `agilityServo`). */
  servoRate: 3.6,
  /** How much the design's agility (0..10) speeds up or slows down the elevator: × (1 + (agility - 5) × this). */
  agilityServo: 0.08,
  /** Climb assist: rising air (m/s) where it starts to help, and how much more for its full help. */
  climbLift0: 0.4,
  climbLiftFull: 1.6,
  /** ...and how much further past its stall angle (fraction) a wing flies in the strongest rising air. */
  climbStallMargin: 0.3,
  /** Turnaround duration multiplier on the design's turn time. */
  turnMul: 0.38,
  /** Fraction of airspeed kept through a turnaround (before drag). */
  turnSpeedKeep: 0.92,
  /** Pitch beyond which a plane that isn't actively looping rolls upright (rad). */
  invertLimit: 1.85,
  /** Pitch rate (rad/s, sim) that counts as actively looping. */
  loopRate: 2.2,
  /** Duration (sim s) of the auto-righting half roll. */
  rightingTime: 0.3,
  /** Peak bank angle during a turnaround (rad). */
  turnBank: 0.8,
  /** Contact restitution & friction. */
  restitution: 0.18,
  friction: 0.8,
  /** Impact speed (m/s, real) below which bumps cause no damage. */
  safeImpact: 0.9,
  /** Speed below which a plane resting on a surface counts as grounded (m/s). */
  groundSpeed: 0.35,
  /** Seconds (sim) of resting contact before "grounded". */
  groundTime: 0.18,
  /** Throw speeds as multiples of the design's best-glide speed. */
  throwMin: 0.55,
  throwMax: 2.6,
  /** Battery boost thrust (N) and duration (sim s) per charge. */
  boostThrust: 0.06,
  boostTime: 1.0,
  /** Helium sticker lift (N) and duration (sim s). */
  heliumLift: 0.05,
  heliumTime: 1.6,
  /**
   * Leaving an updraft after climbing in it: a gentle shove along the heading so the plane doesn't come
   * out at stall speed. It counts once the plane has spent `exitLiftTime` sim s in air rising faster
   * than `exitLiftMin` m/s, fires when the rising air drops under `exitLiftOut`, and accelerates the
   * plane (at most `exitAccel` m/s²) towards `exitTarget` × its best-glide speed for `exitTime` sim s.
   */
  exitLiftMin: 0.8,
  exitLiftOut: 0.3,
  exitLiftTime: 0.8,
  exitTarget: 0.92,
  exitAccel: 2.2,
  exitTime: 0.35,
};
