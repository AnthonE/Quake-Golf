;; Quake Golf sim. Hand-written WebAssembly; tools/asm.mjs expands the
;; (!macros) and @CONSTANTS. One shared 4 MiB memory, imported, never grown.
(module
  (import "env" "mem" (memory 64 64 shared))

  #include "util.wat"
  #include "hash.wat"
  #include "terrain.wat"
  #include "events.wat"
  #include "balls.wat"
  #include "players.wat"
  #include "weapons.wat"
  #include "hole.wat"
#if ARENA
  #include "arena.wat"
#endif
#if BUMPER
  #include "bumper.wat"
#if PARTY
  #include "party.wat"
#endif
#endif
  #include "predict.wat"
  #include "tick.wat"
)
