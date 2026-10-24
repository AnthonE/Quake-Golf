// The arena's page: a host on the arena's sim and its frontend
// (client/arena-game.mjs) mounted alone, a frame per display refresh.
//   ?bot=1 hands the controls to an AI fighter (client/arena-bot.mjs)
//   ?watch=1 spectates; ?cam=x,y,z,yaw,pitch (degrees) holds a spectator's camera
//   there, for looking over a map; ?url=, ?hash=, ?impair=, ?sens=, ?res= as golf's
import { createHost } from './host.mjs';
import { mount } from './arena-game.mjs';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('screen');
const note = document.getElementById('note');

async function main() {
  [canvas.width, canvas.height] = (q.get('res') || '320x200').split('x').map(Number);
  const fixed = q.has('cam') ? q.get('cam').split(',').map(Number) : null;
  const h = await createHost({ wasm: '../build/arena/game.wasm', q, watch: q.get('watch') === '1' || !!fixed, arena: true });
  const game = await mount(h, { canvas, bot: q.get('bot') === '1', skill: Number(q.get('skill') || 0.7), sens: Number(q.get('sens') || 3), fixed,
    present: q.get('present') !== '0', showGraph: q.get('net') === '1' });
  window.__qa = { hashes: h.hashes, keys: h.keys, desyncs: h.desyncs, state: game.state, capture: game.capture };
  note.remove();
  const loop = (now) => { requestAnimationFrame(loop); game.frame(now); };
  requestAnimationFrame(loop);
}

main().catch((e) => {
  note.textContent = String(e?.message || e);
  window.__qa = { error: String(e?.stack || e) };
});
