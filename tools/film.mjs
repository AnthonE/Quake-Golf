#!/usr/bin/env node
// Fireplace's trailer, filmed from a replay on a box with no GPU.
//
//   node tools/film.mjs record [--seconds 900] [--bots 64] [--seed 7]      # a room of guests, saved as a replay in replays/
//   node tools/film.mjs plan REPLAY.qgr                                     # what was on, second by second
//   node tools/film.mjs shoot CUT.json [--stills 2,7.5] [--to 12] [--replay R.qgr]   # draw the cut: an mp4, or stills
//
// The page (client/fireplace.html?replay=…&film=<seconds>) runs with its own
// clock held: the replay sits paused, and each frame this moves the sim to the
// frame's tick (between ticks too, so motion is smooth), sets the page's time
// and draws once. Headless Chrome on SwiftShader takes a second or more a
// frame and the footage still plays at 30 fps. The room's scenes (the couch,
// the zoom into the TV, the standings) are the page's own, run on that clock.
// The sound is the game's own, every call it made while a shot was rolling,
// rendered offline on the cut's timeline (client/film.mjs). A replay is tied
// to the build of game.wasm it was recorded on: record again after the sim
// changes, then `plan` it and move the shots' times.
//
// A cut list (film/*.json):
//   { "replay": "replays/<file>.qgr", "out": "film/out/<name>.mp4", "size": [1920, 1080], "fps": 30,
//     "res": "1920x1080",                    the room's (and bumper's and party's) canvas
//     "theme": "grandma",                    the room's look at the start
//     "fade": 0.5,                           a fade from and to black at the ends, seconds
//     "shots": [
//       { "couch": 4 },                      on the couch, the TV's title up, for 4 s
//       { "sit": 7 },                        sit down: the zoom into the TV at the replay's start, 7 s of it
//       { "at": 95, "len": 5 },              the replay from 95 s in, 5 s of it (1 s runs first, unseen)
//       { "back": 5 }                        back on the couch at the end
//     ] }
//   Any shot may carry "theme" (the room's look from then), "caption" (low on
//   the left in the games' font; a "\n" starts a second, quieter line) and
//   "speed" (the replay's rate, 1 by default).
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import { serve } from './serve.mjs';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
process.chdir(ROOT);
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const [cmd, arg] = argv;
const TICK = 125;
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DENO = existsSync('.tools/deno') ? '.tools/deno' : 'deno';

if (cmd === 'record') await record();
else if (cmd === 'plan' && arg) await plan(arg);
else if (cmd === 'shoot' && arg) await shoot({ ...JSON.parse(readFileSync(arg, 'utf8')), ...(opt('replay', '') ? { replay: opt('replay', '') } : {}) });
else { console.error(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 6).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(2); }

// A relay with --replays and a bot host of Fireplace guests, for --seconds;
// the room's replay is written when the relay ends.
async function record() {
  const seconds = Number(opt('seconds', 900));
  const port = Number(opt('port', 4533));
  execFileSync(process.execPath, ['tools/asm.mjs'], { stdio: 'inherit' });
  mkdirSync('replays', { recursive: true });
  const before = new Set(readdirSync('replays'));
  const relay = spawn(DENO, ['run', '--unstable-net', '-A', '--v8-flags=--single-threaded-gc', 'net/relay.ts', '--port', String(port), '--native-port', String(port + 1),
    '--seed', opt('seed', '7'), '--wasm', 'build/fireplace/game.wasm', '--duration', String(seconds + 15), '--replays', 'replays', '--quiet'], { stdio: ['ignore', 'ignore', 'inherit'] });
  await new Promise((ok) => setTimeout(ok, 1500));
  const bots = spawn(process.execPath, ['net/bot-host.mjs', '--fireplace', '--relay', `127.0.0.1:${port + 1}`, '--bots', opt('bots', '64'), '--seconds', String(seconds), '--quiet', '--out', 'traces/film-bots.json'],
    { stdio: ['ignore', 'ignore', 'inherit'] });
  const t0 = Date.now();
  const tick = setInterval(() => process.stderr.write(`\rrecording ${((Date.now() - t0) / 1000).toFixed(0)} of ${seconds} s `), 1000);
  await new Promise((ok) => relay.once('exit', ok));
  clearInterval(tick);
  bots.kill();
  const made = readdirSync('replays').filter((f) => !before.has(f) && f.endsWith('.qgr'));
  console.error(`\n${made.length ? made.map((f) => `replays/${f}`).join('\n') : 'no replay was written'}`);
}

async function open({ replay, res = '960x540', film = 1, theme = '' }) {
  if (!existsSync('build/fireplace/game.wasm')) execFileSync(process.execPath, ['tools/asm.mjs'], { stdio: 'inherit' });
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const { server, port } = await serve();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined),
    args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('page:', m.text()); });
  const q = new URLSearchParams({ replay: `/${relative(ROOT, resolve(replay))}`, film: String(film), present: '0', res, ...(theme ? { theme } : {}) });
  await page.goto(`http://127.0.0.1:${port}/client/fireplace.html?${q}`);
  await page.waitForFunction(() => window.__film || window.__qa?.error, null, { timeout: 120000 });
  const err = await page.evaluate(() => window.__qa?.error);
  if (err) throw new Error(err);
  return { page, close: async () => { await browser.close(); server.close(); } };
}

// Each second of the replay: the game on, its state, and the scene.
async function plan(replay) {
  const { page, close } = await open({ replay });
  const span = await page.evaluate(() => window.__film.sit());
  const STATES = ['idle', 'countdown', 'play', 'over'];
  let lastLine = '';
  for (let t = span.first; t < span.end; t += TICK) {
    await page.evaluate((t) => window.__film.seek(t), t);
    const s = await page.evaluate(() => window.__qa.state());
    const line = `${s.gameName} ${STATES[s.state] ?? s.state}`;
    if (line !== lastLine) console.log(`${(t / TICK).toFixed(0).padStart(5)} s  ${line}`);
    lastLine = line;
  }
  console.log(`${(span.end / TICK).toFixed(0).padStart(5)} s  the end`);
  await close();
}

