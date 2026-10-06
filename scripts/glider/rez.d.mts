/** Types for rez.mjs (used by the tests). */

export function parseRez(text: string, types?: string[] | null): Record<string, { id: number; name: string | null; data: Uint8Array }[]>;
