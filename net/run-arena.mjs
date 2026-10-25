#!/usr/bin/env node
// A1, the arena online: a relay on the arena's sim, AI fighters through its
// native door (net/bot-host.mjs --arena, one world shared by them all), and Chrome playing the arena's page with
// a fighter at its controls, over a lossy network if asked. Passes when the
// referee checked interval hashes from every session and none differed,
// someone was killed, and Chrome kept up. Screenshots go to traces/.
// --mode k forces every match to mode k (layout.mjs, M_*: 1 Infection, 2 gun
// game, 3 Juggernaut, 4 Team Slayer, 5 CTF, 6 Oddball, 7 King of the Hill)
// through the relay's seed, and the gate wants it played, by the bot host's
// world and every page; in a team mode, both sides dealt fighters.
//   node net/run-arena.mjs [--bots 5] [--chrome 1] [--seconds 60] [--impair delay=60,jitter=10,loss=0.05] [--shots 1] [--mode k]
//                          [--port 4433: the relay's, its native door the next]
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { serve } from '../tools/serve.mjs';
import { forcedSeed } from '../src/arena-view.mjs';
import * as L from '../src/layout.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const nbots = Number(opt('bots', 5));
const chrome = Number(opt('chrome', 1));
const seconds = Number(opt('seconds', 60));
const impair = opt('impair', '');
const shots = opt('shots', '1') !== '0';
const mode = opt('mode', '') === '' ? null : Number(opt('mode', ''));
const seed = mode === null ? 7 : forcedSeed(mode);
const tag = mode === null ? 'arena' : `arena-${L.MODES[mode].name.toLowerCase().replace(/ /g, '')}`;
const port = Number(opt('port', 4433));
const DENO = existsSync('.tools/deno') ? '.tools/deno' : 'deno';
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

execFileSync('sh', ['tools/cert.sh'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/asm.mjs'], { stdio: 'inherit' });
const hash = readFileSync('certs/hash.txt', 'utf8').trim();
mkdirSync('traces', { recursive: true });
const summaryPath = `traces/${tag}.relay.json`;
rmSync(summaryPath, { force: true });
const relay = spawn(DENO, ['run', '--unstable-net', '-A', '--v8-flags=--single-threaded-gc', 'net/relay.ts', '--port', String(port), '--seed', String(seed),
  '--native-port', String(port + 1), '--wasm', 'build/arena/game.wasm', '--duration', String(seconds + 40), '--summary', summaryPath, '--quiet'], { stdio: ['ignore', 'inherit', 'inherit'] });
await new Promise((ok) => setTimeout(ok, 1500));
const botsPath = `traces/${tag}.bots.json`;
rmSync(botsPath, { force: true });
const bots = nbots ? spawn(process.execPath, ['net/bot-host.mjs', '--arena', '--relay', `127.0.0.1:${port + 1}`, '--bots', String(nbots), '--seconds', String(seconds + 10), '--quiet', '--out', botsPath],
  { stdio: ['ignore', 'inherit', 'inherit'] }) : null;
const botsDone = bots ? new Promise((ok) => bots.once('exit', ok)) : null;

const require = createRequire(import.meta.url);
const { chromium } = (() => { for (const n of ['playwright', 'playwright-core']) { try { return require(n); } catch { /* next */ } } throw new Error('playwright not found'); })();
const { server, port: webPort } = await serve();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined),
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const pages = [];
const q = new URLSearchParams({ bot: '1', present: '0', url: `https://127.0.0.1:${port}/`, hash, impair, net: opt('net', '0'), skill: '0.9' });
const report = { bots: nbots, chrome, seconds, impair: impair || 'none', mode: mode === null ? 'rotation' : L.MODES[mode].name, seed, screenshots: [], kills: [], errors: [] };
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0);
try {
  for (let k = 0; k < chrome; k++) {
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
    page.on('console', (m) => { if (m.type() === 'error') { report.errors.push(m.text()); process.stderr.write(`[chrome ${k}] ${m.text()}\n`); } });
    page.on('pageerror', (e) => { report.errors.push(e.message); process.stderr.write(`[chrome ${k}] ${e.message}\n`); });
    await page.goto(`http://127.0.0.1:${webPort}/client/arena.html?${q}`);
    pages.push(page);
  }
  let snapAt = 0;
  while (Date.now() - t0 < seconds * 1000) {
    await new Promise((ok) => setTimeout(ok, 1000));
    const st = await Promise.all(pages.map((p) => p.evaluate(() => window.__qa?.state?.() || window.__qa || null)));
    if (st.some((s) => s?.error)) throw new Error(st.find((s) => s?.error).error);
    process.stderr.write(`\r${secs()} s  ${st.map((s, k) => s?.me ? `c${k}: P${s.slot + 1} ${s.me.kills}/${s.me.deaths} ${s.me.dead ? 'dead' : `${s.me.sh}/${s.me.hp}`}${s.me.zombie ? ' zombie' : ''}${s.mode?.mode === L.M_GUNGAME ? ` rung ${s.me.rung + 1}` : ''}${s.mode?.teamed ? ` ${['red', 'blue'][s.team] ?? '-'}${s.me.carry ? ' carrying' : ''} ${s.mode.score.join('-')}` : ''} ${s.mode?.name} ${['idle', 'countdown', 'play', 'over'][s.match.state]}` : `c${k}: ${s?.clState ?? '-'}`).join(' | ')}     `);
    if (shots && pages.length && Date.now() - snapAt > 4000 && st[0]?.me) {
      snapAt = Date.now();
      const png = await pages[0].evaluate(() => window.__qa.capture?.(2)).catch(() => null);
      if (png) { const f = `traces/${tag}-${secs().padStart(3, '0')}s.png`; writeFileSync(f, Buffer.from(png, 'base64')); report.screenshots.push(f); }
    }
  }
  process.stderr.write('\n');
  const end = await Promise.all(pages.map((p) => p.evaluate(() => window.__qa.state())));
  report.chromeState = end.map((s) => ({ slot: s.slot, kills: s.me?.kills, deaths: s.me?.deaths, behind: s.clState !== 2, feed: s.feed, mode: s.mode?.mode, match: s.match?.hole,
    zombie: s.me?.zombie, rung: s.me?.rung, points: s.me?.points, humans: s.mode?.humans, zombies: s.mode?.zombies,
    team: s.team, carry: s.me?.carry, score: s.mode?.score, target: s.mode?.target, teamWin: s.mode?.teamWin, teamN: s.mode?.teamN, kit: s.kit }));
  report.chromeHashes = await Promise.all(pages.map((p) => p.evaluate(() => window.__qa.hashes.length)));
} finally {
  await browser.close();
  server.close();
  bots?.kill('SIGINT');
  await Promise.race([botsDone, new Promise((ok) => setTimeout(ok, 5000))]);
  relay.kill('SIGTERM');
  await new Promise((ok) => setTimeout(ok, 1500));
}
const r = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null;
report.relay = r && { sessions: r.sessions, compared: r.compared, agreed: r.agreed, mismatches: r.mismatches, keys: r.keys, repairs: r.repairs, downKBpsPerSession: r.downKBpsPerSession, upKBpsPerSession: r.upKBpsPerSession, tickBytes: r.tickBytes };
const b = existsSync(botsPath) ? JSON.parse(readFileSync(botsPath, 'utf8')) : null;
report.botHost = b && { joined: b.joined, rejected: b.rejected, errors: b.errors, cpuPctOfOneCore: b.cpuPctOfOneCore, meanStepMs: b.world.meanStepMs, worstStepMs: b.world.worstStepMs,
  kills: b.world.players.reduce((n, p) => n + p.kills, 0), downKBpsEach: b.sessions.length ? Number((b.sessions.reduce((n, x) => n + x.downKB, 0) / b.sessions.length / seconds).toFixed(1)) : 0,
  mode: b.mode && { mode: b.mode.mode, name: b.mode.name, teamed: b.mode.teamed, score: b.mode.score, target: b.mode.target, teamWin: b.mode.teamWin, teamN: b.mode.teamN },
  matches: b.games, sides: b.mode?.teamed ? [0, 1].map((k) => b.world.players.filter((p) => p.team === k).length) : null };
