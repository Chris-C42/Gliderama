/**
 * Design schema: everything needed to rebuild a paper plane deterministically.
 *
 * Coordinates are millimetres in the "table frame" of the RIGHT HALF of the sheet:
 *   x = distance from the centre line (0 .. sheetWidth/2), y = distance from the nose edge (0 .. sheetLength).
 * Every fold is mirrored onto the left half, so planes are always symmetric.
 *
 * This schema is persisted (saves) and encoded into share codes — treat changes as migrations.
 */

export type PaperSizeId = 'a4' | 'letter' | 'square' | 'a5' | 'legal' | 'a3';
export type PaperStockId = 'tissue' | 'newsprint' | 'origami' | 'printer' | 'cardstock';
export type CoatingId = 'none' | 'wax' | 'foil';
export type GadgetId = 'none' | 'battery' | 'bands' | 'helium';
export type PatternId =
  | 'plain'
  | 'lined'
  | 'graph'
  | 'newspaper'
  | 'kraft'
  | 'stars'
  | 'waves'
  | 'chevron'
  | 'dots'
  | 'camo'
  | 'blueprint'
  | 'flames';

export interface Vec2Like {
  x: number;
  y: number;
}

/** One flat fold. The fold line passes through a and b (table frame, mm). */
export interface FoldOp {
  a: Vec2Like;
  b: Vec2Like;
  /** Which side of the directed line a→b moves: +1 = left of a→b, -1 = right of a→b. */
  side: 1 | -1;
  /** Mountain folds tuck the flap underneath instead of on top. */
  mountain: boolean;
}

export interface WingFold {
  /** Keel depth (distance from centre line to the wing fold line) at the nose edge (y = 0), mm. */
  d0: number;
  /** Keel depth at the tail edge (y = sheet length), mm. */
  d1: number;
}

export interface WingletSpec {
  /** Fold line position: distance from the centre line in the table frame (x), mm. */
  x: number;
  /** Bend angle in degrees relative to the wing: +90 = straight up, -90 = straight down. */
  angle: number;
}

export interface ElevatorSpec {
  /** Flap depth measured forward from the trailing edge, mm. */
  depth: number;
  /** Spanwise start / end of the flap as fractions of the half-span measured from the wing root (0..1). */
  from: number;
  to: number;
  /** Bend angle in degrees; positive = trailing edge up (nose-up trim). */
  angle: number;
}

export interface Look {
  /** Front colour of the paper (CSS hex). */
  color: string;
  /** Back colour (two-sided origami paper shows this where folded). */
  backColor: string;
  pattern: PatternId;
  /** Ink colour for the printed pattern. */
  ink: string;
  sticker: string | null;
  trail: string | null;
}

export interface Design {
  v: 1;
  id: string;
  name: string;
  /** Recipe this design started from (cosmetic / analytics only). */
  recipe: string | null;
  createdAt: number;
  updatedAt: number;
  paper: {
    size: PaperSizeId;
    /** Landscape puts the short side along the plane's length (wide, stubby planes). */
    landscape: boolean;
    stock: PaperStockId;
  };
  folds: FoldOp[];
  /** Fold in half with flaps inside (valley, default) or outside (mountain). */
  flapsOutside: boolean;
  wing: WingFold;
  shape: {
    /** Wing dihedral in degrees (negative = anhedral). */
    dihedral: number;
    winglet: WingletSpec | null;
    elevator: ElevatorSpec | null;
  };
  extras: {
    /** Paperclip positions along the keel, mm from the nose edge (max 3). */
    clips: number[];
    coating: CoatingId;
    /** Tape reinforcement strips (0..3): toughness up, weight up. */
    tape: number;
    gadget: GadgetId;
  };
  look: Look;
}

export interface PaperSize {
  id: PaperSizeId;
  name: string;
  /** Short side, mm. */
  w: number;
  /** Long side, mm. */
  h: number;
}

export const PAPER_SIZES: Record<PaperSizeId, PaperSize> = {
  a4: { id: 'a4', name: 'A4', w: 210, h: 297 },
  letter: { id: 'letter', name: 'Letter', w: 216, h: 279 },
  square: { id: 'square', name: 'Square', w: 200, h: 200 },
  a5: { id: 'a5', name: 'A5', w: 148, h: 210 },
  legal: { id: 'legal', name: 'Legal', w: 216, h: 356 },
  a3: { id: 'a3', name: 'A3', w: 297, h: 420 },
};

export interface PaperStock {
  id: PaperStockId;
  name: string;
  /** Grams per square metre. */
  gsm: number;
  /** Relative stiffness/toughness of one layer (printer = 1). */
  toughness: number;
  /** How quickly it soaks up water (printer = 1). */
  absorbency: number;
  /** Surface roughness factor for skin friction (printer = 1). */
  roughness: number;
  blurb: string;
}

export const PAPER_STOCKS: Record<PaperStockId, PaperStock> = {
  tissue: { id: 'tissue', name: 'Tissue', gsm: 25, toughness: 0.35, absorbency: 2.2, roughness: 1.1, blurb: 'Feather-light and floaty, but tears if you look at it wrong.' },
  newsprint: { id: 'newsprint', name: 'Newsprint', gsm: 45, toughness: 0.6, absorbency: 1.6, roughness: 1.15, blurb: 'Light and cheap. Soaks up water fast.' },
  origami: { id: 'origami', name: 'Origami', gsm: 65, toughness: 0.85, absorbency: 0.9, roughness: 0.9, blurb: 'Thin, crisp, holds a sharp crease. Coloured on one side.' },
  printer: { id: 'printer', name: 'Printer', gsm: 80, toughness: 1, absorbency: 1, roughness: 1, blurb: 'The classic. Balanced in every way.' },
  cardstock: { id: 'cardstock', name: 'Cardstock', gsm: 160, toughness: 2.4, absorbency: 0.6, roughness: 1.05, blurb: 'Heavy and tough. Punches through drafts; sinks faster.' },
};

/** Size of the sheet as folded: width across the plane (x spans width/2), length along it. */
export function sheetDims(d: Pick<Design, 'paper'>): { width: number; length: number } {
  const s = PAPER_SIZES[d.paper.size];
  return d.paper.landscape ? { width: s.h, length: s.w } : { width: s.w, length: s.h };
}

export const MAX_FOLDS = 12;
export const MAX_CLIPS = 3;

export function newDesignId(): string {
  const r = Math.random().toString(36).slice(2, 8);
  return `d_${Date.now().toString(36)}_${r}`;
}

export const DEFAULT_LOOK: Look = {
  color: '#f4efe2',
  backColor: '#f4efe2',
  pattern: 'plain',
  ink: '#7a8bb0',
  sticker: null,
  trail: null,
};

/** A plain, unfolded sheet ready for the workshop. */
export function blankDesign(): Design {
  const now = Date.now();
  return {
    v: 1,
    id: newDesignId(),
    name: 'Untitled',
    recipe: null,
    createdAt: now,
    updatedAt: now,
    paper: { size: 'a4', landscape: false, stock: 'printer' },
    folds: [],
    flapsOutside: false,
    wing: { d0: 20, d1: 20 },
    shape: { dihedral: 8, winglet: null, elevator: null },
    extras: { clips: [], coating: 'none', tape: 0, gadget: 'none' },
    look: { ...DEFAULT_LOOK },
  };
}

export function cloneDesign(d: Design): Design {
  return JSON.parse(JSON.stringify(d)) as Design;
}
