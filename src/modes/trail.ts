/**
 * Paper Trail — the endless draft-to-build roguelike.
 * Each run starts with a plain sheet and a few basic folds. Clear a floor, then pick 1 of 3
 * offers (techniques, paper, add-ons, repairs, perks) and refold at the workbench.
 */

import { createRng } from '../core/rng';
import { RECIPES } from '../paper/recipes';
import type { Design } from '../paper/design';
import type { WorkshopLimits } from '../app/nav';

export interface RunState {
  seed: number;
  floor: number;
  score: number;
  stars: number;
  sheets: number;
  tools: string[];
  papers: string[];
  gadgets: string[];
  recipes: string[];
  maxClips: number;
  airMul: number;
  perks: string[];
  design: Design;
  log: { floor: number; stars: number; time: number; damage: number }[];
  over: boolean;
}

export interface Offer {
  id: string;
  kind: 'technique' | 'paper' | 'addon' | 'gadget' | 'supplies' | 'perk';
  title: string;
  text: string;
  icon: string;
  apply(r: RunState): void;
  ok(r: RunState): boolean;
}

const has = (list: string[], id: string) => list.includes(id);

export const OFFERS: Offer[] = [
  { id: 'mountain', kind: 'technique', title: 'Mountain folds', text: 'Tuck flaps underneath.', icon: 'fold', ok: (r) => !has(r.tools, 'mountain'), apply: (r) => r.tools.push('mountain') },
  { id: 'flap', kind: 'technique', title: 'Top-flap folds', text: 'Fold a single flap, Nakamura-style.', icon: 'fold', ok: (r) => !has(r.tools, 'flap'), apply: (r) => r.tools.push('flap') },
  { id: 'winglets', kind: 'technique', title: 'Winglets', text: 'Bend the wingtips for a cleaner glide.', icon: 'wing', ok: (r) => !has(r.tools, 'winglets'), apply: (r) => r.tools.push('winglets') },
  {
    id: 'recipe-nakamura',
    kind: 'technique',
    title: 'Nakamura blueprint',
    text: 'A locked nose for long, stable glides.',
    icon: 'cards',
    ok: (r) => !has(r.recipes, 'nakamura'),
    apply: (r) => {
      r.recipes.push('nakamura');
      if (!has(r.tools, 'flap')) r.tools.push('flap');
    },
  },
  { id: 'recipe-delta', kind: 'technique', title: 'Delta blueprint', text: 'A wide wing that refuses to stall.', icon: 'cards', ok: (r) => !has(r.recipes, 'delta'), apply: (r) => r.recipes.push('delta') },
  { id: 'recipe-glider', kind: 'technique', title: 'Glider blueprint', text: 'Broad wings that ride every draft.', icon: 'cards', ok: (r) => !has(r.recipes, 'glider'), apply: (r) => r.recipes.push('glider') },
  { id: 'origami', kind: 'paper', title: 'Origami paper', text: 'Crisp and light; coloured on one side.', icon: 'sheet', ok: (r) => !has(r.papers, 'origami'), apply: (r) => r.papers.push('origami', 'square') },
  { id: 'cardstock', kind: 'paper', title: 'Cardstock', text: 'Heavy and tough. Punches through fans.', icon: 'sheet', ok: (r) => !has(r.papers, 'cardstock'), apply: (r) => r.papers.push('cardstock') },
  { id: 'tissue', kind: 'paper', title: 'Tissue paper', text: 'Floats on a whisper. Tears easily.', icon: 'sheet', ok: (r) => !has(r.papers, 'tissue'), apply: (r) => r.papers.push('tissue') },
  { id: 'big', kind: 'paper', title: 'A3 & Legal sheets', text: 'Bigger sheets: longer, wider planes.', icon: 'sheet', ok: (r) => !has(r.papers, 'a3'), apply: (r) => r.papers.push('a3', 'legal') },
  { id: 'clip', kind: 'addon', title: 'Extra paperclip', text: 'One more clip for nose weight (max 3).', icon: 'clip', ok: (r) => r.maxClips < 3, apply: (r) => (r.maxClips += 1) },
  { id: 'wax', kind: 'addon', title: 'Wax coating', text: 'Waterproof: drips just roll off.', icon: 'drop', ok: (r) => !has(r.tools, 'wax'), apply: (r) => r.tools.push('wax') },
  { id: 'foil', kind: 'addon', title: 'Foil coating', text: 'Heat-shield: candles can’t light you.', icon: 'flame', ok: (r) => !has(r.tools, 'foil'), apply: (r) => r.tools.push('foil') },
  { id: 'tape', kind: 'addon', title: 'Tape roll', text: 'Reinforce your plane: tougher, heavier.', icon: 'tape', ok: (r) => !has(r.tools, 'tape'), apply: (r) => r.tools.push('tape') },
  { id: 'battery', kind: 'gadget', title: 'Battery prop', text: 'Two boosts of thrust per throw.', icon: 'battery', ok: (r) => !has(r.gadgets, 'battery'), apply: (r) => r.gadgets.push('battery') },
  { id: 'helium', kind: 'gadget', title: 'Helium sticker', text: 'One floaty lift per throw.', icon: 'balloon', ok: (r) => !has(r.gadgets, 'helium'), apply: (r) => r.gadgets.push('helium') },
  { id: 'sheets', kind: 'supplies', title: 'A fresh ream', text: '+2 spare sheets.', icon: 'sheet', ok: () => true, apply: (r) => (r.sheets += 2) },
  { id: 'updraft', kind: 'perk', title: 'Updraft', text: 'Every vent and fan blows 15% harder.', icon: 'plus', ok: (r) => r.airMul < 1.45, apply: (r) => (r.airMul += 0.15) },
  { id: 'lucky', kind: 'perk', title: 'Lucky star', text: '+1 spare sheet at the start of every floor.', icon: 'star', ok: (r) => !has(r.perks, 'lucky'), apply: (r) => r.perks.push('lucky') },
];

