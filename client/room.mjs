// Fireplace's room on its own, no sim and no net: the page to make a theme on.
// It draws the living room from the couch in the theme ?theme= names
// (client/themes/<id>.json) and reads the file again every second, so an
// edit shows as you save it; a mistake in the file shows at the bottom, and
// the room keeps the last good one. T or a click: the next theme the build
// bundled. tools/theme-shots.mjs reads each back with shot() (headless
// Chrome, ?present=0) into traces/themes/<id>.png.
//   ?theme=<id>  ?live=0 reads the file once  ?res=1280x800  ?present=0
import { createRoom, COUCH, cardText, cardFire } from './room-render.mjs';
import { validate, loadTheme, themeList, savedTheme, saveTheme, DEFAULT, FALLBACK } from './themes.mjs';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('room');
const note = document.getElementById('note');
const PRESENT = q.get('present') !== '0';

async function main() {
  const [W, H] = q.has('res') ? q.get('res').split('x').map(Number) : [Math.min(1600, innerWidth * Math.min(devicePixelRatio || 1, 2)) | 0, Math.min(1000, innerHeight * Math.min(devicePixelRatio || 1, 2)) | 0];
  canvas.width = W;
  canvas.height = H;
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('This browser has no WebGPU: try a current Chrome or Edge.');
  const device = await adapter.requestDevice();
  let id = q.get('theme') || savedTheme() || DEFAULT;
  const theme = await loadTheme(id).catch((e) => { note.textContent = e.message; id = DEFAULT; return FALLBACK; });
  const room = await createRoom(canvas, device, { present: PRESENT, theme });
  const g2 = room.card.getContext('2d');

  // the TV: the title, and whose room this is
  const drawCard = (t) => {
    const th = room.theme;
    g2.fillStyle = '#10141f';
    g2.fillRect(0, 0, 640, 400);
    cardText(g2, 'CH 3', 620, 18, 3, '#7fbf7f', 'right');
    cardFire(g2, 320, 150, 9, t);
    cardText(g2, 'FIREPLACE', 320, 178, 11, '#ffcf6a', 'center');
    cardText(g2, th.name, 320, 262, th.name.length * 24 <= 600 ? 6 : 4, '#ffffff', 'center');
    cardText(g2, `BY ${th.by}`, 320, 310, 4, '#c9b89a', 'center');
    room.updateCard();
  };
  const state = (now, still) => ({
    cam: still ? COUCH.cam(0) : COUCH.cam(now), look: COUCH.look, focal: H * 1.05, time: still ? 3 : now / 1000, zoom: 0,
    cardMix: 1, flicker: still ? 1 : 0.8 + 0.35 * Math.random(), tvOn: 1, tvLight: [0.35, 0.4, 0.6], tvBright: 1, game: null,
  });

  // the file, again every second: a change goes on the wall at once
  let text = '';
  const reread = async () => {
    try {
      const r = await fetch(`themes/${id}.json`, { cache: 'no-store' });
      const body = await r.text();
      if (body === text) return;
      text = body;
      room.setTheme(validate(JSON.parse(body), id));
      note.textContent = `${room.theme.name} by ${room.theme.by}: client/themes/${id}.json`;
    } catch (e) { note.textContent = String(e.message || e); }
  };
  const next = async () => {
    const ids = await themeList();
    id = ids[(ids.indexOf(id) + 1) % ids.length];
    text = '';
    await reread();
    saveTheme(id);
    history.replaceState(null, '', `?${new URLSearchParams({ ...Object.fromEntries(q), theme: id })}`);
  };
  addEventListener('keydown', (e) => { if (e.code === 'KeyT' && !e.repeat) next(); });
  canvas.addEventListener('click', next);
  await reread();
  if (q.get('live') !== '0') setInterval(reread, 1000);

  let cardAt = 0;
  const frame = (now) => {
    requestAnimationFrame(frame);
    if (now - cardAt > 100) { drawCard(now / 1000); cardAt = now; }
    room.frame(state(now, false));
  };
  if (PRESENT) requestAnimationFrame(frame);

  window.__room = {
    ready: true,
    themes: themeList,
    // a theme from the couch, held still, as a PNG (base64)
    async shot(tid) {
      room.setTheme(await loadTheme(tid));
      drawCard(3);
      const { width, height, rgba } = await room.capture(state(0, true));
      const c = new OffscreenCanvas(width, height);
      c.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
      const out = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let bin = '';
      for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return btoa(bin);
    },
  };
}

main().catch((e) => {
  note.textContent = String(e?.message || e);
  window.__room = { error: String(e?.stack || e) };
});
