/**
 * BinHex 4.0 decoder (plain Node, no dependencies).
 *
 * A .hqx / .binhex file is a classic Mac file (name, type, creator, data fork, resource fork) encoded as
 * 7-bit text:
 *   1. text between the first ':' after "(This file must be converted with BinHex 4.0)" and the next ':'
 *      is a stream of 6-bit digits from a 64-character alphabet (line breaks are ignored);
 *   2. the decoded bytes are run-length compressed: 0x90 n repeats the previous byte (n - 1 more times),
 *      0x90 0x00 is a literal 0x90;
 *   3. the expanded stream is: name length, name, version (0), type, creator, flags, data length,
 *      resource length, header CRC, then the data fork + its CRC and the resource fork + its CRC.
 * The CRCs are CRC-16/XMODEM (CCITT polynomial 0x1021, initial value 0), big-endian.
 */

const ALPHABET = '!"#$%&\'()*+,-012345689@ABCDEFGHIJKLMNPQRSTUVXYZ[`abcdefhijklmpqr';
const DIGIT = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) DIGIT[ALPHABET.charCodeAt(i)] = i;

export class BinHexError extends Error {}

/** CRC-16/XMODEM of `bytes` (optionally continuing from `crc`). */
export function crc16(bytes, crc = 0) {
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** The 6-bit text between the colons, decoded to bytes (still run-length compressed). */
function decode6(text) {
  const marker = text.indexOf('(This file must be converted with BinHex');
  const start = text.indexOf(':', marker < 0 ? 0 : marker);
  if (start < 0) throw new BinHexError('no BinHex data (missing the opening colon)');
  const out = [];
  let acc = 0;
  let bits = 0;
  let i = start + 1;
  for (; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 58) break; // ':'
    if (c === 10 || c === 13 || c === 32 || c === 9) continue;
    const d = c < 128 ? DIGIT[c] : -1;
    if (d < 0) throw new BinHexError(`bad BinHex character ${JSON.stringify(text[i])} at offset ${i}`);
    acc = (acc << 6) | d;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  if (i >= text.length) throw new BinHexError('no BinHex data end (missing the closing colon)');
  return Uint8Array.from(out);
}

/** Expand the 0x90 run-length encoding. */
function unRle90(bytes) {
  const out = [];
  let prev = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b !== 0x90) {
      out.push(b);
      prev = b;
      continue;
    }
    const n = bytes[++i];
    if (n === undefined) break;
    if (n === 0) {
      out.push(0x90);
      prev = 0x90;
    } else for (let k = 1; k < n; k++) out.push(prev);
  }
  return Uint8Array.from(out);
}

const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const fourCC = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** Mac Roman bytes to a string (the upper half mapped for the characters house texts use). */
export function macRoman(bytes) {
  const HIGH = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';
  let s = '';
  for (const b of bytes) s += b < 128 ? String.fromCharCode(b) : HIGH[b - 128];
  return s;
}

/**
 * Decode a BinHex 4.0 text into its parts. Every CRC is checked; a mismatch throws (pass `{ lenient: true }`
 * to get the result anyway, with `crcOk` saying which parts failed).
 */
export function decodeBinHex(text, opts = {}) {
  const raw = unRle90(decode6(text));
  const nameLen = raw[0];
  const hdrEnd = 1 + nameLen + 1 + 4 + 4 + 2 + 4 + 4;
  if (raw.length < hdrEnd + 2) throw new BinHexError('BinHex header is truncated');
  const name = macRoman(raw.subarray(1, 1 + nameLen));
  let o = 1 + nameLen;
  const version = raw[o++];
  const type = fourCC(raw, o);
  const creator = fourCC(raw, o + 4);
  const flags = u16(raw, o + 8);
  const dataLength = u32(raw, o + 10);
  const rsrcLength = u32(raw, o + 14);
  o = hdrEnd;
  const crcOk = { header: false, data: false, rsrc: false };
  crcOk.header = crc16(raw.subarray(0, hdrEnd)) === u16(raw, o);
  o += 2;
  if (raw.length < o + dataLength + 2 + rsrcLength + 2) throw new BinHexError(`BinHex forks are truncated (${name})`);
  const data = raw.slice(o, o + dataLength);
  crcOk.data = crc16(data) === u16(raw, o + dataLength);
  o += dataLength + 2;
  const rsrc = raw.slice(o, o + rsrcLength);
  crcOk.rsrc = crc16(rsrc) === u16(raw, o + rsrcLength);
  if (!opts.lenient) {
    for (const part of ['header', 'data', 'rsrc']) if (!crcOk[part]) throw new BinHexError(`BinHex ${part} CRC mismatch (${name})`);
  }
  return { name, version, type, creator, flags, data, rsrc, crcOk };
}

/**
 * Parse a classic Mac resource fork: { [type]: [{ id, name, attrs, data }] }. Used for the houses' 'bnds'
 * (room bounds for custom backgrounds) and to list their custom pictures and sounds.
 */
export function parseResourceFork(fork) {
  const out = {};
  if (fork.length < 16) return out;
  const dataOff = u32(fork, 0);
  const mapOff = u32(fork, 4);
  const typeListOff = mapOff + u16(fork, mapOff + 24);
  const nameListOff = mapOff + u16(fork, mapOff + 26);
  const nTypes = u16(fork, typeListOff) + 1;
  if (u16(fork, typeListOff) === 0xffff) return out;
  for (let t = 0; t < nTypes; t++) {
    const e = typeListOff + 2 + t * 8;
    const type = macRoman(fork.subarray(e, e + 4));
    const n = u16(fork, e + 4) + 1;
    const refOff = typeListOff + u16(fork, e + 6);
    const list = (out[type] = []);
    for (let r = 0; r < n; r++) {
      const ref = refOff + r * 12;
      const idRaw = u16(fork, ref);
      const id = idRaw >= 0x8000 ? idRaw - 0x10000 : idRaw;
      const nameOff = u16(fork, ref + 2);
      const attrs = fork[ref + 4];
      const off = dataOff + ((fork[ref + 5] << 16) | (fork[ref + 6] << 8) | fork[ref + 7]);
      const len = u32(fork, off);
      const name = nameOff === 0xffff ? null : macRoman(fork.subarray(nameListOff + nameOff + 1, nameListOff + nameOff + 1 + fork[nameListOff + nameOff]));
      list.push({ id, name, attrs, data: fork.slice(off + 4, off + 4 + len) });
    }
  }
  return out;
}