export function newRun(seed = Math.floor(Math.random() * 2 ** 31)): RunState {
  const dart = RECIPES.find((r) => r.id === 'dart')!.make();
  dart.name = 'Trail Dart';
  return {
    seed,
    floor: 0,
    score: 0,
    stars: 0,
    sheets: 3,
    tools: ['valley', 'elevator'],
    papers: ['a4', 'letter', 'printer'],
    gadgets: [],
    recipes: ['dart'],
    maxClips: 1,
    airMul: 1,
    perks: [],
    design: dart,
    log: [],
    over: false,
  };
}

/** Three distinct offers for the draft after a floor (deterministic per run+floor). */
export function draftOffers(r: RunState): Offer[] {
  const rng = createRng(r.seed).fork(`draft-${r.floor}`);
  const avail = OFFERS.filter((o) => o.ok(r));
  const picks: Offer[] = [];
  const pool = rng.shuffle(avail);
  // try to give variety of kinds
  for (const o of pool) {
    if (picks.length >= 3) break;
    if (picks.some((p) => p.kind === o.kind) && pool.length > 4) continue;
    picks.push(o);
  }
  for (const o of pool) {
    if (picks.length >= 3) break;
    if (!picks.includes(o)) picks.push(o);
  }
  return picks;
}

export function workshopLimits(r: RunState): WorkshopLimits {
  return {
    tools: r.tools,
    papers: r.papers,
    gadgets: r.gadgets,
    recipes: r.recipes,
    maxClips: r.maxClips,
    title: `Paper Trail · floor ${r.floor + 1}`,
  };
}

/** Score for a cleared floor. */
export function floorScore(stars: number, time: number, par: number, damage: number, floor: number): number {
  const speed = Math.max(0, Math.round((par - time) * 5));
  return Math.round((100 + stars * 25 + speed + Math.max(0, 50 - damage)) * (1 + floor * 0.15));
}

const KEY = 'gliderama.trail.v1';

export function saveRun(r: RunState | null): void {
  try {
    if (!r) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* ignore */
  }
}

export function loadRun(): RunState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as RunState;
    return r.over ? null : r;
  } catch {
    return null;
  }
}
