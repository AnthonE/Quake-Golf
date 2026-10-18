import test from 'node:test';
import assert from 'node:assert/strict';
import { newSim } from './helpers.mjs';
import { View, inputWord, MOVE } from '../src/view.mjs';
import * as L from '../src/layout.mjs';

// Slot 0 on the tee, play under way: walks, rocket-jumps off its own feet,
// then lobs a grenade while jumping. inputs[k] is the word for tick k0 + k.
async function scenario() {
  const sim = await newSim(true);
  sim.init(7);
  const v = new View(sim.memory.buffer);
  sim.feedPlayers([[L.EV_JOIN, 0]]);
  sim.x.step();
  while (v.hole().state !== L.H_PLAY) sim.x.step();
  const inputs = [];
  for (let k = 0; k < 160; k++) {
    if (k < 30) inputs.push(inputWord({ yaw: 1000, move: MOVE.FORWARD }));
    else if (k < 70) inputs.push(inputWord({ yaw: 1000, pitch: 0, shot: 1, move: k > 40 ? MOVE.LEFT : 0 }));
    else inputs.push(inputWord({ yaw: 3000, pitch: 640, shot: 2, weapon: 1, move: MOVE.FORWARD, jump: k === 120 ? 1 : 0 }));
  }
  return { sim, v, inputs, k0: v.tick };
}

const record = (u8, a, n) => u8.slice(a, a + n);
const ownProjectiles = (u8, base) => {
  const out = [];
  for (let j = 0; j < L.NPROJ; j++) {
    const b = base + j * L.JSIZE;
    if (u8[b + L.J_KIND] && u8[b + L.J_OWNER] === 0) out.push([j, [...u8.subarray(b, b + L.JSIZE)]]);
  }
  return out;
};
const fx = (dv, ring) => {
  const out = [];
  for (let k = 0; k < dv.getUint32(ring, true); k++) {
    const r = ring + 16 + (k & (L.FX_MAX - 1)) * 32;
    if (dv.getUint8(r + 5) === 0) out.push([dv.getUint8(r + 4), dv.getUint16(r + 6, true), dv.getUint32(r + 8, true), dv.getUint32(r + 12, true), dv.getUint32(r + 16, true)]);
  }
  return out;
};

test('a prediction matches the confirmed sim bit for bit: a walk, a rocket jump and a lob', async () => {
  const { sim, v, inputs, k0 } = await scenario();
  const dv = new DataView(sim.memory.buffer);
  const due = new Map(); // tick -> predictions that end there
  const confirmedFx = [];
  let compared = 0;
  for (let k = 0; k < inputs.length; k++) {
    // a prediction from here for each of these windows, as the main thread would make it
    for (const n of [1, 6, 30]) {
      if (k % 7 !== 0 && n !== 1) continue;
      if (k + n > inputs.length) continue;
      for (let i = 0; i < n; i++) dv.setUint32(L.PWORDS + 4 * i, inputs[k + i], true);
      sim.x.predict(0, n);
      assert.equal(v.tick, k0 + k, 'predict never steps the confirmed world');
      assert.equal(dv.getUint32(L.HDR_TICK + L.PRED_D, true), k0 + k + n);
      assert.equal(dv.getUint32(L.PTRACK + 16 * (n - 1) + 12, true), k0 + k + n);
      const list = due.get(k + n) || [];
      list.push({ from: k, n, player: record(sim.u8, L.PLAYERS + L.PRED_D, L.PSIZE), proj: ownProjectiles(sim.u8, L.PROJ + L.PRED_D), fx: fx(dv, L.PFX) });
      due.set(k + n, list);
    }
    sim.feedPlayers([[L.EV_INPUT, 0, inputs[k]]]);
    sim.x.step();
    for (const p of due.get(k + 1) || []) {
      const at = `predicted ${p.n} from tick ${k0 + p.from}`;
      assert.deepEqual(p.player, record(sim.u8, L.PLAYERS, L.PSIZE), `${at}: player`);
      assert.deepEqual(p.proj, ownProjectiles(sim.u8, L.PROJ), `${at}: projectiles`);
      compared++;
    }
    confirmedFx.splice(0, confirmedFx.length, ...fx(dv, L.FX));
  }
  assert.ok(compared > 150, `${compared} predictions compared`);
  // the shot, the blast and the lob happened, keyed and placed as in the confirmed ring
  const me = v.player(0);
  assert.equal(me.strokes, 2);
  assert.ok(confirmedFx.length >= 3, JSON.stringify(confirmedFx));
  const all = [...due.values()].flat().flatMap((p) => p.fx);
  for (const f of confirmedFx) assert.ok(all.some((g) => g.join() === f.join()), `ghost FX for ${f}`);
});

test('a prediction writes nothing outside PRED', async () => {
  const { sim, inputs } = await scenario();
  const dv = new DataView(sim.memory.buffer);
  for (let k = 0; k < 40; k++) { sim.feedPlayers([[L.EV_INPUT, 0, inputs[k]]]); sim.x.step(); }
  const region = sim.x.hash_region(); // (its scratch is outside PRED too, so hash first)
  const before = sim.u8.slice();
  for (let i = 0; i < 100; i++) dv.setUint32(L.PWORDS + 4 * i, inputs[40 + i], true);
  sim.x.predict(0, 100);
  const after = sim.u8;
  const end = L.PRED + 0x10000;
  for (let a = 0; a < before.length; a++) {
    if (a >= L.PRED && a < end) { a = end - 1; continue; }
    if (before[a] !== after[a]) assert.fail(`predict wrote ${a.toString(16)}`);
  }
  assert.equal(sim.x.hash_region(), region);
  assert.ok(new View(sim.memory.buffer, L.PRED_D).tick === new View(sim.memory.buffer).tick + 100);
  assert.ok(L.PWORDS + 4 * L.PRED_MAX <= end && L.PTRACK + 16 * L.PRED_MAX <= L.PWORDS && L.PFX + 16 + 32 * L.FX_MAX <= L.PTRACK);
  assert.ok(L.PRED + L.PRED_COPY <= L.PFX);
});

test('a slot that has not joined predicts nothing', async () => {
  const { sim } = await scenario();
  sim.x.predict(5, 30);
  const v = new View(sim.memory.buffer, L.PRED_D);
  assert.equal(v.player(5).live, false);
  assert.equal(v.tick, new View(sim.memory.buffer).tick);
});
