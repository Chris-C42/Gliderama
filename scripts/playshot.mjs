// node scripts/playshot.mjs <url> <outPrefix> <script-json>
// script: [{"wait":ms} | {"eval":"js"} | {"shot":"name"}]
import { chromium } from 'playwright';
const [url, prefix, scriptJson] = process.argv.slice(2);
const steps = JSON.parse(scriptJson);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', null, { timeout: 20000 });
for (const s of steps) {
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.eval) { const r = await page.evaluate(s.eval); if (r !== undefined) console.log('eval:', JSON.stringify(r)); }
  if (s.shot) { await page.screenshot({ path: `${prefix}-${s.shot}.png` }); console.log('shot', s.shot); }
}
await browser.close();
if (logs.length) console.log(logs.slice(0, 30).join('\n'));
