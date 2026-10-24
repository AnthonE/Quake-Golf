#!/usr/bin/env node
// Play: the relay and the page server, until Ctrl-C. Open the printed URL in
// two tabs (or more) of the newest Chrome; each tab is a player. Each room's
// replay lands in replays/ when it ends, and plays at ?replay=../replays/<file>.
//   node net/play.mjs [--seed 7] [--port 4433] [--web 8080] [--host 127.0.0.1] [--xbox] [--arena [--bots 7] [--mode k]] [--bumper [--bots 15]] [--fireplace [--bots 15]]
// --xbox runs the room on the Xbox's sim (build/xbox/game.wasm), for Xboxes
// and xemu on its native door, 4434: the browsers play another sim.
// --arena runs the room on the arena's sim (build/arena/game.wasm), the
// deathmatch, with --bots AI fighters in it (net/bot-host.mjs --arena); its
// matches play the modes in turn, or with --mode k only mode k (layout.mjs, M_*).
// --bumper runs it on bumper balls' sim (build/bumper/game.wasm), with --bots
// AI balls in it (net/bot-host.mjs --bumper); up to 256 in the room.
// --fireplace runs Fireplace (build/fireplace/game.wasm): every game in turn,
// with --bots guests who play whatever is on (net/bot-host.mjs --fireplace).
// Another machine on the LAN can join with --host 0.0.0.0 if its Chrome treats
// this page as secure: chrome://flags/#unsafely-treat-insecure-origin-as-secure
// with http://<this machine>:8080 (shared memory and WebTransport need it).
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { serve } from '../tools/serve.mjs';
import { PLAYLIST, GAMES } from '../src/layout.mjs';
import { forcedSeed } from '../src/arena-view.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const port = opt('port', '4433');
const web = Number(opt('web', 8080));
const host = opt('host', '127.0.0.1');
const seed = opt('mode', '') !== '' ? String(forcedSeed(Number(opt('mode', '')), Number(opt('seed', 7)))) : opt('seed', '');
const xbox = argv.includes('--xbox');
const arena = argv.includes('--arena');
const bumper = argv.includes('--bumper');
const fireplace = argv.includes('--fireplace');
const nbots = Number(opt('bots', arena ? 5 : bumper || fireplace ? 15 : 0));
const DENO = existsSync('.tools/deno') ? '.tools/deno' : 'deno';

execFileSync('sh', ['tools/cert.sh'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/asm.mjs'], { stdio: 'inherit' });
const hash = readFileSync('certs/hash.txt', 'utf8').trim();
const relay = spawn(DENO, ['run', '--unstable-net', '-A', '--v8-flags=--single-threaded-gc', 'net/relay.ts', '--port', port, '--host', host, '--replays', 'replays', ...(seed ? ['--seed', seed] : []), ...(xbox ? ['--wasm', 'build/xbox/game.wasm'] : arena ? ['--wasm', 'build/arena/game.wasm'] : bumper ? ['--wasm', 'build/bumper/game.wasm'] : fireplace ? ['--wasm', 'build/fireplace/game.wasm'] : [])], { stdio: 'inherit' });
relay.on('exit', (code) => { console.error(`relay exited (${code})`); process.exit(1); });
let bots = null;
process.on('SIGINT', () => { relay.kill(); bots?.kill(); process.exit(0); });
if (fireplace) {
  await serve({ port: web, host });
  const page = host === '0.0.0.0' ? '<this machine>' : host;
  console.log(`\nopen http://${page}:${web}/client/fireplace.html?hash=${encodeURIComponent(hash)} in Chrome`);
  console.log('a living room at night, the fire going, the TV on: click to sit down and the TV fills the screen with whatever the room is playing.');
  console.log(`the playlist: ${PLAYLIST.map((g) => GAMES[g]).join(', ')}, again; marshmallows for the top three of each. Come and go as you like.`);
  if (nbots) {
    await new Promise((ok) => setTimeout(ok, 1500));
    mkdirSync('traces', { recursive: true });
    bots = spawn(process.execPath, ['net/bot-host.mjs', '--fireplace', '--relay', `${host === '0.0.0.0' ? '127.0.0.1' : host}:4434`, '--bots', String(nbots), '--out', 'traces/bot-host.json'], { stdio: 'inherit' });
  }
} else if (bumper) {
  await serve({ port: web, host });
  const page = host === '0.0.0.0' ? '<this machine>' : host;
  console.log(`\nopen http://${page}:${web}/client/bumper.html?hash=${encodeURIComponent(hash)} in Chrome`);
  console.log('click to play: the mouse turns you, WASD rolls, space hops, click (or E) uses the power-up you hold, Tab scores, F fullscreen, M music.');
  console.log('a wheel of Swiss cheese over the sea: keep out of its holes, bump the others into them, grab what falls from the sky. Last ball rolling wins.');
  if (nbots) {
    await new Promise((ok) => setTimeout(ok, 1500));
    mkdirSync('traces', { recursive: true });
    bots = spawn(process.execPath, ['net/bot-host.mjs', '--bumper', '--relay', `${host === '0.0.0.0' ? '127.0.0.1' : host}:4434`, '--bots', String(nbots), '--out', 'traces/bot-host.json'], { stdio: 'inherit' });
  }
} else if (arena) {
  await serve({ port: web, host });
  const page = host === '0.0.0.0' ? '<this machine>' : host;
  console.log(`\nopen http://${page}:${web}/client/arena.html?hash=${encodeURIComponent(hash)} in Chrome`);
  console.log('click to play: mouse aims, WASD runs, space jumps, left click fires, right click zooms, 1/2, X or the wheel swaps guns,');
  console.log('Q melee, G grenade, R reload, E picks up the gun on a pad, Tab scores, F fullscreen. Fiesta: random guns, most kills in 10 minutes wins.');
  if (nbots) {
    await new Promise((ok) => setTimeout(ok, 1500));
    mkdirSync('traces', { recursive: true });
    bots = spawn(process.execPath, ['net/bot-host.mjs', '--arena', '--relay', `${host === '0.0.0.0' ? '127.0.0.1' : host}:4434`, '--bots', String(nbots), '--out', 'traces/bot-host.json'], { stdio: 'inherit' });
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
