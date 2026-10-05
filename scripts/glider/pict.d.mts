/** Types for pict.mjs (used by the tests). */

export interface Picture {
  width: number;
  height: number;
  /** 8-bit RGB triplets, row by row. */
  rgb: Uint8Array;
  /** 1 where something was drawn (composed rooms). */
  mask?: Uint8Array;
}

export interface ColourStats {
  n: number;
  sky: number;
  dark: number;
  bright: number;
  specks: number;
  colours: { share: number; rgb: number[] }[];
}

export function decodePict(data: Uint8Array): Picture | null;
export function colourStats(img: Picture, x0: number, y0: number, x1: number, y1: number): ColourStats;
export function colourDistance(a: number[], b: number[]): number;
