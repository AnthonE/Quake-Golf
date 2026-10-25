// Fireplace: the living room, the fire going, the TV on. Click and you sit
// down: the camera closes in on the TV until its glass fills the screen and
// you are in the game, whatever the room is playing. Between games it pulls
// back to the room, and the TV shows the marshmallows and what's on next;
// then it closes in again. One host (client/host.mjs) on Fireplace's sim,
// every game's frontend mounted in turn on its own canvas (golf, the arena,
// bumper balls, party); while the room is in view, the game draws into a
// texture the TV shows. B and H, while the room is in view, change your ball
// and hat (client/looks.mjs), which everyone in the room sees; L lists your
// achievements (client/achievements.mjs). Both are kept in this browser.
//   ?theme=<id> the room in client/themes/<id>.json (T cycles them while the room is in view)
//   ?bot=1 sits a guest (client/fireplace-bot.mjs) at the controls, and sits down at once
//   ?look=<word> wears that look (client/looks.mjs packLook) for this visit, earned or not, and keeps nothing
//   ?watch=1 spectates; ?url=, ?hash=, ?impair=, ?sens=, ?res=, ?music=0 as the games'
//   ?replay=<url> plays a replay file (net/replay.mjs) as a spectator
//   ?film=<seconds> with ?replay=: no clock of its own; tools/film.mjs steps it a frame at a time (window.__film)
import * as L from '../src/layout.mjs';
import { unpackArena, modeName } from '../src/arena-view.mjs';
import '../src/bumper-view.mjs';
import '../src/party-view.mjs';
import { createHost, epoch, fitSize } from './host.mjs';
import { createRoom, SCREEN, COUCH, cardText, cardFire } from './room-render.mjs';
import { loadTheme, themeList, savedTheme, saveTheme, FALLBACK, DEFAULT } from './themes.mjs';
import { Guest } from './fireplace-bot.mjs';
import { readClock } from './clock.mjs';
import { BALLS, HATS, packLook, unpackLook, savedLook, saveLook, nextOpen, wearable, isOpen, drawLook, lookName } from './looks.mjs';
import { ACHIEVEMENTS, loadTally, saveTally, emptyTally, record, readResult, gotSet } from './achievements.mjs';
import { filmClock, filmSound, compose } from './film.mjs';

const q = new URLSearchParams(location.search);
const stage = document.getElementById('stage');
const note = document.getElementById('note');
const roomCanvas = document.getElementById('room');
const canvases = L.GAMES.map((_, k) => document.getElementById(`g${k}`));
const BOT = q.get('bot') === '1';
const FILM = q.has('film') && q.has('replay') ? Number(q.get('film')) : 0;
const WATCH = q.get('watch') === '1' || q.has('replay');
const SENS = Number(q.get('sens') || 3);
const ZOOM_MS = 1700;
const LOOK_MS = 5000; // how long B or H keeps your look on the TV
const LIST_MS = 12000; // and L your achievements
const PER_PAGE = 6; // achievements a page, in type the TV can show from the couch
// what each game's picture lights the room with, roughly: golf's grass, the
// arena's grey, the cheese, party's sky
const TV_LIGHT = [[0.45, 0.7, 0.45], [0.6, 0.65, 0.6], [1, 0.85, 0.5], [0.55, 0.75, 1]];
const FRONTENDS = { [L.G_GOLF]: './golf-game.mjs', [L.G_ARENA]: './arena-game.mjs', [L.G_BUMPER]: './bumper-game.mjs', [L.G_PARTY]: './party-game.mjs' };
const ease = (x) => x * x * (3 - 2 * x);
const lerp = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);

