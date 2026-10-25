import test from 'node:test';
import assert from 'node:assert/strict';
import { newArena } from './helpers.mjs';
import { View, forcedSeed, modeName } from '../src/arena-view.mjs';
import { Fighter, route, walkable, roleOf, navOf } from '../client/arena-bot.mjs';
import { unpackArena } from '../src/arena-view.mjs';
import { aimAt } from '../client/bot.mjs';
import { project, lens, PALETTE } from '../client/arena-render.mjs';
import { AMC, newsOf, SIDE, SIDE_C } from '../client/am/index.mjs';
import slayer, { lead, nearestEnemy } from '../client/am/slayer.mjs';
import { C } from '../client/font.mjs';
import * as L from '../src/layout.mjs';

// The arena's clients against a world whose memory is poked into shape: the
// teams sim isn't needed to read sides, scores and objectives, to draw them,
// or to steer by them. n fighters joined and stepped into play on seed 7 (a
// Fiesta), then frozen: nothing below steps it again.
async function world(n = 4) {
  const sim = await newArena();
  sim.init(7);
  const v = new View(sim.memory.buffer);
  const dv = new DataView(sim.memory.buffer);
  sim.feedPlayers(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  sim.x.step();
  while (v.hole().state !== L.H_PLAY) sim.x.step();
  sim.x.step();
  return { sim, v, dv };
}

const rec = (p) => L.PLAYERS + p * L.PSIZE;
const flags = (g, p, set, clear = 0) => { g.dv.setUint8(rec(p) + L.P_FL, (g.dv.getUint8(rec(p) + L.P_FL) | set) & ~clear); };
function put(g, p, x, z, y = g.v.stand(x, z)) {
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, y, true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
}
// the match's mode, in the confirmed header and the prediction's copy of it
const setMode = (g, m) => { g.dv.setUint32(L.AH_MODE, m, true); g.dv.setUint32(L.AH_MODE + L.PRED_D, m, true); };

test('readers: sides, carriers and a team mode\'s header; nobody is an ally or red in a Fiesta', async () => {
  const g = await world(4);
  assert.equal(g.v.mode().mode, L.M_FIESTA);
  // PF_BLUE on 1 and 3 means nothing in a Fiesta: no side, nobody an ally
  flags(g, 1, L.PF_BLUE); flags(g, 3, L.PF_BLUE);
  assert.equal(g.v.mode().teamed, false);
  for (let p = 0; p < 4; p++) assert.equal(g.v.fighter(p).team, -1, `P${p + 1} has no side in a Fiesta`);
  for (const [p, q] of [[0, 1], [0, 2], [1, 3], [2, 2]]) assert.equal(g.v.ally(p, q), false, `${p} ${q}`);
  // Team Slayer: red (the bit clear) 0 and 2, blue 1 and 3
  setMode(g, L.M_SLAYER);
  const md = g.v.mode();
  assert.equal(md.teamed, true);
  assert.equal(md.name, 'TEAM SLAYER');
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.fighter(p).team), [0, 1, 0, 1]);
  assert.deepEqual([[0, 2], [1, 3], [0, 1], [2, 3], [1, 1]].map(([p, q]) => g.v.ally(p, q)), [true, true, false, false, false]);
  // the header: scores red then blue, the target, the winner, the sides' counts
  g.dv.setUint32(L.AH_SCORE, 12, true); g.dv.setUint32(L.AH_SCORE + 4, 9, true);
  g.dv.setUint32(L.AH_TARGET, 50, true); g.dv.setUint32(L.AH_TEAMWIN, 2, true);
  g.dv.setUint32(L.AH_TEAMN, 2, true); g.dv.setUint32(L.AH_TEAMN + 4, 3, true);
  assert.deepEqual((({ score, target, teamWin, teamN }) => ({ score, target, teamWin, teamN }))(g.v.mode()), { score: [12, 9], target: 50, teamWin: 2, teamN: [2, 3] });
  // a carrier, and a team mode's second stat in MR_AUX
  flags(g, 2, L.PF_CARRY);
  g.dv.setUint16(L.MODE_REC + 1 * L.MR_SIZE + L.MR_AUX, 4, true);
  g.dv.setUint16(L.MODE_REC + 1 * L.MR_SIZE + L.MR_POINTS, 3, true);
  assert.deepEqual([g.v.fighter(2).carry, g.v.fighter(2).team, g.v.fighter(0).carry], [true, 0, false]);
  assert.deepEqual([g.v.fighter(1).aux, g.v.fighter(1).points], [4, 3]);
  // Infection and Juggernaut keep their sides: PF_ZOMBIE splits them as before
  setMode(g, L.M_INFECTION);
  flags(g, 0, 0, L.PF_BLUE | L.PF_CARRY); flags(g, 1, 0, L.PF_BLUE); flags(g, 2, L.PF_ZOMBIE, L.PF_CARRY); flags(g, 3, 0, L.PF_BLUE);
  assert.deepEqual([g.v.ally(0, 1), g.v.ally(0, 2), g.v.fighter(0).team, g.v.mode().teamed], [true, false, -1, false]);
  // the prediction's View reads its own bank's mode and records
  setMode(g, L.M_CTF);
  const pv = new View(g.sim.memory.buffer, L.PRED_D);
  g.dv.setUint8(rec(1) + L.PRED_D + L.P_FL, L.PF_LIVE | L.PF_BLUE | L.PF_CARRY);
  assert.deepEqual([pv.fighter(1).team, pv.fighter(1).carry, pv.mode().teamed], [1, true, true]);
});

