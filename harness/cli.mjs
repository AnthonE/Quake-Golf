// Shared argument handling for the runners.
export function args(argv, defaults) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([\w-]+)(?:=(.*))?$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2] !== undefined ? m[2] : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
    out[key] = typeof defaults[key] === 'number' ? Number(val) : val;
  }
  return out;
}

export const DEFAULTS = {
  log: 'logs/short.qgl',
  wasm: 'build/game.wasm',
  ticks: 20000,
  threads: 1,
  salt: 0,
  out: '',
  tag: '',
  flags: '',
};
