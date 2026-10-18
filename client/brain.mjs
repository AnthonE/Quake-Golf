// The neural golfer: a 274-weight net that judges a shot by feel, where the
// golf bot tries 24 on a private sim first. It reads the hole as fourteen
// numbers (the cup's distance and height, the lie, the ground along the line)
// and answers with the blast distance behind the ball and a small turn.
//
// A genome stores no weights. It is a recipe: a base seed, then one 16-bit
// seed per accepted mutation, and replaying it rebuilds the same weights
// bit for bit, the way a course seed rebuilds the terrain (Such et al. 2017
// encode deep neuroevolution genomes the same way). "qg2:" and base64url:
// 101 mutations still fit in a tweet.
//
// All of it is f32, as the sim is: Math.fround after every + - * / and sqrt,
// which on f32 operands gives the IEEE single result, so xbox/brain.c, doing
// the same ops in the same order on the Pentium III's SSE1, gets the same
// bits. (qg1 genomes were the f64 brain, before the Xbox; they do not carry
// over.)
import * as L from '../src/layout.mjs';
import { GolfBot, shotGeometry } from './bot.mjs';

export const NIN = 14;
export const NHID = 16;
export const NOUT = 2;
export const NW = (NIN + 1) * NHID + (NHID + 1) * NOUT;
export const TWEET = 280;
export const MAX_MUTATIONS = Math.floor(Math.floor((TWEET - 4) * 3 / 4 - 4) / 2);
const f = Math.fround;
const SIGMA = [0.05, 0.1, 0.2, 0.4].map(f); // a mutation's step, picked by its seed's top two bits
const DH_MIN = f(0.3), DH_SPAN = f(4.5); // the bot's range of blast distances
const TURN = f(6 * Math.PI / 180);
const GMAX = f(510.99);
const LIES = 4;
const ALONG = [0.25, 0.5, 0.75, 1, 1.25, 1.5]; // ground samples, as fractions of the way to the cup

// splitmix32 for the bits, then 24 of them as an exact f32 in [0, 1).
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return ((z ^ (z >>> 16)) >>> 8) * 2 ** -24;
  };
}
// Three uniforms, centred and scaled to variance 1.
const noise = (u) => { const a = u(), b = u(), c = u(); return f(f(f(f(a + b) + c) - 1.5) * 2); };
const mix = (base, g, s) => (Math.imul(base ^ 0x5bd1e995, 0x27d4eb2d) ^ Math.imul(g + 1, 0x9e3779b9) ^ Math.imul(s + 1, 0x85ebca6b)) >>> 0;

// Each weight's scale: 1/sqrt(fan-in), so a fresh net neither saturates nor sleeps.
const S1 = f(1 / f(Math.sqrt(NIN + 1))), S2 = f(1 / f(Math.sqrt(NHID + 1)));
const scale = (i) => (i < (NIN + 1) * NHID ? S1 : S2);

