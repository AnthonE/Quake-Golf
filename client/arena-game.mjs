// The arena's frontend: golf's client with a shooter on top, mounted on a host
// (client/host.mjs) that owns the memory, the workers and the GPU. Raw mouse
// and keys into the input slots; a frame per display refresh drawn from
// shared memory by client/arena-render.mjs, with tracers, sparks, the gun in
// your hands, shields and health, ammo, a motion tracker, a kill feed and
// the scoreboard, each as the match's mode has them (layout.mjs, M_*). A team
// mode (TEAMED) is red against blue: the bodies in their side's colour, a
// score bar, the board by side, and its own objective, HUD lines, news,
// columns and waypoints from its kit module (client/am/<key>.mjs, AMC).
// arena.html mounts it alone; Fireplace mounts it while the room plays the arena.
//   opts: { canvas, lockTarget, bot, skill, sens, fixed (a spectator's held camera: x, y, z, yaw, pitch in degrees), present, showGraph,
//           external (the slots are driven from outside, as Fireplace's guest does: the camera follows them) }
import * as L from '../src/layout.mjs';
import { arenaWord, unpackArena, boxRay } from '../src/arena-view.mjs';
import { createRenderer, COLS, MAX_RECT, PALETTE, project } from './arena-render.mjs';
import { AMC, newsOf, SIDE, SIDE_C, SIDE_RGB, sideOf } from './am/index.mjs';
import { put, C } from './font.mjs';
import { readClock } from './clock.mjs';
import { NetGraph } from './netgraph.mjs';
import { Fighter } from './arena-bot.mjs';
import { predict, corrector, capturePng, listeners } from './host.mjs';

const TURN = 16384;
const ARMS = L.ARMS;
const COLOR = { // per weapon: tracer colour, viewmodel body
  [L.W_AR]: [1, 0.85, 0.45], [L.W_BR]: [1, 0.9, 0.55], [L.W_MAGNUM]: [1, 0.85, 0.5], [L.W_SNIPER]: [1, 1, 0.9],
  [L.W_SHOTGUN]: [1, 0.8, 0.4], [L.W_ROCKET]: [1, 0.6, 0.2], [L.W_PLASMA]: [0.4, 0.8, 1], [L.W_NEEDLER]: [1, 0.4, 0.9], [L.W_SWORD]: [0.5, 0.9, 1],
};
const SHORT = { [L.W_AR]: 'AR', [L.W_BR]: 'BR', [L.W_MAGNUM]: 'MAGNUM', [L.W_SNIPER]: 'SNIPER', [L.W_SHOTGUN]: 'SHOTGUN', [L.W_ROCKET]: 'ROCKET',
  [L.W_PLASMA]: 'PLASMA', [L.W_NEEDLER]: 'NEEDLER', [L.W_SWORD]: 'SWORD', [L.KILL_GREN]: 'FRAG', [L.KILL_MELEE]: 'MELEE', [L.KILL_BEHIND]: 'ASSASSINATION',
  [L.KILL_SUPER]: 'SUPERCOMBINE', [L.KILL_FALL]: 'FALL' };
const CROSS = { [L.W_AR]: 0, [L.W_BR]: 1, [L.W_MAGNUM]: 1, [L.W_SNIPER]: 1, [L.W_SHOTGUN]: 2, [L.W_ROCKET]: 3, [L.W_PLASMA]: 4, [L.W_NEEDLER]: 4, [L.W_SWORD]: 5 };
const RUNGS = L.LADDER.length;
// How a fighter stands under the match's mode, higher is better: the sim's $a_key, for the board while play goes on.
// A team mode's: the winning side first (once it's over), then objective points, then kills.
function standing(m, o, teamWin = 0) {
  if (m < 32 && (1 << m) & L.TEAMED) return (teamWin && teamWin === o.team + 1 ? 2 ** 31 : 0) + Math.min(o.points, 0x7fff) * 65536 + Math.min(o.kills, 0xffff);
  if (m === L.M_INFECTION) return o.zombie ? Math.min(o.human, 0x7fff) * 65536 + o.points : 2 ** 31;
  if (m === L.M_GUNGAME) return o.rung * 65536 + o.kills;
  if (m === L.M_JUGGERNAUT) return o.points * 65536 + o.kills;
  return o.kills * 65536 - o.deaths;
}
const MEDALS = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'OVERKILL', 'KILLTACULAR', 'KILLTROCITY', 'KILLAMANJARO'];
const SPREES = { 5: 'KILLING SPREE', 10: 'KILLING FRENZY', 15: 'RUNNING RIOT', 20: 'RAMPAGE' };

