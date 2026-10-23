#!/usr/bin/env node
// Plays an arena match with AI fighters on a local sim (no network) and
// records it as a .qgl event log: joins, leaves and every input word that
// changed. Each fighter's words land `delay` ticks after it decides them and
// it sees the world that old, as over a network, and says so in its frames,
// so the shots it takes are checked where it saw its targets. The log replays
// in the harness like any other, so the determinism matrix covers the
// arena's guns, grenades, melee, pickups and respawns.
//   node tools/genarena.mjs [--seed 7] [--bots 8] [--ticks 20000] [--delay 6] [--out logs/arena.qgl]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { newMemory, instantiate, Sim, encodeLog } from '../harness/core.mjs';
import { View } from '../src/arena-view.mjs';
import { Fighter } from '../client/arena-bot.mjs';
import * as L from '../src/layout.mjs';
import { isMain } from './main.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Fighters join 25 ticks apart; one leaves at `leaveAt` and comes back 500 ticks later.
export async function playArena({ bytes, seed = 7, bots = 8, ticks = 20000, delay = 6, leaveAt = 0 } = {}) {
  const memory = newMemory();
  const sim = new Sim(await instantiate(await WebAssembly.compile(bytes), memory), memory);
  sim.init(seed);
  const view = new View(memory.buffer);
  const fighters = Array.from({ length: bots }, (_, k) => ({ f: new Fighter(k, seed, 0.3 + 0.6 * ((k * 5) % bots) / bots), join: 25 * k, queue: [], last: -1, live: false }));
  const recs = [];
  for (let t = 0; t < ticks; t++) {
    const now = [];
    for (const p of fighters) {
      const k = p.f.slot;
      if (t === p.join || (leaveAt && k === 1 && t === leaveAt + 500)) { now.push([L.EV_JOIN, k]); p.live = true; p.queue = []; p.last = -1; }
      if (leaveAt && k === 1 && t === leaveAt) { now.push([L.EV_LEAVE, k]); p.live = false; }
      if (!p.live) continue;
      p.queue.push(p.f.think(view, t + delay, 2 * delay));
      if (p.queue.length > delay) {
        const w = p.queue.shift();
        if (w !== p.last) { now.push([L.EV_INPUT, k, w]); p.last = w; }
      }
    }
    for (const [kind, slot, word] of now) recs.push([t, kind, slot, word]);
    sim.feedPlayers(now);
    sim.x.step();
  }
  const scores = fighters.map((p) => { const f = view.fighter(p.f.slot); return { slot: p.f.slot, kills: f.kills, deaths: f.deaths }; });
  return { log: encodeLog({ courseSeed: seed, ticks, recs }), scores, matches: view.hole().hole, state: view.hole().state };
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  execFileSync(process.execPath, [join(ROOT, 'tools/asm.mjs')], { stdio: 'ignore' });
  const bytes = readFileSync(join(ROOT, 'build/arena/game.wasm'));
  const out = opt('out', 'logs/arena.qgl');
  const { log, scores, matches } = await playArena({ bytes, seed: Number(opt('seed', 7)), bots: Number(opt('bots', 8)), ticks: Number(opt('ticks', 20000)), delay: Number(opt('delay', 6)), leaveAt: 3000 });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, log);
  console.log(`${out}: ${log.length} B, ${matches} matches over; kills/deaths ${scores.map((s) => `${s.kills}/${s.deaths}`).join(' ')}`);
}
