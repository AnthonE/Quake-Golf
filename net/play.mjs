#!/usr/bin/env node
// Play: the relay and the page server, until Ctrl-C. Open the printed URL in
// two tabs (or more) of the newest Chrome; each tab is a player. Each room's
// replay lands in replays/ when it ends, and plays at ?replay=../replays/<file>.
//   node net/play.mjs [--seed 7] [--port 4433] [--web 8080] [--host 127.0.0.1] [--xbox] [--arena [--bots 7]]
// --xbox runs the room on the Xbox's sim (build/xbox/game.wasm), for Xboxes
// and xemu on its native door, 4434: the browsers play another sim.
// --arena runs the room on the arena's sim (build/arena/game.wasm), the
// deathmatch, with --bots AI fighters in it (net/arena-bots.mjs).
// Another machine on the LAN can join with --host 0.0.0.0 if its Chrome treats
// this page as secure: chrome://flags/#unsafely-treat-insecure-origin-as-secure
// with http://<this machine>:8080 (shared memory and WebTransport need it).
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { serve } from '../tools/serve.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const port = opt('port', '4433');
const web = Number(opt('web', 8080));
const host = opt('host', '127.0.0.1');
const seed = opt('seed', '');
const xbox = argv.includes('--xbox');
const arena = argv.includes('--arena');
const nbots = Number(opt('bots', arena ? 5 : 0));
const DENO = existsSync('.tools/deno') ? '.tools/deno' : 'deno';

execFileSync('sh', ['tools/cert.sh'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/asm.mjs'], { stdio: 'inherit' });
const hash = readFileSync('certs/hash.txt', 'utf8').trim();
const relay = spawn(DENO, ['run', '--unstable-net', '-A', '--v8-flags=--single-threaded-gc', 'net/relay.ts', '--port', port, '--host', host, '--replays', 'replays', ...(seed ? ['--seed', seed] : []), ...(xbox ? ['--wasm', 'build/xbox/game.wasm'] : arena ? ['--wasm', 'build/arena/game.wasm'] : [])], { stdio: 'inherit' });
relay.on('exit', (code) => { console.error(`relay exited (${code})`); process.exit(1); });
let bots = null;
process.on('SIGINT', () => { relay.kill(); bots?.kill(); process.exit(0); });
if (arena) {
  await serve({ port: web, host });
  const page = host === '0.0.0.0' ? '<this machine>' : host;
  console.log(`\nopen http://${page}:${web}/client/arena.html?hash=${encodeURIComponent(hash)} in Chrome`);
  console.log('click to play: mouse aims, WASD runs, space jumps, left click fires, right click zooms, 1/2, X or the wheel swaps guns,');
  console.log('Q melee, G grenade, R reload, E picks up the gun on a pad, Tab scores, F fullscreen. Slayer to 25 kills.');
  if (nbots) {
    await new Promise((ok) => setTimeout(ok, 1500));
    bots = spawn(process.execPath, ['net/arena-bots.mjs', `${host === '0.0.0.0' ? '127.0.0.1' : host}:4434`, '--bots', String(nbots)], { stdio: 'inherit' });
  }
} else if (xbox) {
  console.log('\na room on the Xbox\'s sim: Xboxes and xemu join on TCP and UDP 4434');
} else {
  await serve({ port: web, host });
  const page = host === '0.0.0.0' ? '<this machine>' : host;
  console.log(`\nopen http://${page}:${web}/client/?hash=${encodeURIComponent(hash)} in two Chrome tabs`);
  console.log('click to play: mouse aims, WASD runs, space jumps, left click fires, 1/2 or right click picks rocket or grenade, Tab scores, F fullscreen');
  console.log(`replays: each room's lands in replays/ when it ends; play one at http://${page}:${web}/client/?replay=../replays/<file>`);
  console.log('a rocket blast just behind your ball drives it far and high; farther back is a softer shot; it rolls into the slipgate cup');
}
