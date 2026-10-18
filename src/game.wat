;; Quake Golf sim. Hand-written WebAssembly; tools/asm.mjs expands the
;; (!macros) and @CONSTANTS. One shared 4 MiB memory, imported, never grown.
(module
  (import "env" "mem" (memory 64 64 shared))

  #include "util.wat"
  #include "hash.wat"
  #include "terrain.wat"
  #include "events.wat"
  #include "balls.wat"
  #include "tick.wat"
)
