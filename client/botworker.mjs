// ?bot=1: a golf bot plays instead of the mouse and keys, writing the same
// input slots a person's mouse and keys would.
import * as L from '../src/layout.mjs';
import { View } from '../src/view.mjs';
import { GolfBot, Planner } from './bot.mjs';

self.onmessage = async (e) => {
  const { module, memory } = e.data;
  const i32 = new Int32Array(memory.buffer);
  const f32 = new Float32Array(memory.buffer);
  const view = new View(memory.buffer);
  const planner = await Planner.create(module);
  const get = (a) => Atomics.load(i32, a >> 2);
  const set = (a, v) => Atomics.store(i32, a >> 2, v);
  let bot = null;
  setInterval(() => {
    const slot = get(L.CL_SLOT);
    if (slot < 0 || get(L.CL_STATE) !== 2) return;
    if (!bot || bot.slot !== slot) bot = new GolfBot(slot, planner, { seq: i32 });
    // a round trip in ticks: the input lead plus the playout delay
    bot.lag = Math.round(f32[L.CL_LEAD >> 2] + L.PLAY_DELAY + 3);
    bot.think(view);
    set(L.CL_YAW, bot.input.yaw);
    set(L.CL_PITCH, bot.input.pitch);
    set(L.CL_MOVE, bot.input.move | (bot.input.jump << 4));
    set(L.CL_WEAPON, bot.input.weapon);
    set(L.CL_PRESSES, bot.presses);
  }, 8);
};