export async function mount(host, { canvas, lockTarget = canvas, bot: BOT = false, skill = 0.7, sens: SENS = 3, fixed: FIXED = null, present = true, showGraph: graphOn = false, external = false } = {}) {
  // (the host is `host` here: `h` is the match's state, as in the frame below)
  const { u8, i32, u32, f32, f64, view, pview, set, get, press, sound, memory, hashes, keys } = host;
  const WATCH = host.watch || !!FIXED;
  const W = canvas.width, H = canvas.height;
  const renderer = host.renderers.get('arena') || await createRenderer(canvas, { present, device: host.device });
  host.renderers.set('arena', renderer);
  const { on, off } = listeners();
  const epoch = () => performance.timeOrigin + performance.now();

  // ---- input
  let yaw = get(L.CL_YAW), pitch = 512;
  let slotOut = 0;
  let zoomed = false;
  let trigger = false;
  const held = new Set();
  const MOVES = { KeyW: 1, ArrowUp: 1, KeyS: 2, ArrowDown: 2, KeyA: 4, ArrowLeft: 4, KeyD: 8, ArrowRight: 8, Space: 16 };
  const writeKeys = () => { let m = 0; for (const k of held) m |= MOVES[k] || 0; set(L.CL_MOVE, m); };
  const aim = () => { set(L.CL_YAW, Math.round(yaw) & 0x3fff); set(L.CL_PITCH, Math.round(pitch)); };
  const swap = (s) => { if (s !== slotOut) { sound.weapon(); zoomed = false; } slotOut = s; set(L.CL_WEAPON, s); };
  let locked = document.pointerLockElement === lockTarget;
  let watched = -1;
  let showGraph = graphOn;
  let bot = null;
  const nextLive = (from, step) => {
    for (let k = 1; k <= L.NPLAYER; k++) {
      const p = (((from + step * k) % L.NPLAYER) + L.NPLAYER) % L.NPLAYER;
      if (view.player(p).live) return p;
    }
    return -1;
  };
  if (WATCH) {
    const turn = (step) => { watched = nextLive(watched, step); };
    on(canvas, 'click', () => turn(1));
    on(document, 'keydown', (e) => {
      if (e.code === 'ArrowRight' || e.code === 'Space') turn(1);
      if (e.code === 'ArrowLeft') turn(-1);
      if (e.code === 'Tab') { e.preventDefault(); held.add('Tab'); }
      if (e.code === 'KeyN' && !e.repeat) showGraph = !showGraph;
    });
    on(document, 'keyup', (e) => held.delete(e.code));
  } else if (BOT) {
    if (!external) bot = new Fighter(0, (Math.random() * 1e9) | 0, skill);
    on(document, 'keydown', (e) => {
      if (e.code === 'Tab') { e.preventDefault(); held.add('Tab'); }
      if (e.code === 'KeyN' && !e.repeat) showGraph = !showGraph;
    });
    on(document, 'keyup', (e) => held.delete(e.code));
  } else {
    on(canvas, 'click', () => {
      sound.wake();
      if (!locked) lockTarget.requestPointerLock({ unadjustedMovement: true }).catch(() => lockTarget.requestPointerLock());
    });
    on(document, 'pointerlockchange', () => {
      locked = document.pointerLockElement === lockTarget;
      if (!locked) { held.clear(); writeKeys(); trigger = false; set(L.CL_AUTO, 0); }
    });
    const look = (e) => {
      if (!locked) return;
      const s = SENS / (zoomed ? zoomOf() : 1);
      yaw += e.movementX * s;
      pitch = Math.max(16, Math.min(1008, pitch - e.movementY * s / 8));
      aim();
    };
    on(document, 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove', look);
    on(document, 'mousedown', (e) => {
      if (!locked) return;
      if (e.button === 0) { press(L.CL_PRESSES); trigger = true; }
      if (e.button === 2) { if (zoomOf() > 1) { zoomed = !zoomed; sound.weapon(); } }
    });
    on(document, 'mouseup', (e) => { if (e.button === 0) { trigger = false; set(L.CL_AUTO, 0); } });
    on(document, 'contextmenu', (e) => e.preventDefault());
    on(document, 'wheel', (e) => { if (locked && e.deltaY) swap(slotOut ^ 1); });
    on(document, 'keydown', (e) => {
      if (e.code === 'Digit1') swap(0);
      else if (e.code === 'Digit2') swap(1);
      else if ((e.code === 'KeyX' || e.code === 'KeyY') && !e.repeat) swap(slotOut ^ 1);
      else if ((e.code === 'KeyQ' || e.code === 'KeyV') && !e.repeat) { press(L.CL_MELEE); zoomed = false; }
      else if (e.code === 'KeyG' && !e.repeat) { press(L.CL_GREN); zoomed = false; }
      else if (e.code === 'KeyR' && !e.repeat) { press(L.CL_RELOAD); zoomed = false; }
      else if (e.code === 'KeyE' && !e.repeat) press(L.CL_USE);
      else if (e.code === 'KeyN' && !e.repeat) showGraph = !showGraph;
      else if (e.code === 'KeyF' && !e.repeat) {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().then(() => navigator.keyboard?.lock?.()).catch(() => {});
      }
      if (MOVES[e.code] || e.code === 'Tab') e.preventDefault();
      held.add(e.code);
      writeKeys();
    });
    on(document, 'keyup', (e) => { held.delete(e.code); writeKeys(); });
    on(window, 'blur', () => { held.clear(); writeKeys(); trigger = false; set(L.CL_AUTO, 0); });
  }

  // ---- the prediction (as golf's), with the arena's word in progress
  const live = () => {
    const sent = get(L.CL_SENT), mv = get(L.CL_MOVE);
    const room = get(L.CL_ROOM), next = get(L.CL_NEXT);
    const ahead = (a, s) => ((get(a) - get(s)) > 0 ? get(s) + 1 : get(s)) & 1;
    return arenaWord({ yaw: get(L.CL_YAW), pitch: get(L.CL_PITCH), move: mv & 15, jump: (mv >> 4) & 1,
      shot: (get(L.CL_PRESSES) - sent) > 0 || get(L.CL_AUTO) ? sent + 1 : sent, melee: ahead(L.CL_MELEE, L.CL_MSENT), gren: ahead(L.CL_GREN, L.CL_GSENT),
      slot: get(L.CL_WEAPON), serial: (get(L.CL_FRAME) >> ((next - room) & 7)) & 1 });
  };
  const corr = corrector(host);

  // ---- what happened: FX into flashes, tracers, the feed and sounds
  const text = new Uint32Array(COLS * renderer.rows);
  const netGraph = new NetGraph(memory, { watch: WATCH });
  const glows = []; // { pos, size, color, kind, born, life, grow }
  const tracers = []; // { a, b, width, color, born, life }
  const feed = []; // { text, color, born }
  let banner = { text: '', until: 0, color: C.YELLOW };
  let medal = { text: '', until: 0 };
  let marker = 0, hurt = 0, kick = 0, lastShotAt = -1e9, meleeAt = -1e9, swapAt = -1e9, lastSlot = 0, lastWeapon = 0;
  let dealt = false;
  let fxSeen = 0, seed = -1, spawnedAt = -1, lastKill = -1e9, multi = 0, spree = 0, matchSeen = -1;
  const played = {}; // kind -> newest of my shot numbers played
  const newer = (a, b) => { const d = (a - b) & 0xffff; return d > 0 && d < 0x8000; };
  const lastShots = new Map(); // slot -> [shots, when], for the motion tracker
  let frames = 0, fpsAt = performance.now(), fps = 0, lastFrame = performance.now();
  let me = null, pme = null;
  const muzzle = (cam, cy, sy, cp, sp) => [cam[0] + cy * cp * 0.7 - sy * 0.22, cam[1] + sp * 0.7 - 0.22, cam[2] + sy * cp * 0.7 + cy * 0.22];

  const say = (text, color, now) => { feed.push({ text, color, born: now }); if (feed.length > 5) feed.shift(); };
  function show(f, slot, cam, now, mine, eyeOf) {
    const d = Math.hypot(f.pos[0] - cam[0], f.pos[1] - cam[1], f.pos[2] - cam[2]);
    switch (f.kind) {
      case L.FX_SHOT:
        if (mine) { kick = 1; lastShotAt = now; }
        else glows.push({ pos: eyeOf(f.owner), size: 0.35, color: [...(COLOR[f.size] || [1, 1, 1]), 1], kind: 3, born: now, life: 60 });
        sound.gun(f.size, mine ? 0 : d);
        break;
      case L.FX_TRACER: {
        const w = f.size;
        const a = mine ? muzzle(cam, Math.cos(camYaw), Math.sin(camYaw), Math.cos(camPitch), Math.sin(camPitch)) : eyeOf(f.owner);
        const sniper = w === L.W_SNIPER;
        tracers.push({ a, b: f.pos, width: sniper ? 0.06 : 0.025, color: [...(COLOR[w] || [1, 1, 1]), sniper ? 0.9 : 0.7], born: now, life: sniper ? 500 : 70 });
        if (!mine || d < 80) glows.push({ pos: f.pos, size: 0.15, color: [1, 0.9, 0.6, 0.8], kind: 5, born: now, life: 120 });
        break;
      }
      case L.FX_HIT: {
        const shield = f.size === 1;
        glows.push({ pos: f.pos, size: shield ? 0.9 : 0.35, color: shield ? [0.5, 0.75, 1, 0.9] : [0.9, 0.1, 0.1, 0.9], kind: shield ? 6 : 5, born: now, life: shield ? 220 : 160 });
        if (f.owner === slot && slot >= 0) { marker = 1; sound.hit(f.size === 3); }
        if (f.shot === slot && f.owner !== slot) { hurt = Math.min(1, hurt + 0.5); zoomed = false; sound.hurt(shield); }
        break;
      }
      case L.FX_KILL: {
        const name = (p) => (p === slot ? 'YOU' : `P${p + 1}`);
        const md = view.mode();
        // a flag's or the skull's carrier swung it
        const cause = f.size === L.KILL_CARRY ? (AMC[md.mode]?.carry === 'skull' ? 'SKULL' : 'FLAG') : SHORT[f.size] || '?';
        const infected = md.mode === L.M_INFECTION && f.owner !== f.shot && view.fighter(f.owner).zombie;
        // a team mode's lines in the killer's side's colour, but for your own
        const other = md.teamed && f.owner < L.NPLAYER ? SIDE_C[sideOf(view, f.owner)] : C.WHITE;
        if (!infected) say(f.owner === f.shot ? `${name(f.shot)} DIED` : `${name(f.owner)} [${cause}] ${name(f.shot)}`, f.owner === slot ? C.GREEN : f.shot === slot ? C.RED : other, now);
        glows.push({ pos: [f.pos[0], f.pos[1] + 1, f.pos[2]], size: 1.4, color: [1, 0.3, 0.2, 0.8], kind: 3, born: now, life: 400 });
        if (f.owner === slot && f.shot !== slot) {
          multi = now - lastKill < 4500 ? multi + 1 : 1;
          lastKill = now;
          spree++;
          sound.kill();
          const m = SPREES[spree] || MEDALS[Math.min(multi, MEDALS.length - 1)] || (f.size === L.KILL_BEHIND ? 'ASSASSINATION' : f.size === L.KILL_SUPER ? 'NEEDLER SUPERCOMBINE' : '');
          if (m) medal = { text: m, until: now + 2500 };
          banner = { text: `YOU ${infected ? 'INFECTED' : 'KILLED'} P${f.shot + 1}`, until: now + 1800, color: C.GREEN };
        }
        if (f.shot === slot) { spree = 0; multi = 0; banner = { text: f.owner === slot ? 'YOU DIED' : `${infected ? 'INFECTED' : 'KILLED'} BY P${f.owner + 1}`, until: now + 3000, color: C.RED }; }
        break;
      }
      case L.FX_MODE: {
        // the mode's news: sides changed, rungs climbed, a winner
        const name = (p) => (p === slot ? 'YOU' : `P${p + 1}`);
        const own = f.owner === slot;
        const big = (text, color) => { if (own) banner = { text, until: now + 2500, color }; };
        // a team mode's own news, to its kit module
        const kit = newsOf(f.size);
        if (kit) {
          const team = (p) => (p < L.NPLAYER ? sideOf(view, p) : -1);
          kit.news(f, { slot, me, name, team, feed: (text, color) => say(text, color, now), banner: (text, color, ms = 2500) => { banner = { text, until: now + ms, color }; },
            glow: (g) => glows.push({ ...g, born: now, life: g.life ?? 400 }), sound, dist: d, C, now, view });
          break;
        }
        switch (f.size) {
          case L.MX_INFECT: say(f.owner === f.shot ? `${name(f.shot)} TURNED` : `${name(f.owner)} INFECTED ${name(f.shot)}`, C.GREEN, now); break;
          case L.MX_ZOMBIE: say(`${name(f.owner)} ${own ? 'ARE' : 'IS'} A ZOMBIE`, C.GREEN, now); big('YOU ARE A ZOMBIE', C.GREEN); break;
          case L.MX_LAST: say(`${name(f.owner)} ${own ? 'ARE' : 'IS'} THE LAST HUMAN`, C.YELLOW, now); big('LAST HUMAN STANDING', C.YELLOW); break;
          case L.MX_RUNG:
            if (f.shot === RUNGS - 1) say(`${name(f.owner)} ${own ? 'ARE' : 'IS'} ON THE SWORD`, C.ORANGE, now);
            big(f.shot === RUNGS - 1 ? 'ON THE SWORD: ONE KILL TO WIN' : `RUNG ${f.shot + 1} OF ${RUNGS}: ${ARMS[L.LADDER[f.shot]].name}`, C.CYAN);
            break;
          case L.MX_DEMOTE: say(`${name(f.owner)} DOWN TO ${SHORT[L.LADDER[f.shot]]}`, C.RED, now); big(`DOWN TO RUNG ${f.shot + 1}`, C.RED); break;
          case L.MX_WIN: say(`${name(f.owner)} ${own ? 'WIN' : 'WINS'}`, C.YELLOW, now); break;
          case L.MX_JUGG: say(`${name(f.owner)} ${own ? 'ARE' : 'IS'} THE JUGGERNAUT`, C.ORANGE, now); big('YOU ARE THE JUGGERNAUT', C.ORANGE); break;
          case L.MX_TEAMWIN: {
            // a team match is over: shot 1 red won, 2 blue, 3 a draw
            const won = f.shot === 1 || f.shot === 2 ? f.shot - 1 : -1;
            const text = won < 0 ? 'A DRAW' : `${SIDE[won]} WINS`;
            say(text, won < 0 ? C.YELLOW : SIDE_C[won], now);
            banner = { text, until: now + 4000, color: won < 0 ? C.YELLOW : SIDE_C[won] };
            sound.holed();
            break;
          }
          default:
        }
        break;
      }
      case L.FX_BLAST:
        glows.push({ pos: f.pos, size: f.size < 1 ? 0.6 : f.size, color: f.size < 1 ? [0.4, 0.8, 1, 1] : [1, 0.6, 0.2, 1], kind: 3, born: now, life: 500, grow: true });
        if (f.size >= 1) sound.blast(d, f.size);
        break;
      case L.FX_SPAWN:
        glows.push({ pos: [f.pos[0], f.pos[1] + 1, f.pos[2]], size: 1.2, color: [0.4, 0.7, 1, 0.8], kind: 6, born: now, life: 500 });
        if (f.owner === slot) { spawnedAt = now; spree = 0; if (L.FIESTA || view.mode().mode) dealt = true; }
        break;
      case L.FX_PICKUP:
        if (f.owner === slot && ARMS[f.size]) { sound.pickup(); banner = { text: ARMS[f.size].name, until: now + 1500, color: C.CYAN }; }
        break;
      case L.FX_TELE:
        glows.push({ pos: [f.pos[0], f.pos[1] + 1, f.pos[2]], size: 1.6, color: [0.4, 0.9, 1, 0.9], kind: 6, born: now, life: 450 });
        sound.sink(f.owner === slot ? 0 : d);
        break;
      case L.FX_MELEE:
        if (mine) meleeAt = now;
        // a carrier's swing (size 2): a flash where it struck
        else if (f.size === 2) glows.push({ pos: f.pos, size: 0.7, color: [1, 1, 0.85, 0.8], kind: 5, born: now, life: 160 });
        sound.melee(mine ? 0 : d);
        break;
      default:
    }
  }

  let camYaw = 0, camPitch = 0;
  function zoomOf() {
    const f = pme || me;
    if (!f || f.carry) return 1;
    return ARMS[f.weapon]?.zoom || 1;
  }

  // What a carrier holds in place of a gun, as rectangles at 320x200: the flag
  // (in the colour of the side it was taken from) on its pole over the
  // shoulder, or the skull held out. It bobs and lunges as a gun would.
  function carryRects(kind, color, now, moving) {
    const out = [];
    const s = W / 320;
    const t = now / 1000;
    const bob = moving ? Math.sin(t * 9) * 2.5 : Math.sin(t * 1.5) * 0.8;
    const drop = Math.max(0, 1 - (now - swapAt) / 350) * 60 + (pme?.dead ? 200 : 0);
    const lunge = Math.max(0, 1 - (now - meleeAt) / 250);
    const ox = bob - lunge * 46, oy = Math.abs(bob) + drop - lunge * 14;
    const rect = (x0, y0, x1, y1, c, a = 1) => out.push([(x0 + ox) * s, (y0 + oy) * s, (x1 + ox) * s, (y1 + oy) * s, c[0], c[1], c[2], a]);
    if (kind === 'skull') {
      const bone = [0.92, 0.89, 0.8], dark = [0.1, 0.08, 0.08];
      rect(238, 136, 290, 178, bone); rect(232, 146, 296, 170, bone); rect(246, 176, 282, 194, bone);
      rect(244, 152, 258, 164, dark); rect(270, 152, 284, 164, dark); rect(262, 168, 266, 176, dark);
      for (let k = 0; k < 4; k++) rect(250 + k * 8, 184, 252 + k * 8, 192, [0.5, 0.48, 0.42]);
      rect(250, 196, 300, 214, [0.55, 0.42, 0.32]);
    } else {
      // the pole up from the bottom right, the cloth hanging off its top in folds
      for (let k = 0; k < 14; k++) { const y = 214 - k * 8, x = 296 - k * 2.2; rect(x - 2.5, y - 8, x + 2.5, y, [0.78, 0.78, 0.74]); }
      const top = [266, 100];
      for (let k = 0; k < 9; k++) {
        const x = top[0] - k * 6, wave = Math.sin(t * 6 - k * 0.8) * 2.5;
        const shade = 0.75 + 0.25 * Math.sin(t * 6 - k * 0.8 + 1.2);
        rect(x - 6, top[1] + wave, x, top[1] + 30 + wave - k * 0.6, color.map((v) => v * shade));
      }
      rect(top[0] - 3, top[1] - 6, top[0] + 3, top[1], [1, 0.82, 0.3]);
    }
    return out;
  }

  // The gun in your hands as rectangles, at 320x200, pointing at the centre.
  function gunRects(w, now, moving) {
    const out = [];
    const s = W / 320;
    const t = now / 1000;
    const bob = moving ? Math.sin(t * 9) * 2.5 : Math.sin(t * 1.5) * 0.8;
    const drop = Math.max(0, 1 - (now - swapAt) / 350) * 60 + (pme?.reload ? 26 : 0) + (pme?.dead ? 200 : 0);
    const lunge = Math.max(0, 1 - (now - meleeAt) / 250);
    const k = kick * (w === L.W_SNIPER || w === L.W_ROCKET || w === L.W_SHOTGUN ? 2.2 : 1);
    const ox = bob + k * 5 - lunge * 40 - 16, oy = Math.abs(bob) + k * 7 + drop - lunge * 10 - 8;
    const rect = (x0, y0, x1, y1, c, a = 1) => out.push([(x0 + ox) * s, (y0 + oy) * s, (x1 + ox) * s, (y1 + oy) * s, c[0], c[1], c[2], a]);
    // a thick line from (x0, y0) to (x1, y1) as a stair of rects
    const bar = (x0, y0, x1, y1, wd, c) => {
      const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4));
      for (let i = 0; i < n; i++) {
        const x = x0 + (x1 - x0) * (i + 0.5) / n, y = y0 + (y1 - y0) * (i + 0.5) / n;
        const shade = 0.8 + 0.25 * (i / n);
        rect(x - wd / 2, y - wd / 2, x + wd / 2, y + wd / 2, c.map((v) => v * shade));
      }
    };
    const flash = now - lastShotAt < 50 && w !== L.W_SWORD;
    let tip = [205, 142];
    switch (w) {
      case L.W_AR:
        bar(305, 210, 232, 158, 24, [0.3, 0.33, 0.28]); bar(236, 160, 205, 142, 9, [0.15, 0.16, 0.15]);
        rect(262, 166, 274, 172, [0.3, 0.9, 1]); bar(268, 186, 262, 205, 9, [0.2, 0.22, 0.2]);
        break;
      case L.W_BR:
        bar(305, 210, 230, 158, 22, [0.42, 0.44, 0.46]); bar(232, 159, 200, 140, 8, [0.2, 0.2, 0.22]); bar(270, 168, 238, 150, 8, [0.12, 0.12, 0.14]);
        tip = [200, 140];
        break;
      case L.W_MAGNUM:
        bar(300, 212, 252, 172, 18, [0.72, 0.74, 0.78]); bar(255, 174, 228, 156, 9, [0.55, 0.57, 0.6]); bar(290, 200, 296, 215, 12, [0.25, 0.22, 0.2]);
        tip = [228, 156];
        break;
      case L.W_SNIPER:
        bar(310, 214, 236, 160, 20, [0.17, 0.19, 0.19]); bar(238, 161, 178, 126, 6, [0.1, 0.1, 0.1]); bar(282, 176, 240, 152, 11, [0.06, 0.06, 0.07]);
        tip = [178, 126];
        break;
      case L.W_SHOTGUN:
        bar(312, 214, 262, 180, 22, [0.38, 0.25, 0.15]); bar(265, 182, 206, 146, 12, [0.3, 0.3, 0.32]); bar(250, 178, 222, 160, 9, [0.22, 0.15, 0.1]);
        tip = [206, 146];
        break;
      case L.W_ROCKET:
        bar(330, 212, 224, 146, 36, [0.28, 0.33, 0.22]); bar(232, 151, 222, 145, 38, [0.15, 0.17, 0.12]); bar(300, 170, 270, 150, 8, [0.12, 0.12, 0.12]);
        tip = [222, 145];
        break;
      case L.W_PLASMA:
        bar(305, 210, 236, 166, 28, [0.42, 0.3, 0.62]); bar(244, 160, 214, 146, 5, [0.4, 0.85, 1]); bar(246, 174, 216, 156, 5, [0.4, 0.85, 1]);
        tip = [214, 151];
        break;
      case L.W_NEEDLER:
        bar(305, 210, 238, 166, 26, [0.38, 0.22, 0.45]);
        for (let i = 0; i < 6; i++) { const x = 290 - i * 9, y = 186 - i * 6; rect(x - 2, y - 12, x + 2, y - 2, [1, 0.45, 0.9]); }
        tip = [232, 160];
        break;
      case L.W_SWORD:
        bar(300, 214, 272, 186, 14, [0.3, 0.3, 0.33]); bar(270, 186, 222, 104, 6, [0.55, 0.95, 1]); bar(282, 190, 248, 100, 6, [0.55, 0.95, 1]);
        break;
      default:
        bar(300, 214, 262, 180, 16, [0.85, 0.7, 0.55]);
    }
    if (flash) { rect(tip[0] - 9, tip[1] - 7, tip[0] + 5, tip[1] + 5, w === L.W_PLASMA ? [0.5, 0.9, 1] : w === L.W_NEEDLER ? [1, 0.5, 0.9] : [1, 0.85, 0.4], 0.95); }
    return out;
  }

  function hudRects(f, now) {
    const out = [];
    const s = W / 320;
    const r = (x0, y0, x1, y1, c, a = 1) => out.push([x0 * s, y0 * s, x1 * s, y1 * s, c[0], c[1], c[2], a]);
    // shields over health, top centre under the clock
    const low = f.sh < 25 && !f.zombie && Math.floor(now / 150) % 2;
    const sh = Math.min(100, f.sh);
    r(109, 8, 211, 15, [0.05, 0.08, 0.12], 0.7);
    r(110, 9, 110 + sh, 14, low ? [1, 0.3, 0.2] : [0.35, 0.7, 1]);
    if (f.sh > 100) r(110, 9, 110 + Math.min(100, f.sh - 100), 14, [1, 0.72, 0.15]);
    if (f.shieldIn === 0 && f.sh < 100 && !f.zombie) r(110 + sh, 9, 111 + sh, 14, [1, 1, 1]);
    for (let k = 0; k < 8; k++) {
      const filled = f.hp > k * 12.5;
      r(110 + k * 12.6, 17, 110 + k * 12.6 + 11, 20, filled ? (f.hp < 35 ? [1, 0.3, 0.2] : [0.4, 0.9, 0.4]) : [0.15, 0.15, 0.15], 0.85);
    }
    // the motion tracker: enemies within 25 m that move or shoot; in a team mode your side too, still or not, in yellow (Halo's)
    const R = 26, cx = 32 * s, cy = (H / s - 32) * s;
    const fy = Math.cos(camYaw), fz = Math.sin(camYaw);
    const teamed = view.teamed();
    for (let p = 0; p < L.NPLAYER; p++) {
      const ally = view.ally(f.slot, p);
      if (p === f.slot || (ally && !teamed)) continue;
      const o = view.fighter(p);
      if (!o.live || o.dead) continue;
      const dx = o.pos[0] - f.pos[0], dz = o.pos[2] - f.pos[2];
      const dist = Math.hypot(dx, dz);
      const ls = lastShots.get(p);
      if (!ls || ls[0] !== o.shots) lastShots.set(p, [o.shots, now]);
      const loud = Math.hypot(o.vel[0], o.vel[2]) > 3 || now - (lastShots.get(p)?.[1] ?? -1e9) < 1500;
      if (dist > 25 || (!loud && !ally)) continue;
      const fwd = dx * fy + dz * fz, right = -dx * fz + dz * fy;
      const x = cx / s + right / 25 * R, y = cy / s - fwd / 25 * R;
      r(x - 1.5, y - 1.5, x + 1.5, y + 1.5, ally ? [1, 0.85, 0.25] : [1, 0.25, 0.2]);
    }
    return { rects: out, tracker: [cx, cy, R * s] };
  }

  // Is the crosshair over an enemy within the gun's range (a carrier's swing's 2.4 m)? For the red reticle.
  function onTarget(f, cam) {
    const arm = ARMS[f.weapon];
    if (!arm && !f.carry) return false;
    const range = f.carry ? 2.4 : arm.type === 0 ? arm.range : arm.type === 2 ? 5 : 60;
    const d = [Math.cos(camPitch) * Math.cos(camYaw), Math.sin(camPitch), Math.cos(camPitch) * Math.sin(camYaw)];
    for (let p = 0; p < L.NPLAYER; p++) {
      if (p === f.slot || view.ally(f.slot, p)) continue;
      const o = view.player(p);
      if (!o.live || u8[L.PLAYERS + p * L.PSIZE + L.P_FL] & L.PF_DEAD) continue;
      const c = [o.pos[0] - cam[0], o.pos[1] + 1 - cam[1], o.pos[2] - cam[2]];
      const t = c[0] * d[0] + c[1] * d[1] + c[2] * d[2];
      if (t < 0 || t > range) continue;
      const miss = Math.hypot(c[0] - d[0] * t, (c[1] - d[1] * t) * 0.6, c[2] - d[2] * t);
      if (miss < 0.6) return true;
    }
    return false;
  }

  let last = null;
  function frame(now, target) {
    frames++;
    if (now - fpsAt > 1000) { fps = frames; frames = 0; fpsAt = now; }
    const ms = Math.min(100, now - lastFrame);
    lastFrame = now;
    const nowE = epoch();
    const st = get(L.CL_STATE);
    const slot = get(L.CL_SLOT);
    const h = view.hole();
    if (st >= 1 && view.dv.getUint32(L.HDR_SEED, true) !== seed && host.welcome) {
      seed = view.dv.getUint32(L.HDR_SEED, true);
      renderer.setTerrain(u8);
      renderer.setMap(view.map());
    }
    const room = get(L.CL_ROOM);
    const dt = Math.max(0, Math.min(3, readClock(i32, f64, L.CL_PLAY, nowE) - room - h.tick)) * 0.008;
    me = slot >= 0 ? view.fighter(slot) : null;
    pme = null;
    let tgt = null;
    if (WATCH && st >= 1) {
      if (watched < 0 || !view.player(watched).live) watched = nextLive(watched, 1);
      tgt = watched >= 0 ? view.fighter(watched) : null;
    }
    // the bot drives the slots as the keys and mouse would
    if (external) { yaw = get(L.CL_YAW); pitch = get(L.CL_PITCH); swap(get(L.CL_WEAPON)); }
    if (bot && me?.live && st === 2) {
      // the brain plays the slot the welcome gave, not the 0 it was made with
      bot.slot = slot;
      const w = unpackArena(bot.think(view, h.tick, Math.round(readClock(i32, f64, L.CL_PRED, nowE) - readClock(i32, f64, L.CL_PLAY, nowE))));
      yaw = w.yaw; pitch = w.pitch;
      aim();
      set(L.CL_MOVE, w.move | (w.jump << 4));
      if (w.shot !== (bot.lastShot ?? w.shot)) press(L.CL_PRESSES);
      if (w.melee !== (bot.lastMelee ?? w.melee)) press(L.CL_MELEE);
      if (w.gren !== (bot.lastGren ?? w.gren)) press(L.CL_GREN);
      if (bot.wantUse) press(L.CL_USE);
      Object.assign(bot, { lastShot: w.shot, lastMelee: w.melee, lastGren: w.gren });
      swap(w.slot);
    }
    let dtPred = dt;
    if (me?.live && st === 2) {
      const n = predict(host, slot, live);
      if (n >= 0) {
        pme = pview.fighter(slot);
        dtPred = Math.max(-2.5, Math.min(1, readClock(i32, f64, L.CL_PRED, nowE) - room - pview.tick)) * 0.008;
        corr.update(n, ms);
        for (const k of [L.FX_SHOT, L.FX_TRACER, L.FX_MELEE, L.FX_BLAST]) if (played[k] === undefined) played[k] = me.shots;
      }
    }
    // automatics keep asking while the trigger is held
    // (a carrier's trigger swings, a press at a time)
    if (!BOT && !WATCH) set(L.CL_AUTO, trigger && locked && !(pme || me)?.carry && ARMS[(pme || me)?.weapon]?.auto ? 1 : 0);
    // a new life or a new match: look down the gulch
    if (me?.live && h.hole !== matchSeen) { matchSeen = h.hole; if (!BOT) { yaw = me.pos[0] < 512 ? 0 : TURN / 2; pitch = 512; aim(); } }
    const f = tgt || pme || me;
    if (dealt && me?.live && !me.dead) {
      dealt = false;
      const m = view.mode().mode;
      const arm = (w) => ARMS[w]?.name ?? '?';
      const text = me.zombie ? 'ZOMBIE: THE SWORD' : me.jugg ? 'JUGGERNAUT: THE SWORD' : m === L.M_GUNGAME ? `RUNG ${Math.min(me.rung + 1, RUNGS)} OF ${RUNGS}: ${arm(me.gun[0])}`
        : `${me.team >= 0 ? `${SIDE[me.team]}: ` : ''}${arm(me.gun[0])} + ${arm(me.gun[1])}`;
      if (banner.until < now + 500) banner = { text, until: now + 2500, color: me.zombie ? C.GREEN : me.team >= 0 ? SIDE_C[me.team] : C.CYAN };
    }
    if (pme && (pme.hand !== lastSlot || pme.weapon !== lastWeapon)) { swapAt = now; lastSlot = pme.hand; lastWeapon = pme.weapon; }
    let cam;
    if (pme) cam = [0, 1, 2].map((k) => pme.pos[k] + pme.vel[k] * dtPred + corr.off[k] + (k === 1 ? 1.6 : 0));
    else if (me?.live) cam = [me.pos[0] + me.vel[0] * dt, me.pos[1] + me.vel[1] * dt + 1.6, me.pos[2] + me.vel[2] * dt];
    else if (tgt) cam = [tgt.pos[0] + tgt.vel[0] * dt, tgt.pos[1] + tgt.vel[1] * dt + 1.6, tgt.pos[2] + tgt.vel[2] * dt];
    else cam = [512 - 140, view.height(372, 512) + 14, 512];
    camYaw = me?.live && !WATCH ? yaw / TURN * 2 * Math.PI : tgt ? tgt.yaw : 0;
    camPitch = me?.live && !WATCH ? (pitch - 512) / 1024 * Math.PI : tgt ? tgt.pitch : -0.15;
    // dead: the camera backs up and rises over where you fell, short of any wall or roof
    if (f?.dead) {
      const up = Math.min(1, (L.RESPAWN_TICKS - f.respawn) / 150);
      const back = [-Math.cos(camYaw) * 5 * up, 1 + 5 * up, -Math.sin(camYaw) * 5 * up];
      const t = Math.max(0, boxRay(view.map(), cam, back, 1.1) - 0.1);
      for (let k = 0; k < 3; k++) cam[k] += back[k] * Math.min(1, t);
      camPitch = -0.45;
    }
    if (FIXED) { cam = FIXED.slice(0, 3); camYaw = FIXED[3] / 180 * Math.PI; camPitch = FIXED[4] / 180 * Math.PI; }
    // never inside the ground
    cam[1] = Math.max(cam[1], view.height(cam[0], cam[2]) + 0.4);

    // FX: mine from the prediction first, then the confirmed ring
    const eyeOf = (p) => { const o = view.player(p); return [o.pos[0] + o.vel[0] * dt, o.pos[1] + 1.45, o.pos[2] + o.vel[2] * dt]; };
    const mineKinds = new Set([L.FX_SHOT, L.FX_TRACER, L.FX_MELEE, L.FX_BLAST]);
    const isMine = (x) => x.owner === slot && slot >= 0 && mineKinds.has(x.kind) && (x.kind !== L.FX_BLAST || x.shot !== 0);
    if (pme) {
      const best = {};
      for (let k = 0; k < pview.fxCount(); k++) {
        const x = pview.fx(k);
        if (isMine(x) && newer(x.shot, played[x.kind])) { show(x, slot, cam, now, true, eyeOf); best[x.kind] = newer(x.shot, best[x.kind] ?? played[x.kind]) ? x.shot : best[x.kind]; }
      }
      Object.assign(played, best);
    }
    const nfx = view.fxCount();
    if (nfx - fxSeen > L.FX_MAX) fxSeen = nfx - L.FX_MAX;
    for (; fxSeen < nfx; fxSeen++) {
      const x = view.fx(fxSeen);
      if (h.tick - x.tick > 60) continue;
      if (isMine(x)) { if (played[x.kind] !== undefined && !newer(x.shot, played[x.kind])) continue; played[x.kind] = x.shot; show(x, slot, cam, now, true, eyeOf); continue; }
      show(x, slot, cam, now, false, eyeOf);
    }
    kick *= Math.exp(-ms / 70);
    marker *= Math.exp(-ms / 120);
    hurt *= Math.exp(-ms / 400);

    // the team mode's objective: its sprites, glows and beams ahead of everything else's, its waypoints and zone
    const md = view.mode();
    const kit = AMC[md.mode];
    const out = { solid: [], glow: [], beams: [], markers: [], zone: null };
    const playT = h.state === L.H_PLAY ? (h.tick - h.start) * 0.008 + dt : 0;
    if (kit && st >= 1) kit.draw(view, { dt, dtPred, now, t: playT, slot, me, pme, cam, view, pview }, out);
    // sprites: the objective's, the pads' guns, then what glows
    const solid = out.solid;
    for (const p of view.pads()) {
      if (p.wait) continue;
      const c = COLOR[p.weapon];
      solid.push({ pos: [p.pos[0], p.pos[1] + 0.7 + 0.15 * Math.sin(now / 400 + p.k), p.pos[2]], size: 0.55, aspect: 0.8, color: [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8, 1], kind: 4, minpx: 2 });
    }
    const glow = out.glow;
    // the teleporters: a pulse over each pad, a fainter one where it comes out
    for (const [k, tp] of view.map().teleporters.entries()) {
      const pulse = 0.55 + 0.25 * Math.sin(now / 300 + k);
      glow.push({ pos: [tp.from[0], tp.from[1] + 1.1, tp.from[2]], size: tp.radius * 1.3, color: [0.35, 0.85, 1, pulse], kind: 6, minpx: 1 });
      glow.push({ pos: [tp.from[0], tp.from[1] + 0.15, tp.from[2]], size: tp.radius, color: [0.5, 0.9, 1, pulse * 0.7], kind: 3, minpx: 1 });
      glow.push({ pos: [tp.to[0], tp.to[1] + 0.15, tp.to[2]], size: 0.8, color: [0.5, 0.9, 1, 0.25], kind: 3, minpx: 1 });
    }
    for (let k = glows.length - 1; k >= 0; k--) {
      const g = glows[k];
      const a = (now - g.born) / g.life;
      if (a >= 1) { glows.splice(k, 1); continue; }
      const grow = g.grow ? 0.35 + 0.65 * Math.min(1, a / 0.4) : 1;
      glow.push({ pos: g.pos, size: g.size * grow, color: [g.color[0], g.color[1], g.color[2], (g.color[3] ?? 1) * (1 - a)], kind: g.kind, minpx: 1 });
    }
    const beams = out.beams;
    for (let k = tracers.length - 1; k >= 0; k--) {
      const t = tracers[k];
      const a = (now - t.born) / t.life;
      if (a >= 1) { tracers.splice(k, 1); continue; }
      beams.push({ a: t.a, b: t.b, width: t.width, color: [t.color[0], t.color[1], t.color[2], t.color[3] * (1 - a)] });
    }
    let rects = [], tracker = null;
    const playing = st === 2 && f?.live;
    if (playing) {
      const moving = Math.hypot(f.vel[0], f.vel[2]) > 1 && f.ground;
      // a carrier's hands hold the flag or the skull (a flag in the colour of the side it was taken from)
      if (!WATCH && !f.dead) rects = f.carry ? carryRects(kit?.carry, SIDE_RGB[f.team === 0 ? 1 : 0], now, moving) : gunRects(f.weapon, now, moving);
      if (!f.dead) { const hr = hudRects(f, now); rects.push(...hr.rects); tracker = hr.tracker; }
    }
    const zoom = zoomed && f && !f.dead ? zoomOf() : 1;
    const kitRects = [];
    hudText(text, { h, f, slot: tgt ? watched : slot, st, now, fps, md, kit, kitRects, playT });
    rects.push(...kitRects);
    // the objective's waypoints over everything, through walls, with the camera as it is drawn (not over the board)
    if (out.markers.length && st === 2 && !(h.state === L.H_OVER || (held.has('Tab') && h.live))) {
      const mr = markerRects(out.markers, { cam, yaw: camYaw, pitch: camPitch, zoom }, f);
      rects = rects.slice(0, Math.max(0, MAX_RECT - mr.length)).concat(mr);
    }
    // a fixed camera is for looking at the map: no HUD
    if (FIXED) { rects = []; tracker = null; text.fill(0); }
    netGraph.sample(now, hashes, keys);
    const graph = showGraph && st > 0 ? netGraph.build((x, y, s, c) => put(text, COLS, x, y, s, c), C) : null;
    const spread = ARMS[f?.weapon]?.spread || 0;
    last = {
      cam, yaw: camYaw, pitch: camPitch, zoom, time: now / 1000, dt, dtPred, proj: pme ? L.PROJ + L.PRED_D : L.PROJ, slot: tgt ? watched : slot < 0 ? 999 : slot,
      solid, glow, beams, rects, tracker, text, graph, marker, hurt, scope: zoom >= 4, sides: md.teamed ? 2 : ((1 << md.mode) & L.TEAM_MODES) !== 0 ? 1 : 0, zone: out.zone,
      crosshair: FIXED ? 7 : (f?.carry ? 5 : CROSS[f?.weapon] ?? 0) + (playing && !f.dead && onTarget(f, cam) ? 8 : 0), gap: spread / 30 + kick * 3,
    };
    renderer.frame(u8, last, target);
  }

  // Waypoints as HUD rects and text: a mark in its colour where the point lands
  // (pulled in to the screen's edge when it's off it or behind), its label
  // above and the distance in metres below, in text cells (4 x 6 px).
  function markerRects(markers, cv, f) {
    const out = [];
    const s = W / 320;
    const rows = renderer.rows;
    for (const m of markers) {
      const [px, py, depth] = project(cv, W, H, m.pos);
      let x = px, y = py;
      // behind the eye (or level with it): the edge on the side it's on, halfway down
      if (depth < 0.3) { x = px < W / 2 ? 0 : W - 1; y = H / 2; }
      x = Math.max(8 * s, Math.min(W - 8 * s, x));
      // kept below the score bar (its label two rows up clear of rows 4 and 5) and above the bottom lines
      y = Math.max(48 * s, Math.min(H - 40 * s, y));
      // on the left, its label and distance kept above the kill feed (rows - 16 to rows - 12)
      if (x < 128 && Math.round(y / 6) + 1 >= rows - 16) y = (rows - 18) * 6;
      const c = PALETTE[m.color ?? C.WHITE] || PALETTE[0];
      const r = (x0, y0, x1, y1, col = c, a = 0.95) => out.push([x + x0 * s, y + y0 * s, x + x1 * s, y + y1 * s, col[0], col[1], col[2], a]);
      // a diamond (a flag's pennant, a skull's dot, a hill's ring by kind)
      if (m.kind === 'flag') { r(-0.5, -6, 0.5, 2); r(0.5, -6, 5, -2.5); }
      else if (m.kind === 'hill') { r(-4, -1, 4, 1); r(-3, -3, 3, -1, c, 0.5); r(-3, 1, 3, 3, c, 0.5); }
      else if (m.kind === 'skull') { r(-3, -4, 3, 1); r(-2, 1, 2, 3); r(-2, -2, -0.5, -0.5, [0, 0, 0]); r(0.5, -2, 2, -0.5, [0, 0, 0]); }
      else { r(-1, -4, 1, 4); r(-2.5, -2.5, 2.5, 2.5, c, 0.8); r(-4, -1, 4, 1); }
      const dist = f ? Math.round(Math.hypot(m.pos[0] - f.pos[0], m.pos[1] - f.pos[1], m.pos[2] - f.pos[2])) : 0;
      const col = Math.round(x / 4), row = Math.round(y / 6);
      const label = String(m.label ?? '');
      if (label) put(text, COLS, Math.max(0, Math.min(COLS - label.length, col - (label.length >> 1))), Math.max(0, row - 2), label, m.color ?? C.WHITE);
      const ds = `${dist}M`;
      if (f) put(text, COLS, Math.max(0, Math.min(COLS - ds.length, col - (ds.length >> 1))), Math.min(rows - 1, row + 1), ds, C.WHITE);
    }
    return out;
  }

  function hudText(t, { h, f, slot, st, now, fps, md = view.mode(), kit = AMC[md.mode], kitRects = [], playT = 0 }) {
    t.fill(0);
    const rows = renderer.rows;
    const right = (y, s, c) => put(t, COLS, COLS - 1 - String(s).length, y, s, c);
    const centre = (y, s, c) => put(t, COLS, Math.floor((COLS - String(s).length) / 2), y, s, c);
    if (st !== 2 || (!f?.live && !WATCH)) centre(Math.floor(rows / 2) - 3, host.error ? 'ERROR: ' + host.error.slice(0, 64) : ['CONNECTING', 'CATCHING UP', '', 'DISCONNECTED'][st] || 'JOINING', host.error ? C.RED : C.YELLOW);
    const m = md.mode;
    const list = [];
    for (let p = 0; p < L.NPLAYER; p++) { const o = view.fighter(p); if (o.live) list.push(o); }
    // the board's order: Fiesta's kills, a mode's standing in play, its places once it's over
    if (m && h.state === L.H_OVER) list.sort((a, b) => (a.place || 999) - (b.place || 999) || a.slot - b.slot);
    else list.sort((a, b) => standing(m, b, md.teamWin) - standing(m, a, md.teamWin) || a.slot - b.slot);
    const clock = (n) => `${Math.floor(n / 125 / 60)}:${String(Math.floor(n / 125) % 60).padStart(2, '0')}`;
    const left = Math.max(0, h.until - h.tick);
    // your side: the fighter shown's (a spectator's, the one watched)
    const team = md.teamed && f?.live ? f.team : -1;
    if (h.state === L.H_COUNT) {
      centre(4, `${md.name}  STARTS IN ${Math.ceil(left / 125)}`, C.YELLOW); centre(5, md.rules, C.WHITE);
      if (team >= 0) centre(7, `${WATCH ? `P${slot + 1} IS` : 'YOU ARE'} ON ${SIDE[team]}`, SIDE_C[team]);
    }
    if (h.state === L.H_PLAY) centre(0, clock(left), left < 30 * 125 ? C.RED : C.WHITE);
    const who = WATCH ? 'P' + (slot + 1) : 'YOU';
    const board = h.state === L.H_OVER || (held.has('Tab') && h.live);
    // the team score bar under the shields: RED 12  50  9 BLUE over two bars meeting in the middle, your side's framed
    if (md.teamed && h.state === L.H_PLAY && !board) {
      const [rs, bs] = md.score;
      const line = `${SIDE[0]} ${rs}  ${md.target || ''}  ${bs} ${SIDE[1]}`;
      const x0 = Math.floor((COLS - line.length) / 2);
      put(t, COLS, x0, 4, `${SIDE[0]} ${rs}`, SIDE_C[0]);
      put(t, COLS, x0 + `${SIDE[0]} ${rs}  `.length, 4, String(md.target || ''), C.WHITE);
      put(t, COLS, x0 + line.length - `${bs} ${SIDE[1]}`.length, 4, `${bs} ${SIDE[1]}`, SIDE_C[1]);
      // in 320 x 200 units: red's bar grows left from x 159, blue's right from 161, full at the target
      const k = W / 320, full = 48;
      const fill = (n) => Math.min(1, md.target ? n / md.target : 0) * full;
      const bar = (a, b, c, alpha = 1, grow = 0) => kitRects.push([(a - grow) * k, (31 - grow) * k, (b + grow) * k, (34 + grow) * k, c[0], c[1], c[2], alpha]);
      if (team >= 0) bar(team ? 161 : 159 - full, team ? 161 + full : 159, [1, 1, 1], 0.8, 1);
      bar(159 - full, 159, [0.06, 0.06, 0.08], 0.75); bar(161, 161 + full, [0.06, 0.06, 0.08], 0.75);
      bar(159 - fill(rs), 159, SIDE_RGB[0]); bar(161, 161 + fill(bs), SIDE_RGB[1]);
    }
    if (f?.live && md.teamed) {
      // your side and kills; the mode's own lines below them, from its kit module
      put(t, COLS, 1, 0, `${who}: ${SIDE[team] ?? ''}`, SIDE_C[team] ?? C.YELLOW);
      put(t, COLS, 1, 1, `${f.kills} KILL${f.kills === 1 ? '' : 'S'}  ${f.deaths} DEATH${f.deaths === 1 ? '' : 'S'}`, C.GREY);
      const s = W / 320;
      kit?.hud(view, { put: (x, y, str, c) => put(t, COLS, x, y, str, c), centre, right, rect: (x0, y0, x1, y1, r, g, b, a = 1) => kitRects.push([x0 * s, y0 * s, x1 * s, y1 * s, r, g, b, a]),
        rows, C, slot, me: f, team, now, t: playT });
    } else if (f?.live && m === L.M_INFECTION) {
      put(t, COLS, 1, 0, f.zombie ? `${who}: ZOMBIE  ${f.points} INFECTED` : `${who}: HUMAN`, f.zombie ? C.GREEN : C.YELLOW);
      if (h.state !== L.H_COUNT) put(t, COLS, 1, 1, `${md.humans} HUMAN${md.humans === 1 ? '' : 'S'} LEFT  ${md.zombies} ZOMBIE${md.zombies === 1 ? '' : 'S'}`, C.GREY);
    } else if (f?.live && m === L.M_GUNGAME) {
      const r = Math.min(f.rung, RUNGS - 1);
      put(t, COLS, 1, 0, `${who}: RUNG ${r + 1} OF ${RUNGS}  ${SHORT[L.LADDER[r]]}`, C.YELLOW);
      put(t, COLS, 1, 1, r + 1 < RUNGS ? `NEXT ${SHORT[L.LADDER[r + 1]]}` : 'A SWORD KILL WINS', C.GREY);
      const lead = md.leader >= 0 ? view.fighter(md.leader) : null;
      if (lead) put(t, COLS, 1, 2, lead.slot === f.slot ? 'IN THE LEAD' : `P${lead.slot + 1} LEADS ON ${Math.min(lead.rung + 1, RUNGS)}`, C.GREY);
    } else if (f?.live && m === L.M_JUGGERNAUT) {
      put(t, COLS, 1, 0, `${who} ${f.points} POINT${f.points === 1 ? '' : 'S'}${f.jugg ? '  JUGGERNAUT' : ''}`, f.jugg ? C.ORANGE : C.YELLOW);
      const j = md.leader >= 0 ? view.fighter(md.leader) : null;
      if (j && j.slot !== f.slot) put(t, COLS, 1, 1, `JUGGERNAUT P${j.slot + 1}  ${j.points} OF ${L.JUGG_POINTS}`, C.ORANGE);
    } else if (f?.live) {
      const leader = list[0];
      put(t, COLS, 1, 0, `${who} ${f.kills}`, C.YELLOW);
      if (leader && leader.slot !== f.slot) put(t, COLS, 1, 1, `P${leader.slot + 1} ${leader.kills}`, C.GREY);
      else if (list[1]) put(t, COLS, 1, 1, `P${list[1].slot + 1} ${list[1].kills}`, C.GREY);
    }
    if (f?.live) {
      if (f.dead) centre(Math.floor(rows / 2) + 2, `RESPAWN IN ${Math.ceil(f.respawn / 125)}`, C.YELLOW);
      else if (f.carry) {
        // a carrier has no guns or frags, only a swing that kills
        centre(rows - 3, `CARRYING THE ${kit?.carry === 'skull' ? 'SKULL' : 'FLAG'}`, C.YELLOW);
        centre(rows - 2, 'NO GUNS  CLICK OR Q SWINGS', C.WHITE);
      } else {
        const arm = ARMS[f.weapon];
        if (arm) {
          const ammo = arm.reload ? `${f.mag[f.hand]} / ${f.res[f.hand]}` : f.weapon === L.W_SWORD ? `${f.mag[f.hand] * 10}%` : `${f.mag[f.hand]}%`;
          right(rows - 3, arm.name, C.WHITE);
          right(rows - 2, f.reload ? 'RELOADING' : f.mag[f.hand] === 0 && f.res[f.hand] === 0 ? 'EMPTY' : ammo, f.mag[f.hand] === 0 ? C.RED : C.CYAN);
          // the other hand's gun, unless the mode put the same one in both
          const other = f.gun[f.hand ^ 1] !== f.weapon ? ARMS[f.gun[f.hand ^ 1]] : null;
          right(rows - 4, other ? `${f.hand ? 1 : 2} ${other.name}` : '', C.GREY);
        }
        if (!f.zombie && !f.jugg) right(rows - 5, `FRAGS ${f.grens}`, C.ORANGE);
        // a gun on the pad underfoot
        const pad = view.pads().find((p) => !p.wait && Math.hypot(p.pos[0] - f.pos[0], p.pos[2] - f.pos[2]) < 1.5);
        if (pad && !WATCH && !f.gun.includes(pad.weapon) && ARMS[pad.weapon]) centre(Math.floor(rows / 2) + 5, `E: PICK UP ${ARMS[pad.weapon].name}`, C.WHITE);
        if (f.mag[f.hand] === 0 && f.res[f.hand] > 0 && !f.reload) centre(Math.floor(rows / 2) + 3, 'R: RELOAD', C.RED);
      }
      // the feed, over the tracker
      feed.forEach((e, k) => { if (now - e.born < 6000) put(t, COLS, 1, rows - 12 - (feed.length - 1 - k), e.text, e.color); });
    }
    if (banner.until > now) centre(Math.floor(rows / 2) - 6, banner.text, banner.color);
    if (medal.until > now) centre(Math.floor(rows / 2) - 8, medal.text, C.ORANGE);
    if (st === 2 && !BOT && !WATCH && !locked) centre(Math.floor(rows / 2) + 7, 'CLICK TO PLAY', C.WHITE);
    // (a team mode's own lines have rows 2 to 4)
    if (WATCH && st === 2) put(t, COLS, 1, md.teamed ? 5 : 3, f?.live ? `WATCHING P${slot + 1}  < >` : 'NOBODY TO WATCH', C.CYAN);
    if (showGraph) put(t, COLS, 1, rows - 1, `${fps} FPS  LEAD ${f32[L.CL_LEAD >> 2].toFixed(1)}  DELAY ${f32[L.CL_DELAY >> 2].toFixed(1)}  LAG ${f?.lag ?? 0}  REPAIRS ${get(L.CL_REPAIRS)}`, C.GREY);
    if (board && md.teamed) teamBoard(t, { list, slot, md, kit, over: h.state === L.H_OVER, rows, centre });
    else if (board) {
      const y0 = 6;
      const top = list[0];
      const over = h.state === L.H_OVER;
      let title = `${md.name}  ${list.length} PLAYERS`;
      if (over) {
        const won = top ? (top.slot === slot ? 'YOU WIN' : `P${top.slot + 1} WINS`) : '';
        const alive = list.filter((o) => !o.zombie).length;
        title = m === L.M_INFECTION ? `GAME OVER  ${alive ? `${alive} HUMAN${alive === 1 ? '' : 'S'} SURVIVED` : 'THE ZOMBIES WIN'}` : `GAME OVER  ${won}`;
      }
      centre(y0, title, C.YELLOW);
      // a mode's columns: what places it
      const cols = m === L.M_INFECTION ? ['HUMAN FOR', 'INFECTED', 'SIDE'] : m === L.M_GUNGAME ? ['RUNG', 'GUN', 'KILLS'] : m === L.M_JUGGERNAUT ? ['POINTS', 'KILLS', 'DEATHS'] : ['KILLS', 'DEATHS'];
      const cells = (o) => m === L.M_INFECTION ? [o.zombie || over ? clock(o.human) : 'ALIVE', o.points, o.zombie ? 'ZOMBIE' : 'HUMAN']
        : m === L.M_GUNGAME ? [Math.min(o.rung + 1, RUNGS), o.rung >= RUNGS ? 'WON' : SHORT[L.LADDER[o.rung]], o.kills]
        : m === L.M_JUGGERNAUT ? [o.points, o.kills, o.deaths] : [o.kills, o.deaths];
      const row = (rank, name, xs) => `${String(rank).padStart(4)}  ${String(name).padEnd(8)}${xs.map((x, k) => '  ' + String(x).padStart(Math.max(6, cols[k].length))).join('')}`;
      centre(y0 + 2, row('RANK', 'PLAYER', cols), C.GREY);
      const fit = rows - y0 - 6;
      const mine = list.findIndex((o) => o.slot === slot);
      const shown = mine >= fit ? [...list.slice(0, fit - 1), list[mine]] : list.slice(0, fit);
      shown.forEach((o, k) => {
        // ties share a place: the sim's once it's over, else the first with that standing
        const rank = m && over && o.place ? o.place : list.findIndex((x) => standing(m, x) === standing(m, o)) + 1;
        const name = (o.slot === slot && !WATCH ? 'YOU ' : 'P') + String(o.slot + 1);
        centre(y0 + 3 + k, row(rank, name, cells(o)), o.slot === slot ? C.YELLOW : m === L.M_INFECTION && o.zombie ? C.GREEN : C.WHITE);
      });
    }
  }

  // A team mode's board (Tab, and once it's over): a header per side with its
  // score in its colour, its fighters under it by standing (you in yellow),
  // the kit module's columns and KILLS / DEATHS; the winner in the title.
  function teamBoard(t, { list, slot, md, kit, over, rows, centre }) {
    const y0 = 6;
    const [rs, bs] = md.score;
    const title = !over ? `${md.name}  ${SIDE[0]} ${rs}  ${SIDE[1]} ${bs}` : md.teamWin === 3 || (!md.teamWin && rs === bs) ? `GAME OVER  A DRAW ${rs} ALL`
      : `GAME OVER  ${SIDE[(md.teamWin || (rs > bs ? 1 : 2)) - 1]} WINS ${Math.max(rs, bs)} TO ${Math.min(rs, bs)}`;
    centre(y0, title, C.YELLOW);
    const cols = [...(kit?.cols || []), { head: 'KILLS', get: (o) => o.kills }, { head: 'DEATHS', get: (o) => o.deaths }];
    const row = (rank, name, xs) => `${String(rank).padStart(4)}  ${String(name).padEnd(8)}${xs.map((x, k) => '  ' + String(x).padStart(Math.max(6, cols[k].head.length))).join('')}`;
    centre(y0 + 2, row('RANK', 'PLAYER', cols.map((c) => c.head)), C.GREY);
    // as many rows as fit, shared out between the sides, yourself always in
    const sides = [0, 1].map((k) => list.filter((o) => o.team === k));
    const fit = rows - y0 - 8;
    const share = [0, 1].map((k) => Math.max(Math.floor(fit / 2), fit - sides[1 - k].length));
    let y = y0 + 3;
    for (const k of [0, 1]) {
      const all = sides[k];
      const n = Math.min(all.length, share[k]);
      const mine = all.findIndex((o) => o.slot === slot);
      const shown = mine >= n ? [...all.slice(0, Math.max(0, n - 1)), all[mine]] : all.slice(0, n);
      centre(y++, row(SIDE[k], md.score[k], cols.map(() => '')), SIDE_C[k]);
      for (const o of shown) {
        const rank = over && o.place ? o.place : list.findIndex((x) => standing(md.mode, x, md.teamWin) === standing(md.mode, o, md.teamWin)) + 1;
        const name = (o.slot === slot && !WATCH ? 'YOU ' : 'P') + String(o.slot + 1);
        centre(y++, row(rank, name, cols.map((c) => c.get(o))), o.slot === slot ? C.YELLOW : C.WHITE);
      }
      if (all.length > shown.length) centre(y++, `+${all.length - shown.length} MORE`, C.GREY);
    }
  }


  return {
    frame,
    unmount() { off(); held.clear(); set(L.CL_MOVE, 0); set(L.CL_AUTO, 0); if (document.pointerLockElement === lockTarget && lockTarget === canvas) document.exitPointerLock(); },
    capture: (scale = 2) => (last ? capturePng(renderer, u8, last, scale) : null),
    // for the gates: in a team mode, mode carries the scores, me its team and carry, and kit what the kit module shows them
    state: () => ({ slot: get(L.CL_SLOT), clState: get(L.CL_STATE), me, error: host.error, welcome: host.welcome, match: view.hole(), mode: view.mode(), feed: feed.map((f) => f.text),
      team: me?.team ?? -1, kit: AMC[view.mode().mode]?.state?.(view) ?? null }),
    get locked() { return locked; },
  };
}