test('readers: the map\'s objectives from MAP_OBJ, a stand\'s height, a forced seed\'s mode by name', async () => {
  const g = await world(1);
  const f = (a, xs) => xs.forEach((x, k) => g.dv.setFloat32(a + 4 * k, x, true));
  f(L.MAP_FLAGS, [392, 512, -1000]); f(L.MAP_FLAGS + 16, [632, 512, -1000]);
  f(L.MAP_BALL, [512, 512, -1000]);
  g.dv.setUint32(L.MAP_NHILL, 3, true);
  f(L.MAP_HILLS, [512, 512, -1000, 8]); f(L.MAP_HILLS + 16, [392, 512, 26.3, 6]); f(L.MAP_HILLS + 32, [568.5, 570.5, 24, 4]);
  const m = new View(g.sim.memory.buffer).map();
  assert.deepEqual(m.flags, [[392, 512, -1000], [632, 512, -1000]]);
  assert.deepEqual(m.ball, [512, 512, -1000]);
  assert.deepEqual(m.hills.map((h) => h.map((x) => Math.round(x * 10) / 10)), [[512, 512, -1000, 8], [392, 512, 26.3, 6], [568.5, 570.5, 24, 4]]);
  // red's room: its floor is the ground, its roof 25.8 for a top that reaches it
  assert.equal(g.v.stand(392, 512), g.v.height(392, 512));
  assert.equal(Math.round(g.v.stand(392, 512, 26.3) * 100) / 100, 25.8);
  assert.equal(Math.round(g.v.stand(392, 512, 25) * 100) / 100, 21);
  for (let k = 0; k < L.MODES.length; k++) assert.equal(modeName(forcedSeed(k, 1234)), L.MODES[k].name);
  assert.equal(modeName(7), null);
});

test('the kit: a module for every team mode, news routed by its MX codes, the stubs inert', () => {
  for (const a of L.AM) {
    const k = AMC[a.mode];
    assert.equal(k.mode, a.mode);
    assert.equal(k.key, a.key);
    for (const fn of ['hud', 'news', 'draw', 'goal']) assert.equal(typeof k[fn], 'function', `${a.key}.${fn}`);
    assert.ok(Array.isArray(k.cols));
    assert.equal(newsOf(L.MX_AM + 8 * L.AM.indexOf(a)), k);
    assert.equal(newsOf(L.MX_AM + 8 * L.AM.indexOf(a) + 7), k);
  }
  assert.equal(AMC[L.M_FIESTA] ?? AMC[L.M_INFECTION] ?? AMC[L.M_GUNGAME] ?? AMC[L.M_JUGGERNAUT], undefined);
  assert.equal(newsOf(L.MX_TEAMWIN), undefined);
  assert.equal(newsOf(L.TS_MX_LEAD), slayer);
  assert.equal(newsOf(L.CF_MX_TAKE), AMC[L.M_CTF]);
  assert.equal(newsOf(L.HL_MX_CONTEST), AMC[L.M_HILL]);
  assert.deepEqual([AMC[L.M_CTF].carry, AMC[L.M_ODDBALL].carry], ['flag', 'skull']);
  for (const m of [L.M_CTF]) {
    const out = { solid: [], glow: [], beams: [], markers: [], zone: null };
    AMC[m].draw(null, {}, out);
    assert.deepEqual(out, { solid: [], glow: [], beams: [], markers: [], zone: null });
    assert.equal(AMC[m].goal(null, null, {}), null);
  }
  assert.deepEqual([SIDE, SIDE_C], [['RED', 'BLUE'], [C.RED, C.CYAN]]);
});

