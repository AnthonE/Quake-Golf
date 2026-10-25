// Every team mode's constants (src/am/<key>.mjs) in one module: what JS reads
// them from (import * as AC), and what layout.mjs gathers into AM_CONSTS for
// the assembler, so they stay out of layout.mjs's own namespace (see MG_CONSTS).
export * from './slayer.mjs';
export * from './ctf.mjs';
export * from './oddball.mjs';
export * from './hill.mjs';