async function main() {
  const [W, H] = fitSize(q, [1600, 1000]);
  roomCanvas.width = W;
  roomCanvas.height = H;
  // golf and the arena are drawn at their 320 x 200, bumper balls and party at the window's size
  [canvases[L.G_GOLF].width, canvases[L.G_GOLF].height] = [320, 200];
  [canvases[L.G_ARENA].width, canvases[L.G_ARENA].height] = [320, 200];
  [canvases[L.G_BUMPER].width, canvases[L.G_BUMPER].height] = [W, H];
  [canvases[L.G_PARTY].width, canvases[L.G_PARTY].height] = [W, H];
  const clock = FILM ? filmClock() : null;
  const host = await createHost({ wasm: '../build/fireplace/game.wasm', q, watch: WATCH, fireplace: true, connect: false });
  const track = FILM ? filmSound(FILM, { music: q.get('music') !== '0' }) : null;
  if (track) host.sound = track.sound;
  const { view, get, set, press, sound, i32, f64 } = host;
  // the room's theme: ?theme=, else this viewer's last pick, else Grandma's (client/themes.mjs)
  const theme = await loadTheme(q.get('theme') || savedTheme() || DEFAULT).catch((e) => { console.warn(e.message); return FALLBACK; });
  const room = await createRoom(roomCanvas, host.device, { present: q.get('present') !== '0', theme });
  const tvTex = canvases.map((c) => room.tvTexture(c.width, c.height));
  const genome = (await (await fetch('../xbox/golfer.h')).text()).match(/GOLFER_DEFAULT "(qg2:[A-Za-z0-9_-]+)"/)[1];
  const guest = BOT ? new Guest(0, (Math.random() * 1e9) | 0, Number(q.get('skill') || 0.8), genome) : null;

  // ---- your look and your achievements, kept in this browser; a guest at the controls or a spectator keeps neither
  const KEEP = !BOT && !WATCH;
  let tally = KEEP ? loadTally() : emptyTally();
  let got = gotSet(tally);
  let look = q.has('look') ? Number(q.get('look')) >>> 0 : KEEP ? wearable(savedLook(), got) : 0;
  set(L.CL_LOOK, look);
  let lookAt = -1e9, listAt = -1e9, listPage = 0; // when B or H, and L, last put their card on the TV; the list's page
  let heldKey = '', opened = []; // the game held now, and what its end opened
  const wear = (w) => { look = w; set(L.CL_LOOK, w); saveLook(w); lookAt = performance.now(); listAt = -1e9; };
  // the looks an achievement opens
  const opens = (id) => [...BALLS, ...HATS].filter((x) => x.unlock === id).map(lookName);
  // what this slot did in the game just held, counted once
  function tallyUp() {
    const slot = get(L.CL_SLOT);
    if (!KEEP || slot < 0) return;
    const r = readResult(view, slot, get(L.CL_ROOM));
    if (r.key !== heldKey) { heldKey = r.key; opened = []; }
    const next = record(tally, r);
    if (next.tally === tally) return;
    tally = next.tally;
    saveTally(tally);
    got = gotSet(tally);
    opened = next.opened;
  }

  // ---- the scene: on the couch, closing in on the TV, in the game, pulling back
  let scene = 'couch'; // couch -> tuning -> in <-> out
  let zoom = 0, zoomFrom = 0, zoomTo = 0, zoomAt = 0;
  let cardMix = 1, cardTo = 1;
  let tvOn = 0;
  let card = '';
  let game = -1, frontend = null, mounting = null;
  let gamesSeen = 0;
  let last = null;
  const zoomBy = (to, now) => { zoomFrom = zoom; zoomTo = to; zoomAt = now; };
  const show = (canvas) => { for (const c of [roomCanvas, ...canvases]) c.classList.toggle('on', c === canvas); };

  const sitDown = () => {
    if (scene !== 'couch') return;
    sound.wake();
    scene = 'tuning';
    if (!BOT && !WATCH) stage.requestPointerLock?.({ unadjustedMovement: true })?.catch?.(() => stage.requestPointerLock());
    host.connect();
  };
  stage.addEventListener('click', () => { if (scene === 'couch') sitDown(); else if (!document.pointerLockElement && !BOT && !WATCH) stage.requestPointerLock(); });
  addEventListener('keydown', (e) => {
    if (scene === 'couch' && (e.code === 'Enter' || e.code === 'Space')) sitDown();
    const roomInView = !(scene === 'in' && zoom >= 0.999);
    if (e.code === 'KeyT' && !e.repeat && roomInView) nextTheme();
    if (KEEP && roomInView && !e.repeat) {
      const { ball, hat } = unpackLook(look);
      if (e.code === 'KeyB') wear(packLook(nextOpen(BALLS, ball, got), hat));
      if (e.code === 'KeyH') wear(packLook(ball, nextOpen(HATS, hat, got)));
      // L: the list's first page, then its next, then away
      if (e.code === 'KeyL') {
        const open = performance.now() - listAt < LIST_MS;
        listPage = open ? listPage + 1 : 0;
        listAt = listPage < LIST_PAGES ? performance.now() : -1e9;
        lookAt = -1e9;
      }
    }
    if (e.code === 'KeyF' && !e.repeat) {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().then(() => navigator.keyboard?.lock?.()).catch(() => {});
    }
  });

  // T, while the room is in view: the next theme the build bundled, kept for next time
  let themeAt = -1e9;
  async function nextTheme() {
    const ids = await themeList();
    const id = ids[(ids.indexOf(room.theme.id) + 1) % ids.length];
    try { room.setTheme(await loadTheme(id)); saveTheme(id); themeAt = performance.now(); } catch (e) { console.warn(e.message); }
  }

  // the game the room is on, mounted on its own canvas; the last one put away
  async function mountGame(g) {
    if (mounting) return;
    mounting = (async () => {
      frontend?.unmount();
      frontend = null;
      const { mount } = await import(FRONTENDS[g]);
      frontend = await mount(host, { canvas: canvases[g], lockTarget: stage, bot: BOT, external: BOT, sens: SENS, present: q.get('present') !== '0' });
      game = g;
      gamesSeen++;
    })();
    try { await mounting; } finally { mounting = null; }
  }

  // ---- the guest at the controls (?bot=1): its word into the slots, as keys and a mouse would
  let lastWord = 0;
  function drive() {
    const slot = get(L.CL_SLOT);
    if (!guest || slot < 0 || get(L.CL_STATE) !== 2) return;
    guest.slot = guest.golfer.slot = guest.fighter.slot = guest.roller.slot = guest.partier.slot = slot;
    const nowE = epoch();
    const lag = Math.round(readClock(i32, f64, L.CL_PRED, nowE) - readClock(i32, f64, L.CL_PLAY, nowE));
    const w = guest.think(view, view.tick, lag);
    if (Guest.game(view) === L.G_ARENA) {
      const a = unpackArena(w), b = unpackArena(lastWord);
      set(L.CL_YAW, a.yaw); set(L.CL_PITCH, a.pitch); set(L.CL_MOVE, a.move | (a.jump << 4)); set(L.CL_WEAPON, a.slot);
      if (a.shot !== b.shot) press(L.CL_PRESSES);
      if (a.melee !== b.melee) press(L.CL_MELEE);
      if (a.gren !== b.gren) press(L.CL_GREN);
      if (guest.fighter.wantUse) press(L.CL_USE);
    } else {
      set(L.CL_YAW, w & 0x3fff); set(L.CL_PITCH, (w >>> 14) & 0x3ff); set(L.CL_MOVE, ((w >>> 24) & 15) | (((w >>> 28) & 1) << 4)); set(L.CL_WEAPON, w >>> 31);
      if (((w >>> 29) & 3) !== ((lastWord >>> 29) & 3)) press(L.CL_PRESSES);
    }
    lastWord = w;
  }

  // ---- the TV's cards, drawn in the games' own 3x5 font
  const g2 = room.card.getContext('2d');
  const text = (s, x, y, px, color, align) => cardText(g2, s, x, y, px, color, align);
  const pixelFire = (cx, cy, s, t) => cardFire(g2, cx, cy, s, t);
  // the room's theme and who made it: on the title, and for a while after T changes it
  const roomLine = () => {
    const s = `ROOM: ${room.theme.name} BY ${room.theme.by}  -  T FOR ANOTHER`;
    text(s, 320, 372, s.length * 12 <= 620 ? 3 : 2, '#8ea0b8', 'center');
  };
  function drawCard(kind, now) {
    const t = now / 1000;
    g2.fillStyle = '#10141f';
    g2.fillRect(0, 0, 640, 400);
    text('CH 3', 620, 18, 3, '#7fbf7f', 'right');
    if (kind === 'title' || now - themeAt < 4000) roomLine();
    if (kind === 'look') return lookCard(t);
    if (kind === 'list') return listCard();
    if (kind === 'title' || kind === 'tuning') {
      pixelFire(320, 150, 9, t);
      text('FIREPLACE', 320, 178, 11, '#ffcf6a', 'center');
      text('A ROOMFUL OF GAMES, COME AND GO AS YOU LIKE', 320, 250, 3, '#c9b89a', 'center');
      text(GAMES_LINE, 320, 275, 3, '#8ea0b8', 'center');
      if (KEEP) {
        drawLook(g2, 578, 128, 22, Math.max(0, get(L.CL_SLOT)), look, t);
        const { ball, hat } = unpackLook(look);
        const s = `B: ${BALLS[ball].name}  H: ${HATS[hat].name}  L: ACHIEVEMENTS ${Object.keys(tally.got).length}/${ACHIEVEMENTS.length}`;
        text(s, 320, 300, s.length * 12 <= 620 ? 3 : 2, '#8ea0b8', 'center');
      }
      if (kind === 'tuning') text(host.error ? 'NO SIGNAL' : 'TUNING IN...', 320, 330, 5, host.error ? '#ff6a5a' : '#ffffff', 'center');
      else if (Math.floor(t * 1.5) % 2) text(BOT ? 'A GUEST SITS DOWN' : 'CLICK TO SIT DOWN', 320, 330, 5, '#ffffff', 'center');
      return;
    }
    // the standings: everyone in the room by marshmallows, your row lit, and what's next
    const slot = get(L.CL_SLOT);
    const list = [];
    for (let p = 0; p < L.NPLAYER; p++) {
      if (!view.player(p).live) continue;
      list.push({ p, m: view.dv.getUint16(L.FP_MALLOWS + 2 * p, true), got: view.u8[L.FP_GOT + p], place: view.u8[L.FP_LAST + p] });
    }
    list.sort((a, b) => b.m - a.m || (a.place || 999) - (b.place || 999) || a.p - b.p);
    const g = view.dv.getUint32(L.FP_GAME, true);
    text(`${gameName(g, view.dv.getUint32(L.HDR_SEED, true))} IS OVER`, 320, 28, 4, '#ffcf6a', 'center');
    text('MARSHMALLOWS', 320, 60, 5, '#ffffff', 'center');
    const mine = list.findIndex((x) => x.p === slot);
    const most = opened.length ? 6 : 7; // a row less when there's news under them
    const rows = mine >= most ? [...list.slice(0, most - 1), list[mine]] : list.slice(0, most);
    rows.forEach((x, k) => {
      const y = 104 + k * 30;
      const you = x.p === slot;
      if (you) { g2.fillStyle = '#3a2c14'; g2.fillRect(70, y - 6, 500, 28); }
      text(`${list.indexOf(x) + 1}`, 110, y, 4, you ? '#ffcf6a' : '#c9b89a', 'right');
      text(you ? 'YOU' : `P${x.p + 1}`, 130, y, 4, you ? '#ffcf6a' : '#ffffff');
      for (let i = 0; i < Math.min(x.m, 12); i++) { g2.fillStyle = '#f4ecdc'; g2.fillRect(290 + i * 18, y, 12, 14); g2.fillStyle = '#d9cbb0'; g2.fillRect(290 + i * 18, y + 10, 12, 4); }
      if (x.m > 12) text(`+${x.m - 12}`, 290 + 12 * 18 + 4, y, 3, '#c9b89a');
      if (x.got) text(`+${x.got}`, 560, y, 4, '#7fdf7f', 'right');
    });
    // what this game's end opened for you
    const fit = (s) => (s.length * 12 <= 620 ? 3 : 2);
    if (opened.length) {
      const news = `NEW: ${opened.map((id) => ACHIEVEMENTS.find((a) => a.id === id).name).join(', ')}`;
      text(news, 320, 286, fit(news), '#7fdf7f', 'center');
      const looks = opened.flatMap(opens);
      const s = `${looks.join(', ')} ${looks.length > 1 ? 'ARE' : 'IS'} YOURS: B OR H TO WEAR IT`;
      if (looks.length) text(s, 320, 308, fit(s), '#c9e8a0', 'center');
    }
    const left = Math.max(0, Math.ceil((view.dv.getUint32(L.FP_AT, true) - view.tick) / 125));
    const next = `NEXT: ${gameName(nextGame(), view.dv.getUint32(L.FP_NEXT, true))}${left ? `  IN ${left}` : ''}`;
    text(next, 320, 340, next.length * 20 <= 620 ? 5 : 4, '#ffffff', 'center');
  }
  // your look, as B and H left it, and the next one to earn
  function lookCard(t) {
    const { ball, hat } = unpackLook(look);
    text('YOUR LOOK', 320, 26, 5, '#ffcf6a', 'center');
    drawLook(g2, 170, 250, 62, Math.max(0, get(L.CL_SLOT)), look, t);
    text('BALL', 330, 100, 3, '#8ea0b8');
    text(BALLS[ball].name, 330, 120, 5, '#ffffff');
    text('B FOR ANOTHER', 330, 150, 3, '#c9b89a');
    text('HAT', 330, 200, 3, '#8ea0b8');
    text(HATS[hat].name, 330, 220, 5, '#ffffff');
    text('H FOR ANOTHER', 330, 250, 3, '#c9b89a');
    text('EVERYONE IN THE ROOM SEES IT', 320, 324, 3, '#8ea0b8', 'center');
    const shut = [...BALLS, ...HATS].find((x) => !isOpen(x, got));
    if (shut) {
      const s = `EARN ${lookName(shut)}: ${ACHIEVEMENTS.find((a) => a.id === shut.unlock).about}`;
      text(s, 320, 352, s.length * 12 <= 620 ? 3 : 2, '#7fdf7f', 'center');
    }
  }
  // the achievements, a page at a time: earned lit, the rest with how far along, and the look each opens
  function listCard() {
    const n = Object.keys(tally.got).length;
    text(`ACHIEVEMENTS  ${n} OF ${ACHIEVEMENTS.length}`, 320, 16, 5, '#ffcf6a', 'center');
    ACHIEVEMENTS.slice(listPage * PER_PAGE, (listPage + 1) * PER_PAGE).forEach((a, k) => {
      const y = 58 + k * 48, have = !!tally.got[a.id];
      g2.fillStyle = have ? '#ffcf6a' : '#3a3f4f';
      g2.fillRect(30, y + 2, 16, 16);
      text(a.name, 58, y, 4, have ? '#ffffff' : '#8ea0b8');
      const [x, of] = a.have?.(tally) ?? [0, 0];
      const far = !have && of ? `  ${Math.min(x, of)}/${of}` : '';
      const about = a.about + far;
      text(about, 58, y + 24, about.length * 12 <= 560 ? 3 : 2, have ? '#c9b89a' : '#7f8aa0');
      const o = opens(a.id);
      if (o.length) text(o.join(', '), 610, y + 4, 2, have ? '#7fdf7f' : '#5f8a60', 'right');
    });
    text(listPage + 1 < LIST_PAGES ? 'L FOR MORE' : 'L TO PUT IT AWAY', 320, 360, 3, '#8ea0b8', 'center');
  }
  const LIST_PAGES = Math.ceil(ACHIEVEMENTS.length / PER_PAGE);

  // the playlist goes by position: entry (games played) % length is next
  const nextGame = () => L.PLAYLIST[view.dv.getUint16(L.FP_COUNT + 2, true) % L.PLAYLIST.length];
  // a game as the TV names it: the arena by the mode its seed forces
  const gameName = (g, seed) => (g === L.G_ARENA && modeName(seed) !== null ? `ARENA ${modeName(seed)}` : L.GAMES[g]);
  const GAMES_LINE = L.PLAYLIST.map((g) => L.GAMES[g]).join(' . ');

  // ---- the frame
  let crackleAt = 0;
  let flick = 1;
  function frame(now) {
    if (!FILM) requestAnimationFrame(frame);
    const st = get(L.CL_STATE);
    const g = view.dv.getUint32(L.FP_GAME, true);
    const held = view.dv.getUint32(L.FP_STAGE, true) === 1;
    if (held) tallyUp();
    if (st >= 1 && g !== game && !mounting) mountGame(g);
    drive();
    // where the scene goes next
    if (scene === 'tuning' && st === 2 && frontend && game === g) { scene = 'in'; zoomBy(1, now); cardTo = 0; }
    if (scene === 'in' && held) { scene = 'out'; zoomBy(0, now); }
    if (scene === 'out') cardTo = now - zoomAt > ZOOM_MS * 0.6 ? 1 : 0;
    if (scene === 'out' && !held && frontend && game === g) { scene = 'in'; zoomBy(1, now); cardTo = 0; }
    const a = Math.min(1, (now - zoomAt) / ZOOM_MS);
    zoom = zoomFrom + (zoomTo - zoomFrom) * ease(a);
    cardMix += (cardTo - cardMix) * Math.min(1, (16 / 300));
    tvOn = Math.min(1, tvOn + 0.02);
    // the fire: a flicker for the light, and now and then a pop
    flick += ((0.8 + 0.35 * Math.random()) - flick) * 0.25;
    if (now > crackleAt) { sound.crackle(zoom > 0.9 ? 0.25 : 1); crackleAt = now + 80 + Math.random() * 900; }

    const inside = scene === 'in' && zoom >= 0.999;
    if (inside && frontend) {
      show(canvases[game]);
      frontend.frame(now);
      last = null;
      return;
    }
    // the room, the game (or a card) on the TV
    if (frontend && game === g) frontend.frame(now, tvTex[game]);
    const kind = now - listAt < LIST_MS ? 'list' : now - lookAt < LOOK_MS ? 'look' : scene === 'couch' ? 'title' : scene === 'tuning' ? 'tuning' : 'standings';
    if (cardMix > 0.01 || scene === 'couch' || scene === 'tuning') { drawCard(kind, now); room.updateCard(); card = kind; }
    show(roomCanvas);
    const focal = H * 1.05;
    const mid = [(SCREEN.x0 + SCREEN.x1) / 2, (SCREEN.y0 + SCREEN.y1) / 2, SCREEN.z];
    const d = Math.min((SCREEN.x1 - SCREEN.x0) * focal / W, (SCREEN.y1 - SCREEN.y0) * focal / H) * 0.995;
    const z = ease(zoom);
    last = {
      cam: lerp(COUCH.cam(now), [mid[0], mid[1], mid[2] - d], z), look: lerp(COUCH.look, mid, z), focal, time: now / 1000, zoom: z,
      cardMix: scene === 'couch' || scene === 'tuning' ? 1 : cardMix, flicker: flick, tvOn: scene === 'couch' ? 1 : tvOn,
      tvLight: (game >= 0 && cardMix < 0.5 ? TV_LIGHT[game] : [0.35, 0.4, 0.6]).map((v) => v * (0.85 + 0.15 * Math.random())), tvBright: 1, game: game >= 0 ? tvTex[game] : null,
    };
    room.frame(last);
  }

  window.__qa = {
    hashes: host.hashes, keys: host.keys, desyncs: host.desyncs,
    state: () => {
      const g = view.dv.getUint32(L.FP_GAME, true);
      const slot = get(L.CL_SLOT);
      return { slot, clState: get(L.CL_STATE), error: host.error, theme: room.theme.id, game: g, gameName: gameName(g, view.dv.getUint32(L.HDR_SEED, true)), state: view.hole().state, scene, zoom, games: gamesSeen,
        mallows: slot >= 0 ? view.dv.getUint16(L.FP_MALLOWS + 2 * slot, true) : 0, card, me: frontend?.state?.().me ?? null,
        look, achievements: Object.keys(tally.got), opened,
        // the room's looks as the relay last sent them (this slot's own included, once it has gone round)
        relayLooks: [...Array(L.NPLAYER).keys()].filter((p) => host.u32[(L.CL_LOOKS >> 2) + p]).map((p) => [p, host.u32[(L.CL_LOOKS >> 2) + p]]) };
    },
    // a PNG of what's on the screen: the room, or the game
    capture: async () => {
      if (!last) return frontend?.capture(1) ?? null;
      const { width, height, rgba } = await room.capture(last);
      const c = new OffscreenCanvas(width, height);
      c.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
      const out = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let bin = '';
      for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return btoa(bin);
    },
  };
  note.remove();
  if (FILM) {
    // tools/film.mjs: the replay paused, moved a tick at a time, a frame drawn at the film's time
    const pause = (async () => {
      while (!host.replay) await new Promise((ok) => setTimeout(ok, 20));
      host.net.postMessage({ pause: true });
      return host.replay;
    })();
    const settle = async () => { while (mounting) await mounting.catch(() => {}); };
    window.__film = {
      // sit down: the replay opens, paused at its start; its span in sim ticks
      async sit() { sitDown(); const r = await pause; return { first: r.first - r.roomStart, end: r.end - r.roomStart }; },
      // the sim stepped to tick t (fractional: the frame between ticks), never back
      async seek(t) {
        host.net.postMessage({ to: t });
        const t0 = Date.now();
        while (view.tick < Math.floor(t) && !host.error) {
          if (Date.now() - t0 > 60000) throw new Error(`the sim did not reach tick ${t} (at ${view.tick})`);
          await new Promise((ok) => setTimeout(ok, 5));
        }
      },
      // one frame at film time ms; out: its time in the cut (seconds), or -1 while the film skips
      async frame(ms, out = -1) {
        clock.at(ms);
        track.at(Math.max(0, out), out >= 0);
        frame(ms);
        await settle();
      },
      shot: async (W, H, caption) => compose(await window.__qa.capture(), W, H, caption),
      async theme(id) { room.setTheme(await loadTheme(id)); },
      // back on the couch, the TV's title up (the film's last shot)
      couch() { scene = 'couch'; zoomBy(0, performance.now()); },
      audio: () => track.render(),
    };
  } else {
    if (BOT || WATCH || q.get('auto') === '1') { scene = 'couch'; setTimeout(sitDown, 1500); }
    requestAnimationFrame(frame);
  }
}

main().catch((e) => {
  note.textContent = String(e?.message || e);
  window.__qa = { error: String(e?.stack || e) };
});
