#!/usr/bin/env node
// Plays Party with AI balls (client/party-bot.mjs) on a local sim (no network)
// and records it as a .qgl event log: joins, leaves and every input word that
// changed. Each ball's words land `delay` ticks after it decides them and it
// sees the world that old, as over a network. The log replays in the harness
// like any other, so the determinism matrix covers the rotation, every
// minigame it reaches, the bumps and the outs. --mg k plays only minigame k,
// through the seed as the framework reads it (top byte 0xA7, k in the next).
//   node tools/genparty.mjs [--seed 7] [--mg k] [--bots 16] [--ticks 20000] [--delay 6] [--out logs/party.qgl] [--debug]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { newMemory, instantiate, Sim, encodeLog } from '../harness/core.mjs';
import { View } from '../src/party-view.mjs';
import { Partier } from '../client/party-bot.mjs';
import * as L from '../src/layout.mjs';
import { isMain } from './main.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// A room seed that forces minigame mg (null: the rotation's) and keeps the low bits of seed.
export const partySeed = (seed, mg = null) => (mg === null || mg === undefined ? seed >>> 0 : ((0xa7 << 24) | ((mg & 0xff) << 16) | (seed & 0xffff)) >>> 0);

// Balls join a tick apart; one leaves at `leaveAt` and comes back 500 ticks
// later. onTick(t, sim, view) after every step. Returns the log, every ball's
// tally, the rounds over, the minigames played (in order), the bots' think
// time (thinkMs in all, playMs a tick while a round plays).
export async function playParty({ bytes, seed = 7, mg = null, bots = 16, ticks = 20000, delay = 6, leaveAt = 0, onTick } = {}) {
  const memory = newMemory();
  const sim = new Sim(await instantiate(await WebAssembly.compile(bytes), memory), memory);
  const roomSeed = partySeed(seed, mg);
  sim.init(roomSeed);
  const view = new View(memory.buffer);
  const balls = Array.from({ length: bots }, (_, k) => ({ r: new Partier(k, seed, 0.3 + 0.6 * ((k * 5) % bots) / bots), join: k, queue: [], last: -1, live: false }));
  const recs = [];
  const games = [];
  let rounds = 0, state = -1, thinkMs = 0, playMs = 0, playTicks = 0;
  for (let t = 0; t < ticks; t++) {
    const now = [];
    const a = performance.now();
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
    const ms = performance.now() - a;
    thinkMs += ms;
    if (state === L.H_PLAY) { playMs += ms; playTicks++; }
    for (const [kind, slot, word] of now) recs.push([t, kind, slot, word]);
    sim.feedPlayers(now);
    sim.x.step();
    const s = view.hole().state;
    if (s === L.H_PLAY && state !== L.H_PLAY) games.push(view.party().game);
    if (s === L.H_OVER && state !== L.H_OVER) rounds++;
    state = s;
    onTick?.(t, sim, view);
  }
  const scores = balls.map((p) => { const b = view.partier(p.r.slot); return { slot: p.r.slot, pts: b.pts, wins: b.wins, kos: b.kos, rounds: b.rounds }; });
  return { log: encodeLog({ courseSeed: roomSeed, ticks, recs }), scores, rounds, games, state, thinkMs, playMs: playTicks ? playMs / playTicks : 0, sim, view };
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  execFileSync(process.execPath, [join(ROOT, 'tools/asm.mjs')], { stdio: 'ignore' });
  const bytes = readFileSync(join(ROOT, argv.includes('--debug') ? 'build/party/game.debug.wasm' : 'build/party/game.wasm'));
  const out = opt('out', 'logs/party.qgl');
  const mg = opt('mg', null);
  const ticks = Number(opt('ticks', 20000));
  const { log, scores, rounds, games, playMs } = await playParty({ bytes, seed: Number(opt('seed', 7)), mg: mg === null ? null : Number(mg), bots: Number(opt('bots', 16)), ticks, delay: Number(opt('delay', 6)), leaveAt: 3000 });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, log);
  console.log(`${out}: ${log.length} B, ${rounds} rounds over (${games.map((g) => L.MINIGAMES[g].name).join(', ')}); bots ${playMs.toFixed(3)} ms a tick in play`);
  console.log(`points/wins/KOs ${scores.map((s) => `${s.pts}/${s.wins}/${s.kos}`).join(' ')}`);
}
