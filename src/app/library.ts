/** The player's design library (persisted in the save) + campaign unlock helpers. */

import { cloneDesign, newDesignId, type Design } from '../paper/design';
import { RECIPES } from '../paper/recipes';
import { getSave, updateSave } from '../core/storage';

export const STARTER_UNLOCKS = {
  recipes: ['dart', 'glider'],
  folds: ['valley', 'elevator'],
  papers: ['a4', 'letter', 'printer'],
  gadgets: [] as string[],
  cosmetics: ['plain', 'lined', 'graph'],
};

/** Make sure a fresh save has starter unlocks and a first design. */
export function ensureStarterContent(): void {
  updateSave((s) => {
    const u = s.progress.unlocks;
    for (const k of Object.keys(STARTER_UNLOCKS) as (keyof typeof STARTER_UNLOCKS)[]) {
      for (const id of STARTER_UNLOCKS[k]) if (!u[k].includes(id)) u[k].push(id);
    }
    if (s.designs.length === 0) {
      const dart = RECIPES.find((r) => r.id === 'dart')!.make();
      dart.name = 'My First Dart';
      s.designs.push(dart);
      s.activeDesignId = dart.id;
    }
    if (!s.activeDesignId || !s.designs.some((d) => d.id === s.activeDesignId)) s.activeDesignId = s.designs[0]?.id ?? null;
  });
}

export function listDesigns(): Design[] {
  return getSave().designs;
}

export function activeDesign(): Design {
  const s = getSave();
  const d = s.designs.find((x) => x.id === s.activeDesignId) ?? s.designs[0];
  return d ? cloneDesign(d) : RECIPES[0].make();
}

export function setActiveDesign(id: string): void {
  updateSave((s) => {
    s.activeDesignId = id;
  });
}

/** Insert or replace a design in the library; returns the stored copy's id. */
export function saveDesign(d: Design): string {
  const copy = cloneDesign(d);
  copy.updatedAt = Date.now();
  updateSave((s) => {
    const i = s.designs.findIndex((x) => x.id === copy.id);
    if (i >= 0) s.designs[i] = copy;
    else s.designs.unshift(copy);
    s.activeDesignId = copy.id;
  });
  return copy.id;
}

export function duplicateDesign(d: Design): Design {
  const c = cloneDesign(d);
  c.id = newDesignId();
  c.name = `${d.name} copy`.slice(0, 24);
  c.createdAt = c.updatedAt = Date.now();
  return c;
}

export function deleteDesign(id: string): void {
  updateSave((s) => {
    s.designs = s.designs.filter((x) => x.id !== id);
    if (s.activeDesignId === id) s.activeDesignId = s.designs[0]?.id ?? null;
  });
}

export function isUnlocked(kind: 'recipes' | 'folds' | 'papers' | 'gadgets' | 'cosmetics', id: string): boolean {
  return getSave().progress.unlocks[kind].includes(id);
}

export function unlock(kind: 'recipes' | 'folds' | 'papers' | 'gadgets' | 'cosmetics', id: string): boolean {
  let added = false;
  updateSave((s) => {
    if (!s.progress.unlocks[kind].includes(id)) {
      s.progress.unlocks[kind].push(id);
      added = true;
    }
  });
  return added;
}