test('Team Slayer\'s module: the lead in words, its HUD lines and news, a hunt for the nearest enemy', async () => {
  assert.deepEqual(lead([12, 9], 0), { text: 'YOUR SIDE LEADS BY 3', side: 0 });
  assert.deepEqual(lead([12, 9], 1), { text: 'RED LEADS BY 3', side: 0 });
  assert.deepEqual(lead([3, 7], -1), { text: 'BLUE LEADS BY 4', side: 1 });
  assert.deepEqual(lead([5, 5], 1), { text: 'TIED AT 5', side: -1 });
  assert.deepEqual(lead([0, 0], 0), { text: 'NO KILLS YET', side: -1 });
  const lines = [];
  const view = { mode: () => ({ score: [20, 31], target: 60 }) };
  slayer.hud(view, { put: (x, y, s, c) => lines.push([x, y, s, c]), C, team: 1 });
  assert.deepEqual(lines, [[1, 2, 'YOUR SIDE LEADS BY 11', C.CYAN], [1, 3, 'FIRST TO 60 KILLS', C.GREY]]);
  // news: blue takes the lead (shot 2), told to each side
  for (const team of [0, 1]) {
    const said = [], shown = [];
    slayer.news({ size: L.TS_MX_LEAD, owner: 3, shot: 2 }, { team, C, feed: (t, c) => said.push([t, c]), banner: (t, c) => shown.push([t, c]) });
    assert.deepEqual(said, [['BLUE TAKES THE LEAD', C.CYAN]]);
    assert.equal(shown[0][0], team ? 'YOUR SIDE TAKES THE LEAD' : 'YOUR SIDE LOST THE LEAD');
  }
  // the hunt: the nearest live enemy's feet, past nearer allies; none in a room of allies
  const g = await world(5);
  setMode(g, L.M_SLAYER);
  for (let p = 0; p < 5; p++) flags(g, p, p % 2 ? L.PF_BLUE : 0, p % 2 ? 0 : L.PF_BLUE);
  put(g, 0, 470, 500); put(g, 2, 471, 500); put(g, 1, 520, 500); put(g, 3, 490, 500); put(g, 4, 480, 500);
  const me = g.v.fighter(0);
  assert.deepEqual(nearestEnemy(g.v, me), [3, 20]);
  const goal = slayer.goal(g.v, me, { role: 'attack' });
  assert.deepEqual([goal.pos[0], goal.pos[2], goal.hurry, goal.hold], [490, 500, 0, false]);
  flags(g, 3, L.PF_DEAD);
  assert.equal(nearestEnemy(g.v, me)[0], 1);
  for (const p of [1, 3]) flags(g, p, 0, L.PF_BLUE);
  assert.equal(slayer.goal(g.v, me, {}), null);
});

test('the HUD\'s waypoints land where the shader\'s project() puts them', () => {
  const W = 320, H = 200;
  // straight ahead down +x, level: the screen's middle
  const s = { cam: [100, 20, 100], yaw: 0, pitch: 0, zoom: 1 };
  const focal = 320 * 0.62;
  assert.deepEqual(lens(s, W, H), { focal, horizon: 100 });
  let p = project(s, W, H, [110, 20, 100]);
  assert.deepEqual(p.map((x) => +x.toFixed(6)), [160, 100, 10]);
  // 10 m on, 5 to the right (+z), 2 up
  p = project(s, W, H, [110, 22, 105]);
  assert.deepEqual(p.map((x) => +x.toFixed(4)), [+(160 + 5 * focal / 10).toFixed(4), +(100 - 2 * focal / 10).toFixed(4), 10]);
  // facing +z (a quarter turn), looking up 0.3 rad, zoomed 2x: the horizon shears down by tan(0.3) of the focal length
  const t = { cam: [0, 0, 0], yaw: Math.PI / 2, pitch: 0.3, zoom: 2 };
  const f2 = 320 * 0.62 * 2, hz = 100 + Math.tan(0.3) * f2;
  p = project(t, W, H, [-4, 1, 20]);
  // zf = r.z = 20, xr = -r.x = 4
  assert.ok(Math.abs(p[0] - (160 + 4 * f2 / 20)) < 1e-6 && Math.abs(p[1] - (hz - f2 / 20)) < 1e-6 && Math.abs(p[2] - 20) < 1e-9, String(p));
  // the pitch clamps at 1.35 rad as the shader's does; a point behind the eye has a negative depth
  assert.equal(lens({ ...s, pitch: 2 }, W, H).horizon, 100 + Math.tan(1.35) * focal);
  assert.ok(project(s, W, H, [90, 20, 100])[2] < 0);
  assert.equal(PALETTE.length, 8);
});

