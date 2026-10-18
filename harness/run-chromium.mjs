#!/usr/bin/env node
// node harness/run-chromium.mjs --log L --ticks N --threads T --flags liftoff-only|no-liftoff --out trace.qgh
// Drives headless Chromium through Playwright; the page is served cross-origin isolated.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { serve } from '../tools/serve.mjs';
import { args, DEFAULTS } from './cli.mjs';
import { isMain } from '../tools/main.mjs';

const require = createRequire(import.meta.url);
function playwright() {
  for (const name of ['playwright', 'playwright-core']) {
    try { return require(name); } catch { /* next */ }
  }
  throw new Error('playwright not found (set NODE_PATH or npm i playwright-core)');
}

const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export async function runChromium(a) {
  const { chromium } = playwright();
  const { server, port } = await serve();
  const jsFlags = a.flags && a.flags !== 'default' ? [`--js-flags=--${a.flags}`] : [];
  const executablePath = process.env.CHROMIUM_PATH || (existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined);
  const browser = await chromium.launch({ executablePath, args: [...jsFlags, '--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const v8 = browser.version();
    const q = new URLSearchParams({
      log: a.log, wasm: a.wasm, ticks: String(a.ticks), threads: String(a.threads), salt: String(a.salt),
      flags: a.flags || 'default', v8, out: a.out ? basename(a.out) : '',
    });
    page.on('console', (m) => process.stderr.write(`[page] ${m.text()}\n`));
    await page.goto(`http://127.0.0.1:${port}/harness/browser/index.html?${q}`);
    let last = '';
    for (;;) {
      const r = await page.evaluate(() => window.__result || null);
      if (r) {
        if (r.error) throw new Error(r.error);
        process.stderr.write('\n');
        return r.result;
      }
      const text = await page.textContent('#log');
      if (text !== last) { process.stderr.write(`\r${text}   `); last = text; }
      await new Promise((ok) => setTimeout(ok, 500));
    }
  } finally {
    await browser.close();
    server.close();
  }
}

if (isMain(import.meta.url)) {
  const a = args(process.argv.slice(2), DEFAULTS);
  if (a.out && !a.out.startsWith('traces/')) {
    console.error('--out must be under traces/ (the server writes there)');
    process.exit(2);
  }
  runChromium(a).then((r) => console.log(JSON.stringify(r))).catch((e) => { console.error(e.message || e); process.exit(1); });
}
