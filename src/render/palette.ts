/**
 * Gliderama palette: hue-shifted ramps (shadows lean cool/purple, highlights lean warm/yellow),
 * dark → light. Painters should pull colours from here so rooms read as one world.
 */

export type Ramp = readonly string[];

export const INK = '#1c1727';
export const OUTLINE = '#2b2340';

export const R = {
  ink: ['#141019', '#1c1727', '#2b2340', '#3d3357', '#575070', '#7a7491'],
  stone: ['#3a3848', '#555566', '#767888', '#9a9caa', '#c0c2cc', '#e2e3e8'],
  cream: ['#7c6a58', '#a08a70', '#c4ad8c', '#ddc9a6', '#ece0c4', '#f8f2e2'],
  oak: ['#2e1c16', '#4a2c1e', '#6b4128', '#8f5c36', '#b47d48', '#d4a066', '#ebc690'],
  walnut: ['#1f1416', '#33201f', '#4a2e28', '#664036', '#855646', '#a8705a'],
  pine: ['#4a3020', '#6e4a2c', '#96683c', '#bb8c52', '#d9ad6c', '#efcf92'],
  red: ['#3a1424', '#5e1f2e', '#8a2c35', '#b8413e', '#dc6a50', '#f09a72', '#f8c6a0'],
  rose: ['#4a2033', '#743049', '#a04a62', '#c87084', '#e49ba8', '#f6c9cc'],
  plum: ['#2a1a3a', '#432a58', '#634076', '#845c96', '#a882b6', '#ceb0d6'],
  navy: ['#151a33', '#1f2a4c', '#2c3f6c', '#3e5a8e', '#5b7fb0', '#86a8d0', '#b8d0ea'],
  teal: ['#12302e', '#1c4a44', '#2a6a5e', '#3e8c78', '#62ae92', '#96ceb0', '#c8e8d0'],
  moss: ['#1c2a1a', '#2c4226', '#425e32', '#5f7e3e', '#82a050', '#a8c070', '#d0dc9a'],
  mustard: ['#3e2a12', '#634418', '#8c6420', '#b88a2c', '#dcb446', '#f0d470', '#faeca8'],
  peach: ['#5a2e22', '#874634', '#b4664a', '#d68c64', '#eeb288', '#f8d4b0'],
  sky: ['#2c4a7a', '#4472a8', '#6a9ccc', '#96c2e4', '#c4e0f2', '#e8f4fa'],
  night: ['#0c0e1e', '#151a33', '#1e2848', '#2a3a62', '#3e5480', '#5e78a4'],
  brass: ['#3a2810', '#6a4a18', '#9a7024', '#c89a38', '#e8c45c', '#faea9c'],
  steel: ['#22242e', '#383c4a', '#545a6c', '#767e92', '#9ea6b8', '#c8ced8', '#eef0f4'],
  flame: ['#5a1a0c', '#a83a14', '#e06a1c', '#f8a02c', '#fcd45a', '#fff4b8'],
  leaf: ['#142a18', '#1e4224', '#2c5e30', '#3e7c3c', '#5e9c48', '#88bc5c'],
} as const;

export type RampName = keyof typeof R;

/** Pick a shade from a ramp, clamped. */
export function shade(r: Ramp, i: number): string {
  return r[Math.max(0, Math.min(r.length - 1, Math.round(i)))];
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
