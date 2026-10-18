// ?bot=1: a golf bot plays instead of the mouse and keys, writing the same
// input slots a person's mouse and keys would. With &genome=qg2:..., a
// neural golfer (client/brain.mjs) does, on the same legs.
import * as L from '../src/layout.mjs';
import { View } from '../src/view.mjs';
import { GolfBot, Planner } from './bot.mjs';
import { BrainBot } from './brain.mjs';

self.onmessage = async (e) => {
  const { module, memory, genome } = e.data;
  const i32 = new Int32Array(memory.buffer);
  const f32 = new Float32Array(memory.buffer);
  const f64 = new Float64Array(memory.buffer);
  const view = new View(memory.buffer);
  const planner = await Planner.create(module);
  const get = (a) => Atomics.load(i32, a >> 2);
  const set = (a, v) => Atomics.store(i32, a >> 2, v);
  let bot = null;
  setInterval(() => {
    const slot = get(L.CL_SLOT);
    if (slot < 0 || get(L.CL_STATE) !== 2) return;
    if (!bot || bot.slot !== slot) bot = genome ? new BrainBot(slot, genome, { seq: i32 }) : new GolfBot(slot, planner, { seq: i32 });
    // a round trip in ticks: the input lead plus the playout clock's delay (the bot plays the confirmed world)
    bot.lag = Math.round(f32[L.CL_LEAD >> 2] + f32[L.CL_DELAY >> 2] + 2);
    bot.think(view);
    set(L.CL_YAW, bot.input.yaw);
    set(L.CL_PITCH, bot.input.pitch);
    const move = bot.input.move | (bot.input.jump << 4);
    if (move !== get(L.CL_MOVE)) { set(L.CL_MOVE, move); f64[L.CL_MOVEAT >> 3] = performance.timeOrigin + performance.now(); }
    set(L.CL_WEAPON, bot.input.weapon);
    set(L.CL_PRESSES, bot.presses);
  }, 8);
};
