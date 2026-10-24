#!/usr/bin/env node
// Party's renderer on its demo stages (client/party-render-demo.html), in
// Playwright's Chromium on SwiftShader WebGPU with ?present=0, each frame read
// back with capture() into traces/party-render-<scene>.png. A scene can take
// another backdrop: looks@night. Frame times are printed but mean nothing on
// a software GPU.
//   node tools/party-shot.mjs [--scenes looks,thinice,looks@snow] [--res 1280x800] [--bench: the main thread's ms a frame instead]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const res = opt('res', '1280x800');
const [W, H] = res.split('x').map(Number);
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const require = createRequire(import.meta.url);
const { chromium } = (() => { for (const n of ['playwright', 'playwright-core']) { try { return require(n); } catch { /* next */ } } throw new Error('playwright not found'); })();
const { server, port } = await serve();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined),
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'],
});
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('console', (m) => { if (m.type() === 'error') { failed = true; process.stderr.write(`[chrome] ${m.text()}\n`); } });
  page.on('pageerror', (e) => { failed = true; process.stderr.write(`[chrome] ${e.message}\n`); });
  await page.goto(`http://127.0.0.1:${port}/client/party-render-demo.html?present=0&res=${res}`);
  await page.waitForFunction(() => window.__demo?.ready || window.__demo?.error, null, { timeout: 120000 });
  const err = await page.evaluate(() => window.__demo.error);
  if (err) throw new Error(err);
  const all = await page.evaluate(() => window.__demo.names);
  const names = opt('scenes', '') ? opt('scenes', '').split(',') : [...all, 'looks@sunset', 'looks@night', 'looks@snow', 'horizon@sunset', 'horizon@night', 'horizon@snow'];
  if (argv.includes('--bench')) {
    for (const name of opt('scenes', 'stress,crowd,thinice').split(',')) console.log(name, JSON.stringify(await page.evaluate((n) => window.__demo.bench(n), name)));
    names.length = 0;
  }
  mkdirSync('traces', { recursive: true });
  for (const name of names) {
    const t0 = Date.now();
    const r = await page.evaluate((n) => window.__demo.shot(n), name);
    const f = `traces/party-render-${name.replace('@', '-')}.png`;
    writeFileSync(f, Buffer.from(r.png, 'base64'));
    console.log(`${f}  ${r.solids} solids  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
