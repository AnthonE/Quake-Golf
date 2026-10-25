;; MAZE RUN: a hedge maze over the sea, MZ_N cells a side for the crowd, laid
;; out from the round's PRNG as the round is: a perfect maze dug from the
;; middle, a room of three by three cells round the pad, a few wide halls,
;; and of the hedges left inside some come down for loops and some are
;; doors. Everyone starts the same number of cells from the pad in the
;; middle (by the doors open as play starts), as far out as there are cells
;; enough; the first onto the pad wins. The doors are in MZ_NG groups, and
;; every MZ_PERIOD ticks a new set of groups is open (the table in PG_S,
;; drawn at setup); the maze's own paths never need a door, so the middle is
;; always reachable.
;; Home, a ball is out of play (PF_DEAD, never back: PG_RESPAWN is past the
;; round), placed by the order it got there; the first home leaves the rest
;; MZ_LATE. At the end the rest are placed by how far along the open paths
;; they are from the middle (MZ_DIST, the search the bots run too).
;;
;; The maze and the doors' table are the confirmed world's, fixed from the
;; layout on; which doors are shut is a function of the tick into play. So
;; push, on either bank, finds the hedges round its ball from the table and
;; its own bank's tick, and the prediction is exact through every door.
;; Coming home and the end are the confirmed world's.

;; The kind of the hedge line x = i between cells (i - 1, j) and (i, j) of a
;; maze n a side: the rim's a hedge; past the maze's rows there's no line.
(func $mz_v (param $i i32) (param $j i32) (param $n i32) (result i32)
  (if (i32.ge_u (local.get $j) (local.get $n)) (then (return (i32.const @MZ_OPEN))))
  (if (i32.or (i32.le_s (local.get $i) (i32.const 0)) (i32.ge_s (local.get $i) (local.get $n))) (then (return (i32.const @MZ_WALL))))
  (i32.and (i32.load8_u offset=@(PG_S + MZ_CELLS) (i32.add (i32.mul (local.get $j) (local.get $n)) (i32.sub (local.get $i) (i32.const 1)))) (i32.const 15)))

;; The kind of the line z = j between cells (i, j - 1) and (i, j).
(func $mz_h (param $i i32) (param $j i32) (param $n i32) (result i32)
  (if (i32.ge_u (local.get $i) (local.get $n)) (then (return (i32.const @MZ_OPEN))))
  (if (i32.or (i32.le_s (local.get $j) (i32.const 0)) (i32.ge_s (local.get $j) (local.get $n))) (then (return (i32.const @MZ_WALL))))
  (i32.shr_u (i32.load8_u offset=@(PG_S + MZ_CELLS) (i32.add (i32.mul (i32.sub (local.get $j) (i32.const 1)) (local.get $n)) (local.get $i))) (i32.const 4)))

;; Is an edge of kind k shut, with the doors' groups in mask open?
(func $mz_shut (param $k i32) (param $mask i32) (result i32)
  (if (result i32) (i32.lt_u (local.get $k) (i32.const @MZ_DOOR))
    (then (i32.eq (local.get $k) (i32.const @MZ_WALL)))
    (else (i32.eqz (i32.and (i32.shr_u (local.get $mask) (i32.sub (local.get $k) (i32.const @MZ_DOOR))) (i32.const 1))))))

;; The groups of doors open on tick t into play.
(func $mz_mask (param $t i32) (result i32)
  (!ld i32 @(PG_S + MZ_MASKS) (i32.and (i32.div_u (local.get $t) (i32.const @MZ_PERIOD)) (i32.const @(MZ_NE - 1)))))

;; The cell a side holding the maze's coordinate u (m from its low corner), held to the maze.
(func $mz_at (param $u f32) (param $n i32) (result i32)
  (local $i i32)
  (local.set $i (i32.trunc_sat_f32_s (f32.floor (f32.div (local.get $u) (f32.const @MZ_C)))))
  (if (i32.lt_s (local.get $i) (i32.const 0)) (then (local.set $i (i32.const 0))))
  (if (i32.ge_s (local.get $i) (local.get $n)) (then (local.set $i (i32.sub (local.get $n) (i32.const 1)))))
  (local.get $i))

;; ---- the layout (setup: the confirmed world, the PRNG)

;; The maze for the crowd and where they start, the knobs: scored by place,
;; nobody back, braking for the corners; bumps without bumper's kick
;; (PGF_NOKICK: only what the balls bring), so a queue down a corridor
;; doesn't kick itself into the hedges and jam.
(func $mz_setup (param $n i32)
  (local $m i32) (local $half f32)
  (local.set $m (i32.add (i32.shl (i32.trunc_sat_f32_u (f32.mul (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @MZ_NK) (f32.const @MZ_N0))
                                                                 (f32.const 0.5)))
                                  (i32.const 1))
                         (i32.const 1)))
  (if (i32.lt_u (local.get $m) (i32.const @MZ_NMIN)) (then (local.set $m (i32.const @MZ_NMIN))))
  (if (i32.gt_u (local.get $m) (i32.const @MZ_NMAX)) (then (local.set $m (i32.const @MZ_NMAX))))
  (local.set $half (f32.mul (f32.convert_i32_u (local.get $m)) (f32.const @(MZ_C / 2))))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_SCORE))
  (i32.store (i32.const @PG_LEN) (i32.add (i32.const @MZ_LEN0) (i32.mul (local.get $m) (i32.const @MZ_LENK))))
  (f32.store (i32.const @PG_SIZE) (local.get $half))
  (f32.store (i32.const @PG_IDLE) (f32.const @MZ_IDLE))
  (i32.store (i32.const @PG_RESPAWN) (i32.const 0x7fffffff))
  (i32.store (i32.const @PG_FLAGS) (i32.const @(PGF_BUMPS | PGF_NOKICK)))
  (i32.store (i32.const @(PG_H + MZ_N)) (local.get $m))
  (f32.store (i32.const @(PG_H + MZ_X0)) (f32.sub (f32.load (i32.const @PG_CX)) (local.get $half)))
  (f32.store (i32.const @(PG_H + MZ_HALF)) (local.get $half))
  (call $mz_lay (local.get $m))
  (call $mz_starts (local.get $n)))

