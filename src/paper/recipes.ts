/**
 * Starting recipes: classic paper airplanes expressed as fold sequences on the half-sheet.
 * Table frame: x = distance from the centre line, y = distance from the nose edge (mm).
 */

import type { Design, FoldOp, PaperSizeId } from './design';
import { blankDesign, PAPER_SIZES } from './design';
import { sideValue } from './geom';

type XY = [number, number];

/** Build a fold op; `moving` is any point on the side of the line that should fold over. */
export function foldOp(a: XY, b: XY, moving: XY, opts: { mountain?: boolean; flap?: XY } = {}): FoldOp {
  const A = { x: a[0], y: a[1] };
  const B = { x: b[0], y: b[1] };
  const s = sideValue({ x: moving[0], y: moving[1] }, A, B);
  return {
    a: A,
    b: B,
    side: s > 0 ? 1 : -1,
    mountain: !!opts.mountain,
    flap: opts.flap ? { x: opts.flap[0], y: opts.flap[1] } : null,
  };
}

export interface Recipe {
  id: 'dart' | 'glider' | 'nakamura' | 'delta' | 'hammerhead' | 'square';
  name: string;
  blurb: string;
  /** 1 (easy) .. 3 (fiddly) */
  difficulty: number;
  make(): Design;
}

function base(name: string, recipe: Recipe['id'], size: PaperSizeId = 'a4', landscape = false): Design {
  const d = blankDesign();
  d.name = name;
  d.recipe = recipe;
  d.paper.size = size;
  d.paper.landscape = landscape;
  return d;
}

const T67 = Math.tan((67.5 * Math.PI) / 180);

export const RECIPES: Recipe[] = [
  {
    id: 'dart',
    name: 'Classic Dart',
    blurb: 'Sharp, fast and forgiving. Punches through drafts but sinks quickly.',
    difficulty: 1,
    make() {
      const d = base('Classic Dart', 'dart');
      const hw = PAPER_SIZES.a4.w / 2;
      d.folds = [
        foldOp([0, 0], [hw, hw], [hw, 1]),
        foldOp([0, 0], [hw, hw * T67], [hw, hw + 2]),
      ];
      d.wing = { d0: 0, d1: 38 };
      d.shape = { dihedral: 6, winglet: null, elevator: { depth: 14, from: 0.4, to: 1, angle: 5 } };
      d.look = { ...d.look, color: '#f4efe2', backColor: '#f4efe2', pattern: 'lined', ink: '#8aa0c8' };
      return d;
    },
  },
  {
    id: 'glider',
    name: 'Simple Glider',
    blurb: 'Blunt nose, broad wings. Floats on the gentlest draft.',
    difficulty: 1,
    make() {
      const d = base('Simple Glider', 'glider', 'a4', true);
      const hw = PAPER_SIZES.a4.h / 2;
      d.folds = [
        foldOp([0, 36], [hw, 36], [1, 1]),
        foldOp([0, 72], [hw, 72], [1, 38]),
        foldOp([50, 72], [hw, 72 + (hw - 50)], [hw - 1, 73]),
      ];
      d.wing = { d0: 18, d1: 22 };
      d.extras.clips = [12];
      d.shape = { dihedral: 8, winglet: null, elevator: { depth: 16, from: 0.3, to: 1, angle: 5 } };
      d.look = { ...d.look, color: '#e9eef6', backColor: '#e9eef6', pattern: 'graph', ink: '#9bb4d6' };
      return d;
    },
  },
  {
    id: 'nakamura',
    name: 'Nakamura Lock',
    blurb: 'A locked, heavy nose and long glide. The distance champion.',
    difficulty: 2,
    make() {
      const d = base('Nakamura Lock', 'nakamura');
      const hw = PAPER_SIZES.a4.w / 2;
      const px = 15;
      const land = hw + Math.sqrt((hw - px) ** 2 - px * px);
      // fold line: perpendicular bisector of the corner (hw, hw) and its landing (0, land), through (px, hw)
      const dx = hw - 0;
      const dy = land - hw;
      const bx = px + dy;
      const by = hw + dx;
      d.folds = [
        foldOp([0, 0], [hw, hw], [hw, 1]),
        foldOp([0, hw], [hw, hw], [1, 1]),
        foldOp([px, hw], [bx, by], [hw - 1, hw + 1]),
        foldOp([0, land - 4], [hw, land - 4], [1, land + 6], { flap: [1, land + 4] }),
      ];
      d.flapsOutside = true;
      d.wing = { d0: 6, d1: 14 };
      d.shape = { dihedral: 5, winglet: null, elevator: { depth: 12, from: 0.35, to: 1, angle: 10 } };
      d.look = { ...d.look, color: '#f6e7c8', backColor: '#f6e7c8', pattern: 'kraft', ink: '#b08a5a' };
      return d;
    },
  },
  {
    id: 'delta',
    name: 'Delta',
    blurb: 'A wide, swept wing that refuses to stall. Agile and stable.',
    difficulty: 1,
    make() {
      const d = base('Delta', 'delta', 'a4', true);
      const hw = PAPER_SIZES.a4.h / 2; // landscape: width is the long side
      d.folds = [foldOp([0, 0], [hw, hw], [hw, 1]), foldOp([0, 40], [hw, 40], [1, 1]), foldOp([0, 70], [hw, 70], [1, 42])];
      d.wing = { d0: 6, d1: 14 };
      d.extras.clips = [72, 80];
      d.shape = { dihedral: 3, winglet: { x: hw - 22, angle: 70 }, elevator: { depth: 14, from: 0.2, to: 0.75, angle: 4 } };
      d.look = { ...d.look, color: '#dfe9e3', backColor: '#dfe9e3', pattern: 'chevron', ink: '#7fa894' };
      return d;
    },
  },
  {
    id: 'hammerhead',
    name: 'Hammerhead',
    blurb: 'A rolled, weighted leading edge. Steady, tough and drift-proof.',
    difficulty: 2,
    make() {
      const d = base('Hammerhead', 'hammerhead');
      const hw = PAPER_SIZES.a4.w / 2;
      d.folds = [
        foldOp([0, 40], [hw, 40], [1, 1]),
        foldOp([0, 80], [hw, 80], [1, 44]),
        foldOp([24, 80], [hw, 80 + (hw - 24)], [hw - 1, 81]),
      ];
      d.wing = { d0: 22, d1: 24 };
      d.shape = { dihedral: 8, winglet: null, elevator: { depth: 15, from: 0.3, to: 1, angle: 4 } };
      d.look = { ...d.look, color: '#f1d9d2', backColor: '#f1d9d2', pattern: 'dots', ink: '#c98a7c' };
      return d;
    },
  },
  {
    id: 'square',
    name: 'Square Glider',
    blurb: 'Folded from a square of origami paper. Small, light and nimble.',
    difficulty: 1,
    make() {
      const d = base('Square Glider', 'square', 'square');
      d.paper.stock = 'origami';
      const hw = PAPER_SIZES.square.w / 2;
      d.folds = [foldOp([0, 0], [hw, hw], [hw, 1]), foldOp([0, 48], [hw, 48], [1, 1])];
      d.wing = { d0: 16, d1: 20 };
      d.extras.clips = [52];
      d.shape = { dihedral: 10, winglet: null, elevator: { depth: 12, from: 0.3, to: 1, angle: 8 } };
      d.look = { ...d.look, color: '#d9534f', backColor: '#f6f1e4', pattern: 'plain', ink: '#a33a36' };
      return d;
    },
  },
];

export function recipeById(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.id === id);
}
