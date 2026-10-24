import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { newMemory, instantiate, Sim, parseLog, encodeLog } from '../harness/core.mjs';
import assert from 'node:assert/strict';
import { generate } from '../tools/genlog.mjs';
import { inputWord } from '../src/view.mjs';
import * as L from '../src/layout.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let built = false;

export function wasmBytes(debug = false) {
  if (!built) {
    execFileSync(process.execPath, ['tools/asm.mjs'], { cwd: ROOT, stdio: 'ignore' });
    built = true;
  }
  return readFileSync(`${ROOT}build/${debug ? 'game.debug' : 'game'}.wasm`);
}

export async function newSim(debug = false) {
  const memory = newMemory();
  return new Sim(await instantiate(await WebAssembly.compile(wasmBytes(debug)), memory), memory);
}

// The arena's build of the same sources (build/arena/).
export function arenaBytes(debug = false) {
  wasmBytes();
  return readFileSync(`${ROOT}build/arena/${debug ? 'game.debug' : 'game'}.wasm`);
}

export async function newArena(debug = false) {
  const memory = newMemory();
  return new Sim(await instantiate(await WebAssembly.compile(arenaBytes(debug)), memory), memory);
}

export const smallLog = (ticks = 1600, extra = {}) => parseLog(generate({ ticks, target: 1200, ...extra }));

export async function hashes(sim, log, from, to, step = (s) => s.x.step()) {
  const out = [];
  for (let t = from; t < to; t++) {
    sim.feed(log, t);
    step(sim);
    out.push(BigInt.asUintN(64, sim.x.hash_region()));
  }
  return out;
}

// Bumper balls' build of the same sources (build/bumper/).
export function bumperBytes(debug = false) {
  wasmBytes();
  return readFileSync(`${ROOT}build/bumper/${debug ? 'game.debug' : 'game'}.wasm`);
}

export async function newBumper(debug = false) {
  const memory = newMemory();
  return new Sim(await instantiate(await WebAssembly.compile(bumperBytes(debug)), memory), memory);
}

// Fireplace: every game in one module (build/fireplace/).
export function fireplaceBytes(debug = false) {
  wasmBytes();
  return readFileSync(`${ROOT}build/fireplace/${debug ? 'game.debug' : 'game'}.wasm`);
}

export async function newFireplace(debug = false) {
  const memory = newMemory();
  return new Sim(await instantiate(await WebAssembly.compile(fireplaceBytes(debug)), memory), memory);
}

// Party: bumper's ball, a minigame a round (build/party/).
export function partyBytes(debug = false) {
  wasmBytes();
  return readFileSync(`${ROOT}build/party/${debug ? 'game.debug' : 'game'}.wasm`);
}

export async function newParty(debug = false) {
  const memory = newMemory();
  return new Sim(await instantiate(await WebAssembly.compile(partyBytes(debug)), memory), memory);
}

// Party on a local sim with scripted balls, recorded as a .qgl log. Every 8
// ticks a ball picks its word from its own PRNG: most often for the stage's
// centre (its yaw a little off), else a random way, now and then a hop, and
// near the centre sometimes no keys at all. Words land `delay` ticks after
// they're picked, as over a network. Balls join a tick apart; with leaveAt,
// slot 1 leaves then and is back 500 ticks later. force writes PG_FORCE
// before the first join.
export async function scriptedParty({ bytes, seed = 7, balls = 16, ticks = 6000, delay = 6, force = 0, leaveAt = 0, onTick } = {}) {
  const memory = newMemory();
  const sim = new Sim(await instantiate(await WebAssembly.compile(bytes), memory), memory);
  sim.init(seed);
  const dv = new DataView(memory.buffer);
  if (force) dv.setUint32(L.PG_FORCE, force, true);
  const bots = Array.from({ length: balls }, (_, k) => {
    let s = (Math.imul(seed, 2654435761) + k * 40503) >>> 0 || 1;
    const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32; };
    return { k, r, queue: [], last: -1, live: false, word: 0 };
  });
  const recs = [];
  for (let t = 0; t < ticks; t++) {
    const now = [];
    for (const b of bots) {
      if (t === b.k || (leaveAt && b.k === 1 && t === leaveAt + 500)) { now.push([L.EV_JOIN, b.k]); b.live = true; b.queue = []; b.last = -1; }
      if (leaveAt && b.k === 1 && t === leaveAt) { now.push([L.EV_LEAVE, b.k]); b.live = false; }
      if (!b.live) continue;
      if ((t + b.k) % 8 === 0) {
        const a = L.PLAYERS + b.k * L.PSIZE;
        const cx = dv.getFloat32(L.PG_CX, true);
        const dx = cx - dv.getFloat32(a + L.P_PX, true), dz = cx - dv.getFloat32(a + L.P_PZ, true);
        const roll = b.r();
        const ang = roll < 0.65 ? Math.atan2(dz, dx) + (b.r() - 0.5) * 1.2 : b.r() * 2 * Math.PI;
        const move = Math.hypot(dx, dz) < 3 && roll < 0.3 ? 0 : 1;
        b.word = inputWord({ yaw: Math.round(ang / (2 * Math.PI) * 16384) & 16383, pitch: 512, move, jump: b.r() < 0.06 ? 1 : 0 });
      }
      b.queue.push(b.word);
      if (b.queue.length > delay) {
        const w = b.queue.shift();
        if (w !== b.last) { now.push([L.EV_INPUT, b.k, w]); b.last = w; }
      }
    }
    for (const [kind, slot, word] of now) recs.push([t, kind, slot, word]);
    sim.feedPlayers(now);
    sim.x.step();
    onTick?.(t, sim);
  }
  return { log: encodeLog({ courseSeed: seed, ticks, recs }), sim };
}

// Party: predicts slot 0 of room g ({ sim, v, dv, step }) through `inputs`
// from every tick (1 ahead, and 6 and 30 every 7th) and compares each, its
// whole record and the round's end, with the confirmed world when it gets
// there. Returns how many it compared.
export function predicted(g, inputs) {
  const due = new Map();
  let compared = 0;
  for (let k = 0; k < inputs.length; k++) {
    for (const n of [1, 6, 30]) {
      if ((k % 7 !== 0 && n !== 1) || k + n > inputs.length) continue;
      for (let i = 0; i < n; i++) g.dv.setUint32(L.PWORDS + 4 * i, inputs[k + i], true);
      g.sim.x.predict(0, n);
      const list = due.get(k + n) || [];
      list.push({ n, from: k, player: g.sim.u8.slice(L.PLAYERS + L.PRED_D, L.PLAYERS + L.PRED_D + L.PSIZE), until: g.dv.getUint32(L.HDR_UNTIL + L.PRED_D, true) });
      due.set(k + n, list);
    }
    g.step([[L.EV_INPUT, 0, inputs[k]]]);
    for (const p of due.get(k + 1) || []) {
      assert.deepEqual(p.player, g.sim.u8.slice(L.PLAYERS, L.PLAYERS + L.PSIZE), `predicted ${p.n} from ${p.from}`);
      if (g.v.hole().state === L.H_PLAY) assert.equal(p.until, g.v.hole().until, 'the round\'s end, from PG_LEN');
      compared++;
    }
  }
  return compared;
}
