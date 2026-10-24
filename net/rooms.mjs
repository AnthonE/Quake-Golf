#!/usr/bin/env node
// A game's rooms: one relay (net/relay.ts) per room, as many as players need.
// It keeps min_free rooms with nobody in them, so a newcomer always has one to
// join; starts another when the free ones fill, up to max_rooms; and stops an
// extra empty room once it has sat idle for idle_s. Each room writes its status
// (relay --status) to status_dir/<port>.json, and the pool writes the game's
// server list (elo-shardlist-v1: id, name, addr, max_players, status_url) to
// `list`, rows in port order. A page host serves both: status_url is
// status_base + <port>.json.
//
// A room whose relay ends is dropped and replaced by the rule above; a room
// that ends with a refusal (exit 2: the wasm is not a sim it will run) or a
// referee that fell behind (exit 3) counts as a failure, and after
// MAX_FAILURES in a row the pool stops starting rooms and says why in the
// list's `why`. When the certificate is renewed (tools/cert.sh rewrites
// certs/cert.pem, and pages fetch the new hash), a room still on the old one
// is stopped once it is empty and a fresh one takes its place.
//   node net/rooms.mjs rooms.json
// rooms.json (net/rooms.example.json):
//   { game, wasm, host, bind, ports: [first, last], native_offset, max_players,
//     min_free, max_rooms, idle_s, status_dir, status_base, list, relay_args }
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isMain } from '../tools/main.mjs';

const DENO = existsSync('.tools/deno') ? '.tools/deno' : 'deno';
const TICK_MS = 2000;
const MAX_FAILURES = 3;

const DEFAULTS = {
  game: 'golf', wasm: 'build/game.wasm', host: '127.0.0.1', bind: '127.0.0.1',
  ports: [4433, 4440], native_offset: 0, max_players: 16, min_free: 1, max_rooms: 4,
  idle_s: 300, status_dir: 'traces/rooms', status_base: '', list: 'traces/rooms/servers.json', relay_args: [],
};

const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
const certAge = () => { try { return statSync('certs/cert.pem').mtimeMs; } catch { return 0; } };
const writeWhole = (path, text) => { writeFileSync(`${path}.tmp`, text); renameSync(`${path}.tmp`, path); };

export function startPool(config, { log = (m) => console.error(`[rooms] ${m}`) } = {}) {
  const c = { ...DEFAULTS, ...config };
  mkdirSync(c.status_dir, { recursive: true });
  const rooms = new Map(); // port -> { p, port, cert, emptySince, stopping, exited }
  // failures in a row (a room that ends refusing its wasm, or with a referee
  // behind); a room with players in it resets the count
  let failures = 0, lastWhy = null, stopped = false;

  const statusOf = (r) => readJson(`${c.status_dir}/${r.port}.json`);
  const freePort = () => {
    for (let port = c.ports[0]; port <= c.ports[1]; port++) if (!rooms.has(port)) return port;
    return null;
  };

  function start(port) {
    const args = ['run', '--unstable-net', '-A', '--v8-flags=--single-threaded-gc', 'net/relay.ts',
      '--port', String(port), '--host', c.bind, '--native-port', String(c.native_offset ? port + c.native_offset : 0),
      '--wasm', c.wasm, '--game', c.game, '--max-players', String(c.max_players),
      '--status', `${c.status_dir}/${port}.json`, '--quiet', ...c.relay_args];
    const p = spawn(DENO, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    const r = { p, port, cert: certAge(), started: Date.now(), emptySince: Date.now(), stopping: false, exited: false };
    p.on('exit', (code) => {
      r.exited = true;
      rooms.delete(port);
      // a relay that crashed never removed its status: a stale file must not read as a room
      rmSync(`${c.status_dir}/${port}.json`, { force: true });
      if (r.stopping) return;
      // a refusal, a referee behind, or a room that died starting (a port in use, say)
      const early = Date.now() - r.started < 10000;
      if (code === 2 || code === 3 || early) {
        failures++;
        lastWhy = code === 2 ? `the relay refused ${c.wasm} (exit 2)` : code === 3 ? 'a room\'s referee fell behind (exit 3)'
          : `room ${port} ended within 10 s of starting (exit ${code})`;
        log(`room ${port} ended: ${lastWhy}`);
      } else log(`room ${port} ended (exit ${code})`);
    });
    rooms.set(port, r);
    log(`room ${port} started`);
  }

  function stop(r) {
    r.stopping = true;
    r.p.kill('SIGTERM');
  }

  function step() {
    if (stopped) return;
    const now = Date.now();
    const certNow = certAge();
    let free = 0;
    for (const r of rooms.values()) {
      if (r.stopping) continue;
      const st = statusOf(r);
      const players = st ? st.players : null;
      // a room still starting counts as free, so the next step doesn't start another
      if (players === null && now - r.started < 10000) { free++; continue; }
      if (players > 0) failures = 0;
      if (players === 0) {
        r.emptySince ??= now;
        // an empty room on an old certificate gives way to a fresh one
        if (r.cert < certNow) { log(`room ${r.port}: new certificate, restarting while empty`); stop(r); continue; }
        free++;
      } else if (players > 0) r.emptySince = null;
    }
    // stop the extras that have sat empty past idle_s, newest port first
    const idle = [...rooms.values()].filter((r) => !r.stopping && r.emptySince !== null && now - r.emptySince > c.idle_s * 1000
      && statusOf(r)?.players === 0).sort((a, b) => b.port - a.port);
    for (const r of idle) {
      if (free <= c.min_free) break;
      log(`room ${r.port}: empty for ${c.idle_s} s, stopping`);
      stop(r);
      free--;
    }
    // and start rooms until enough are free
    const live = () => [...rooms.values()].filter((r) => !r.stopping).length;
    while (failures < MAX_FAILURES && free < c.min_free && live() < c.max_rooms) {
      const port = freePort();
      if (port === null) break;
      start(port);
      free++;
    }
    writeList();
  }

  function writeList() {
    const rows = [...rooms.values()].filter((r) => !r.stopping && !r.exited && existsSync(`${c.status_dir}/${r.port}.json`))
      .sort((a, b) => a.port - b.port)
      .map((r) => ({
        // named by its port, so a room keeps its name while others come and go
        id: `${c.game}-${r.port}`, name: `Room ${r.port - c.ports[0] + 1}`, addr: `${c.host}:${r.port}`, max_players: c.max_players,
        ...(c.status_base ? { status_url: `${c.status_base}${r.port}.json` } : {}),
      }));
    const why = failures >= MAX_FAILURES ? `stopped starting rooms after ${failures} failures: ${lastWhy}` : null;
    writeWhole(c.list, JSON.stringify({ servers: rows, ...(why ? { why } : {}) }, null, 1) + '\n');
  }

  const timer = setInterval(step, TICK_MS);
  step();
  return {
    rooms,
    step,
    async close() {
      stopped = true;
      clearInterval(timer);
      const left = [...rooms.values()];
      for (const r of left) stop(r);
      await Promise.all(left.map((r) => (r.exited ? null : new Promise((ok) => { r.p.once('exit', ok); setTimeout(ok, 5000); }))));
      writeWhole(c.list, JSON.stringify({ servers: [] }, null, 1) + '\n');
    },
  };
}

if (isMain(import.meta.url)) {
  const path = process.argv[2];
  if (!path) { console.error('usage: node net/rooms.mjs rooms.json'); process.exit(1); }
  const pool = startPool(JSON.parse(readFileSync(path, 'utf8')));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await pool.close(); process.exit(0); });
}