// a forced team mode: both sides were dealt fighters, counted over the whole
// room (the bot host's own and every page's), and every page has a side and
// sees both sides' counts (AH_TEAMN) above 0; a room of one has one side
const teamed = mode !== null && !!L.MODES[mode]?.team;
const room = [...(b?.world.players ?? []).map((p) => p.team), ...(report.chromeState ?? []).map((s) => s.team)];
report.sides = teamed ? [0, 1].map((k) => room.filter((t) => t === k).length) : null;
const both = (n) => !!n && n.length === 2 && n.every((k) => k > 0);
const two = nbots + chrome >= 2;
const gate = {
  everyBotIn: !nbots || (!!b && b.joined === nbots && !b.errors.length),
  refereeChecked: !!r && r.compared >= 4 * (nbots + chrome),
  hashesAgree: !!r && (r.mismatches?.length ?? r.mismatches) === 0 && r.agreed === r.compared,
  someoneDied: (report.chromeState || []).some((s) => s.kills + s.deaths > 0) || (report.botHost?.kills ?? 0) > 0,
  chromeKeptUp: (report.chromeState || []).every((s) => !s.behind),
  modePlayed: mode === null || ((!nbots || report.botHost?.mode?.mode === mode) && (report.chromeState || []).every((s) => s.mode === mode)),
  sidesDealt: !teamed || ((!two || both(report.sides)) && (report.chromeState || []).every((s) => (s.team === 0 || s.team === 1) && (!two || both(s.teamN)))),
  noErrors: report.errors.length === 0,
};
report.gate = { ...gate, pass: Object.values(gate).every(Boolean) };
writeFileSync(`traces/${tag}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
console.log(report.gate.pass ? 'A1 gate: PASS' : 'A1 gate: FAIL');
process.exit(report.gate.pass ? 0 : 1);
