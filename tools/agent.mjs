#!/usr/bin/env node
// A local room any agent can play over plain HTTP (or stdin), next to golf
// bots, through the door in client/agent.mjs. Time is stepped: the world
// moves only while some agent's command runs, so a slow thinker loses
// nothing by thinking, while the hole clock still counts every tick it plays.
// The match is an ordinary event log, saved after every command, that the
// M1 harness replays to the same hashes.
//   node tools/agent.mjs [--course 7] [--agents 1] [--bots 1] [--genome qg2:...] [--delay 6] [--port 7777] [--out logs/agent.qgl] [--stdin]
//   curl -s localhost:7777/0                         look, as slot 0
//   curl -s localhost:7777/0 -d 'face cup; hold w 2' act, then look
//   curl -s localhost:7777/0.json                    the same view as JSON
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newMemory, instantiate, Sim } from '../harness/core.mjs';
import { View } from '../src/view.mjs';
import { GolfBot, Planner } from '../client/bot.mjs';
import { HELP, Hands, see, look } from '../client/agent.mjs';
import { BrainBot } from '../client/brain.mjs';
import { encodeLog } from './gengame.mjs';
import * as L from '../src/layout.mjs';
import { isMain } from './main.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export class Room {
  // Agents take slots 0..agents-1, golf bots the ones after, then a neural
  // golfer per genome; everyone joins on tick 0. Each player's inputs land
  // `delay` ticks after it makes them.
  static async create({ bytes, courseSeed = 7, agents = 1, bots = 1, genomes = [], delay = 6 } = {}) {
    const module = await WebAssembly.compile(bytes);
    const memory = newMemory();
    const sim = new Sim(await instantiate(module, memory), memory);
    sim.init(courseSeed);
    const planner = bots ? await Planner.create(module) : null;
    return new Room(sim, courseSeed, agents, bots, genomes, delay, planner);
  }

  constructor(sim, courseSeed, agents, bots, genomes, delay, planner) {
    this.sim = sim;
    this.view = new View(sim.memory.buffer);
    this.courseSeed = courseSeed;
    this.delay = delay;
    this.players = [
      ...Array.from({ length: agents }, () => ({ hands: new Hands(), seen: 0 })),
      ...Array.from({ length: bots }, (_, k) => ({ bot: new GolfBot(agents + k, planner, { lag: delay }) })),
      ...genomes.map((g, k) => ({ bot: new BrainBot(agents + bots + k, g, { lag: delay }) })),
    ].map((p) => ({ ...p, queue: [], last: -1 }));
    this.agents = agents;
    this.recs = [];
    this.t = 0;
  }

  tick() {
    const now = [];
    for (const [k, p] of this.players.entries()) {
      if (this.t === 0) now.push([L.EV_JOIN, k]);
      p.queue.push(p.bot ? p.bot.think(this.view) : p.hands.word());
      const word = p.queue.length > this.delay ? p.queue.shift() : p.queue[0];
      if (word !== p.last) { now.push([L.EV_INPUT, k, word]); p.last = word; }
    }
    for (const r of now) this.recs.push([this.t, ...r]);
    this.sim.feedPlayers(now);
    this.sim.x.step();
    this.t++;
  }

  // Runs `text` (commands joined by ";") as agent `slot` and answers with
  // what it sees after them. The first bad command stops the rest.
  act(slot, text = 'look') {
    const p = this.players[slot];
    if (!p || !p.hands) throw new Error(`no agent in slot ${slot}; agents are 0..${this.agents - 1}`);
    if (this.t === 0) this.tick(); // the joins
    const out = [];
    for (const line of String(text).split(';')) {
      if (/^\s*help\s*$/.test(line)) out.push(HELP);
      let plan;
      try {
        plan = p.hands.command(line, this.view, slot);
      } catch (e) {
        out.push(`error: ${e.message}`);
        break;
      }
      p.hands.move = plan.move || 0;
      for (let k = 0; k < plan.ticks; k++) {
        this.tick();
        if (plan.until && k > this.delay && plan.until(this.view)) break;
      }
      p.hands.move = 0;
    }
    p.saw = this.see(slot);
    out.push(look(p.saw));
    return out.join('\n');
  }

  // The view as data; marks the FX so far as seen by `slot`.
  see(slot) {
    const p = this.players[slot];
    const s = see(this.view, slot, { since: p.seen, aim: p.hands.aim });
    p.seen = s.seen;
    return s;
  }

  log() {
    return encodeLog({ courseSeed: this.courseSeed, ticks: this.t, recs: this.recs });
  }

  get hash() { return BigInt.asUintN(64, this.sim.x.hash_region()); }
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

if (isMain(import.meta.url)) {
  const bytes = readFileSync(join(ROOT, 'build/game.wasm'));
  const room = await Room.create({
    bytes, courseSeed: Number(arg('course', 7)), agents: Number(arg('agents', 1)), bots: Number(arg('bots', 1)), delay: Number(arg('delay', 6)),
    genomes: process.argv.flatMap((a, i) => (process.argv[i - 1] === '--genome' ? [a] : [])),
  });
  const out = arg('out', 'logs/agent.qgl');
  mkdirSync(dirname(out), { recursive: true });
  const save = () => writeFileSync(out, room.log());
  const banner = `${HELP}\n\nThis room is stepped: the world moves only while your commands run. ` +
    `Agents are slots 0..${room.agents - 1}; golf bots, then neural golfers, play the slots after.`;
  if (process.argv.includes('--stdin')) {
    console.log(`${banner}\nYou are slot 0. One line of commands at a time.\n\n${room.act(0)}\n`);
    for await (const line of createInterface({ input: process.stdin })) {
      console.log(`${room.act(0, line)}\n`);
      save();
    }
  } else {
    const server = createServer(async (req, res) => {
      let body = '';
      for await (const c of req) body += c;
      const m = req.url.match(/^\/(\d+)(\.json)?$/);
      try {
        if (!m) return res.end(`${banner}\nGET /<slot> looks; POST /<slot> with commands acts; /<slot>.json is the view as JSON.\n`);
        const slot = Number(m[1]);
        const text = room.act(slot, req.method === 'POST' ? body : 'look');
        save();
        if (m[2]) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(room.players[slot].saw)); }
        res.end(`${text}\n`);
      } catch (e) {
        res.statusCode = 400;
        res.end(`error: ${e.message}\n`);
      }
    });
    server.listen(Number(arg('port', 7777)), '127.0.0.1', () =>
      console.log(`agent door on http://127.0.0.1:${server.address().port}/ (course ${room.courseSeed}, log ${out})`));
  }
}
