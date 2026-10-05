#!/usr/bin/env node
/**
 * Renders public/icons/icon.svg into the PNG icons the PWA needs, with Playwright's chromium.
 * It only uses a browser that is already installed (it never downloads one).
 *
 *   public/icons/icon-192.png           192x192  purpose "any"       transparent corners
 *   public/icons/icon-512.png           512x512  purpose "any"       transparent corners
 *   public/icons/icon-maskable-512.png  512x512  purpose "maskable"  opaque edge-to-edge background,
 *                                                                    artwork scaled into the safe zone
 *   public/icons/apple-touch-icon.png   180x180  iOS home screen     opaque (iOS paints transparency black)
 *
 * Usage:  npm run icons
 * Env:    CHROMIUM_PATH=/path/to/chrome   skip browser discovery and use this executable
 *
 * Conventions for icon.svg (so the lead can swap the art freely):
 *   - an element with id="bg" is the tile background: its fill colour fills the maskable and apple icons
 *     (the element itself is hidden in the maskable render so the glyph can be scaled on its own);
 *   - everything else is the glyph. Keep it inside the circle inscribed in the viewBox and it is safe to crop.
 *   - optional public/icons/icon-maskable.svg: hand-made maskable art, rendered edge to edge as is.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'public', 'icons');
const SOURCE = join(iconsDir, 'icon.svg');
const MASKABLE_SOURCE = join(iconsDir, 'icon-maskable.svg');

/** Used when icon.svg has no #bg element with a plain colour fill. Matches the manifest theme_color. */
const FALLBACK_BG = '#2b2340';
/**
 * Android crops maskable icons to a circle with 80 % of the icon's width (the "safe zone"), so scaling the
 * artwork to 80 % puts everything inside the source's inscribed circle inside the safe zone.
 */
const MASKABLE_SCALE = 0.8;

/** @type {{ file: string; size: number; mode: 'any' | 'maskable' | 'apple' }[]} */
const TARGETS = [
  { file: 'icon-192.png', size: 192, mode: 'any' },
  { file: 'icon-512.png', size: 512, mode: 'any' },
  { file: 'icon-maskable-512.png', size: 512, mode: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, mode: 'apple' },
];

/** Find a preinstalled chromium (newest first). Never runs `playwright install`. */
function findChromium() {
  const fromEnv = process.env.CHROMIUM_PATH;
  if (fromEnv) {
    if (existsSync(fromEnv)) return fromEnv;
    throw new Error(`CHROMIUM_PATH is set but does not exist: ${fromEnv}`);
  }
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean);
  const relPaths = [
    'chrome-linux/chrome',
    'chrome-linux64/chrome',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-win/chrome.exe',
  ];
  for (const base of roots) {
    if (!existsSync(base)) continue;
    const dirs = readdirSync(base)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const dir of dirs) {
      for (const rel of relPaths) {
        const candidate = join(base, dir, rel);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  try {
    const own = chromium.executablePath();
    if (own && existsSync(own)) return own;
  } catch {
    // fall through to the error below
  }
  throw new Error(
    'No chromium found. Looked in $PLAYWRIGHT_BROWSERS_PATH and /opt/pw-browsers; set CHROMIUM_PATH to a chrome executable.',
  );
}

/** Strip an XML prolog / doctype so the markup can be inlined into an HTML page. */
function inlineable(svg) {
  return svg.replace(/^\s*<\?xml[^>]*\?>/, '').replace(/<!DOCTYPE[^>]*>/i, '').trim();
}

function pageHtml({ svg, size, background, scale, hideBg }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; width: ${size}px; height: ${size}px; overflow: hidden; background: ${background}; }
.stage { width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center; }
.stage > svg { width: ${size * scale}px; height: ${size * scale}px; display: block; }
${hideBg ? '#bg { display: none; }' : ''}
</style></head><body><div class="stage">${svg}</div></body></html>`;
}

/** Read the tile colour from the SVG's #bg element (resolved by the browser), or fall back. */
async function probeBackground(page, svg) {
  await page.setContent(`<!doctype html><body>${svg}</body>`);
  return page.evaluate((fallback) => {
    const el = document.querySelector('svg #bg');
    if (!el) return { color: fallback, hasBg: false };
    const fill = getComputedStyle(el).fill;
    return /^rgba?\(/.test(fill) ? { color: fill, hasBg: true } : { color: fallback, hasBg: false };
  }, FALLBACK_BG);
}

function pngSize(buf) {
  const sig = buf.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') throw new Error('not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function main() {
  if (!existsSync(SOURCE)) throw new Error(`Missing ${SOURCE}`);
  const svg = inlineable(readFileSync(SOURCE, 'utf8'));
  const customMaskable = existsSync(MASKABLE_SOURCE) ? inlineable(readFileSync(MASKABLE_SOURCE, 'utf8')) : null;

  const executablePath = findChromium();
  console.log(`chromium: ${executablePath}`);
  const browser = await chromium.launch({ executablePath });
  try {
    const context = await browser.newContext({ deviceScaleFactor: 1 });
    const page = await context.newPage();
    const { color: bg, hasBg } = await probeBackground(page, svg);
    mkdirSync(iconsDir, { recursive: true });

    for (const { file, size, mode } of TARGETS) {
      let html;
      if (mode === 'any') {
        html = pageHtml({ svg, size, background: 'transparent', scale: 1, hideBg: false });
      } else if (mode === 'maskable' && customMaskable) {
        html = pageHtml({ svg: customMaskable, size, background: bg, scale: 1, hideBg: false });
      } else if (mode === 'maskable') {
        html = pageHtml({ svg, size, background: bg, scale: MASKABLE_SCALE, hideBg: hasBg });
      } else {
        html = pageHtml({ svg, size, background: bg, scale: 1, hideBg: false });
      }
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(html);
      const png = await page.screenshot({
        type: 'png',
        omitBackground: mode === 'any',
        clip: { x: 0, y: 0, width: size, height: size },
      });
      const dims = pngSize(png);
      if (dims.width !== size || dims.height !== size) {
        throw new Error(`${file}: expected ${size}x${size}, got ${dims.width}x${dims.height}`);
      }
      writeFileSync(join(iconsDir, file), png);
      console.log(`wrote public/icons/${file}  ${size}x${size}  ${png.length} bytes  (${mode})`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
