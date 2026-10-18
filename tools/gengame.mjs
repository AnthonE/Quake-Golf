#!/usr/bin/env node
// Plays holes with golf bots on a local sim (no network) and records the
// match as a .qgl event log: joins, leaves and every input word that changed.
// The log replays in the M1 harness like any other, so the determinism
// matrix covers players, rockets, grenades and the cup.
//   node tools/gengame.mjs [--course 7] [--bots 2] [--ticks 20000] [--delay 6] [--out logs/game.qgl]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newMemory, instantiate, Sim, encodeLog } from '../harness/core.mjs';

export { encodeLog };
import { View } from '../src/view.mjs';
import { GolfBot, Planner } from '../client/bot.mjs';
import * as L from '../src/layout.mjs';
import { isMain } from './main.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Bots join at `joins[k]` and play until `ticks`; each bot's inputs land
// `delay` ticks after it decides them, standing in for the round trip.
export async function playHoles({ bytes, courseSeed = 7, bots = 2, ticks = 20000, delay = 6, joins, until } = {}) {
  const module = await WebAssembly.compile(bytes);
  const memory = newMemory();
  const sim = new Sim(await instantiate(module, memory), memory);
  sim.init(courseSeed);
  const view = new View(memory.buffer);
  const planner = await Planner.create(module);
  const players = Array.from({ length: bots }, (_, k) => ({ bot: new GolfBot(k, planner, { lag: delay }), join: joins ? joins[k] : 10 * k, queue: [], last: -1 }));
  const recs = [];
  const fx = [];
  let t = 0;
  for (; t < ticks; t++) {
    const now = [];
    for (const [k, p] of players.entries()) {
      if (t === p.join) now.push([L.EV_JOIN, k]);
      if (t < p.join) continue;
      p.queue.push(p.bot.think(view));
      const word = p.queue.length > delay ? p.queue.shift() : p.queue[0];
      if (word !== p.last) { now.push([L.EV_INPUT, k, word]); p.last = word; }
    }
    for (const r of now) recs.push([t, ...r]);
    sim.feedPlayers(now);
    sim.x.step();
    for (let n = fx.length; n < view.fxCount(); n++) fx.push(view.fx(n));
    if (until && until(view, t)) { t++; break; }
  }
  const log = encodeLog({ courseSeed, ticks: t, recs });
  return { log, ticks: t, view, sim, bots: players.map((p) => p.bot), fx, hash: BigInt.asUintN(64, sim.x.hash_region()) };
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

if (isMain(import.meta.url)) {
  const bytes = readFileSync(join(ROOT, 'build/game.wasm'));
  const out = arg('out', 'logs/game.qgl');
  const courseSeed = Number(arg('course', 7));
  const nb = Number(arg('bots', 2));
  const t0 = performance.now();
  const r = await playHoles({ bytes, courseSeed, bots: nb, ticks: Number(arg('ticks', 20000)), delay: Number(arg('delay', 6)) });
  const h = r.view.hole();
  console.log(`course ${courseSeed}: par ${h.par}, ${Math.hypot(h.cup[0] - h.tee[0], h.cup[2] - h.tee[2]).toFixed(0)} m, ${r.ticks} ticks in ${((performance.now() - t0) / 1000).toFixed(1)} s, holes started ${h.hole + 1}`);
  for (let k = 0; k < nb; k++) {
    const p = r.view.player(k);
    console.log(`  bot ${k}: holes ${p.holes}, total ${p.total}, last score ${p.score}, strokes now ${p.strokes}, done at ${p.done ? p.doneTick : '-'}`);
    if (arg('verbose', '0') === '1') for (const s of r.bots[k].log) console.log(`    t${s.tick} from ${s.from.map((v) => v.toFixed(1))} blast ${s.dh.toFixed(2)} turn ${(s.turn * 180 / Math.PI).toFixed(0)} expect ${s.expect.toFixed(1)}`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, r.log);
  console.log(`${out}: ${(r.log.length - 32) / L.REC} events`);
}
