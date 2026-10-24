#!/usr/bin/env node
// Plays bumper balls with AI balls on a local sim (no network) and records
// it as a .qgl event log: joins, leaves and every input word that changed.
// Each ball's words land `delay` ticks after it decides them and it sees the
// world that old, as over a network. The log replays in the harness like any
// other, so the determinism matrix covers the cheese, the bumps, the orbs,
// the power-ups and the rounds.
//   node tools/genbumper.mjs [--seed 7] [--bots 16] [--ticks 20000] [--delay 6] [--out logs/bumper.qgl]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { newMemory, instantiate, Sim, encodeLog } from '../harness/core.mjs';
import { View } from '../src/bumper-view.mjs';
import { Roller } from '../client/bumper-bot.mjs';
import * as L from '../src/layout.mjs';
import { isMain } from './main.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Balls join a tick apart; one leaves at `leaveAt` and comes back 500 ticks later (watching till the next round).
export async function playBumper({ bytes, seed = 7, bots = 16, ticks = 20000, delay = 6, leaveAt = 0 } = {}) {
  const memory = newMemory();
  const sim = new Sim(await instantiate(await WebAssembly.compile(bytes), memory), memory);
  sim.init(seed);
  const view = new View(memory.buffer);
  const balls = Array.from({ length: bots }, (_, k) => ({ r: new Roller(k, seed, 0.3 + 0.6 * ((k * 5) % bots) / bots), join: k, queue: [], last: -1, live: false }));
  const recs = [];
  let rounds = 0, state = -1;
  for (let t = 0; t < ticks; t++) {
    const now = [];
    for (const p of balls) {
      const k = p.r.slot;
      if (t === p.join || (leaveAt && k === 1 && t === leaveAt + 500)) { now.push([L.EV_JOIN, k]); p.live = true; p.queue = []; p.last = -1; }
      if (leaveAt && k === 1 && t === leaveAt) { now.push([L.EV_LEAVE, k]); p.live = false; }
      if (!p.live) continue;
      p.queue.push(p.r.think(view, t + delay, 2 * delay));
      if (p.queue.length > delay) {
        const w = p.queue.shift();
        if (w !== p.last) { now.push([L.EV_INPUT, k, w]); p.last = w; }
      }
    }
    for (const [kind, slot, word] of now) recs.push([t, kind, slot, word]);
    sim.feedPlayers(now);
    sim.x.step();
    const s = view.hole().state;
    if (s === L.H_OVER && state !== L.H_OVER) rounds++;
    state = s;
  }
  const scores = balls.map((p) => { const b = view.bumper(p.r.slot); return { slot: p.r.slot, wins: b.wins, kos: b.kos, bumps: b.bumps }; });
  return { log: encodeLog({ courseSeed: seed, ticks, recs }), scores, rounds, state };
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  execFileSync(process.execPath, [join(ROOT, 'tools/asm.mjs')], { stdio: 'ignore' });
  const bytes = readFileSync(join(ROOT, 'build/bumper/game.wasm'));
  const out = opt('out', 'logs/bumper.qgl');
  const { log, scores, rounds } = await playBumper({ bytes, seed: Number(opt('seed', 7)), bots: Number(opt('bots', 16)), ticks: Number(opt('ticks', 20000)), delay: Number(opt('delay', 6)), leaveAt: 3000 });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, log);
  console.log(`${out}: ${log.length} B, ${rounds} rounds over; wins/KOs ${scores.map((s) => `${s.wins}/${s.kos}`).join(' ')}`);
}