test('route(): doors found on Blood Gulch; into each base\'s room by one from mid-field, then to the flag; out and round to a roof', async () => {
  const g = await world(1);
  const v = g.v;
  const at = (x, z, top) => [x, v.stand(x, z, top), z];
  // the bases' doors, probed once: the front and back doorways, the side door facing the field, the gap in the
  // roof's parapet the bridge comes through, and the way in under the bridge to the far side door
  const nav = navOf(v);
  const doors = (gi) => nav.rings[gi].doors.map((d) => [...d.out, ...d.in].map((x) => Math.round(x * 10) / 10));
  assert.deepEqual(doors(0).sort(), [[377, 21.3, 501.5, 377, 21.3, 511.7], [386, 21, 501.5, 386, 21, 504.2], [386, 21, 523.9, 386, 21, 519.8], [366.5, 25.8, 511.9, 383.2, 25.8, 511.9], [403.5, 21, 512, 400.8, 21, 512]].sort());
  assert.equal(nav.rings[1].doors.length, 5, 'blue\'s, the same turned round');
  assert.deepEqual([nav.rings[3].doors, nav.rings[4].doors], [[], []], 'the rocks have none');
  // walk the route a waypoint at a time (each leg must be clear at knee, chest and head) until it gives the goal itself
  const walk = (from, goal) => {
    const legs = [];
    let p = from;
    for (let i = 0; i < 8; i++) {
      const w = route(v, p, goal);
      assert.ok(walkable(v, p, w), `leg ${i} from ${p.map(Math.round)} to ${w.map(Math.round)} is clear`);
      legs.push(w);
      if (w === goal) return legs;
      p = [w[0], v.stand(w[0], w[2], w[1] + 0.6), w[2]];
    }
    assert.fail(`no way from ${from} to ${goal}`);
  };
  const isDoor = (gi, w) => nav.rings[gi].doors.some((d) => d.in === w || d.out === w);
  for (const [side, gi, x] of [['red', 0, 392], ['blue', 1, 632]]) {
    const flag = at(x, 512);
    const from = at(512, 480);
    assert.ok(!walkable(v, from, flag), `${side}: not straight from mid-field`);
    const legs = walk(from, flag);
    // a door, the side door facing the field (in its x = +-10 wall's line, z within 1.75 of the base's centre), then the flag
    assert.equal(legs.length, 2, side);
    assert.ok(isDoor(gi, legs[0]), `${side}: ${legs[0]} is a door`);
    assert.ok(Math.abs(legs[0][2] - 512) < 1.75 && Math.abs(Math.abs(legs[0][0] - x) - 10) < 2, `${side}: the side door, ${legs[0]}`);
  }
  // from north of red's base: the front door
  const front = walk(at(392, 470), at(392, 512));
  assert.ok(isDoor(0, front[0]) && front[0][0] > 384.5 && front[0][0] < 387.5 && front[0][2] < 506, `front door: ${front[0]}`);
  // from the hill behind it (where the bridge starts): down round the slope and in under the bridge, not along the bridge
  const back = walk(at(360, 512), at(392, 512));
  assert.ok(back.every((w) => w[1] < 22 || w === back.at(-1) || w[0] < 367), `under the bridge: ${JSON.stringify(back)}`);
  // out of red's room and into blue's
  assert.ok(walk(at(386, 506), at(632, 512)).length <= 3);
  // red's roof from its own room: out a door, round to the hill behind, along the bridge
  const roof = at(392, 512, 26.3);
  assert.equal(Math.round(roof[1] * 10), 258);
  const up = walk(at(386, 506), roof);
  const bridge = up.find((w) => w[0] === 366.5 && Math.abs(w[2] - 512) < 1.5);
  assert.ok(bridge, `by the bridge: ${JSON.stringify(up)}`);
  assert.ok(Math.abs(bridge[1] - 25.8) < 0.1);
  // and down again to mid-field by the bridge; blue's roof from the field; into the cave by one of its ends
  assert.ok(walk(roof, at(512, 512)).some((w) => w[0] === 366.5));
  walk(at(512, 540), at(632, 512, 26.3));
  const cave = walk(at(512, 540), at(512, 574));
  assert.ok(cave.some((w) => isDoor(2, w)), `the cave by an end: ${JSON.stringify(cave)}`);
});

