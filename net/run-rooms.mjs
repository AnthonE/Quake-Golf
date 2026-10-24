#!/usr/bin/env node
// Hosting online: the relay as a pool runs it for a game someone else wrote.
// Passes when
//   · a wasm that imports anything but its memory, or lacks an export the
//     referee calls, is refused at start (exit 2) and says which;
//   · a sim that never returns ends its relay (exit 3) once the referee falls
//     --referee-lag behind, with a player in the room;
//   · the pool (net/rooms.mjs) keeps a free room, opens another as one fills,
//     caps each at max_players, writes each room's status and the game's
//     server list, and stops the extra rooms once they have sat empty.
// Bots join through each room's native door (net/bot-host.mjs).
//   node net/run-rooms.mjs
import net from 'node:net';
import dgram from 'node:dgram';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as W from './wire.mjs';
import { setup, botHost, readJson, sleep } from './gate.mjs';
import { startPool } from './rooms.mjs';

const DENO = existsSync('.tools/deno') ? '.tools/deno' : 'deno';
const failed = [];
// every relay this gate starts goes when it does, whatever way it ends
const kids = new Set();
process.on('exit', () => { for (const p of kids) try { p.kill('SIGKILL'); } catch { /* gone */ } });
const check = (name, ok, detail = '') => { console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed.push(name); };

setup('rooms');
const dir = 'traces/rooms-gate';
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

// ── wasm the relay must refuse, or stop ─────────────────────────────────────
const wabt = await (createRequire(import.meta.url)('wabt'))();
const wasmOf = (wat) => new Uint8Array(wabt.parseWat('t.wat', wat, { threads: true }).toBinary({}).buffer);
const MEM = '(import "env" "mem" (memory 64 64 shared))';
const SIM = (step) => `(module ${MEM} (func (export "init") (param i32)) (func (export "step") ${step})
  (func (export "snapshot") (param i32)) (func (export "regrid")))`;
const write = async (name, bytes) => { const { writeFileSync } = await import('node:fs'); writeFileSync(`${dir}/${name}`, bytes); return `${dir}/${name}`; };

