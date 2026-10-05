/** Types for binhex.mjs (used by the tests). */

export class BinHexError extends Error {}

export function crc16(bytes: Uint8Array, crc?: number): number;

export function macRoman(bytes: Uint8Array): string;

export interface BinHexFile {
  name: string;
  version: number;
  type: string;
  creator: string;
  flags: number;
  data: Uint8Array;
  rsrc: Uint8Array;
  crcOk: { header: boolean; data: boolean; rsrc: boolean };
}

export function decodeBinHex(text: string, opts?: { lenient?: boolean }): BinHexFile;

export interface Resource {
  id: number;
  name: string | null;
  attrs: number;
  data: Uint8Array;
}

export function parseResourceFork(fork: Uint8Array): Record<string, Resource[]>;
