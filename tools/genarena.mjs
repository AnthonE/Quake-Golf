#!/usr/bin/env node
// Plays an arena match with AI fighters on a local sim (no network) and
// records it as a .qgl event log: joins, leaves and every input word that
// changed. Each fighter's words land `delay` ticks after it decides them and
// it sees the world that old, as over a network, and says so in its frames,
// so the shots it takes are checked where it saw its targets. The log replays
// in the harness like any other, so the determinism matrix covers the
// arena's guns, grenades, melee, pickups and respawns. --mode k forces every
// match to mode k (layout.mjs, M_*: 1 Infection, 2 gun game, 3 Juggernaut, and
// red against blue: 4 Team Slayer, 5 Capture the Flag, 6 Oddball, 7 King of the
// Hill) through the seed, which the log carries, so its replays play it too.
//   node tools/genarena.mjs [--seed 7] [--bots 8] [--ticks 20000] [--delay 6] [--mode k] [--out logs/arena.qgl]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { newMemory, instantiate, Sim, encodeLog } from '../harness/core.mjs';
import { View, forcedSeed } from '../src/arena-view.mjs';
import { Fighter } from '../client/arena-bot.mjs';
import * as L from '../src/layout.mjs';
import { isMain } from './main.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Fighters join 25 ticks apart; one leaves at `leaveAt` and comes back 500 ticks later.
export async function playArena({ bytes, seed = 7, bots = 8, ticks = 20000, delay = 6, leaveAt = 0, onTick } = {}) {
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
    onTick?.(t, view);
  }
  const scores = fighters.map((p) => { const f = view.fighter(p.f.slot); return { slot: p.f.slot, kills: f.kills, deaths: f.deaths, zombie: f.zombie, rung: f.rung, points: f.points, place: f.place, team: f.team, aux: f.aux }; });
  return { log: encodeLog({ courseSeed: seed, ticks, recs }), scores, matches: view.hole().hole, state: view.hole().state, mode: view.mode() };
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  execFileSync(process.execPath, [join(ROOT, 'tools/asm.mjs')], { stdio: 'ignore' });
  const bytes = readFileSync(join(ROOT, 'build/arena/game.wasm'));
  const out = opt('out', 'logs/arena.qgl');
  const mode = opt('mode', '');
  const seed = mode === '' ? Number(opt('seed', 7)) : forcedSeed(Number(mode), Number(opt('seed', 7)));
  const { log, scores, matches, mode: md } = await playArena({ bytes, seed, bots: Number(opt('bots', 8)), ticks: Number(opt('ticks', 20000)), delay: Number(opt('delay', 6)), leaveAt: 3000 });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, log);
  // a team mode's: the scores red-blue, and each fighter's side (r, b)
  const team = md.teamed ? `; ${md.name} ${md.score.join('-')}${md.teamWin ? ` (${['', 'red won', 'blue won', 'a draw'][md.teamWin]})` : ''}` : '';
  console.log(`${out}: ${log.length} B, seed ${seed}, ${matches} matches over; kills/deaths ${scores.map((s) => `${s.kills}/${s.deaths}${md.teamed ? 'rb'[s.team] ?? '' : ''}`).join(' ')}${team}`);
}
