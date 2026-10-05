// node scripts/flow.mjs <url> <outPrefix> <steps-json> [w] [h] [touch]
// steps: [{wait}|{click:"css or text=..."}|{shot:"name"}|{eval:"js"}|{drag:[x0,y0,x1,y1]}|{key:"ArrowUp", ms}]
import { chromium } from 'playwright';
const [url, prefix, stepsJson, w = '1280', h = '720', touch = ''] = process.argv.slice(2);
const steps = JSON.parse(stepsJson);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, hasTouch: !!touch, isMobile: !!touch, deviceScaleFactor: touch ? 2 : 1 });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
for (const s of steps) {
  try {
    if (s.wait) await page.waitForTimeout(s.wait);
    if (s.click) await page.locator(s.click).first().click({ timeout: 5000 });
    if (s.eval) { const r = await page.evaluate(s.eval); if (r !== undefined) console.log('eval:', typeof r === 'string' ? r : JSON.stringify(r)); }
    if (s.drag) {
      const [x0, y0, x1, y1] = s.drag;
      await page.mouse.move(x0, y0); await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10); await page.waitForTimeout(16); }
      if (!s.hold) await page.mouse.up();
    }
    if (s.up) await page.mouse.up();
    if (s.key) { await page.keyboard.down(s.key); await page.waitForTimeout(s.ms ?? 100); await page.keyboard.up(s.key); }
    if (s.shot) { await page.screenshot({ path: `${prefix}-${s.shot}.png` }); console.log('shot', s.shot); }
  } catch (e) { logs.push(`[step error] ${JSON.stringify(s)}: ${e.message.split('\n')[0]}`); }
}
await browser.close();
if (logs.length) console.log(logs.slice(0, 40).join('\n'));
