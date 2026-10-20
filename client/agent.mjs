// The agent door: what any agent (an LLM, a script, a bred brain) gets to
// play with, and no more than a human gets. see() is the screen and the HUD
// as data and look() as text; Hands turn commands into the same input word a
// mouse and keyboard make. There is no pathfinding and no auto-shot: the
// agent plans, the hands only press. Nothing here touches the network or the
// DOM, so the stepped local room (tools/agent.mjs) and a live door share it.
import * as L from '../src/layout.mjs';
import { inputWord, MOVE } from '../src/view.mjs';

export const HZ = 125;
const EYE = 1.6;
const LIES = ['fairway', 'rough', 'sand', 'green'];
const STATES = ['waiting', 'countdown', 'play', 'over'];
const KEYS = { w: MOVE.FORWARD, s: MOVE.BACK, a: MOVE.LEFT, d: MOVE.RIGHT, j: 16 };
const FIRE_TICKS = 12; // long enough for the press to cross the round trip and land

export const HELP = `QUAKE GOLF. Sink your ball in the cup (a slipgate: it swallows a ball under 8 m/s) in as few shots as you can.
Every shot is a stroke. The rocket is your club: shoot the ground just behind your ball, on the side away from where it
should go. From four tees, a blast this far behind the ball sent it: 0.5-1 m, 200-350 m; 1.5 m, 150-180 m; 2 m,
80-170 m; 3 m, 30-70 m; 4 m, 11 m. Rough and slopes change that a lot (a 1 m blast from uphill rough went 47 m), and
past a cup in a hollow the ball runs on up the far side, so leave it short. Stand 1 to 4 m behind the blast point and
look down at it: where you stand barely changes the shot, but nearer than 2 m the blast throws you about 20 m. You
pass through your own ball (no dribbling) and push everyone else's. The grenade bounces and pops after 2.5 s, for
lobs. A hole lasts 4 min; not finishing costs 2. Bearings are yaw degrees (0 is +x, 90 is +z), the numbers aim
takes; pitch 0 is level, down is negative. You run at 10 m/s and slide about 2.5 m after letting go; a 0.05 s tap
moves you about 0.8 m.
Commands, several at once joined by ";":
  look                                what you see (every reply ends with it)
  aim <yaw> [<pitch>]                 turn to a bearing, in degrees
  face ball | cup | <x> <z> | <x> <y> <z>   look at a point (without y, the ground there)
  hold <keys> <seconds>               hold any of w a s d j (j jumps); w runs the way you face
  fire                                shoot: one stroke
  weapon rocket | grenade
  wait <seconds> | wait ball          stand still; "wait ball" until your ball stops (20 s at most)`;

const deg = (r) => r * 180 / Math.PI;
const bearing = (from, to) => ((deg(Math.atan2(to[2] - from[2], to[0] - from[0])) % 360) + 360) % 360;
const flat = (a, b) => Math.hypot(b[0] - a[0], b[2] - a[2]);