test('the AI fighter: roles by rank on its side, a hunt in Team Slayer, a carrier swings and never shoots', async () => {
  const g = await world(9);
  // a Fiesta: nobody has a side, everyone attacks
  assert.deepEqual([0, 4, 8].map((p) => roleOf(g.v, p)), [0, 4, 8].map(() => ({ rank: 0, role: 'attack' })));
  setMode(g, L.M_SLAYER);
  for (let p = 0; p < 9; p++) flags(g, p, p % 2 ? L.PF_BLUE : 0, p % 2 ? 0 : L.PF_BLUE);
  // red 0 2 4 6 8 rank 0..4, blue 1 3 5 7 rank 0..3: every third from the third defends
  assert.deepEqual([...Array(9).keys()].map((p) => roleOf(g.v, p).role),
    ['attack', 'attack', 'attack', 'attack', 'defend', 'defend', 'attack', 'attack', 'attack']);
  // a slot that left doesn't count
  flags(g, 2, 0, L.PF_LIVE);
  assert.deepEqual([roleOf(g.v, 4).rank, roleOf(g.v, 6).rank], [1, 2]);
  flags(g, 2, L.PF_LIVE);
  // red 0 north of the gulch, blue 3 out of sight behind red's base, everyone else far off: it runs for 3 by the route
  for (let p = 0; p < 9; p++) put(g, p, 600 + p, 440);
  put(g, 0, 392, 470); put(g, 3, 392, 512);
  for (let p = 0; p < 9; p++) for (const o of [L.P_VX, L.P_VY, L.P_VZ]) g.dv.setFloat32(rec(p) + o, 0, true);
  const bot = new Fighter(0, 7, 0.8);
  let w;
  for (let t = 0; t < 40; t++) w = unpackArena(bot.think(g.v, t, 0));
  assert.equal(bot.target, -1, 'blue 3 is out of sight');
  assert.ok(bot.obj && bot.obj.pos[0] === 392 && bot.obj.pos[2] === 512, 'the hunt is for 3');
  assert.ok(w.move & 1, 'running');
  // facing the front door's waypoint, not the wall between
  const way = bot.way;
  assert.ok(way[2] < 506 && way[0] > 384.5 && way[0] < 387.5, `waypoint ${way}`);
  const yaw = aimAt([392, 0, 470], [way[0], 0, way[2]]).yaw;
  assert.ok(Math.abs(((w.yaw - yaw + 8192) % 16384 + 16384) % 16384 - 8192) < 300, `yaw ${w.yaw} for ${yaw}`);
  // a carrier with an enemy close in front: a swing (the melee bit), and no shot however long it sees them
  flags(g, 0, L.PF_CARRY);
  put(g, 1, 394, 470);
  const carrier = new Fighter(0, 7, 0.8);
  carrier.yaw = 0; // facing +x, at 1
  const words = [];
  for (let t = 0; t < 60; t++) words.push(unpackArena(carrier.think(g.v, t, 0)));
  assert.ok(new Set(words.map((x) => x.melee)).size === 2, 'it swings');
  assert.ok(words.every((x) => x.shot === words[0].shot), 'it never pulls the trigger');
  // stuck is counted in the world's ticks: many calls on one tick are one look
  const still = new Fighter(5, 3, 0.5);
  for (let k = 0; k < 50; k++) still.think(g.v, 100 + k, 0);
  assert.ok(still.stuck <= 1 && still.detourUntil === 0, `stuck ${still.stuck}`);
});
