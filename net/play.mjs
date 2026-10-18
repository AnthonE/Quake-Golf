#!/usr/bin/env node
// Play: the relay and the page server, until Ctrl-C. Open the printed URL in
// two tabs (or more) of the newest Chrome; each tab is a player.
//   node net/play.mjs [--seed 7] [--port 4433] [--web 8080] [--host 127.0.0.1]
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
const DENO = existsSync('.tools/deno') ? '.tools/deno' : 'deno';

execFileSync('sh', ['tools/cert.sh'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/asm.mjs'], { stdio: 'inherit' });
const hash = readFileSync('certs/hash.txt', 'utf8').trim();
const relay = spawn(DENO, ['run', '--unstable-net', '-A', '--v8-flags=--single-threaded-gc', 'net/relay.ts', '--port', port, '--host', host, ...(seed ? ['--seed', seed] : [])], { stdio: 'inherit' });
relay.on('exit', (code) => { console.error(`relay exited (${code})`); process.exit(1); });
await serve({ port: web, host });
const page = host === '0.0.0.0' ? '<this machine>' : host;
console.log(`\nopen http://${page}:${web}/client/?hash=${encodeURIComponent(hash)} in two Chrome tabs`);
console.log('click to play: mouse aims, WASD runs, space jumps, left click fires, 1/2 or right click picks rocket or grenade, Tab scores, F fullscreen');
console.log('a rocket blast just behind your ball drives it far and high; farther back is a softer shot; it rolls into the slipgate cup');
process.on('SIGINT', () => { relay.kill(); process.exit(0); });
