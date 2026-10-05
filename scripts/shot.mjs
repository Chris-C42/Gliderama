// Screenshot helper: node scripts/shot.mjs <url> <out.png> [width] [height] [waitMs]
import { chromium } from 'playwright';
const [url, out, w = '1400', h = '900', wait = '800'] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(+wait);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
if (logs.length) console.log(logs.join('\n'));
console.log('saved', out);
