// Golf's frontend for Fireplace: the hole as client/main.mjs plays it (rockets
// and grenades as clubs, the camera through your eyes, a ball to sink), mounted
// on a host (client/host.mjs) while the room plays golf. main.mjs is still golf's
// own page, with the replays, the latency figures and the debug flip the runs
// use; this is only the playing and the watching.
//   opts: { canvas, lockTarget, bot (no keys or mouse: the page drives the slots), external (the camera follows the slots), sens, present }
import * as L from '../src/layout.mjs';
import { packInput } from '../net/wire.mjs';
import { createRenderer, COLS } from './render.mjs';
import { put, C } from './font.mjs';
import { readClock } from './clock.mjs';
import { epoch, predict, corrector, capturePng, listeners } from './host.mjs';

export async function mount(host, { canvas, lockTarget = canvas, bot: BOT = false, sens: SENS = 3, present = true, external = false } = {}) {
  const { u8, i32, f32, f64, view, pview, set, get, sound } = host;
  const WATCH = host.watch;
  const renderer = host.renderers.get('golf') || await createRenderer(canvas, { present, device: host.device });
  host.renderers.set('golf', renderer);
  const { on, off } = listeners();

  // input: yaw and pitch kept as floats for the camera, sampled as integers
  let yaw = get(L.CL_YAW), pitch = 512;
  let weapon = 0;
  set(L.CL_WEAPON, 0);
  const held = new Set();
  const MOVES = { KeyW: 1, ArrowUp: 1, KeyS: 2, ArrowDown: 2, KeyA: 4, ArrowLeft: 4, KeyD: 8, ArrowRight: 8, Space: 16 };
  const writeKeys = () => { let m = 0; for (const k of held) m |= MOVES[k] || 0; set(L.CL_MOVE, m); };
  const aim = () => { set(L.CL_YAW, Math.round(yaw) & 0x3fff); set(L.CL_PITCH, Math.round(pitch)); };
  const setWeapon = (w) => { if (w !== weapon) sound.weapon(); weapon = w; set(L.CL_WEAPON, w); };
  let locked = document.pointerLockElement === lockTarget;
  let watched = -1;
  const nextLive = (from, step) => {
    for (let k = 1; k <= L.NPLAYER; k++) {
      const p = (((from + step * k) % L.NPLAYER) + L.NPLAYER) % L.NPLAYER;
      if (view.player(p).live) return p;
    }
    return -1;
  };
  if (WATCH || BOT) {
    on(canvas, 'click', () => { watched = nextLive(watched, 1); });
    on(document, 'keydown', (e) => { if (e.code === 'Tab') { e.preventDefault(); held.add('Tab'); } });
    on(document, 'keyup', (e) => held.delete(e.code));
  } else {
    on(canvas, 'click', () => {
      sound.wake();
      if (!locked) lockTarget.requestPointerLock({ unadjustedMovement: true }).catch(() => lockTarget.requestPointerLock());
    });
    on(document, 'pointerlockchange', () => { locked = document.pointerLockElement === lockTarget; if (!locked) { held.clear(); writeKeys(); } });
    on(document, 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove', (e) => {
      if (!locked) return;
      yaw += e.movementX * SENS;
      pitch = Math.max(16, Math.min(1008, pitch - e.movementY * SENS / 8));
      aim();
    });
    on(document, 'mousedown', (e) => {
      if (!locked) return;
      if (e.button === 0) set(L.CL_PRESSES, get(L.CL_PRESSES) + 1);
      if (e.button === 2) setWeapon(weapon ^ 1);
    });
    on(document, 'contextmenu', (e) => e.preventDefault());
    on(document, 'wheel', (e) => { if (locked && e.deltaY) setWeapon(e.deltaY > 0 ? 1 : 0); });
    on(document, 'keydown', (e) => {
      if (e.code === 'Digit1') setWeapon(0);
      else if (e.code === 'Digit2') setWeapon(1);
      else if (e.code === 'KeyQ' && !e.repeat) setWeapon(weapon ^ 1);
      if (MOVES[e.code] || e.code === 'Tab') e.preventDefault();
      held.add(e.code);
      writeKeys();
    });
    on(document, 'keyup', (e) => { held.delete(e.code); writeKeys(); });
    on(window, 'blur', () => { held.clear(); writeKeys(); });
  }

  const text = new Uint32Array(COLS * renderer.rows);
  const flashes = [];
  let fxSeen = view.fxCount();
  let seed = -1;
  let faced = -1;
  let banner = { text: '', until: 0 };
  let cue = -1;
  let feet = { ground: true, vy: 0 };
  let lastFrame = performance.now();
  let me = null, pme = null;
  let last = null;
  const corr = corrector(host);
  const live = () => {
    const sent = get(L.CL_SENT);
    const mv = get(L.CL_MOVE);
    return packInput({ yaw: get(L.CL_YAW), pitch: get(L.CL_PITCH), move: mv & 15, jump: (mv >> 4) & 1, shot: (get(L.CL_PRESSES) - sent) > 0 ? sent + 1 : sent, weapon: get(L.CL_WEAPON) });
  };
  // your shots and blasts play once: from the prediction when it has them, else from the confirmed ring
  const played = { [L.FX_SHOT]: -1, [L.FX_BLAST]: -1 };
  const fresh = (f) => { const d = (f.shot - played[f.kind]) & 0xffff; return d > 0 && d < 0x8000; };

  function frame(now, target) {
    const ms = Math.min(100, now - lastFrame);
    lastFrame = now;
    const nowE = epoch();
    const st = get(L.CL_STATE);
    const slot = get(L.CL_SLOT);
    const h = view.hole();
    if (st >= 1 && view.dv.getUint32(L.HDR_SEED, true) !== seed && host.welcome) {
      seed = view.dv.getUint32(L.HDR_SEED, true);
      renderer.setTerrain(u8);
    }
    const room = get(L.CL_ROOM);
    const dt = Math.max(0, Math.min(3, readClock(i32, f64, L.CL_PLAY, nowE) - room - h.tick)) * 0.008;
    me = slot >= 0 ? view.player(slot) : null;
    pme = null;
    let tgt = null;
    if (external) { yaw = get(L.CL_YAW); pitch = get(L.CL_PITCH); }
    if (WATCH && st >= 1) {
      if (watched < 0 || !view.player(watched).live) watched = nextLive(watched, 1);
      tgt = watched >= 0 ? view.player(watched) : null;
    }
    let dtPred = dt;
    if (me?.live && st === 2) {
      const n = predict(host, slot, live);
      if (n >= 0) {
        pme = pview.player(slot);
        dtPred = Math.max(-2.5, Math.min(1, readClock(i32, f64, L.CL_PRED, nowE) - room - pview.tick)) * 0.008;
        corr.update(n, ms);
        if (played[L.FX_SHOT] < 0) played[L.FX_SHOT] = played[L.FX_BLAST] = me.shots;
      }
    }
    if (me?.live && faced !== h.hole && !external) {
      // face the cup on a new hole
      faced = h.hole;
      yaw = Math.atan2(h.dir[1], h.dir[0]) / (2 * Math.PI) * 16384;
      pitch = 512;
      aim();
    }
    let cam;
    if (pme) cam = [0, 1, 2].map((k) => pme.pos[k] + pme.vel[k] * dtPred + corr.off[k] + (k === 1 ? 1.6 : 0));
    else if (tgt) cam = [tgt.pos[0] + tgt.vel[0] * dt, tgt.pos[1] + tgt.vel[1] * dt + 1.6, tgt.pos[2] + tgt.vel[2] * dt];
    else if (me?.live) cam = [me.pos[0] + me.vel[0] * dt, me.pos[1] + me.vel[1] * dt + 1.6, me.pos[2] + me.vel[2] * dt];
    else cam = [h.tee[0] - h.dir[0] * 25, h.tee[1] + 12, h.tee[2] - h.dir[1] * 25];
    const eyes = pme ? null : tgt || me;
    const camYaw = pme ? yaw / 16384 * 2 * Math.PI : eyes ? (eyes.input & 0x3fff) / 16384 * 2 * Math.PI : Math.atan2(h.dir[1], h.dir[0]);
    const camPitch = pme ? (pitch - 512) / 1024 * Math.PI : eyes ? (((eyes.input >>> 14) & 0x3ff) - 512) / 1024 * Math.PI : -0.12;

    const show = (f) => {
      const d = Math.hypot(f.pos[0] - cam[0], f.pos[1] - cam[1], f.pos[2] - cam[2]);
      if (f.kind === L.FX_BLAST) { flashes.push({ pos: f.pos, born: now, size: f.size * 0.7, kind: 1 }); sound.blast(d, f.size); }
      if (f.kind === L.FX_SHOT && f.owner === slot) sound.shot(f.size);
      if (f.kind === L.FX_SINK) {
        flashes.push({ pos: [f.pos[0], f.pos[1] + 0.5, f.pos[2]], born: now, size: 2.5, kind: 2 });
        sound.sink(d);
        if (f.owner === slot) { banner = { text: `IN THE HOLE IN ${f.shot}`, until: now + 4000 }; sound.holed(); }
      }
    };
    const mine = (f) => f.owner === slot && (f.kind === L.FX_SHOT || f.kind === L.FX_BLAST);
    if (pme) {
      for (let k = 0; k < pview.fxCount(); k++) {
        const f = pview.fx(k);
        if (mine(f) && fresh(f)) { played[f.kind] = f.shot; show(f); }
      }
    }
    const nfx = view.fxCount();
    if (nfx - fxSeen > L.FX_MAX) fxSeen = nfx - L.FX_MAX;
    for (; fxSeen < nfx; fxSeen++) {
      const f = view.fx(fxSeen);
      if (h.tick - f.tick > 60) continue;
      if (mine(f)) { if (!fresh(f)) continue; played[f.kind] = f.shot; }
      show(f);
    }
    const secs = Math.ceil(Math.max(0, h.until - h.tick) / 125);
    const was = cue;
    cue = st === 2 ? h.state * 1000 + secs : -1;
    if (cue !== was && cue >= 0) {
      if (h.state === L.H_COUNT && secs > 0) sound.count(secs);
      else if (h.state === L.H_PLAY && Math.floor(was / 1000) === L.H_COUNT) sound.count(0);
      else if (h.state === L.H_PLAY && secs <= 10) sound.tick();
    }
    const inHole = st === 2 && (h.state === L.H_COUNT || h.state === L.H_PLAY);
    sound.music(inHole ? (view.dv.getUint32(L.HDR_SEED, true) ^ Math.imul(h.hole + 1, 0x9e3779b9)) >>> 0 : null, h.state === L.H_PLAY);
    if (pme) {
      if (feet.ground && !pme.ground && pme.vel[1] > 1 && (pme.input >>> 28) & 1) sound.jump();
      if (!feet.ground && pme.ground && feet.vy < -5) sound.land(-feet.vy);
      feet = { ground: pme.ground, vy: pme.vel[1] };
    }
    for (let k = flashes.length - 1; k >= 0; k--) {
      flashes[k].age = (now - flashes[k].born) / 1000;
      if (flashes[k].age > 0.6) flashes.splice(k, 1);
    }
    hudText(text, { h, me: tgt || pme || me, slot: tgt ? watched : slot, st, cam, now });
    last = {
      cam, yaw: camYaw, pitch: camPitch, time: now / 1000, dt, dtPred, proj: pme ? L.PROJ + L.PRED_D : L.PROJ, cup: h.cup, dir: h.dir,
      slot: tgt ? watched : slot < 0 ? 999 : slot, myBall: me?.live ? me.ball : tgt ? tgt.ball : -1, nballs: view.nballs, flashes, text, graph: null,
    };
    renderer.frame(u8, last, target);
  }

  function hudText(t, { h, me: who, slot, st, cam, now }) {
    t.fill(0);
    const rows = renderer.rows;
    const right = (y, s, c) => put(t, COLS, COLS - 1 - String(s).length, y, s, c);
    const centre = (y, s, c) => put(t, COLS, Math.floor((COLS - String(s).length) / 2), y, s, c);
    if (st !== 2) centre(Math.floor(rows / 2) - 3, host.error ? 'ERROR: ' + host.error.slice(0, 64) : ['CONNECTING', 'CATCHING UP', '', 'DISCONNECTED'][st] || 'JOINING', host.error ? C.RED : C.YELLOW);
    const dist = Math.hypot(h.cup[0] - h.tee[0], h.cup[2] - h.tee[2]);
    put(t, COLS, 1, 0, `GOLF  PAR ${h.par}  ${Math.round(dist)}M`);
    if (who?.live) right(0, `STROKES ${who.strokes}`, C.YELLOW);
    const left = Math.max(0, h.until - h.tick);
    const clock = (n) => `${Math.floor(n / 125 / 60)}:${String(Math.floor(n / 125) % 60).padStart(2, '0')}`;
    if (h.state === L.H_COUNT) {
      centre(2, `TEE OFF IN ${Math.ceil(left / 125)}`, C.YELLOW);
      centre(4, 'ROCKETS AND GRENADES ARE YOUR CLUBS  BLAST YOUR BALL INTO THE CUP', C.GREY);
    }
    if (h.state === L.H_PLAY && left < 0xfffffff) centre(1, clock(left), left < 30 * 125 ? C.RED : C.WHITE);
    if (banner.until > now) centre(Math.floor(rows / 2) + 4, banner.text, C.GREEN);
    if (who?.live) {
      if (!WATCH && !BOT) {
        put(t, COLS, 1, rows - 1, '1 ROCKET', get(L.CL_WEAPON) === 0 ? C.ORANGE : C.GREY);
        put(t, COLS, 11, rows - 1, '2 GRENADE', get(L.CL_WEAPON) === 1 ? C.ORANGE : C.GREY);
      }
      if (who.done) right(rows - 1, 'IN', C.GREEN);
      else if (who.ball >= 0) {
        const b = view.ball(who.ball).pos;
        right(rows - 1, `BALL ${Math.round(Math.hypot(b[0] - h.cup[0], b[2] - h.cup[2]))}M TO CUP  ${slot === get(L.CL_SLOT) ? 'YOU' : 'P' + (slot + 1)} ${Math.round(Math.hypot(b[0] - cam[0], b[2] - cam[2]))}M`, C.CYAN);
      }
    }
    if (!BOT && !WATCH && !locked && st === 2) centre(Math.floor(rows / 2) + 2, 'CLICK TO PLAY', C.WHITE);
    if (h.state === L.H_OVER || (held.has('Tab') && h.live)) {
      const list = [];
      for (let p = 0; p < L.NPLAYER; p++) { const pl = view.player(p); if (pl.live) list.push(pl); }
      list.sort((a, b) => a.total - b.total || a.slot - b.slot);
      const y0 = 6;
      centre(y0, `${h.state === L.H_OVER ? 'HOLE OVER' : 'SCORES'}  ${list.length} PLAYERS`, C.YELLOW);
      centre(y0 + 2, 'RANK  PLAYER    HOLE', C.GREY);
      const fit = rows - y0 - 6;
      const mineAt = list.findIndex((pl) => pl.slot === get(L.CL_SLOT));
      const shown = mineAt >= fit ? [...list.slice(0, fit - 1), list[mineAt]] : list.slice(0, fit);
      shown.forEach((pl, k) => {
        const name = (pl.slot === get(L.CL_SLOT) ? 'YOU ' : 'P') + String(pl.slot + 1);
        const hole = h.state === L.H_OVER ? String(pl.score) : String(pl.strokes);
        centre(y0 + 3 + k, `${String(list.indexOf(pl) + 1).padStart(4)}  ${name.padEnd(8)}  ${hole.padStart(4)}`, pl.slot === get(L.CL_SLOT) ? C.YELLOW : C.WHITE);
      });
    }
  }

  return {
    frame,
    unmount() { off(); held.clear(); set(L.CL_MOVE, 0); sound.music(null, false); },
    capture: (scale = 2) => (last ? capturePng(renderer, u8, last, scale) : null),
    state: () => ({ slot: get(L.CL_SLOT), clState: get(L.CL_STATE), me, error: host.error, hole: view.hole() }),
    get locked() { return locked; },
  };
}
