/**
 * Just enough of QuickDraw's PICT format to read the custom backgrounds of Glider PRO houses: version 2
 * pictures made of pixel maps (opcodes 0x0098 PackBitsRect, 0x0099 PackBitsRgn, 0x009A DirectBitsRect; a big
 * picture comes as several bands). The converter only looks at their colours, to give each room the closest
 * Gliderama look (Inside Macintosh: Imaging With QuickDraw, appendix A). Plain Node, no dependencies.
 */

const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const s16 = (b, o) => (u16(b, o) >= 0x8000 ? u16(b, o) - 0x10000 : u16(b, o));
const rect = (b, o) => ({ top: s16(b, o), left: s16(b, o + 2), bottom: s16(b, o + 4), right: s16(b, o + 6) });

/** PackBits: n < 128 → n + 1 literal items; n > 128 → the next item 257 - n times (`unit` bytes per item). */
function unpackBits(src, o, end, out, unit = 1) {
  let k = 0;
  while (o < end && k < out.length) {
    const n = src[o++];
    if (n < 128) {
      const len = (n + 1) * unit;
      for (let i = 0; i < len; i++) out[k++] = src[o++];
    } else if (n > 128) {
      const times = 257 - n;
      for (let t = 0; t < times; t++) for (let i = 0; i < unit; i++) out[k++] = src[o + i];
      o += unit;
    }
  }
}

/** One row of pixel data (packed when rowBytes >= 8); returns the offset after it. */
function readRow(b, o, rowBytes, row, unit) {
  if (rowBytes < 8) {
    row.set(b.subarray(o, o + rowBytes));
    return o + rowBytes;
  }
  const count = rowBytes > 250 ? u16(b, o) : b[o];
  o += rowBytes > 250 ? 2 : 1;
  unpackBits(b, o, o + count, row, unit);
  return o + count;
}

/** A pixel map's fields after rowBytes (a PixMap without its baseAddr). */
function pixMap(b, o) {
  return {
    rowBytes: u16(b, o) & 0x3fff,
    isPixMap: !!(b[o] & 0x80),
    bounds: rect(b, o + 2),
    packType: u16(b, o + 12),
    pixelSize: u16(b, o + 28),
    cmpCount: u16(b, o + 30),
    end: o + 46,
  };
}

/** An indexed pixel map (1, 2, 4 or 8 bits through its colour table) → { width, height, rgb, dst, end }. */
function indexed(b, o, region) {
  const pm = pixMap(b, o);
  if (!pm.isPixMap || ![1, 2, 4, 8].includes(pm.pixelSize)) return null;
  o = pm.end;
  // colour table: seed, flags, size, then (index, r, g, b) entries of 16-bit components; in a device table
  // (flags bit 15) the entries are simply in index order
  const device = !!(b[o + 4] & 0x80);
  const n = u16(b, o + 6) + 1;
  o += 8;
  const clut = new Uint8Array(256 * 3);
  for (let i = 0; i < n; i++, o += 8) {
    const idx = (device ? i : u16(b, o)) & 0xff;
    clut[idx * 3] = b[o + 2];
    clut[idx * 3 + 1] = b[o + 4];
    clut[idx * 3 + 2] = b[o + 6];
  }
  const dst = rect(b, o + 8);
  o += 18; // srcRect, dstRect, mode
  if (region) o += u16(b, o);
  const width = pm.bounds.right - pm.bounds.left;
  const height = pm.bounds.bottom - pm.bounds.top;
  const bits = pm.pixelSize;
  const rgb = new Uint8Array(width * height * 3);
  const row = new Uint8Array(pm.rowBytes);
  const perByte = 8 / bits;
  const mask = (1 << bits) - 1;
  for (let y = 0; y < height; y++) {
    row.fill(0);
    o = readRow(b, o, pm.rowBytes, row, 1);
    for (let x = 0; x < width; x++) {
      const byte = row[Math.floor(x / perByte)];
      const idx = (byte >> ((perByte - 1 - (x % perByte)) * bits)) & mask;
      rgb.set(clut.subarray(idx * 3, idx * 3 + 3), (y * width + x) * 3);
    }
  }
  return { width, height, rgb, dst, end: o };
}

/** A direct pixel map (16 or 32 bits) → { width, height, rgb, dst, end }. */
function direct(b, o) {
  const pm = pixMap(b, o);
  const dst = rect(b, pm.end + 8);
  o = pm.end + 18; // srcRect, dstRect, mode
  const width = pm.bounds.right - pm.bounds.left;
  const height = pm.bounds.bottom - pm.bounds.top;
  const rgb = new Uint8Array(width * height * 3);
  const row = new Uint8Array(Math.max(pm.rowBytes, width * 4));
  for (let y = 0; y < height; y++) {
    row.fill(0);
    if (pm.pixelSize === 16) {
      o = readRow(b, o, pm.rowBytes, row, pm.packType === 3 ? 2 : 1);
      for (let x = 0; x < width; x++) {
        const v = u16(row, x * 2);
        const c = (s) => (((v >> s) & 31) * 255) / 31;
        rgb.set([c(10), c(5), c(0)], (y * width + x) * 3);
      }
    } else if (pm.pixelSize === 32 && (pm.packType === 4 || pm.packType === 0)) {
      // packed by component: a row of each plane in turn (alpha first when there are four)
      o = readRow(b, o, pm.rowBytes, row, 1);
      const skip = pm.cmpCount === 4 ? width : 0;
      for (let x = 0; x < width; x++) rgb.set([row[skip + x], row[skip + width + x], row[skip + 2 * width + x]], (y * width + x) * 3);
    } else if (pm.pixelSize === 32) {
      const bpp = pm.packType === 2 ? 3 : 4;
      for (let x = 0; x < width; x++) rgb.set(b.subarray(o + x * bpp + bpp - 3, o + x * bpp + bpp), (y * width + x) * 3);
      o += width * bpp;
    } else return null;
  }
  return { width, height, rgb, dst, end: o };
}

