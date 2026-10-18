// The neural golfer: a 274-weight net that judges a shot by feel, where the
// golf bot tries 24 on a private sim first. It reads the hole as fourteen
// numbers (the cup's distance and height, the lie, the ground along the line)
// and answers with the blast distance behind the ball and a small turn.
//
// A genome stores no weights. It is a recipe: a base seed, then one 16-bit
// seed per accepted mutation, and replaying it rebuilds the same weights
// bit for bit, the way a course seed rebuilds the terrain (Such et al. 2017
// encode deep neuroevolution genomes the same way). Weights, features and
// the forward pass use only + - * / and sqrt, which IEEE rounds the same way
// everywhere. "qg1:" and base64url: 101 mutations still fit in a tweet.
import { GolfBot, shotGeometry } from './bot.mjs';

export const NIN = 14;
export const NHID = 16;
export const NOUT = 2;
export const NW = (NIN + 1) * NHID + (NHID + 1) * NOUT;
export const TWEET = 280;
export const MAX_MUTATIONS = Math.floor(Math.floor((TWEET - 4) * 3 / 4 - 4) / 2);
const SIGMA = [0.05, 0.1, 0.2, 0.4]; // a mutation's step, picked by its seed's top two bits
const DH_MIN = 0.3, DH_SPAN = 4.5; // the bot's range of blast distances
const TURN = 6 * Math.PI / 180;
const LIES = 4;
const ALONG = [0.25, 0.5, 0.75, 1, 1.25, 1.5]; // ground samples, as fractions of the way to the cup

// splitmix32: a 32-bit state, integer ops only.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return ((z ^ (z >>> 16)) >>> 0) / 4294967296;
  };
}
// Three uniforms, centred and scaled to variance 1.
const noise = (u) => (u() + u() + u() - 1.5) * 2;
const mix = (base, g, s) => (Math.imul(base ^ 0x5bd1e995, 0x27d4eb2d) ^ Math.imul(g + 1, 0x9e3779b9) ^ Math.imul(s + 1, 0x85ebca6b)) >>> 0;

// Each weight's scale: 1/sqrt(fan-in), so a fresh net neither saturates nor sleeps.
const SCALE = new Float64Array(NW);
{
  let k = 0;
  for (let i = 0; i < (NIN + 1) * NHID; i++) SCALE[k++] = 1 / Math.sqrt(NIN + 1);
  for (let i = 0; i < (NHID + 1) * NOUT; i++) SCALE[k++] = 1 / Math.sqrt(NHID + 1);
}

export function encode({ base, muts }) {
  const b = new Uint8Array(4 + 2 * muts.length);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, base >>> 0, true);
  muts.forEach((m, i) => dv.setUint16(4 + 2 * i, m, true));
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return `qg1:${btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

export function decode(text) {
  const m = String(text).trim().match(/^qg1:([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error('a genome looks like qg1: and base64url');
  const s = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
  if (s.length < 4 || s.length % 2) throw new Error(`a genome is 4 + 2n bytes, this one is ${s.length}`);
  const dv = new DataView(Uint8Array.from(s, (c) => c.charCodeAt(0)).buffer);
  const muts = [];
  for (let o = 4; o < s.length; o += 2) muts.push(dv.getUint16(o, true));
  return { base: dv.getUint32(0, true), muts };
}

// The recipe, replayed.
export function weights({ base, muts }) {
  const w = new Float64Array(NW);
  let u = rng(base);
  for (let i = 0; i < NW; i++) w[i] = noise(u) * SCALE[i];
  muts.forEach((m, g) => {
    u = rng(mix(base, g, m & 0x3fff));
    const sig = SIGMA[m >>> 14];
    for (let i = 0; i < NW; i++) w[i] += sig * SCALE[i] * noise(u);
  });
  return w;
}

const soft = (x) => x / (1 + Math.abs(x)); // softsign: tanh's shape from one division

// What the net sees from a ball at rest: everything a player reads off the
// screen about the shot ahead, with the line to the cup as the frame.
export function features(view, ball, cup) {
  const dx = cup[0] - ball[0], dz = cup[2] - ball[2];
  const d = Math.sqrt(dx * dx + dz * dz);
  const ux = d > 0 ? dx / d : 1, uz = d > 0 ? dz / d : 0;
  const f = new Float64Array(NIN);
  f[0] = d / 100;
  f[1] = (cup[1] - ball[1]) / 10;
  f[2 + Math.min(view.surface(ball[0], ball[2]), LIES - 1)] = 1;
  ALONG.forEach((a, k) => { f[6 + k] = (view.height(ball[0] + ux * a * d, ball[2] + uz * a * d) - ball[1]) / 10; });
  f[12] = (view.height(ball[0] + ux * 5, ball[2] + uz * 5) - ball[1]) / 2;
  f[13] = (view.height(ball[0] - ux * 5, ball[2] - uz * 5) - ball[1]) / 2;
  return f;
}

export class Brain {
  constructor(genome) {
    this.genome = typeof genome === 'string' ? decode(genome) : genome;
    this.w = weights(this.genome);
  }

  // { dh, turn }: metres behind the ball to put the blast, radians off the line to the cup.
  decide(f) {
    const w = this.w;
    const h = new Float64Array(NHID);
    let k = 0;
    for (let j = 0; j < NHID; j++) {
      let s = w[k++];
      for (let i = 0; i < NIN; i++) s += w[k++] * f[i];
      h[j] = soft(s);
    }
    const o = [0, 0];
    for (let j = 0; j < NOUT; j++) {
      let s = w[k++];
      for (let i = 0; i < NHID; i++) s += w[k++] * h[i];
      o[j] = soft(s);
    }
    return { dh: DH_MIN + DH_SPAN * (o[0] + 1) / 2, turn: TURN * o[1] };
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

