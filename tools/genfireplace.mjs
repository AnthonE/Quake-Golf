#!/usr/bin/env node
// Plays the Fireplace playlist with bots on a local sim (no network) and
// records it as a .qgl event log: joins, leaves and every input word that
// changed. Each bot plays whatever game is on (client/fireplace-bot.mjs),
// its words landing `delay` ticks after it decides them, seeing the world
// that old. One leaves and comes back mid-game, and two more drop in late, so
// the log has the room coming and going across the games' switches.
//   node tools/genfireplace.mjs [--seed 7] [--bots 12] [--ticks 90000] [--delay 6] [--out logs/fireplace.qgl] [--debug]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { newMemory, instantiate, Sim, encodeLog } from '../harness/core.mjs';
import { View } from '../src/view.mjs';
import { Guest } from '../client/fireplace-bot.mjs';
import * as L from '../src/layout.mjs';
import { isMain } from './main.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const GENOME = readFileSync(join(ROOT, 'xbox/golfer.h'), 'utf8').match(/GOLFER_DEFAULT "(qg2:[A-Za-z0-9_-]+)"/)[1];

export async function playFireplace({ bytes, seed = 7, bots = 12, ticks = 90000, delay = 6, leaveAt = 0, late = 0, onTick } = {}) {
  const memory = newMemory();
  const sim = new Sim(await instantiate(await WebAssembly.compile(bytes), memory), memory);
  sim.init(seed);
  const view = new View(memory.buffer);
  const guests = Array.from({ length: bots }, (_, k) => ({ g: new Guest(k, seed, 0.3 + 0.6 * ((k * 5) % bots) / bots, GENOME), join: k < bots - 2 || !late ? k * 3 : late + k * 500, queue: [], last: -1, live: false }));
  const recs = [];
  const games = [];
  for (let t = 0; t < ticks; t++) {
    const now = [];
    for (const p of guests) {
      const k = p.g.slot;
      if (t === p.join || (leaveAt && k === 1 && t === leaveAt + 500)) { now.push([L.EV_JOIN, k]); p.live = true; p.queue = []; p.last = -1; }
      if (leaveAt && k === 1 && t === leaveAt) { now.push([L.EV_LEAVE, k]); p.live = false; }
      if (!p.live) continue;
      p.queue.push(p.g.think(view, t + delay, 2 * delay));
      if (p.queue.length > delay) {
        const w = p.queue.shift();
        if (w !== p.last) { now.push([L.EV_INPUT, k, w]); p.last = w; }
      }
    }
    for (const [kind, slot, word] of now) recs.push([t, kind, slot, word]);
    sim.feedPlayers(now);
    sim.x.step();
    const g = view.dv.getUint32(L.FP_GAME, true);
    if (games.at(-1)?.game !== g) games.push({ game: g, at: t + 1 });
    onTick?.(t, view);
  }
  const mallows = guests.map((p) => view.dv.getUint16(L.FP_MALLOWS + 2 * p.g.slot, true));
  return { log: encodeLog({ courseSeed: seed, ticks, recs }), games, mallows };
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  execFileSync(process.execPath, [join(ROOT, 'tools/asm.mjs')], { stdio: 'ignore' });
  const bytes = readFileSync(join(ROOT, `build/fireplace/${argv.includes('--debug') ? 'game.debug' : 'game'}.wasm`));
  const out = opt('out', 'logs/fireplace.qgl');
  const t0 = performance.now();
  const { log, games, mallows } = await playFireplace({ bytes, seed: Number(opt('seed', 7)), bots: Number(opt('bots', 12)), ticks: Number(opt('ticks', 90000)), delay: Number(opt('delay', 6)), leaveAt: 3000, late: 30000 });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, log);
  console.log(`${out}: ${log.length} B in ${((performance.now() - t0) / 1000).toFixed(0)} s; games ${games.map((g) => `${L.GAMES[g.game]} at ${(g.at / 125).toFixed(0)} s`).join(', ')}; marshmallows ${mallows.join(' ')}`);
}