async function shoot(cut) {
  const fps = cut.fps || 30;
  const [W, H] = cut.size || [1920, 1080];
  const lenOf = (s) => s.couch ?? s.sit ?? s.len ?? s.back;
  const total = cut.shots.reduce((a, s) => a + lenOf(s), 0);
  const stills = opt('stills', '') ? opt('stills', '').split(',').map(Number) : null;
  const upTo = Number(opt('to', total));
  const out = cut.out || 'film/out/fireplace.mp4';
  const work = `${out.replace(/\.mp4$/, '')}.work`;
  mkdirSync(work, { recursive: true });
  const { page, close } = await open({ replay: cut.replay, res: cut.res || `${W}x${H}`, film: Math.ceil(total + 2), theme: cut.theme });
  const ff = stills ? null : spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', `${work}/silent.mkv`], { stdio: ['pipe', 'inherit', 'inherit'] });
  let pageMs = 1000; // the page's clock: on through every frame, seen or not
  let n = 0; // frames in the cut so far
  const want = stills ? new Set(stills.map((t) => Math.round(t * fps))) : null;
  const t0 = Date.now();
  let span = null;
  let tick = 0; // the replay's sim tick
  // the page runs at 60 frames a second (its eases count frames), every other one filmed
  const roll = async (shot, frames, step) => {
    for (let f = 0; f < frames; f++) {
      if (n >= upTo * fps) return;
      for (let half = 0; half < 2; half++) {
        if (step) { tick += step / 2; await page.evaluate((t) => window.__film.seek(t), tick); }
        pageMs += 500 / fps;
        await page.evaluate(([ms, o]) => window.__film.frame(ms, o), [pageMs, (n + half / 2) / fps]);
      }
      if (!want || want.has(n)) {
        const jpg = Buffer.from(await page.evaluate(([w, h, c]) => window.__film.shot(w, h, c), [W, H, shot.caption || '']), 'base64');
        if (want) writeFileSync(`${work}/t${(n / fps).toFixed(2)}.jpg`, jpg);
        else if (!ff.stdin.write(jpg)) await new Promise((ok) => ff.stdin.once('drain', ok));
      }
      n++;
      if (n % fps === 0) process.stderr.write(`\rfilm: ${(n / fps).toFixed(0)} of ${total} s, ${((Date.now() - t0) / 1000).toFixed(0)} s so far   `);
    }
  };
  // unseen frames at 60 a second: the page mounts the game on now and its scene catches up
  const preroll = async (seconds, step) => {
    for (let f = 0; f < seconds * 60; f++) {
      tick += step * fps / 60;
      await page.evaluate((t) => window.__film.seek(t), tick);
      pageMs += 1000 / 60;
      await page.evaluate((ms) => window.__film.frame(ms), pageMs);
    }
  };
  for (const shot of cut.shots) {
    if (n >= upTo * fps) break;
    if (shot.theme) await page.evaluate((id) => window.__film.theme(id), shot.theme);
    const frames = Math.round(lenOf(shot) * fps);
    const step = TICK * (shot.speed || 1) / fps;
    if (shot.couch !== undefined) await roll(shot, frames, 0);
    else if (shot.sit !== undefined) {
      span = await page.evaluate(() => window.__film.sit());
      tick = span.first;
      await page.evaluate((t) => window.__film.seek(t), tick);
      await roll(shot, frames, step);
    } else if (shot.back !== undefined) {
      await page.evaluate(() => window.__film.couch());
      await roll(shot, frames, 0);
    } else {
      const at = shot.at * TICK;
      if (at - TICK < tick) throw new Error(`shot at ${shot.at} s is before the replay's ${(tick / TICK).toFixed(1)} s: shots go forward`);
      tick = at - TICK;
      await page.evaluate((t) => window.__film.seek(t), tick);
      await preroll(1, step);
      await roll(shot, frames, step);
    }
  }
  process.stderr.write('\n');
  if (want) { console.error(`film: stills in ${work}/`); await close(); return; }
  ff.stdin.end();
  await new Promise((ok) => ff.once('close', ok));
  writeFileSync(`${work}/sound.wav`, Buffer.from(await page.evaluate(() => window.__film.audio()), 'base64'));
  await close();
  // the sound to -14 LUFS in two passes (linear, not pumped), faded with the picture; the picture in H.264 for the web
  const secs = n / fps, fade = cut.fade ?? 0.5;
  const j = await new Promise((ok) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostats', '-i', `${work}/sound.wav`, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']);
    let e = ''; p.stderr.on('data', (d) => { e += d; }); p.on('close', () => ok(JSON.parse(e.slice(e.lastIndexOf('{')))));
  });
  const af = `atrim=0:${secs},loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,`
    + `afade=t=in:d=${fade},afade=t=out:st=${Math.max(0, secs - fade)}:d=${fade}`;
  const vf = `fade=t=in:d=${fade},fade=t=out:st=${Math.max(0, secs - fade)}:d=${fade}`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `${work}/silent.mkv`, '-i', `${work}/sound.wav`, '-map', '0:v', '-map', '1:a', '-vf', vf, '-af', af, '-ar', '48000',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-maxrate', '8M', '-bufsize', '16M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', out], { stdio: 'inherit' });
  console.error(`film: ${out}, ${secs.toFixed(1)} s, ${(statSync(out).size / 1e6).toFixed(1)} MB`);
}
