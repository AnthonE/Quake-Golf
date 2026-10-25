#!/usr/bin/env node
// Every room theme (client/themes/), drawn from the couch on client/room.html in
// Playwright's Chromium on SwiftShader WebGPU with ?present=0, read back into
// traces/themes/<id>.png: what a theme pull request looks like, for whoever
// reviews it (CI keeps them as an artifact). Run npm run build first: it
// bundles the list.
//   node tools/theme-shots.mjs [--themes grandma,haunted] [--res 960x600]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
import { readThemes } from './themes.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const res = opt('res', '960x600');
const [W, H] = res.split('x').map(Number);
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const require = createRequire(import.meta.url);
const { chromium } = (() => { for (const n of ['playwright', 'playwright-core']) { try { return require(n); } catch { /* next */ } } throw new Error('playwright not found'); })();
const ids = opt('themes', '') ? opt('themes', '').split(',') : readThemes().map((t) => t.id);
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
  await page.goto(`http://127.0.0.1:${port}/client/room.html?present=0&live=0&res=${res}&theme=${ids[0]}`);
  await page.waitForFunction(() => window.__room?.ready || window.__room?.error, null, { timeout: 120000 });
  const err = await page.evaluate(() => window.__room.error);
  if (err) throw new Error(err);
  mkdirSync('traces/themes', { recursive: true });
  for (const id of ids) {
    const t0 = Date.now();
    const png = await page.evaluate((t) => window.__room.shot(t), id);
    const f = `traces/themes/${id}.png`;
    writeFileSync(f, Buffer.from(png, 'base64'));
    console.log(`${f}  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
