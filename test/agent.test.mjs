import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { wasmBytes } from './helpers.mjs';
import { Room } from '../tools/agent.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { MOVE } from '../src/view.mjs';
import * as L from '../src/layout.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const room = (opts = {}) => Room.create({ bytes: wasmBytes(), bots: 0, ...opts });
const hands = (r) => r.players[0].hands;

test('the hands make the word a mouse and keys would', async () => {
  const r = await room();
  r.act(0, 'aim 90 10');
  let w = hands(r).word();
  assert.equal(w & 0x3fff, 4096, 'a quarter turn');
  assert.equal((w >>> 14) & 0x3ff, 512 + 57, '10 degrees up');
  r.act(0, 'aim -90');
  assert.equal(hands(r).word() & 0x3fff, 12288, 'negative bearings wrap, pitch kept');
  assert.equal((hands(r).word() >>> 14) & 0x3ff, 569);
  const plan = hands(r).command('hold wdj 0.5', r.view, 0);
  assert.deepEqual(plan, { ticks: 63, move: MOVE.FORWARD | MOVE.RIGHT | 16 });
  hands(r).move = plan.move;
  w = hands(r).word();
  assert.equal((w >>> 24) & 15, MOVE.FORWARD | MOVE.RIGHT);
  assert.equal((w >>> 28) & 1, 1, 'j is jump');
  r.act(0, 'weapon grenade');
  assert.equal(hands(r).word() >>> 31, 1);
});

test('the door says what went wrong and what to type', async () => {
  const r = await room();
  assert.match(r.act(0, 'bogus'), /error: no command "bogus"; try help/);
  assert.match(r.act(0, 'hold x 1'), /error: hold: keys are any of w a s d j/);
  assert.match(r.act(0, 'hold w 40'), /at most 30/);
  assert.match(r.act(0, 'aim north'), /yaw should be a number, got "north"/);
  assert.match(r.act(0, 'fire'), /no shots while the hole is countdown/);
  const t = r.t;
  assert.match(r.act(0, 'wait 1; bogus; wait 1'), /error/);
  assert.equal(r.t, t + 125, 'the first bad command stops the rest');
  assert.match(r.act(0, 'help'), /QUAKE GOLF[\s\S]*Commands/);
});

test('a time command moves the world; look and aim do not', async () => {
  const r = await room();
  r.act(0, 'wait 3.1');
  const s0 = r.see(0);
  assert.equal(s0.state, 'play');
  r.act(0, 'look; aim 30; face cup; weapon rocket');
  assert.equal(r.see(0).tick, s0.tick);
  r.act(0, 'face cup; hold w 1');
  const s1 = r.see(0);
  assert.equal(s1.tick, s0.tick + 125);
  const d = (s) => Math.hypot(s.cup.pos[0] - s.you.pos[0], s.cup.pos[2] - s.you.pos[2]);
  assert.ok(d(s0) - d(s1) > 6, `ran ${(d(s0) - d(s1)).toFixed(1)} m towards the cup`);
});

// Plays the way an agent reading only the door would: everything it decides
// comes from see(), everything it does goes through act().
function golf(r, slot, maxShots = 8) {
  const say = (c) => r.act(slot, c);
  say('wait 3.1');
  for (let shot = 0; shot < maxShots; shot++) {
    const s = r.see(slot);
    if (s.you.done || s.state !== 'play') break;
    const b = s.ball.pos, a = s.cup.bearing * Math.PI / 180, dir = [Math.cos(a), Math.sin(a)];
    const dh = s.cup.dist > 120 ? 0.5 : s.cup.dist > 40 ? 1.6 : s.cup.dist > 15 ? 3 : 4.4;
    const bp = [b[0] - dir[0] * dh, b[2] - dir[1] * dh], stand = [bp[0] - 2 * dir[0], bp[1] - 2 * dir[1]];
    for (let i = 0; i < 20; i++) {
      const y = r.see(slot).you, d = Math.hypot(stand[0] - y.pos[0], stand[1] - y.pos[2]);
      if (d < 0.5) break;
      say(`face ${stand[0]} ${stand[1]}; hold w ${d > 3 ? ((d - 1.5) / 10).toFixed(3) : d > 1.2 ? 0.05 : 0.016}; wait 0.5`);
    }
    say(`face ${bp[0]} ${bp[1]}; fire; wait ball`);
  }
  return r.see(slot);
}

test('a golfer that uses only the door finishes the hole', async () => {
  const r = await room();
  const s = golf(r, 0);
  assert.ok(s.you.done, `not in the cup: ${s.cup.dist.toFixed(1)} m short after ${s.you.strokes} strokes`);
  assert.ok(s.you.strokes <= 6, `${s.you.strokes} strokes on a par ${s.par}`);
  assert.ok(s.tick < L.LIMIT_TICKS, 'inside the hole clock');
});

test('an agent game next to a bot is a log the harness replays', async () => {
  const bytes = wasmBytes();
  const r = await room({ agents: 1, bots: 1 });
  golf(r, 0, 2);
  assert.ok(r.see(0).events.length + r.players[0].seen > 0, 'blasts were seen');
  const log = parseLog(r.log());
  const tr = decodeTrace((await replay({ bytes, log, ticks: r.t, tag: 'agent' })).trace);
  assert.equal(tr.tickHashes[r.t - 1], r.hash, 'the replay ends where the room did');
});

test('the HTTP door: look, act, JSON', async () => {
  const p = spawn(process.execPath, ['tools/agent.mjs', '--port', '0', '--bots', '0', '--out', 'logs/agent-test.qgl'], { cwd: ROOT });
  try {
    const url = await new Promise((ok, no) => {
      let out = '';
      p.stdout.on('data', (c) => { out += c; const m = out.match(/http:\/\/127\.0\.0\.1:\d+\//); if (m) ok(m[0]); });
      p.on('exit', (code) => no(new Error(`door exited ${code}`)));
    });
    assert.match(await (await fetch(url)).text(), /QUAKE GOLF[\s\S]*POST \/<slot>/);
    assert.match(await (await fetch(`${url}0`)).text(), /hole 1 · countdown/);
    assert.match(await (await fetch(`${url}0`, { method: 'POST', body: 'wait 3.1; face cup' })).text(), /hole 1 · play/);
    const s = await (await fetch(`${url}0.json`)).json();
    assert.equal(s.state, 'play');
    assert.equal(s.you.slot, 0);
    const bad = await fetch(`${url}5`);
    assert.equal(bad.status, 400);
    assert.match(await bad.text(), /no agent in slot 5/);
  } finally {
    p.kill();
  }
});
