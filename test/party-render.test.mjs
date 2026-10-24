import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, SHAPE, LOOK, SPRITE, DECAL, ENVS, MESH, COLS } from '../client/party-render.mjs';

// What the minigames' draw() code builds against: the names, and a solid's 16 floats where they are documented.
test('party renderer: the names the minigames draw with', () => {
  assert.equal(COLS, 80);
  assert.deepEqual(SHAPE, { BOX: 0, CYL: 1, HEX: 2, SPHERE: 3 });
  assert.deepEqual(LOOK, { MATTE: 0, PLASTIC: 1, ICE: 2, METAL: 3, HAZARD: 4, GLOW: 5, PAINT: 6, CHECKER: 7, WOOD: 8, RUBBER: 9 });
  assert.deepEqual(SPRITE, { BALL: 0, BODY: 1, ORB: 2, FLASH: 3, RING: 4, SPARK: 5, ARROW: 6, ROCKET: 7, HEAD: 8, CRUMB: 9, COIN: 10, BOMB: 11 });
  assert.deepEqual(DECAL, { RING: 0, DISC: 1, ZONE: 2, TARGET: 3 });
  for (const k of ['day', 'sunset', 'night', 'snow']) {
    const e = ENVS[k];
    assert.ok(Math.abs(Math.hypot(...e.sun) - 1) < 1e-9 && e.sun[1] > 0.2, `${k}: the sun is a unit vector well over the horizon`);
  }
});

test('party renderer: a Scene packs 16 floats a solid', () => {
  const s = new Scene(4);
  assert.equal(s.count, 0);
  assert.equal(s.box(1, 2, 3, 4, 5, 6, 0.5, 0.1, 0.2, 0.3, LOOK.HAZARD, 0.25, 0.75, 0.5, 9), 0);
  s.cyl(10, 11, 12, 2, 3, 1, 0, 0);
  s.hex(20, 21, 22, 2, 0.25, 0.1, 0, 1, 0, LOOK.ICE, 0.5);
  s.sphere(30, 31, 32, 1.5, 0, 0, 1, LOOK.GLOW, 1, 0, 0.5, 7);
  assert.equal(s.count, 4);
  const f = Array.from(s.data.subarray(0, 64), (x) => Math.round(x * 1000) / 1000);
  // centre, shape | half extents (radius, half height, radius), yaw | rgb, look | a, b, alpha, seed
  assert.deepEqual(f.slice(0, 16), [1, 2, 3, SHAPE.BOX, 4, 5, 6, 0.5, 0.1, 0.2, 0.3, LOOK.HAZARD, 0.25, 0.75, 0.5, 9]);
  assert.deepEqual(f.slice(16, 31), [10, 11, 12, SHAPE.CYL, 2, 3, 2, 0, 1, 0, 0, LOOK.MATTE, 0, 0, 1]);
  assert.deepEqual(f.slice(32, 47), [20, 21, 22, SHAPE.HEX, 2, 0.25, 2, 0.1, 0, 1, 0, LOOK.ICE, 0.5, 0, 1]);
  assert.deepEqual(f.slice(48, 64), [30, 31, 32, SHAPE.SPHERE, 1.5, 1.5, 1.5, 0, 0, 0, 1, LOOK.GLOW, 1, 0, 0.5, 7]);
  // full: nothing more goes in; clear() empties it for the next frame
  assert.equal(s.box(0, 0, 0, 1, 1, 1, 0, 1, 1, 1), -1);
  assert.equal(s.count, 4);
  s.clear();
  assert.equal(s.count, 0);
  // no seed given: one from where it stands in x and z, the same as it falls, an integer a float holds exactly
  s.hex(512, 40, 518, 2, 0.25, 0, 1, 1, 1);
  s.hex(512, 28, 518, 2, 0.25, 0, 1, 1, 1);
  s.hex(515.5, 40, 518, 2, 0.25, 0, 1, 1, 1);
  const seed = (i) => s.data[i * 16 + 15];
  assert.equal(seed(0), seed(1));
  assert.notEqual(seed(0), seed(2));
  assert.ok(Number.isInteger(seed(0)) && seed(0) >= 0 && seed(0) < 4096);
});

// The main pass culls back faces and the shadow pass front ones: every triangle must face out.
test('party renderer: the unit meshes face out, the hex pointy-top', () => {
  const V = MESH.vertices, I = MESH.indices;
  const p = (i) => [V[i * 6], V[i * 6 + 1], V[i * 6 + 2]];
  for (const [name, part] of Object.entries(MESH.parts)) {
    assert.ok(part.count > 0 && part.count % 3 === 0, name);
    for (let t = part.first; t < part.first + part.count; t += 3) {
      const [a, b, c] = [p(I[t]), p(I[t + 1]), p(I[t + 2])];
      const u = b.map((x, k) => x - a[k]), w = c.map((x, k) => x - a[k]);
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const mid = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3);
      assert.ok(n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] > 0, `${name}: triangle ${(t - part.first) / 3} faces in`);
    }
  }
  // the hex's corners: two on the z axis (pointy-top), none on the x axis (flat sides face +-x), all at radius 1
  const hex = MESH.parts.hex;
  const corners = new Set();
  for (let t = hex.first; t < hex.first + hex.count; t++) {
    const [x, y, z] = p(I[t]);
    const r3 = (a) => (Math.round(a * 1000) / 1000 + 0).toFixed(3);
    if (Math.hypot(x, z) > 0.5) corners.add(`${r3(x)},${r3(z)}`);
    if (Math.hypot(x, z) > 0.5) assert.ok(Math.abs(Math.hypot(x, z) - 1) < 1e-6 && Math.abs(Math.abs(y) - 1) < 1e-6);
  }
  assert.equal(corners.size, 6);
  assert.ok(corners.has('0.000,1.000') && corners.has('0.000,-1.000'));
  assert.ok(![...corners].some((c) => c.endsWith(',0.000')));
});
