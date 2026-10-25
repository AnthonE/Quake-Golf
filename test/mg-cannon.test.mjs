// CANNONADE (src/mg/cannon.wat): the platform for the crowd, the floor only on
// it, and a ball off it out. (node tools/new-mg.mjs wrote these; keep them
// true as the minigame grows, and add what it does.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty } from './helpers.mjs';
import { View, PLAT_Y } from '../src/party-view.mjs';
import * as L from '../src/layout.mjs';
import * as MC from '../src/mg/cannon.mjs'; // CN_*: the minigame's own constants

// A room of n balls in CANNONADE, on the debug build (a NaN traps), stepped into play unless asked not to.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_CANNON + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  return { sim, v, dv, step };
}

test('the platform for 1, 8, 64 and 256: sized for the crowd, every ball on it', async () => {
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const rad = Math.min(MC.CN_R0 + MC.CN_RK * Math.sqrt(n), MC.CN_RMAX);
    assert.equal(r.game, L.MG_CANNON);
    assert.ok(Math.abs(r.size - rad) < 1e-4, `${r.size} m for ${n}`);
    assert.deepEqual([r.kind, r.len], [L.PK_OUT, MC.CN_LEN]);
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.equal(b.pos[1], PLAT_Y, `${n}: P${p + 1} on the platform`);
      assert.ok(Math.hypot(b.pos[0] - r.cx, b.pos[2] - r.cx) < r.size, `${n}: P${p + 1} inside the rim`);
    }
  }
});

test('a ball put off the rim falls and is out, and the one left on wins', async () => {
  const g = await room(2);
  const r = g.v.party();
  const b = L.PLAYERS + 1 * L.PSIZE;
  g.dv.setFloat32(b + L.P_PX, r.cx + r.size + 3, true);
  g.dv.setFloat32(b + L.P_PZ, r.cx, true);
  for (let k = 0; k < 2000 && !g.v.partier(1).out; k++) g.step();
  assert.ok(g.v.partier(1).out, 'P2 is out');
  assert.ok(!g.v.partier(0).out, 'P1 is still on');
  for (let k = 0; k < 2000 && g.v.partier(0).place === 0; k++) g.step();
  assert.equal(g.v.partier(0).place, 1, 'P1 wins the round');
});