// What slot `slot` sees: the hole, itself, its ball, the cup, the others and
// the FX since `since` (a running count). `aim` is the agent's own mouse,
// which it sees at once, ahead of the round trip.
export function see(view, slot, { since = 0, aim = null } = {}) {
  const h = view.hole();
  const me = view.player(slot);
  const yawOf = (w) => (w & 0x3fff) / 16384 * 360;
  const pitchOf = (w) => ((w >>> 14) & 0x3ff) / 1024 * 180 - 90;
  const out = {
    tick: h.tick, hole: h.hole + 1, state: STATES[h.state], par: h.par,
    left: h.state === L.H_IDLE ? null : Math.max(0, h.until - h.tick) / HZ,
    you: {
      slot, live: me.live, pos: me.pos, ground: me.ground, speed: Math.hypot(me.vel[0], me.vel[2]),
      yaw: aim ? aim.yaw : yawOf(me.input), pitch: aim ? aim.pitch : pitchOf(me.input),
      weapon: (aim ? aim.weapon : me.input >>> 31) ? 'grenade' : 'rocket', ready: me.refire === 0,
      strokes: me.strokes, done: me.done, score: me.score, holes: me.holes, total: me.total,
    },
    ball: null, cup: { pos: h.cup, green: L.GREEN_R }, others: [], events: [],
  };
  if (me.ball >= 0) {
    const b = view.ball(me.ball);
    out.ball = {
      pos: b.pos, dist: flat(me.pos, b.pos), bearing: bearing(me.pos, b.pos), dy: b.pos[1] - me.pos[1],
      lie: LIES[view.surface(b.pos[0], b.pos[2])], sunk: !!(b.flags & L.F_SUNK),
      moving: !!(b.flags & L.F_AWAKE) && Math.hypot(...b.vel) > 0.02,
    };
    Object.assign(out.cup, { dist: flat(b.pos, h.cup), bearing: bearing(b.pos, h.cup), dy: h.cup[1] - b.pos[1] });
  }
  for (let p = 0; p < L.NPLAYER; p++) {
    if (p === slot) continue;
    const o = view.player(p);
    if (!o.live) continue;
    const ob = o.ball >= 0 ? view.ball(o.ball).pos : null;
    out.others.push({ slot: p, strokes: o.strokes, done: o.done, total: o.total, pos: o.pos, toCup: ob ? flat(ob, h.cup) : null });
  }
  const n = view.fxCount();
  for (let k = Math.max(since, n - L.FX_MAX, n - 8); k < n; k++) {
    const f = view.fx(k);
    const kind = { [L.FX_BLAST]: 'blast', [L.FX_SINK]: 'sink', [L.FX_SHOT]: 'shot' }[f.kind];
    if (kind) out.events.push({ tick: f.tick, kind, by: f.owner, pos: f.pos });
  }
  out.seen = n;
  return out;
}

const v3 = (p) => `(${p.map((x) => x.toFixed(1)).join(' ')})`;
const ud = (dy, what) => `${Math.abs(dy).toFixed(1)} m ${dy >= 0 ? 'above' : 'below'} ${what}`;
const clock = (s) => { const c = Math.ceil(s); return `${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`; };

// see() as the few lines a person would read off the screen.
export function look(s) {
  const y = s.you;
  const lines = [`t${s.tick} · hole ${s.hole} · ${s.state}${s.par ? ` · par ${s.par}` : ''}${s.left !== null ? ` · ${clock(s.left)} left` : ''}`];
  if (!y.live) return [...lines, 'you    not in the room yet'].join('\n');
  lines.push(`you    slot ${y.slot} at ${v3(y.pos)}, ${y.ground ? 'on the ground' : 'in the air'}, ${y.speed < 0.2 ? 'still' : `moving ${y.speed.toFixed(1)} m/s`}, ` +
    `facing ${y.yaw.toFixed(1)}° pitch ${y.pitch.toFixed(1)}°, ${y.weapon} ${y.ready ? 'ready' : 'reloading'}, strokes ${y.strokes}` +
    `${y.done ? ' (in the cup)' : ''}; holes ${y.holes}, total ${y.total}`);
  if (s.ball) {
    const b = s.ball;
    lines.push(`ball   ${v3(b.pos)}, ${b.dist.toFixed(1)} m from you at bearing ${b.bearing.toFixed(1)}°, ${ud(b.dy, 'you')}, ` +
      `${b.sunk ? 'sunk' : `${b.lie}, ${b.moving ? 'moving' : 'still'}`}`);
    lines.push(`cup    ${v3(s.cup.pos)}, ${s.cup.dist.toFixed(1)} m from your ball at bearing ${s.cup.bearing.toFixed(1)}°, ` +
      `${ud(s.cup.dy, 'your ball')}; the green is the ${s.cup.green} m around it`);
  } else lines.push(`cup    ${v3(s.cup.pos)}`);
  for (const o of s.others) {
    lines.push(`other  slot ${o.slot}: strokes ${o.strokes}${o.done ? ', in the cup' : o.toCup !== null ? `, ball ${o.toCup.toFixed(1)} m from the cup` : ''}, total ${o.total}`);
  }
  for (const e of s.events) {
    lines.push(`event  t${e.tick} ${e.kind === 'sink' ? `slot ${e.by} sank` : `${e.kind} by slot ${e.by} at ${v3(e.pos)}`}`);
  }
  return lines.join('\n');
}