;; Every edge of cell c a hedge but those in keep (0x0f its east, 0xf0 its south).
(func $mz_dig (param $c i32) (param $keep i32)
  (i32.store8 offset=@(PG_S + MZ_CELLS) (local.get $c) (i32.and (i32.load8_u offset=@(PG_S + MZ_CELLS) (local.get $c)) (local.get $keep))))

;; The rectangle of cells (i0, j0) to (i1, j1) one open space: every edge between two of them dug.
(func $mz_room (param $i0 i32) (param $j0 i32) (param $i1 i32) (param $j1 i32) (param $n i32)
  (local $i i32) (local $j i32) (local $c i32)
  (!for $j (local.get $j0) (i32.add (local.get $j1) (i32.const 1))
    (!for $i (local.get $i0) (i32.add (local.get $i1) (i32.const 1))
      (local.set $c (i32.add (i32.mul (local.get $j) (local.get $n)) (local.get $i)))
      (if (i32.lt_u (local.get $i) (local.get $i1)) (then (call $mz_dig (local.get $c) (i32.const 0xf0))))
      (if (i32.lt_u (local.get $j) (local.get $j1)) (then (call $mz_dig (local.get $c) (i32.const 0x0f)))))))

;; A hedge left inside (kind MZ_WALL in the nibble at shift s of cell c's byte a):
;; loop in 256 dug for a loop, MZ_PDOOR a door of any group; a's byte back.
(func $mz_open (param $a i32) (param $s i32) (param $loop i32) (result i32)
  (local $r i32) (local $q i32)
  (if (i32.ne (i32.and (i32.shr_u (local.get $a) (local.get $s)) (i32.const 15)) (i32.const @MZ_WALL)) (then (return (local.get $a))))
  (local.set $r (call $rand))
  (local.set $q (i32.and (local.get $r) (i32.const 255)))
  (local.set $a (i32.and (local.get $a) (i32.xor (i32.shl (i32.const 15) (local.get $s)) (i32.const 0xff))))
  (if (i32.lt_u (local.get $q) (local.get $loop)) (then (return (local.get $a))))
  (if (i32.lt_u (local.get $q) (i32.add (local.get $loop) (i32.const @MZ_PDOOR)))
    (then (return (i32.or (local.get $a) (i32.shl (i32.add (i32.const @MZ_DOOR) (i32.rem_u (i32.shr_u (local.get $r) (i32.const 8)) (i32.const @MZ_NG)))
                                                  (local.get $s))))))
  (i32.or (local.get $a) (i32.shl (i32.const @MZ_WALL) (local.get $s))))

;; The maze n a side, from the PRNG: every edge a hedge; a depth-first dig
;; from the middle cell (each step to an undug neighbour the PRNG picks,
;; back up the stack when there's none), so every cell has one path to the
;; middle; the room round the pad; the halls; loops and doors from the
;; hedges left inside (more loops the bigger the maze: a crowd needs ways
;; round a queue); then the doors' groups for each epoch, a few of them
;; turned over each time (at least one).
(func $mz_lay (param $n i32)
  (local $c i32) (local $i i32) (local $j i32) (local $sp i32) (local $opts i32) (local $cnt i32) (local $r i32) (local $dir i32) (local $nb i32)
  (local $h i32) (local $len i32) (local $w i32) (local $hh i32) (local $i0 i32) (local $j0 i32) (local $a i32) (local $e i32) (local $mask i32)
  (memory.fill (i32.const @(PG_S + MZ_CELLS)) (i32.const 0x11) (i32.mul (local.get $n) (local.get $n)))
  (local.set $c (i32.shr_u (i32.mul (local.get $n) (local.get $n)) (i32.const 1)))
  (i32.store8 offset=@(PG_BIG + MZ_SEEN) (local.get $c) (i32.const 1))
  (!st u16 @(PG_BIG + MZ_QUEUE) (i32.const 0) (local.get $c))
  (local.set $sp (i32.const 1))
  (block $dug
    (loop $dig
      (br_if $dug (i32.eqz (local.get $sp)))
      (local.set $c (!ld u16 @(PG_BIG + MZ_QUEUE) (i32.sub (local.get $sp) (i32.const 1))))
      (local.set $i (i32.rem_u (local.get $c) (local.get $n)))
      (local.set $j (i32.div_u (local.get $c) (local.get $n)))
      (local.set $opts (i32.const 0))
      (if (i32.lt_u (i32.add (local.get $i) (i32.const 1)) (local.get $n))
        (then (if (i32.eqz (i32.load8_u offset=@(PG_BIG + MZ_SEEN) (i32.add (local.get $c) (i32.const 1)))) (then (local.set $opts (i32.or (local.get $opts) (i32.const 1)))))))
      (if (i32.lt_u (i32.add (local.get $j) (i32.const 1)) (local.get $n))
        (then (if (i32.eqz (i32.load8_u offset=@(PG_BIG + MZ_SEEN) (i32.add (local.get $c) (local.get $n)))) (then (local.set $opts (i32.or (local.get $opts) (i32.const 2)))))))
      (if (local.get $i)
        (then (if (i32.eqz (i32.load8_u offset=@(PG_BIG + MZ_SEEN) (i32.sub (local.get $c) (i32.const 1)))) (then (local.set $opts (i32.or (local.get $opts) (i32.const 4)))))))
      (if (local.get $j)
        (then (if (i32.eqz (i32.load8_u offset=@(PG_BIG + MZ_SEEN) (i32.sub (local.get $c) (local.get $n)))) (then (local.set $opts (i32.or (local.get $opts) (i32.const 8)))))))
      (local.set $cnt (i32.popcnt (local.get $opts)))
      (if (i32.eqz (local.get $cnt))
        (then (local.set $sp (i32.sub (local.get $sp) (i32.const 1))) (br $dig)))
      ;; the r-th way open, round from east
      (local.set $r (i32.rem_u (call $rand) (local.get $cnt)))
      (local.set $dir (i32.const 0))
      (block $found
        (loop $way
          (if (i32.and (local.get $opts) (i32.shl (i32.const 1) (local.get $dir)))
            (then
              (br_if $found (i32.eqz (local.get $r)))
              (local.set $r (i32.sub (local.get $r) (i32.const 1)))))
          (!inc $dir)
          (br $way)))
      (if (i32.eqz (local.get $dir)) (then (call $mz_dig (local.get $c) (i32.const 0xf0)) (local.set $nb (i32.add (local.get $c) (i32.const 1)))))
      (if (i32.eq (local.get $dir) (i32.const 1)) (then (call $mz_dig (local.get $c) (i32.const 0x0f)) (local.set $nb (i32.add (local.get $c) (local.get $n)))))
      (if (i32.eq (local.get $dir) (i32.const 2))
        (then (local.set $nb (i32.sub (local.get $c) (i32.const 1))) (call $mz_dig (local.get $nb) (i32.const 0xf0))))
      (if (i32.eq (local.get $dir) (i32.const 3))
        (then (local.set $nb (i32.sub (local.get $c) (local.get $n))) (call $mz_dig (local.get $nb) (i32.const 0x0f))))
      (i32.store8 offset=@(PG_BIG + MZ_SEEN) (local.get $nb) (i32.const 1))
      (!st u16 @(PG_BIG + MZ_QUEUE) (local.get $sp) (local.get $nb))
      (!inc $sp)
      (br $dig)))
  ;; the room round the pad
  (local.set $i (i32.shr_u (local.get $n) (i32.const 1)))
  (call $mz_room (i32.sub (local.get $i) (i32.const 1)) (i32.sub (local.get $i) (i32.const 1))
                 (i32.add (local.get $i) (i32.const 1)) (i32.add (local.get $i) (i32.const 1)) (local.get $n))
  ;; the halls: two cells wide, MZ_HALL0 to MZ_HALL0 + 3 long, across or down
  (!for $h (i32.const 0) (i32.div_u (local.get $n) (i32.const @MZ_HALL))
    (local.set $r (call $rand))
    (local.set $len (i32.add (i32.const @MZ_HALL0) (i32.and (i32.shr_u (local.get $r) (i32.const 1)) (i32.const 3))))
    (local.set $w (select (local.get $len) (i32.const 2) (i32.and (local.get $r) (i32.const 1))))
    (local.set $hh (select (i32.const 2) (local.get $len) (i32.and (local.get $r) (i32.const 1))))
    (local.set $i0 (i32.rem_u (call $rand) (i32.add (i32.sub (local.get $n) (local.get $w)) (i32.const 1))))
    (local.set $j0 (i32.rem_u (call $rand) (i32.add (i32.sub (local.get $n) (local.get $hh)) (i32.const 1))))
    (call $mz_room (local.get $i0) (local.get $j0) (i32.sub (i32.add (local.get $i0) (local.get $w)) (i32.const 1))
                   (i32.sub (i32.add (local.get $j0) (local.get $hh)) (i32.const 1)) (local.get $n)))
  ;; loops and doors from the hedges left inside (not the rim's)
  (!for $c (i32.const 0) (i32.mul (local.get $n) (local.get $n))
    (local.set $a (i32.load8_u offset=@(PG_S + MZ_CELLS) (local.get $c)))
    (if (i32.lt_u (i32.add (i32.rem_u (local.get $c) (local.get $n)) (i32.const 1)) (local.get $n))
      (then (local.set $a (call $mz_open (local.get $a) (i32.const 0) (i32.add (i32.const @MZ_PLOOP) (i32.shr_u (local.get $n) (i32.const 1)))))))
    (if (i32.lt_u (i32.add (i32.div_u (local.get $c) (local.get $n)) (i32.const 1)) (local.get $n))
      (then (local.set $a (call $mz_open (local.get $a) (i32.const 4) (i32.add (i32.const @MZ_PLOOP) (i32.shr_u (local.get $n) (i32.const 1)))))))
    (i32.store8 offset=@(PG_S + MZ_CELLS) (local.get $c) (local.get $a)))
  ;; the doors' groups open, epoch by epoch
  (local.set $mask (i32.and (call $rand) (i32.const @((1 << MZ_NG) - 1))))
  (!for $e (i32.const 0) (i32.const @MZ_NE)
    (!st i32 @(PG_S + MZ_MASKS) (local.get $e) (local.get $mask))
    (local.set $r (call $rand))
    (local.set $mask (i32.xor (local.get $mask)
                              (i32.or (i32.and (local.get $r) (i32.const @((1 << MZ_NG) - 1)))
                                      (i32.shl (i32.const 1) (i32.rem_u (i32.shr_u (local.get $r) (i32.const 16)) (i32.const @MZ_NG))))))))

;; Where n balls start: the paths through the first epoch's doors worked
;; (MZ_DIST, as play starts with them), and of the cells the same way from
;; the middle the furthest out there are enough of: the most distance D
;; with need cells at it, need one a ball up to MZ_SPREAD and a quarter of
;; the balls past that (four to a cell); no distance with that many, the
;; cells at D or D + 1 (and so on, wider). Listed in MZ_STARTS in scan
;; order. Starts by the maze's own paths alone, without the doors, would
;; differ by as much as the doors cut: 6 to 20 cells on a 15 a side.
(func $mz_starts (param $n i32)
  (local $m2 i32) (local $c i32) (local $k i32) (local $max i32) (local $need i32) (local $w i32) (local $d i32) (local $s i32) (local $cnt i32)
  (local.set $m2 (i32.mul (i32.load (i32.const @(PG_H + MZ_N))) (i32.load (i32.const @(PG_H + MZ_N)))))
  (call $mz_bfs (call $mz_mask (i32.const 0)))
  ;; how many cells at each distance (every cell is reached: the dug paths need no door)
  (memory.fill (i32.const @(PG_BIG + MZ_HIST)) (i32.const 0) (i32.shl (local.get $m2) (i32.const 1)))
  (!for $c (i32.const 0) (local.get $m2)
    (local.set $k (!ld u16 @(PG_BIG + MZ_DIST) (local.get $c)))
    (if (i32.lt_u (local.get $k) (local.get $m2))
      (then
        (!st u16 @(PG_BIG + MZ_HIST) (local.get $k) (i32.add (!ld u16 @(PG_BIG + MZ_HIST) (local.get $k)) (i32.const 1)))
        (if (i32.gt_u (local.get $k) (local.get $max)) (then (local.set $max (local.get $k)))))))
  (local.set $need (i32.shr_u (i32.add (local.get $n) (i32.const 3)) (i32.const 2)))
  (local.set $k (select (local.get $n) (i32.const @MZ_SPREAD) (i32.lt_u (local.get $n) (i32.const @MZ_SPREAD))))
  (if (i32.gt_u (local.get $k) (local.get $need)) (then (local.set $need (local.get $k))))
  (if (i32.eqz (local.get $need)) (then (local.set $need (i32.const 1))))
  ;; the window w distances wide, from the furthest out in (at w = max, every cell but the pad's)
  (local.set $w (i32.const 1))
  (block $found
    (loop $wider
      (local.set $d (local.get $max))
      (loop $down
        (local.set $s (i32.const 0))
        (!for $k (local.get $d) (i32.add (local.get $d) (local.get $w))
          (if (i32.le_u (local.get $k) (local.get $max)) (then (local.set $s (i32.add (local.get $s) (!ld u16 @(PG_BIG + MZ_HIST) (local.get $k)))))))
        (br_if $found (i32.ge_u (local.get $s) (local.get $need)))
        (local.set $d (i32.sub (local.get $d) (i32.const 1)))
        (br_if $down (i32.ge_s (local.get $d) (i32.const 1))))
      (!inc $w)
      (br $wider)))
  (!for $c (i32.const 0) (local.get $m2)
    (if (i32.lt_u (i32.sub (!ld u16 @(PG_BIG + MZ_DIST) (local.get $c)) (local.get $d)) (local.get $w))
      (then
        (!st u16 @(PG_BIG + MZ_STARTS) (local.get $cnt) (local.get $c))
        (!inc $cnt))))
  (i32.store (i32.const @(PG_H + MZ_NST)) (local.get $cnt))
  (i32.store (i32.const @(PG_H + MZ_SD)) (local.get $d))
  (i32.store (i32.const @(PG_H + MZ_SW)) (local.get $w)))

;; Ball i of n on its start cell: one to a cell spread evenly along the list
;; while there are cells enough; past that up to four a cell, MZ_SPOT off
;; its centre either way, each layer spread along it. A ball coming in late
;; (n 1024) at a start cell by i.
(func $mz_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $m i32) (local $k i32) (local $c i32) (local $l i32) (local $base i32) (local $cnt i32)
  (local $ox f32) (local $oz f32) (local $x0 f32)
  (local.set $m (i32.load (i32.const @(PG_H + MZ_N))))
  (local.set $k (i32.load (i32.const @(PG_H + MZ_NST))))
  (if (i32.le_u (local.get $n) (local.get $k))
    (then (local.set $c (i32.div_u (i32.mul (local.get $i) (local.get $k)) (select (local.get $n) (i32.const 1) (local.get $n)))))
    (else
      (local.set $l (i32.div_u (local.get $i) (local.get $k)))
      (local.set $base (i32.mul (local.get $l) (local.get $k)))
      (local.set $cnt (i32.sub (local.get $n) (local.get $base)))
      (if (i32.gt_u (local.get $cnt) (local.get $k)) (then (local.set $cnt (local.get $k))))
      (local.set $c (i32.div_u (i32.mul (i32.sub (local.get $i) (local.get $base)) (local.get $k)) (local.get $cnt)))
      (local.set $l (i32.and (local.get $l) (i32.const 3)))
      (local.set $ox (select (f32.const @(-MZ_SPOT)) (f32.const @MZ_SPOT) (i32.and (local.get $l) (i32.const 1))))
      (local.set $oz (select (f32.const @(-MZ_SPOT)) (f32.const @MZ_SPOT) (i32.and (i32.xor (local.get $l) (i32.shr_u (local.get $l) (i32.const 1))) (i32.const 1))))))
  (local.set $c (!ld u16 @(PG_BIG + MZ_STARTS) (i32.rem_u (local.get $c) (local.get $k))))
  (local.set $x0 (f32.load (i32.const @(PG_H + MZ_X0))))
  (f32.add (!madd (f32.add (f32.convert_i32_u (i32.rem_u (local.get $c) (local.get $m))) (f32.const 0.5)) (f32.const @MZ_C) (local.get $x0)) (local.get $ox))
  (f32.const @PLAT_Y)
  (f32.add (!madd (f32.add (f32.convert_i32_u (i32.div_u (local.get $c) (local.get $m))) (f32.const 0.5)) (f32.const @MZ_C) (local.get $x0)) (local.get $oz)))

;; ---- the paths (the confirmed world's)

;; Every cell's distance in cells along the open paths to the middle, the
;; doors' groups in mask open: a breadth-first search out from the pad's cell.
(func $mz_bfs (param $mask i32)
  (local $n i32) (local $c i32) (local $i i32) (local $j i32) (local $head i32) (local $tail i32) (local $k i32) (local $a i32)
  (local.set $n (i32.load (i32.const @(PG_H + MZ_N))))
  (memory.fill (i32.const @(PG_BIG + MZ_DIST)) (i32.const 0xff) (i32.shl (i32.mul (local.get $n) (local.get $n)) (i32.const 1)))
  (local.set $c (i32.shr_u (i32.mul (local.get $n) (local.get $n)) (i32.const 1)))
  (!st u16 @(PG_BIG + MZ_DIST) (local.get $c) (i32.const 0))
  (!st u16 @(PG_BIG + MZ_QUEUE) (i32.const 0) (local.get $c))
  (local.set $tail (i32.const 1))
  (block $done
    (loop $next
      (br_if $done (i32.ge_u (local.get $head) (local.get $tail)))
      (local.set $c (!ld u16 @(PG_BIG + MZ_QUEUE) (local.get $head)))
      (!inc $head)
      (local.set $i (i32.rem_u (local.get $c) (local.get $n)))
      (local.set $j (i32.div_u (local.get $c) (local.get $n)))
      (local.set $k (i32.add (!ld u16 @(PG_BIG + MZ_DIST) (local.get $c)) (i32.const 1)))
      (local.set $a (i32.load8_u offset=@(PG_S + MZ_CELLS) (local.get $c)))
      (if (i32.lt_u (i32.add (local.get $i) (i32.const 1)) (local.get $n))
        (then (if (i32.and (i32.eqz (call $mz_shut (i32.and (local.get $a) (i32.const 15)) (local.get $mask)))
                           (i32.eq (!ld u16 @(PG_BIG + MZ_DIST) (i32.add (local.get $c) (i32.const 1))) (i32.const 0xffff)))
                (then
                  (!st u16 @(PG_BIG + MZ_DIST) (i32.add (local.get $c) (i32.const 1)) (local.get $k))
                  (!st u16 @(PG_BIG + MZ_QUEUE) (local.get $tail) (i32.add (local.get $c) (i32.const 1)))
                  (!inc $tail)))))
      (if (i32.lt_u (i32.add (local.get $j) (i32.const 1)) (local.get $n))
        (then (if (i32.and (i32.eqz (call $mz_shut (i32.shr_u (local.get $a) (i32.const 4)) (local.get $mask)))
                           (i32.eq (!ld u16 @(PG_BIG + MZ_DIST) (i32.add (local.get $c) (local.get $n))) (i32.const 0xffff)))
                (then
                  (!st u16 @(PG_BIG + MZ_DIST) (i32.add (local.get $c) (local.get $n)) (local.get $k))
                  (!st u16 @(PG_BIG + MZ_QUEUE) (local.get $tail) (i32.add (local.get $c) (local.get $n)))
                  (!inc $tail)))))
      (if (local.get $i)
        (then (if (i32.and (i32.eqz (call $mz_shut (i32.and (i32.load8_u offset=@(PG_S + MZ_CELLS) (i32.sub (local.get $c) (i32.const 1))) (i32.const 15)) (local.get $mask)))
                           (i32.eq (!ld u16 @(PG_BIG + MZ_DIST) (i32.sub (local.get $c) (i32.const 1))) (i32.const 0xffff)))
                (then
                  (!st u16 @(PG_BIG + MZ_DIST) (i32.sub (local.get $c) (i32.const 1)) (local.get $k))
                  (!st u16 @(PG_BIG + MZ_QUEUE) (local.get $tail) (i32.sub (local.get $c) (i32.const 1)))
                  (!inc $tail)))))
      (if (local.get $j)
        (then (if (i32.and (i32.eqz (call $mz_shut (i32.shr_u (i32.load8_u offset=@(PG_S + MZ_CELLS) (i32.sub (local.get $c) (local.get $n))) (i32.const 4)) (local.get $mask)))
                           (i32.eq (!ld u16 @(PG_BIG + MZ_DIST) (i32.sub (local.get $c) (local.get $n))) (i32.const 0xffff)))
                (then
                  (!st u16 @(PG_BIG + MZ_DIST) (i32.sub (local.get $c) (local.get $n)) (local.get $k))
                  (!st u16 @(PG_BIG + MZ_QUEUE) (local.get $tail) (i32.sub (local.get $c) (local.get $n)))
                  (!inc $tail)))))
      (br $next))))

;; How many doors are of the groups in g.
(func $mz_doors (param $g i32) (result i32)
  (local $n i32) (local $c i32) (local $a i32) (local $k i32) (local $cnt i32)
  (local.set $n (i32.load (i32.const @(PG_H + MZ_N))))
  (!for $c (i32.const 0) (i32.mul (local.get $n) (local.get $n))
    (local.set $a (i32.load8_u offset=@(PG_S + MZ_CELLS) (local.get $c)))
    (local.set $k (i32.and (local.get $a) (i32.const 15)))
    (if (i32.and (i32.ge_u (local.get $k) (i32.const @MZ_DOOR)) (i32.lt_u (i32.add (i32.rem_u (local.get $c) (local.get $n)) (i32.const 1)) (local.get $n)))
      (then (if (i32.and (i32.shr_u (local.get $g) (i32.sub (local.get $k) (i32.const @MZ_DOOR))) (i32.const 1)) (then (!inc $cnt)))))
    (local.set $k (i32.shr_u (local.get $a) (i32.const 4)))
    (if (i32.and (i32.ge_u (local.get $k) (i32.const @MZ_DOOR)) (i32.lt_u (i32.add (i32.div_u (local.get $c) (local.get $n)) (i32.const 1)) (local.get $n)))
      (then (if (i32.and (i32.shr_u (local.get $g) (i32.sub (local.get $k) (i32.const @MZ_DOOR))) (i32.const 1)) (then (!inc $cnt))))))
  (local.get $cnt))

;; Ball pb's PG_SCORE at the end, not home: MZ_SFAR less twice the metres
;; along the open paths from it to the middle (its cell's distance, less how
;; far it is across the cell toward the next one on the way: the first of
;; east, south, west, north a cell nearer), 0 off every path.
(func $mz_score (param $pb i32) (result i32)
  (local $n i32) (local $i i32) (local $j i32) (local $c i32) (local $k i32) (local $mask i32) (local $a i32)
  (local $x0 f32) (local $u f32) (local $w f32) (local $dx f32) (local $dz f32) (local $path f32)
  (local.set $n (i32.load (i32.const @(PG_H + MZ_N))))
  (local.set $x0 (f32.load (i32.const @(PG_H + MZ_X0))))
  (local.set $u (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (local.get $x0)))
  (local.set $w (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (local.get $x0)))
  (local.set $i (call $mz_at (local.get $u) (local.get $n)))
  (local.set $j (call $mz_at (local.get $w) (local.get $n)))
  (local.set $c (i32.add (i32.mul (local.get $j) (local.get $n)) (local.get $i)))
  (local.set $k (!ld u16 @(PG_BIG + MZ_DIST) (local.get $c)))
  (if (i32.eq (local.get $k) (i32.const 0xffff)) (then (return (i32.const 0))))
  (if (i32.eqz (local.get $k)) (then (return (i32.const @MZ_SFAR))))
  (local.set $mask (call $mz_mask (call $p_t (i32.const 0))))
  (local.set $a (i32.load8_u offset=@(PG_S + MZ_CELLS) (local.get $c)))
  (block $way
    (if (i32.lt_u (i32.add (local.get $i) (i32.const 1)) (local.get $n))
      (then (if (i32.and (i32.eqz (call $mz_shut (i32.and (local.get $a) (i32.const 15)) (local.get $mask)))
                         (i32.eq (!ld u16 @(PG_BIG + MZ_DIST) (i32.add (local.get $c) (i32.const 1))) (i32.sub (local.get $k) (i32.const 1))))
              (then (local.set $dx (f32.const 1)) (br $way)))))
    (if (i32.lt_u (i32.add (local.get $j) (i32.const 1)) (local.get $n))
      (then (if (i32.and (i32.eqz (call $mz_shut (i32.shr_u (local.get $a) (i32.const 4)) (local.get $mask)))
                         (i32.eq (!ld u16 @(PG_BIG + MZ_DIST) (i32.add (local.get $c) (local.get $n))) (i32.sub (local.get $k) (i32.const 1))))
              (then (local.set $dz (f32.const 1)) (br $way)))))
    (if (local.get $i)
      (then (if (i32.and (i32.eqz (call $mz_shut (i32.and (i32.load8_u offset=@(PG_S + MZ_CELLS) (i32.sub (local.get $c) (i32.const 1))) (i32.const 15)) (local.get $mask)))
                         (i32.eq (!ld u16 @(PG_BIG + MZ_DIST) (i32.sub (local.get $c) (i32.const 1))) (i32.sub (local.get $k) (i32.const 1))))
              (then (local.set $dx (f32.const -1)) (br $way)))))
    (if (local.get $j)
      (then (if (i32.and (i32.eqz (call $mz_shut (i32.shr_u (i32.load8_u offset=@(PG_S + MZ_CELLS) (i32.sub (local.get $c) (local.get $n))) (i32.const 4)) (local.get $mask)))
                         (i32.eq (!ld u16 @(PG_BIG + MZ_DIST) (i32.sub (local.get $c) (local.get $n))) (i32.sub (local.get $k) (i32.const 1))))
              (then (local.set $dz (f32.const -1)))))))
  (local.set $path (f32.sub (f32.mul (f32.convert_i32_u (local.get $k)) (f32.const @MZ_C))
                            (!clamp (!madd (f32.sub (local.get $u) (!madd (f32.convert_i32_u (local.get $i)) (f32.const @MZ_C) (f32.const @(MZ_C / 2)))) (local.get $dx)
                                           (f32.mul (f32.sub (local.get $w) (!madd (f32.convert_i32_u (local.get $j)) (f32.const @MZ_C) (f32.const @(MZ_C / 2)))) (local.get $dz)))
                                    (f32.const @(-MZ_C / 2)) (f32.const @(MZ_C / 2)))))
  (!chk (local.get $path) 81 (local.get $c))
  (local.set $k (i32.trunc_sat_f32_u (f32.mul (local.get $path) (f32.const 2))))
  (select (i32.sub (i32.const @MZ_SFAR) (local.get $k)) (i32.const 0) (i32.lt_u (local.get $k) (i32.const @MZ_SFAR))))

;; ---- the hooks

;; Play starts: the paths through the first epoch's doors are setup's.
(func $mz_start)

(func $mz_begin (param $p i32) (param $d i32))

;; The floor over the maze and its rim, nothing past it, on bank d.
(func $mz_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $h f32) (local $cx f32)
  (if (f32.lt (local.get $y) (f32.const @PLAT_Y)) (then (return (f32.const -1000))))
  (local.set $h (f32.add (f32.load offset=@(PG_H + MZ_HALF) (local.get $d)) (f32.const @MZ_HT)))
  (local.set $cx (f32.load offset=@PG_CX (local.get $d)))
  (if (result f32) (i32.and (f32.le (f32.abs (f32.sub (local.get $x) (local.get $cx))) (local.get $h))
                            (f32.le (f32.abs (f32.sub (local.get $z) (local.get $cx))) (local.get $h)))
    (then (f32.const @PLAT_Y))
    (else (f32.const -1000))))

;; Ball (u, w) of radius r rolling (vx, vz) against the box [xa, xb] x [za, zb]
;; (all in the maze's frame): out of it the nearest way, and of its speed
;; into it MZ_BOUNCE given back; how fast it came in (-1 if it doesn't touch).
(func $mz_box (param $u f32) (param $w f32) (param $vx f32) (param $vz f32) (param $r f32)
              (param $xa f32) (param $xb f32) (param $za f32) (param $zb f32) (result f32 f32 f32 f32 f32)
  (local $dx f32) (local $dz f32) (local $dd f32) (local $nx f32) (local $nz f32) (local $dep f32) (local $e f32) (local $vn f32)
  (local.set $dx (f32.sub (local.get $u) (!clamp (local.get $u) (local.get $xa) (local.get $xb))))
  (local.set $dz (f32.sub (local.get $w) (!clamp (local.get $w) (local.get $za) (local.get $zb))))
  (local.set $dd (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))))
  (if (f32.ge (local.get $dd) (f32.mul (local.get $r) (local.get $r)))
    (then (return (local.get $u) (local.get $w) (local.get $vx) (local.get $vz) (f32.const -1))))
  (if (f32.gt (local.get $dd) (f32.const 1e-8))
    (then
      (local.set $dd (f32.sqrt (local.get $dd)))
      (local.set $nx (f32.div (local.get $dx) (local.get $dd)))
      (local.set $nz (f32.div (local.get $dz) (local.get $dd)))
      (local.set $dep (f32.sub (local.get $r) (local.get $dd))))
    (else
      ;; its centre in the hedge (a bump, a door shutting on it): out the nearest side
      (local.set $dep (f32.sub (local.get $u) (local.get $xa)))
      (local.set $nx (f32.const -1))
      (local.set $e (f32.sub (local.get $xb) (local.get $u)))
      (if (f32.lt (local.get $e) (local.get $dep)) (then (local.set $dep (local.get $e)) (local.set $nx (f32.const 1))))
      (local.set $e (f32.sub (local.get $w) (local.get $za)))
      (if (f32.lt (local.get $e) (local.get $dep)) (then (local.set $dep (local.get $e)) (local.set $nx (f32.const 0)) (local.set $nz (f32.const -1))))
      (local.set $e (f32.sub (local.get $zb) (local.get $w)))
      (if (f32.lt (local.get $e) (local.get $dep)) (then (local.set $dep (local.get $e)) (local.set $nx (f32.const 0)) (local.set $nz (f32.const 1))))
      (local.set $dep (f32.add (local.get $dep) (local.get $r)))))
  (local.set $u (!madd (local.get $nx) (local.get $dep) (local.get $u)))
  (local.set $w (!madd (local.get $nz) (local.get $dep) (local.get $w)))
  (local.set $vn (!madd (local.get $vx) (local.get $nx) (f32.mul (local.get $vz) (local.get $nz))))
  (if (f32.lt (local.get $vn) (f32.const 0))
    (then
      (local.set $vx (f32.sub (local.get $vx) (f32.mul (f32.mul (local.get $vn) (f32.const @(1 + MZ_BOUNCE))) (local.get $nx))))
      (local.set $vz (f32.sub (local.get $vz) (f32.mul (f32.mul (local.get $vn) (f32.const @(1 + MZ_BOUNCE))) (local.get $nz)))))
    (else (local.set $vn (f32.const 0))))
  (local.get $u) (local.get $w) (local.get $vx) (local.get $vz) (f32.neg (local.get $vn)))

;; The hedges and shut doors round ball p on bank d, as they stand on its
;; tick: the twelve lines that can reach a ball in its cell (its four sides,
;; and the ends of the eight that meet its corners), each a box MZ_HT either
;; side of its line and past its ends, in a fixed order. A hard knock is an
;; FX on this bank's ring.
(func $mz_push (param $p i32) (param $d i32)
  (local $pb i32) (local $n i32) (local $i i32) (local $j i32) (local $a i32) (local $b i32) (local $k i32) (local $mask i32) (local $moved i32)
  (local $x0 f32) (local $py f32) (local $u f32) (local $w f32) (local $vx f32) (local $vz f32) (local $r f32) (local $l f32) (local $q f32) (local $hit f32) (local $max f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (if (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @(PF_FALL | PF_DEAD))) (then (return)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (if (f32.ge (local.get $py) (f32.const @(+PLAT_Y + MZ_HIGH))) (then (return)))
  (local.set $n (i32.load offset=@(PG_H + MZ_N) (local.get $d)))
  (if (i32.eqz (local.get $n)) (then (return)))
  (local.set $x0 (f32.load offset=@(PG_H + MZ_X0) (local.get $d)))
  (local.set $mask (call $mz_mask (call $p_t (local.get $d))))
  (local.set $r (call $b_rad (local.get $pb)))
  (local.set $u (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (local.get $x0)))
  (local.set $w (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (local.get $x0)))
  (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  (local.set $i (call $mz_at (local.get $u) (local.get $n)))
  (local.set $j (call $mz_at (local.get $w) (local.get $n)))
  ;; the lines x = (i + a) C, rows j - 1 to j + 1
  (!for $a (i32.const 0) (i32.const 2)
    (local.set $l (f32.mul (f32.convert_i32_s (i32.add (local.get $i) (local.get $a))) (f32.const @MZ_C)))
    (!for $b (i32.const 0) (i32.const 3)
      (local.set $k (i32.sub (i32.add (local.get $j) (local.get $b)) (i32.const 1)))
      (if (call $mz_shut (call $mz_v (i32.add (local.get $i) (local.get $a)) (local.get $k) (local.get $n)) (local.get $mask))
        (then
          (local.set $q (f32.mul (f32.convert_i32_s (local.get $k)) (f32.const @MZ_C)))
          (call $mz_box (local.get $u) (local.get $w) (local.get $vx) (local.get $vz) (local.get $r)
                        (f32.sub (local.get $l) (f32.const @MZ_HT)) (f32.add (local.get $l) (f32.const @MZ_HT))
                        (f32.sub (local.get $q) (f32.const @MZ_HT)) (f32.add (local.get $q) (f32.const @(MZ_C + MZ_HT))))
          (local.set $hit) (local.set $vz) (local.set $vx) (local.set $w) (local.set $u)
          (if (f32.ge (local.get $hit) (f32.const 0)) (then (local.set $moved (i32.const 1)) (local.set $max (f32.max (local.get $max) (local.get $hit)))))))))
  ;; the lines z = (j + b) C, columns i - 1 to i + 1
  (!for $b (i32.const 0) (i32.const 2)
    (local.set $l (f32.mul (f32.convert_i32_s (i32.add (local.get $j) (local.get $b))) (f32.const @MZ_C)))
    (!for $a (i32.const 0) (i32.const 3)
      (local.set $k (i32.sub (i32.add (local.get $i) (local.get $a)) (i32.const 1)))
      (if (call $mz_shut (call $mz_h (local.get $k) (i32.add (local.get $j) (local.get $b)) (local.get $n)) (local.get $mask))
        (then
          (local.set $q (f32.mul (f32.convert_i32_s (local.get $k)) (f32.const @MZ_C)))
          (call $mz_box (local.get $u) (local.get $w) (local.get $vx) (local.get $vz) (local.get $r)
                        (f32.sub (local.get $q) (f32.const @MZ_HT)) (f32.add (local.get $q) (f32.const @(MZ_C + MZ_HT)))
                        (f32.sub (local.get $l) (f32.const @MZ_HT)) (f32.add (local.get $l) (f32.const @MZ_HT)))
          (local.set $hit) (local.set $vz) (local.set $vx) (local.set $w) (local.set $u)
          (if (f32.ge (local.get $hit) (f32.const 0)) (then (local.set $moved (i32.const 1)) (local.set $max (f32.max (local.get $max) (local.get $hit)))))))))
  (if (local.get $moved)
    (then
      (local.set $u (f32.add (local.get $u) (local.get $x0)))
      (local.set $w (f32.add (local.get $w) (local.get $x0)))
      (!chk (local.get $u) 82 (local.get $p))
      (!chk (local.get $w) 83 (local.get $p))
      (!chk (local.get $vx) 84 (local.get $p))
      (!chk (local.get $vz) 85 (local.get $p))
      (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $u))
      (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $w))
      (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
      (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))
      (if (f32.gt (local.get $max) (f32.const @MZ_BONK))
        (then (call $fx (local.get $d) (i32.const @MZ_FX_BONK) (local.get $p) (i32.const 0) (local.get $u) (local.get $py) (local.get $w) (local.get $max)))))))

;; The doors: MZ_WARN ticks before they move, how many will; as they move,
;; the paths again. Then in slot order, a ball whose centre is on the pad
;; is home: out of play where it is, placed by the balls home before this
;; tick, the first cutting the clock to MZ_LATE.
(func $mz_tick
  (local $t i32) (local $tick i32) (local $p i32) (local $pb i32) (local $fin0 i32) (local $fin i32) (local $mask i32)
  (local $cx f32) (local $dx f32) (local $dz f32)
  (local.set $t (call $p_t (i32.const 0)))
  (local.set $tick (i32.load (i32.const @HDR_TICK)))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (if (i32.and (i32.ne (local.get $t) (i32.const 0)) (i32.eqz (i32.rem_u (local.get $t) (i32.const @MZ_PERIOD))))
    (then
      (local.set $mask (call $mz_mask (local.get $t)))
      (call $mz_bfs (local.get $mask))
      (call $fx (i32.const 0) (i32.const @MZ_FX_DOORS) (i32.const 255) (call $mz_doors (local.get $mask))
                (local.get $cx) (f32.const @PLAT_Y) (local.get $cx) (f32.convert_i32_u (i32.div_u (local.get $t) (i32.const @MZ_PERIOD))))))
  (if (i32.eqz (i32.rem_u (i32.add (local.get $t) (i32.const @MZ_WARN)) (i32.const @MZ_PERIOD)))
    (then
      (call $fx (i32.const 0) (i32.const @MZ_FX_WARN) (i32.const 255)
                (call $mz_doors (i32.xor (call $mz_mask (local.get $t)) (call $mz_mask (i32.add (local.get $t) (i32.const @MZ_WARN)))))
                (local.get $cx) (f32.const @PLAT_Y) (local.get $cx) (f32.convert_i32_u (i32.div_u (i32.add (local.get $t) (i32.const @MZ_WARN)) (i32.const @MZ_PERIOD))))))
  (local.set $fin0 (i32.load (i32.const @(PG_H + MZ_FIN))))
  (local.set $fin (local.get $fin0))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (call $p_in (local.get $pb))
      (then
        (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (local.get $cx)))
        (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (local.get $cx)))
        (if (f32.le (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))) (f32.const @(MZ_PAD_R * MZ_PAD_R)))
          (then
            (if (i32.eqz (local.get $fin))
              (then
                (i32.store (i32.const @(PG_H + MZ_FIRST)) (local.get $t))
                (if (i32.gt_u (i32.load (i32.const @HDR_UNTIL)) (i32.add (local.get $tick) (i32.const @MZ_LATE)))
                  (then (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $tick) (i32.const @MZ_LATE)))))))
            (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.or (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_DEAD)))
            (!put i32 @(PLAYERS + B_OUTAT) (local.get $pb) (local.get $tick))
            (!put f32 @(PLAYERS + P_VX) (local.get $pb) (f32.const 0))
            (!put f32 @(PLAYERS + P_VY) (local.get $pb) (f32.const 0))
            (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (f32.const 0))
            (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (i32.sub (i32.const @MZ_SFIN) (local.get $fin0)))
            (!put i32 @(PLAYERS + PG_M) (local.get $pb) (i32.or (i32.const @MZ_M_FIN) (i32.add (local.get $fin0) (i32.const 1))))
            (call $fx (i32.const 0) (i32.const @MZ_FX_HOME) (local.get $p) (i32.add (local.get $fin0) (i32.const 1))
                      (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))
                      (f32.mul (f32.convert_i32_u (local.get $t)) (f32.const @DT)))
            (!inc $fin))))))
  (i32.store (i32.const @(PG_H + MZ_FIN)) (local.get $fin)))

;; Over when nobody is racing. On the round's last tick (this, or the
;; clock's) the balls still racing are scored by how far along the paths
;; they are: kept out of their records till then, so the prediction's copy
;; of them stays the confirmed one's.
(func $mz_over (result i32)
  (local $p i32) (local $pb i32) (local $end i32)
  (local.set $end (i32.eqz (i32.load (i32.const @BH_LEFT))))
  (if (i32.or (local.get $end) (i32.ge_u (i32.load (i32.const @HDR_TICK)) (i32.load (i32.const @HDR_UNTIL))))
    (then
      (!for $p (i32.const 0) (i32.const @NPLAYER)
        (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
        (if (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
          (then (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (call $mz_score (local.get $pb))))))))
  (local.get $end))

(func $mz_out (param $p i32))