export function encode({ base, muts }) {
  const b = new Uint8Array(4 + 2 * muts.length);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, base >>> 0, true);
  muts.forEach((m, i) => dv.setUint16(4 + 2 * i, m, true));
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return `qg2:${btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

export function decode(text) {
  const t = String(text).trim();
  if (t.startsWith('qg1:')) throw new Error('qg1 genomes were the f64 brain, before the Xbox; breed a qg2 one');
  const m = t.match(/^qg2:([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error('a genome looks like qg2: and base64url');
  const s = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
  if (s.length < 4 || s.length % 2) throw new Error(`a genome is 4 + 2n bytes, this one is ${s.length}`);
  const dv = new DataView(Uint8Array.from(s, (c) => c.charCodeAt(0)).buffer);
  const muts = [];
  for (let o = 4; o < s.length; o += 2) muts.push(dv.getUint16(o, true));
  return { base: dv.getUint32(0, true), muts };
}

// The recipe, replayed.
export function weights({ base, muts }) {
  const w = new Float32Array(NW);
  let u = rng(base);
  for (let i = 0; i < NW; i++) w[i] = f(noise(u) * scale(i));
  muts.forEach((m, g) => {
    u = rng(mix(base, g, m & 0x3fff));
    const sig = SIGMA[m >>> 14];
    for (let i = 0; i < NW; i++) w[i] = f(w[i] + f(f(sig * scale(i)) * noise(u)));
  });
  return w;
}

const soft = (x) => f(x / f(1 + Math.abs(x))); // softsign: tanh's shape from one division

// The ground under (x, z), bilinear over the sim's heightfield, in f32.
export function ground(dv, x, z) {
  const gx = f(Math.min(Math.max(f(x * 0.5), 0), GMAX)), gz = f(Math.min(Math.max(f(z * 0.5), 0), GMAX));
  const ix = Math.trunc(gx), iz = Math.trunc(gz);
  const fx = f(gx - ix), fz = f(gz - iz);
  const h = (a, b) => f(dv.getUint16(L.TERRAIN_H + 2 * ((iz + b) * 512 + ix + a), true) / 256);
  const h00 = h(0, 0), h10 = h(1, 0), h01 = h(0, 1), h11 = h(1, 1);
  let r = f(h00 + f(f(h10 - h00) * fx));
  r = f(r + f(f(h01 - h00) * fz));
  return f(r + f(f(f(f(f(h00 - h10) - h01) + h11) * fx) * fz));
}

function lie(dv, x, z) {
  const ix = Math.trunc(f(Math.min(Math.max(f(x * 0.5), 0), GMAX))), iz = Math.trunc(f(Math.min(Math.max(f(z * 0.5), 0), GMAX)));
  return Math.min(dv.getUint8(L.TERRAIN_S + iz * 512 + ix), LIES - 1);
}

// What the net sees from a ball at rest: everything a player reads off the
// screen about the shot ahead, with the line to the cup as the frame. `ball`
// and `cup` are the sim's own f32 values.
export function features(view, ball, cup) {
  const dv = view.dv;
  const dx = f(cup[0] - ball[0]), dz = f(cup[2] - ball[2]);
  const d = f(Math.sqrt(f(f(dx * dx) + f(dz * dz))));
  const ux = d > 0 ? f(dx / d) : 1, uz = d > 0 ? f(dz / d) : 0;
  const out = new Float32Array(NIN);
  out[0] = f(d / 100);
  out[1] = f(f(cup[1] - ball[1]) / 10);
  out[2 + lie(dv, ball[0], ball[2])] = 1;
  ALONG.forEach((a, k) => {
    const s = f(a * d);
    out[6 + k] = f(f(ground(dv, f(ball[0] + f(ux * s)), f(ball[2] + f(uz * s))) - ball[1]) / 10);
  });
  out[12] = f(f(ground(dv, f(ball[0] + f(ux * 5)), f(ball[2] + f(uz * 5))) - ball[1]) / 2);
  out[13] = f(f(ground(dv, f(ball[0] - f(ux * 5)), f(ball[2] - f(uz * 5))) - ball[1]) / 2);
  return out;
}

export class Brain {
  constructor(genome) {
    this.genome = typeof genome === 'string' ? decode(genome) : genome;
    this.w = weights(this.genome);
  }

  // { dh, turn }: metres behind the ball to put the blast, radians off the line to the cup.
  decide(x) {
    const w = this.w;
    const h = new Float32Array(NHID);
    let k = 0;
    for (let j = 0; j < NHID; j++) {
      let s = w[k++];
      for (let i = 0; i < NIN; i++) s = f(s + f(w[k++] * x[i]));
      h[j] = soft(s);
    }
    const o = [0, 0];
    for (let j = 0; j < NOUT; j++) {
      let s = w[k++];
      for (let i = 0; i < NHID; i++) s = f(s + f(w[k++] * h[i]));
      o[j] = soft(s);
    }
    return { dh: f(DH_MIN + f(DH_SPAN * f(f(o[0] + 1) / 2))), turn: f(TURN * o[1]) };
  }
}

// The golf bot's own legs and aim, with the brain's feel in place of its
// private sim: the one thing that differs between the two is how the shot
// is chosen.
export class BrainBot extends GolfBot {
  constructor(slot, genome, opts) {
    super(slot, null, opts);
    this.brain = genome instanceof Brain ? genome : new Brain(genome);
  }

  choose(view, ball, cup) {
    const { dh, turn } = this.brain.decide(features(view, ball, cup));
    return { from: ball.slice(), shot: shotGeometry(view, ball, cup, dh, turn), score: 0 };
  }
}
