// A Fireplace bot: one player who plays whatever game is on. It holds a brain
// for each (golf's neural golfer, the arena's fighter, bumper's ball, party's
// ball) and asks the one for the game in the world it sees (FP_GAME), in that
// game's input word. Deterministic from its seed and what it sees, like each
// of them.
import * as L from '../src/layout.mjs';
import '../src/arena-view.mjs';
import '../src/bumper-view.mjs';
import '../src/party-view.mjs';
import { BrainBot } from './brain.mjs';
import { Fighter } from './arena-bot.mjs';
import { Roller } from './bumper-bot.mjs';
import { Partier } from './party-bot.mjs';

export class Guest {
  constructor(slot, seed = 1, skill = 0.6, genome) {
    this.slot = slot;
    this.golfer = new BrainBot(slot, genome, { lag: 8 });
    this.fighter = new Fighter(slot, seed, skill);
    this.roller = new Roller(slot, seed, skill);
    this.partier = new Partier(slot, seed, skill);
  }

  // the game on in this view
  static game(view) { return view.dv.getUint32(L.FP_GAME + view.bank, true); }

  // t: the tick the word is for; lag: ticks between the world it sees and t
  think(view, t = view.tick, lag = 0) {
    switch (Guest.game(view)) {
      case L.G_ARENA: return this.fighter.think(view, t, lag);
      case L.G_BUMPER: return this.roller.think(view, t, lag);
      case L.G_PARTY: return this.partier.think(view, t, lag);
      default: this.golfer.lag = Math.max(2, lag); return this.golfer.think(view);
    }
  }
}