/**
 * The colours of a region of an image { width, height, rgb, mask? } (mask: 1 where something was drawn), sampled
 * every other pixel: the shares of sky-blue, near-black and near-white pixels, of specks (bright dots on black:
 * stars), and the main colours (clusters of similar colour, biggest first, as { share, rgb }).
 */
export function colourStats(img, x0, y0, x1, y1) {
  const bins = new Map();
  const blackAt = (x, y) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return true;
    const q = (y * img.width + x) * 3;
    return Math.max(img.rgb[q], img.rgb[q + 1], img.rgb[q + 2]) < 64;
  };
  let n = 0;
  let sky = 0;
  let dark = 0;
  let bright = 0;
  let specks = 0;
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y += 2)
    for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x += 2) {
      const p = y * img.width + x;
      if (img.mask && !img.mask[p]) continue;
      const r = img.rgb[p * 3];
      const g = img.rgb[p * 3 + 1];
      const b = img.rgb[p * 3 + 2];
      n++;
      // Glider PRO's skies are #33ccff-ish: strong blue, little red (pale cyan walls are not sky)
      if (r < 150 && g > 120 && b > 200 && b > r + 60) sky++;
      if (Math.max(r, g, b) < 48) dark++;
      if (r + g + b > 660) bright++;
      if (r + g + b > 450 && blackAt(x - 2, y) && blackAt(x + 2, y) && blackAt(x, y - 2) && blackAt(x, y + 2)) specks++;
      const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const e = bins.get(k) ?? bins.set(k, { n: 0, r: 0, g: 0, b: 0 }).get(k);
      e.n++;
      e.r += r;
      e.g += g;
      e.b += b;
    }
  const colours = [...bins.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 12)
    .map((e) => ({ share: e.n / n, rgb: [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)] }));
  const share = (k) => (n ? k / n : 0);
  return { n, sky: share(sky), dark: share(dark), bright: share(bright), specks: share(specks), colours: mergeColours(colours) };
}

/** Colour distance ("redmean", close enough to how different two colours look). */
export function colourDistance(a, b) {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

/** Merge clusters of similar colour (a textured wall is one colour in a few shades), biggest first. */
function mergeColours(colours) {
  const out = [];
  for (const c of colours) {
    const into = out.find((o) => colourDistance(o.rgb, c.rgb) < 90);
    if (!into) out.push({ share: c.share, rgb: c.rgb.slice() });
    else {
      const t = c.share / (into.share + c.share);
      into.rgb = into.rgb.map((v, i) => Math.round(v + (c.rgb[i] - v) * t));
      into.share += c.share;
    }
  }
  return out.sort((a, b) => b.share - a.share);
}

/**
 * Decode a PICT resource into { width, height, rgb } (8-bit RGB triplets, row by row, the size of its frame),
 * or null when it holds no pixel map this reader knows.
 */
export function decodePict(data) {
  const b = data;
  if (b.length < 40 || u16(b, 10) !== 0x0011 || u16(b, 12) !== 0x02ff) return null;
  const frame = rect(b, 2);
  const width = frame.right - frame.left;
  const height = frame.bottom - frame.top;
  if (width <= 0 || height <= 0 || width > 4096 || height > 4096) return null;
  const rgb = new Uint8Array(width * height * 3);
  let bands = 0;
  let o = 14;
  while (o + 2 <= b.length) {
    o += o & 1; // opcodes are word aligned
    const op = u16(b, o);
    o += 2;
    if (op === 0x00ff) break;
    if (op === 0x0c00) o += 24;
    else if (op === 0x0000 || op === 0x001e) continue;
    else if (op === 0x0001) o += u16(b, o);
    else if (op === 0x001a || op === 0x001b || op === 0x001f) o += 6;
    else if (op === 0x00a0) o += 2;
    else if (op === 0x00a1) o += 4 + u16(b, o + 2);
    else if (op === 0x0098 || op === 0x0099 || op === 0x009a) {
      const img = op === 0x009a ? direct(b, o + 4) : indexed(b, o, op === 0x0099);
      if (!img) break;
      // into the frame at its destination (bands are drawn 1:1)
      const x0 = img.dst.left - frame.left;
      const y0 = img.dst.top - frame.top;
      for (let y = 0; y < img.height; y++) {
        const ty = y0 + y;
        if (ty < 0 || ty >= height) continue;
        for (let x = 0; x < img.width; x++) {
          const tx = x0 + x;
          if (tx >= 0 && tx < width) rgb.set(img.rgb.subarray((y * img.width + x) * 3, (y * img.width + x) * 3 + 3), (ty * width + tx) * 3);
        }
      }
      bands++;
      o = img.end;
    } else break;
  }
  return bands ? { width, height, rgb } : null;
}
