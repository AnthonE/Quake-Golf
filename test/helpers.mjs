import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { newMemory, instantiate, Sim, parseLog } from '../harness/core.mjs';
import { generate } from '../tools/genlog.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let built = false;

export function wasmBytes(debug = false) {
  if (!built) {
    execFileSync(process.execPath, ['tools/asm.mjs'], { cwd: ROOT, stdio: 'ignore' });
    built = true;
  }
  return readFileSync(`${ROOT}build/${debug ? 'game.debug' : 'game'}.wasm`);
}

export async function newSim(debug = false) {
  const memory = newMemory();
  return new Sim(await instantiate(await WebAssembly.compile(wasmBytes(debug)), memory), memory);
}

// The arena's build of the same sources (build/arena/).
export function arenaBytes(debug = false) {
  wasmBytes();
  return readFileSync(`${ROOT}build/arena/${debug ? 'game.debug' : 'game'}.wasm`);
}

export async function newArena(debug = false) {
  const memory = newMemory();
  return new Sim(await instantiate(await WebAssembly.compile(arenaBytes(debug)), memory), memory);
}

export const smallLog = (ticks = 1600, extra = {}) => parseLog(generate({ ticks, target: 1200, ...extra }));

export async function hashes(sim, log, from, to, step = (s) => s.x.step()) {
  const out = [];
  for (let t = from; t < to; t++) {
    sim.feed(log, t);
    step(sim);
    out.push(BigInt.asUintN(64, sim.x.hash_region()));
  }
  return out;
}

// Bumper balls' build of the same sources (build/bumper/).
export function bumperBytes(debug = false) {
  wasmBytes();
  return readFileSync(`${ROOT}build/bumper/${debug ? 'game.debug' : 'game'}.wasm`);
}

export async function newBumper(debug = false) {
  const memory = newMemory();
  return new Sim(await instantiate(await WebAssembly.compile(bumperBytes(debug)), memory), memory);
}

// Fireplace: every game in one module (build/fireplace/).
export function fireplaceBytes(debug = false) {
  wasmBytes();
  return readFileSync(`${ROOT}build/fireplace/${debug ? 'game.debug' : 'game'}.wasm`);
}

export async function newFireplace(debug = false) {
  const memory = newMemory();
  return new Sim(await instantiate(await WebAssembly.compile(fireplaceBytes(debug)), memory), memory);
}