// The hands: aim, weapon and the shot counter change at once; a command that
// takes time comes back as { ticks, move, until } for the room to run, keys
// held throughout and released after. Bad commands throw, with the reason.
export class Hands {
  constructor() {
    this.yaw = 0; // degrees
    this.pitch = 0;
    this.weapon = 0;
    this.presses = 0; // the input's 2-bit shot counter is this mod 4
    this.move = 0; // MOVE bits, 16 for jump
  }

  get aim() { return { yaw: this.yaw, pitch: this.pitch, weapon: this.weapon }; }

  word() {
    const yaw = Math.round(this.yaw / 360 * 16384) & 0x3fff;
    const pitch = Math.max(0, Math.min(1023, Math.round(512 + this.pitch / 180 * 1024)));
    return inputWord({ yaw, pitch, move: this.move & 15, jump: (this.move >> 4) & 1, shot: this.presses, weapon: this.weapon });
  }

  command(line, view, slot) {
    const [verb, ...a] = line.trim().split(/\s+/);
    const num = (x, what) => {
      const v = Number(x);
      if (x === undefined || !Number.isFinite(v)) throw new Error(`${verb}: ${what} should be a number, got ${x === undefined ? 'nothing' : `"${x}"`}`);
      return v;
    };
    const secs = (x) => {
      const v = num(x, 'seconds');
      if (v <= 0 || v > 60) throw new Error(`${verb}: seconds should be above 0 and at most 60`);
      return Math.max(1, Math.round(v * HZ));
    };
    const me = view.player(slot);
    switch (verb) {
      case 'look': case 'help': case '': return { ticks: 0 };
      case 'aim':
        this.yaw = ((num(a[0], 'yaw') % 360) + 360) % 360;
        if (a[1] !== undefined) this.pitch = Math.max(-90, Math.min(89.8, num(a[1], 'pitch')));
        return { ticks: 0 };
      case 'face': {
        let to;
        if (a[0] === 'ball' || a[0] === 'cup') {
          if (a[0] === 'ball' && me.ball < 0) throw new Error('face: you have no ball yet');
          to = a[0] === 'cup' ? view.hole().cup : view.ball(me.ball).pos;
        } else if (a.length === 2) to = [num(a[0], 'x'), view.height(num(a[0], 'x'), num(a[1], 'z')), num(a[1], 'z')];
        else if (a.length === 3) to = [num(a[0], 'x'), num(a[1], 'y'), num(a[2], 'z')];
        else throw new Error('face: give ball, cup, <x> <z> or <x> <y> <z>');
        const eye = [me.pos[0], me.pos[1] + EYE, me.pos[2]];
        this.yaw = bearing(eye, to);
        this.pitch = Math.max(-90, Math.min(89.8, deg(Math.atan2(to[1] - eye[1], flat(eye, to)))));
        return { ticks: 0 };
      }
      case 'hold': {
        if (!a[0] || /[^wasdj]/.test(a[0])) throw new Error('hold: keys are any of w a s d j, e.g. "hold w 2" or "hold wd 0.5"');
        let move = 0;
        for (const k of a[0]) move |= KEYS[k];
        return { ticks: secs(a[1]), move };
      }
      case 'fire': {
        const state = view.hole().state;
        if (state !== L.H_PLAY) throw new Error(`fire: no shots while the hole is ${STATES[state]}`);
        if (me.refire > 0) throw new Error(`fire: still reloading, ${(me.refire / HZ).toFixed(2)} s to go`);
        this.presses++;
        return { ticks: FIRE_TICKS };
      }
      case 'weapon':
        if (a[0] !== 'rocket' && a[0] !== 'grenade') throw new Error('weapon: rocket or grenade');
        this.weapon = a[0] === 'grenade' ? 1 : 0;
        return { ticks: 0 };
      case 'wait': {
        if (a[0] !== 'ball') return { ticks: secs(a[0]) };
        const until = (v) => {
          const p = v.player(slot);
          if (p.ball < 0 || v.projectiles().some((j) => j.owner === slot)) return false;
          const b = v.ball(p.ball);
          return !(b.flags & L.F_AWAKE) || !!(b.flags & L.F_SUNK);
        };
        return { ticks: 20 * HZ, until };
      }
      default: throw new Error(`no command "${verb}"; try help`);
    }
  }
}