// a relay run to its end: { code, err }
function runRelay(args, ms) {
  return new Promise((ok) => {
    const door = args.includes('--native-port') ? [] : ['--native-port', '0'];
    const p = spawn(DENO, ['run', '--unstable-net', '-A', 'net/relay.ts', '--quiet', ...door, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    kids.add(p);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => p.kill('SIGKILL'), ms);
    p.on('exit', (code) => { clearTimeout(t); ok({ code, err, p }); });
  });
}

const sneaky = await write('sneaky.wasm', wasmOf(`(module ${MEM} (import "env" "fetch" (func (param i32))) (func (export "init") (param i32)) (func (export "step"))
  (func (export "snapshot") (param i32)) (func (export "regrid")))`));
let r = await runRelay(['--port', '4651', '--wasm', sneaky, '--referee-threads', '1'], 10000);
check('a wasm importing more than its memory is refused at start', r.code === 2 && r.err.includes('env.fetch'), `exit ${r.code}: ${r.err.trim()}`);
const partial = await write('partial.wasm', wasmOf(`(module ${MEM} (func (export "init") (param i32)) (func (export "step")))`));
r = await runRelay(['--port', '4652', '--wasm', partial, '--referee-threads', '1'], 10000);
check('a wasm missing an export the referee calls is refused, by name', r.code === 2 && r.err.includes('snapshot') && r.err.includes('regrid'), `exit ${r.code}: ${r.err.trim()}`);

// A sim whose step never returns, and one player in the room keeping it open
// (a hello with its prefix, then empty words every 16 ms; no sim of its own).
const stuck = await write('stuck.wasm', wasmOf(SIM('(loop (br 0))')));
{
  const relay = runRelay(['--port', '4653', '--native-port', '4753', '--wasm', stuck, '--referee-threads', '1', '--referee-lag', '2'], 20000);
  await sleep(1500);
  const tcp = net.connect({ host: '127.0.0.1', port: 4753, noDelay: true });
  await new Promise((ok, no) => { tcp.once('connect', ok); tcp.once('error', no); });
  const sr = W.bufferedReader(Readable.toWeb(tcp).getReader());
  const { readFileSync } = await import('node:fs');
  tcp.write(W.encodeHello({ maxDatagram: 1400, wasmPrefix: await W.wasmPrefix(readFileSync(stuck)) }));
  const w = W.decodeWelcome(await sr.read(32));
  const udp = dgram.createSocket('udp4');
  const t0 = performance.now();
  let seq = 0;
  const words = setInterval(() => {
    const now = Math.floor(w.serverTick + (performance.now() - t0) / W.TICK_MS) + 8;
    const from = Math.max(w.joinTick, now - 16);
    const m = W.encodeInput({ seq: seq++, firstTick: from, ackTick: 0, ackBits: 0n, words: new Array(now - from).fill(0) });
    const d = new Uint8Array(4 + m.length); new DataView(d.buffer).setUint32(0, w.token, true); d.set(m, 4);
    udp.send(d, 4753, '127.0.0.1');
  }, 16);
  r = await relay;
  clearInterval(words); udp.close(); tcp.destroy();
  check('a joined player was let in', !!w && !w.reject, JSON.stringify(w));
  check('a sim that never returns ends its relay once the referee is behind', r.code === 3 && r.err.includes('referee'), `exit ${r.code}: ${r.err.trim()}`);
}

// ── the pool ────────────────────────────────────────────────────────────────
const until = async (what, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (what()) return true; await sleep(250); } return false; };
{
  // a pool given a wasm the relay refuses tries a few times, then stops and says why
  const badList = `${dir}/refused.json`;
  const bad = startPool({ game: 'sneaky', wasm: sneaky, ports: [4670, 4672], max_rooms: 2, status_dir: `${dir}/refused`, list: badList,
    relay_args: ['--referee-threads', '1'] }, { log: () => {} });
  const gaveUp = await until(() => /stopped starting rooms after 3 failures: the relay refused/.test(readJson(badList)?.why || ''), 30000);
  check('a pool whose wasm is refused stops after three tries and says why', gaveUp && readJson(badList).servers.length === 0, JSON.stringify(readJson(badList)));
  await bad.close();
}
const statusDir = `${dir}/status`;
const list = `${dir}/servers.json`;
const pool = startPool({
  game: 'golf', wasm: 'build/game.wasm', host: 'play.example.com', ports: [4660, 4663], native_offset: 100,
  max_players: 2, min_free: 1, max_rooms: 3, idle_s: 4, status_dir: statusDir,
  status_base: 'https://play.example.com/golf/rooms/', list,
}, { log: () => {} });
process.on('exit', () => { for (const room of pool.rooms.values()) try { room.p.kill('SIGKILL'); } catch { /* gone */ } });
const servers = () => readJson(list)?.servers || [];

check('the pool opens one free room', await until(() => servers().length === 1, 15000), JSON.stringify(readJson(list)));
const first = servers()[0] || {};
check('a row names the room the way a store reads it', first.addr === 'play.example.com:4660' && first.max_players === 2 && first.name === 'Room 1'
  && first.status_url === 'https://play.example.com/golf/rooms/4660.json', JSON.stringify(first));

// three bots at the first room: two get in, one is turned away
const bots = botHost(`${dir}/bots.json`, ['--relay', '127.0.0.1:4760', '--bots', '3', '--seconds', '10']);
check('the first room fills to its cap', await until(() => readJson(`${statusDir}/4660.json`)?.players === 2, 15000), JSON.stringify(readJson(`${statusDir}/4660.json`)));
const st = readJson(`${statusDir}/4660.json`) || {};
check('its status says what a store shows', st.max_players === 2 && st.tick_hz === 125 && st.tick > 0 && st.game === 'golf', JSON.stringify(st));
check('the players\' worlds match the referee\'s', await until(() => (readJson(`${statusDir}/4660.json`)?.hashes_checked || 0) >= 4, 15000)
  && readJson(`${statusDir}/4660.json`)?.hashes_differed === 0, JSON.stringify(readJson(`${statusDir}/4660.json`)));
check('a full room opens another', await until(() => servers().length === 2, 10000), JSON.stringify(servers()));
await bots.done;
const b = readJson(`${dir}/bots.json`) || {};
check('two bots got in and the third was refused, not squeezed in', b.joined === 2 && b.rejected === 1, JSON.stringify({ joined: b.joined, rejected: b.rejected }));

check('the empty extra room stops after idle_s', await until(() => servers().length === 1, 30000), JSON.stringify(servers()));
await pool.close();
check('a closed pool lists no rooms, and leaves no status behind', servers().length === 0 && !existsSync(`${statusDir}/4660.json`));

console.log(failed.length ? `\nFAILED: ${failed.length}` : '\nPASS');
process.exit(failed.length ? 1 : 0);
