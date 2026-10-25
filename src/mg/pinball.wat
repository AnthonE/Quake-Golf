;; PINBALL: a giant table over the sea, sloping down to the drains at its
;; bottom, walled round. A ball on it is pulled down it. Pop bumpers kick a
;; ball away and pay 1; the top lanes pay 3 rolled through; drop targets in
;; banks on the sides pay 5 and drop, and the one who downs a bank's last is
;; paid 25 more; the spinner pays whoever spun it last 1 a turn. At the bottom
;; two or three funnels each end in a pair of flippers that swing up on the
;; clock, left then right, batting balls back up the table; slingshots above
;; them throw balls off. A ball through a drain is down: a fifth of its points
;; gone, it comes back in the plunger lane at the top and is shot out across
;; it. The last 15 s score double; the most points at the time wins.
;;
;; The table (in PG_H) and its solids (in PG_S) are laid out at setup and
;; fixed for the round: walls, slingshots, bumpers and targets as capsules,
;; each listed in the bands of the table it reaches into. The flippers' angles
;; are functions of the tick into play ($pn_ang). A target hit stands
;; PN_DROPT longer (and its bank, once all are down, stands again at a tick
;; set then), so what a ball meets on tick T was fixed by the confirmed world
;; before T - 201: ground and push work it all out on their own bank, and the
;; prediction is exact. What a ball's push meets it marks in its PG_M; the pay
;; is the confirmed world's (tick, slot order), as are the lanes, the spinner
;; and a drain's loss.

;; The table's plane under w on bank d: PLAT_Y at the bottom edge (w = HL),
;; rising PN_SLOPE a metre up it.
(func $pn_h (param $d i32) (param $w f32) (result f32)
  (!madd (f32.sub (f32.load offset=@(PG_H + PN_HL) (local.get $d)) (local.get $w)) (f32.const @PN_SLOPE) (f32.const @PLAT_Y)))

;; The funnel over u on bank d (0 to M - 1) and its middle, across.
(func $pn_funnel (param $d i32) (param $u f32) (result i32 f32)
  (local $f f32) (local $hw f32) (local $k f32)
  (local.set $f (f32.load offset=@(PG_H + PN_F) (local.get $d)))
  (local.set $hw (f32.load offset=@(PG_H + PN_HW) (local.get $d)))
  (local.set $k (!clamp (f32.floor (f32.div (f32.add (local.get $u) (local.get $hw)) (local.get $f)))
                        (f32.const 0) (f32.convert_i32_u (i32.sub (i32.load offset=@(PG_H + PN_M) (local.get $d)) (i32.const 1)))))
  (i32.trunc_sat_f32_u (local.get $k))
  (f32.sub (f32.mul (f32.add (local.get $k) (f32.const 0.5)) (local.get $f)) (local.get $hw)))

;; The floor's edge at the bottom across u on bank d: the w past which, in
;; the funnels, there is no floor. Level across the gap between a pair's tips,
;; along each flipper at rest from its tip up to its pivot, then up along its
;; guide to the funnel's edge.
(func $pn_edge (param $d i32) (param $u f32) (result f32)
  (local $a f32) (local $ap f32) (local $k i32) (local $uc f32)
  (call $pn_funnel (local.get $d) (local.get $u))
  (local.set $uc) (local.set $k)
  (local.set $a (f32.abs (f32.sub (local.get $u) (local.get $uc))))
  (local.set $ap (f32.load offset=@(PG_H + PN_AP) (local.get $d)))
  (if (f32.le (local.get $a) (f32.const @PN_GAP)) (then (return (f32.load offset=@(PG_H + PN_WT) (local.get $d)))))
  (if (f32.le (local.get $a) (local.get $ap))
    (then (return (!madd (f32.sub (local.get $ap) (local.get $a)) (f32.load offset=@(PG_H + PN_KB) (local.get $d)) (f32.load offset=@(PG_H + PN_WP) (local.get $d))))))
  (f32.sub (f32.load offset=@(PG_H + PN_WP) (local.get $d)) (f32.mul (f32.sub (local.get $a) (local.get $ap)) (f32.load offset=@(PG_H + PN_KG) (local.get $d)))))

;; Is there floor at (u, w) on bank d? On the table, and up the table of the
;; drains' edge.
(func $pn_on (param $d i32) (param $u f32) (param $w f32) (result i32)
  (if (i32.or (f32.gt (f32.abs (local.get $u)) (f32.load offset=@(PG_H + PN_HW) (local.get $d)))
              (f32.gt (f32.abs (local.get $w)) (f32.load offset=@(PG_H + PN_HL) (local.get $d))))
    (then (return (i32.const 0))))
  (if (f32.lt (local.get $w) (f32.load offset=@(PG_H + PN_WG) (local.get $d))) (then (return (i32.const 1))))
  (f32.le (local.get $w) (call $pn_edge (local.get $d) (local.get $u))))

;; A flipper's angle (1/16384 turn below level, toward its funnel's middle)
;; tb ticks into its own clock: at rest before it starts; then every PN_FPER
;; up over PN_FUP, held, back over PN_FDOWN, at rest till the next.
(func $pn_ang (param $tb i32) (result i32)
  (local $ph i32)
  (if (i32.lt_s (local.get $tb) (i32.const 0)) (then (return (i32.const @PN_REST))))
  (local.set $ph (i32.rem_u (local.get $tb) (i32.const @PN_FPER)))
  (if (i32.lt_u (local.get $ph) (i32.const @PN_FUP))
    (then (return (i32.add (i32.const @PN_REST) (i32.div_s (i32.mul (i32.const @(PN_UP - PN_REST)) (local.get $ph)) (i32.const @PN_FUP))))))
  (if (i32.lt_u (local.get $ph) (i32.const @(PN_FUP + PN_FHOLD))) (then (return (i32.const @PN_UP))))
  (if (i32.lt_u (local.get $ph) (i32.const @(PN_FUP + PN_FHOLD + PN_FDOWN)))
    (then (return (i32.add (i32.const @PN_UP) (i32.div_s (i32.mul (i32.const @(PN_REST - PN_UP)) (i32.sub (local.get $ph) (i32.const @(PN_FUP + PN_FHOLD))))
                                                          (i32.const @PN_FDOWN))))))
  (i32.const @PN_REST))

;; Does target j stand on tick t? Till PN_DROPT after it's hit, and again
;; from its bank's tick to stand again.
(func $pn_stands (param $j i32) (param $t i32) (result i32)
  (local $hit i32) (local $at i32)
  (local.set $hit (i32.load offset=@(PG_S + PN_TGT) (i32.shl (local.get $j) (i32.const 3))))
  (if (i32.eqz (local.get $hit)) (then (return (i32.const 1))))
  (if (i32.lt_s (i32.sub (local.get $t) (local.get $hit)) (i32.const @PN_DROPT)) (then (return (i32.const 1))))
  (local.set $at (i32.load offset=@(PG_S + PN_BANK)
                   (i32.shl (i32.load8_u offset=@(PG_S + PN_TGT + 4) (i32.shl (local.get $j) (i32.const 3))) (i32.const 4))))
  (i32.and (i32.ne (local.get $at) (i32.const 0)) (i32.ge_s (i32.sub (local.get $t) (local.get $at)) (i32.const 0))))

;; A round thing of radius r at (pu, pw) moving (vu, vw) against a capsule
;; from (au, aw) along the unit (eu, ew) len, of radius rad, moving at s times
;; (ou, ow) s metres along it (a turning flipper; 0 for the rest): out of it
;; and, if closing, bounced off it at e of the speed they met; then thrown off
;; at kmin at least. The thing's place and speed after, and how fast it now
;; leaves the capsule (-1 if they didn't meet).
(func $pn_hit (param $pu f32) (param $pw f32) (param $vu f32) (param $vw f32) (param $r f32)
              (param $au f32) (param $aw f32) (param $eu f32) (param $ew f32) (param $len f32) (param $rad f32)
              (param $ou f32) (param $ow f32) (param $e f32) (param $kmin f32)
              (result f32 f32 f32 f32 f32)
  (local $qu f32) (local $qw f32) (local $s f32) (local $cu f32) (local $cw f32) (local $d2 f32) (local $dd f32) (local $rr f32)
  (local $nu f32) (local $nw f32) (local $vn f32)
  (local.set $qu (f32.sub (local.get $pu) (local.get $au)))
  (local.set $qw (f32.sub (local.get $pw) (local.get $aw)))
  (local.set $s (!clamp (!madd (local.get $qu) (local.get $eu) (f32.mul (local.get $qw) (local.get $ew))) (f32.const 0) (local.get $len)))
  (local.set $cu (!madd (local.get $eu) (local.get $s) (local.get $au)))
  (local.set $cw (!madd (local.get $ew) (local.get $s) (local.get $aw)))
  (local.set $qu (f32.sub (local.get $pu) (local.get $cu)))
  (local.set $qw (f32.sub (local.get $pw) (local.get $cw)))
  (local.set $d2 (!madd (local.get $qu) (local.get $qu) (f32.mul (local.get $qw) (local.get $qw))))
  (local.set $rr (f32.add (local.get $r) (local.get $rad)))
  (if (f32.ge (local.get $d2) (f32.mul (local.get $rr) (local.get $rr)))
    (then (return (local.get $pu) (local.get $pw) (local.get $vu) (local.get $vw) (f32.const -1))))
  (if (f32.lt (local.get $d2) (f32.const 1e-6))
    (then
      ;; dead on its axis: out across it
      (local.set $nu (f32.neg (local.get $ew)))
      (local.set $nw (local.get $eu)))
    (else
      (local.set $dd (f32.sqrt (local.get $d2)))
      (local.set $nu (f32.div (local.get $qu) (local.get $dd)))
      (local.set $nw (f32.div (local.get $qw) (local.get $dd)))))
  (local.set $pu (!madd (local.get $nu) (f32.add (local.get $rr) (f32.const 0.005)) (local.get $cu)))
  (local.set $pw (!madd (local.get $nw) (f32.add (local.get $rr) (f32.const 0.005)) (local.get $cw)))
  (local.set $vn (!madd (f32.sub (local.get $vu) (f32.mul (local.get $ou) (local.get $s))) (local.get $nu)
                        (f32.mul (f32.sub (local.get $vw) (f32.mul (local.get $ow) (local.get $s))) (local.get $nw))))
  (if (f32.lt (local.get $vn) (f32.const 0))
    (then
      (local.set $vu (f32.sub (local.get $vu) (f32.mul (local.get $nu) (f32.mul (local.get $vn) (f32.add (f32.const 1) (local.get $e))))))
      (local.set $vw (f32.sub (local.get $vw) (f32.mul (local.get $nw) (f32.mul (local.get $vn) (f32.add (f32.const 1) (local.get $e))))))
      (local.set $vn (f32.mul (f32.neg (local.get $vn)) (local.get $e)))))
  (if (f32.lt (local.get $vn) (local.get $kmin))
    (then
      (local.set $vu (!madd (local.get $nu) (f32.sub (local.get $kmin) (local.get $vn)) (local.get $vu)))
      (local.set $vw (!madd (local.get $nw) (f32.sub (local.get $kmin) (local.get $vn)) (local.get $vw)))
      (local.set $vn (local.get $kmin))))
  (local.get $pu) (local.get $pw) (local.get $vu) (local.get $vw) (local.get $vn))

;; ---- laying the table out (setup)

;; A solid from (u0, w0) to (u1, w1) of radius rad, its kind and number; its index.
(func $pn_seg (param $u0 f32) (param $w0 f32) (param $u1 f32) (param $w1 f32) (param $rad f32) (param $kind i32) (param $idx i32) (result i32)
  (local $n i32) (local $a i32) (local $du f32) (local $dw f32) (local $len f32)
  (local.set $n (i32.load (i32.const @(PG_H + PN_NSEG))))
  (if (i32.ge_u (local.get $n) (i32.const @PN_NSEGMAX)) (then (unreachable)))
  (local.set $a (i32.add (i32.const @(PG_S + PN_SEG)) (i32.mul (local.get $n) (i32.const @PN_SEGSIZE))))
  (local.set $du (f32.sub (local.get $u1) (local.get $u0)))
  (local.set $dw (f32.sub (local.get $w1) (local.get $w0)))
  (local.set $len (f32.sqrt (!madd (local.get $du) (local.get $du) (f32.mul (local.get $dw) (local.get $dw)))))
  (!chk (local.get $u0) 200 (local.get $n))
  (!chk (local.get $w0) 200 (local.get $n))
  (!chk (local.get $len) 200 (local.get $n))
  (f32.store offset=@PN_S_U (local.get $a) (local.get $u0))
  (f32.store offset=@PN_S_W (local.get $a) (local.get $w0))
  (f32.store offset=@PN_S_EU (local.get $a) (f32.const 1))
  (if (f32.gt (local.get $len) (f32.const 0))
    (then
      (f32.store offset=@PN_S_EU (local.get $a) (f32.div (local.get $du) (local.get $len)))
      (f32.store offset=@PN_S_EW (local.get $a) (f32.div (local.get $dw) (local.get $len)))))
  (f32.store offset=@PN_S_LEN (local.get $a) (local.get $len))
  (f32.store offset=@PN_S_RAD (local.get $a) (local.get $rad))
  (i32.store8 offset=@PN_S_KIND (local.get $a) (local.get $kind))
  (i32.store8 offset=@PN_S_IDX (local.get $a) (local.get $idx))
  (i32.store (i32.const @(PG_H + PN_NSEG)) (i32.add (local.get $n) (i32.const 1)))
  (local.get $n))

(func $pn_wall (param $u0 f32) (param $w0 f32) (param $u1 f32) (param $w1 f32) (param $kind i32) (param $idx i32)
  (drop (call $pn_seg (local.get $u0) (local.get $w0) (local.get $u1) (local.get $w1) (f32.const @PN_WALLR) (local.get $kind) (local.get $idx))))

;; A guide from the funnel's edge (u0, w0) down to its flipper's pivot (u1,
;; w1): wall, slingshot sl, wall.
(func $pn_guide (param $u0 f32) (param $w0 f32) (param $u1 f32) (param $w1 f32) (param $sl i32)
  (local $au f32) (local $aw f32) (local $bu f32) (local $bw f32) (local $du f32) (local $dw f32)
  (local.set $du (f32.sub (local.get $u1) (local.get $u0)))
  (local.set $dw (f32.sub (local.get $w1) (local.get $w0)))
  (local.set $au (!madd (local.get $du) (f32.const @PN_SL0) (local.get $u0)))
  (local.set $aw (!madd (local.get $dw) (f32.const @PN_SL0) (local.get $w0)))
  (local.set $bu (!madd (local.get $du) (f32.const @PN_SL1) (local.get $u0)))
  (local.set $bw (!madd (local.get $dw) (f32.const @PN_SL1) (local.get $w0)))
  (call $pn_wall (local.get $u0) (local.get $w0) (local.get $au) (local.get $aw) (i32.const @PN_KWALL) (i32.const 0))
  (call $pn_wall (local.get $au) (local.get $aw) (local.get $bu) (local.get $bw) (i32.const @PN_KSLING) (local.get $sl))
  (call $pn_wall (local.get $bu) (local.get $bw) (local.get $u1) (local.get $w1) (i32.const @PN_KWALL) (i32.const 0)))

;; The table for n balls. Its shape, the knobs (a scoring round, a lighter
;; push and drag, the drain's wait), then the solids from the top down: the
;; walls round it and the corners' deflectors, the plunger lane, the spinner
;; lanes, the top lanes' posts, the pop bumpers, the drop targets, the
;; guides and their slingshots; then each band's list.
(func $pn_setup (param $n i32)
  (local $wd f32) (local $hw f32) (local $hl f32) (local $m i32) (local $f f32) (local $lb f32) (local $ap f32)
  (local $wt f32) (local $wp f32) (local $wg f32) (local $ul f32) (local $sw0 f32) (local $u f32) (local $w f32) (local $w0 f32) (local $w1 f32)
  (local $plu f32) (local $plt f32) (local $plb f32) (local $uc f32) (local $sd f32)
  (local $k i32) (local $i i32) (local $j i32) (local $b i32) (local $q i32) (local $a i32) (local $c i32)
  (local $nl i32) (local $nr i32) (local $nb i32) (local $nsp i32) (local $nbank i32) (local $nt i32) (local $side i32) (local $row i32) (local $seg i32)
  (local.set $wd (!clamp (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @PN_WK) (f32.const @PN_W0)) (f32.const @PN_WMIN) (f32.const @PN_WMAX)))
  (!chk (local.get $wd) 201 (local.get $n))
  (local.set $hw (f32.mul (local.get $wd) (f32.const 0.5)))
  (local.set $hl (f32.mul (local.get $wd) (f32.const @(PN_LK / 2))))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_SCORE))
  (i32.store (i32.const @PG_LEN) (i32.const @PN_LEN))
  (f32.store (i32.const @PG_SIZE) (local.get $hl))
  (f32.store (i32.const @PG_ACC) (f32.const @PN_ACC))
  (f32.store (i32.const @PG_DRAG) (f32.const @PN_DRAG))
  (f32.store (i32.const @PG_IDLE) (f32.const @PN_IDLE))
  (i32.store (i32.const @PG_RESPAWN) (i32.const @PN_BACK))
  (f32.store (i32.const @(PG_H + PN_HW)) (local.get $hw))
  (f32.store (i32.const @(PG_H + PN_HL)) (local.get $hl))
  (f32.store (i32.const @(PG_H + PN_BANDK)) (f32.div (f32.const @PN_NBAND) (f32.add (local.get $hl) (local.get $hl))))
  ;; the bottom: two or three funnels, a pair of flippers each, their pivots and tips, the guides' tops
  (local.set $m (select (i32.const 3) (i32.const 2) (f32.ge (local.get $wd) (f32.const @PN_W3))))
  (local.set $f (f32.div (local.get $wd) (f32.convert_i32_u (local.get $m))))
  (local.set $lb (f32.mul (local.get $f) (f32.const @PN_LB)))
  (local.set $ap (!madd (local.get $lb) (f32.const 0.8660254) (f32.const @PN_GAP)))
  (local.set $wt (f32.sub (local.get $hl) (f32.const @PN_TIPB)))
  (local.set $wp (f32.sub (local.get $wt) (f32.mul (local.get $lb) (f32.const 0.5))))
  (local.set $wg (f32.sub (local.get $wp) (f32.mul (f32.sub (f32.mul (local.get $f) (f32.const 0.5)) (local.get $ap)) (f32.const @PN_GUIDEK))))
  (i32.store (i32.const @(PG_H + PN_M)) (local.get $m))
  (f32.store (i32.const @(PG_H + PN_F)) (local.get $f))
  (f32.store (i32.const @(PG_H + PN_LBAT)) (local.get $lb))
  (f32.store (i32.const @(PG_H + PN_AP)) (local.get $ap))
  (f32.store (i32.const @(PG_H + PN_WP)) (local.get $wp))
  (f32.store (i32.const @(PG_H + PN_WT)) (local.get $wt))
  (f32.store (i32.const @(PG_H + PN_WG)) (local.get $wg))
  (f32.store (i32.const @(PG_H + PN_KB)) (f32.div (f32.sub (local.get $wt) (local.get $wp)) (f32.sub (local.get $ap) (f32.const @PN_GAP))))
  (f32.store (i32.const @(PG_H + PN_KG)) (f32.div (f32.sub (local.get $wp) (local.get $wg)) (f32.sub (f32.mul (local.get $f) (f32.const 0.5)) (local.get $ap))))
  ;; the walls round it (the sides down to the guides), and a deflector across each top corner
  (call $pn_wall (f32.neg (local.get $hw)) (f32.neg (local.get $hl)) (local.get $hw) (f32.neg (local.get $hl)) (i32.const @PN_KWALL) (i32.const 0))
  (call $pn_wall (f32.neg (local.get $hw)) (f32.neg (local.get $hl)) (f32.neg (local.get $hw)) (local.get $wg) (i32.const @PN_KWALL) (i32.const 0))
  (call $pn_wall (local.get $hw) (f32.neg (local.get $hl)) (local.get $hw) (local.get $wg) (i32.const @PN_KWALL) (i32.const 0))
  (call $pn_wall (f32.add (f32.neg (local.get $hw)) (f32.const @PN_DEF)) (f32.neg (local.get $hl))
                 (f32.neg (local.get $hw)) (f32.add (f32.neg (local.get $hl)) (f32.const @PN_DEF)) (i32.const @PN_KDEF) (i32.const 0))
  (call $pn_wall (f32.sub (local.get $hw) (f32.const @PN_DEF)) (f32.neg (local.get $hl))
                 (local.get $hw) (f32.add (f32.neg (local.get $hl)) (f32.const @PN_DEF)) (i32.const @PN_KDEF) (i32.const 1))
  ;; the plunger lane: its inner wall and its bottom
  (local.set $plu (f32.sub (local.get $hw) (f32.const @PN_PLW)))
  (local.set $plt (f32.add (f32.neg (local.get $hl)) (f32.const @PN_PLT)))
  (local.set $plb (!madd (local.get $hl) (f32.const @(2 * PN_PLLK)) (f32.neg (local.get $hl))))
  (f32.store (i32.const @(PG_H + PN_PLU)) (local.get $plu))
  (f32.store (i32.const @(PG_H + PN_PLTW)) (local.get $plt))
  (f32.store (i32.const @(PG_H + PN_PLBW)) (local.get $plb))
  (call $pn_wall (local.get $plu) (local.get $plt) (local.get $plu) (local.get $plb) (i32.const @PN_KWALL) (i32.const 0))
  (call $pn_wall (local.get $plu) (local.get $plb) (local.get $hw) (local.get $plb) (i32.const @PN_KWALL) (i32.const 0))
  ;; the spinner lanes: a guide in from the left wall (and the right, on a wide table), the spinner in the middle
  (local.set $nsp (select (i32.const 2) (i32.const 1) (f32.ge (local.get $wd) (f32.const @PN_W3))))
  (local.set $sw0 (!madd (local.get $hl) (f32.const @(2 * PN_SPF)) (f32.neg (local.get $hl))))
  (i32.store (i32.const @(PG_H + PN_NSP)) (local.get $nsp))
  (f32.store (i32.const @(PG_H + PN_SW0)) (local.get $sw0))
  (!for $i (i32.const 0) (local.get $nsp)
    (local.set $sd (select (f32.const 1) (f32.const -1) (local.get $i)))
    (local.set $u (f32.mul (local.get $sd) (f32.sub (local.get $hw) (f32.const @PN_SPW))))
    (call $pn_wall (local.get $u) (local.get $sw0) (local.get $u) (f32.add (local.get $sw0) (f32.const @PN_SPL)) (i32.const @PN_KWALL) (i32.const 0))
    (local.set $a (i32.add (i32.const @(PG_S + PN_SPIN)) (i32.shl (local.get $i) (i32.const 5))))
    (f32.store (local.get $a) (f32.mul (local.get $sd) (f32.sub (local.get $hw) (f32.const @(PN_SPW / 2)))))
    (f32.store offset=4 (local.get $a) (f32.add (local.get $sw0) (f32.const @(PN_SPL / 2))))
    (f32.store offset=8 (local.get $a) (f32.const @(PN_SPW / 2)))
    (i32.store offset=24 (local.get $a) (i32.const 255)))
  ;; the top lanes: their posts, and each lane's middle
  (local.set $nl (select (i32.const 3) (select (i32.const 4) (i32.const 5) (f32.lt (local.get $wd) (f32.const @PN_W5))) (f32.lt (local.get $wd) (f32.const @PN_W4))))
  (local.set $ul (f32.const @(-PN_PLW / 2)))
  (local.set $w0 (f32.add (f32.neg (local.get $hl)) (f32.const @PN_LW0)))
  (local.set $w1 (f32.add (local.get $w0) (f32.const @PN_LLEN)))
  (i32.store (i32.const @(PG_H + PN_NL)) (local.get $nl))
  (f32.store (i32.const @(PG_H + PN_UL)) (local.get $ul))
  (f32.store (i32.const @(PG_H + PN_LTOP)) (local.get $w0))
  (f32.store (i32.const @(PG_H + PN_LBOT)) (local.get $w1))
  (!for $j (i32.const 0) (i32.add (local.get $nl) (i32.const 1))
    (local.set $u (!madd (f32.sub (f32.convert_i32_u (local.get $j)) (f32.mul (f32.convert_i32_u (local.get $nl)) (f32.const 0.5))) (f32.const @PN_LANEW) (local.get $ul)))
    (call $pn_wall (local.get $u) (local.get $w0) (local.get $u) (local.get $w1) (i32.const @PN_KWALL) (i32.const 0))
    (if (i32.lt_u (local.get $j) (local.get $nl))
      (then (f32.store offset=@(PG_S + PN_LANE) (i32.shl (local.get $j) (i32.const 4)) (f32.add (local.get $u) (f32.const @(PN_LANEW / 2)))))))
  ;; the pop bumpers: rows of nr, nr - 1, ... down to 1
  (local.set $nr (select (i32.const 2) (select (i32.const 3) (i32.const 4) (f32.lt (local.get $wd) (f32.const @PN_W5))) (f32.lt (local.get $wd) (f32.const @PN_W4))))
  (!for $row (i32.const 0) (local.get $nr)
    (local.set $c (i32.sub (local.get $nr) (local.get $row)))
    (local.set $w (!madd (f32.convert_i32_u (local.get $row)) (f32.const @PN_BROW) (f32.add (f32.neg (local.get $hl)) (f32.const @PN_BW0))))
    (!for $j (i32.const 0) (local.get $c)
      (local.set $u (!madd (f32.sub (f32.convert_i32_u (local.get $j)) (f32.mul (f32.convert_i32_u (i32.sub (local.get $c) (i32.const 1))) (f32.const 0.5)))
                           (f32.const @PN_BSP) (local.get $ul)))
      (drop (call $pn_seg (local.get $u) (local.get $w) (local.get $u) (local.get $w) (f32.const @PN_BR) (i32.const @PN_KBUMP) (local.get $nb)))
      (f32.store offset=@(PG_S + PN_BUMP) (i32.shl (local.get $nb) (i32.const 4)) (local.get $u))
      (f32.store offset=@(PG_S + PN_BUMP + 4) (i32.shl (local.get $nb) (i32.const 4)) (local.get $w))
      (!inc $nb)))
  (i32.store (i32.const @(PG_H + PN_NB)) (local.get $nb))
  (f32.store (i32.const @(PG_H + PN_SPAWNW)) (f32.add (local.get $w) (f32.const @PN_SPAWN0)))
  ;; the drop targets: a bank a side under the spinner lanes, two a side on a wide table
  (local.set $nbank (select (i32.const 4) (i32.const 2) (f32.ge (local.get $wd) (f32.const @PN_W3))))
  (local.set $nt (select (i32.const 4) (i32.const 3) (f32.ge (local.get $wd) (f32.const @PN_W4))))
  (i32.store (i32.const @(PG_H + PN_NBANK)) (local.get $nbank))
  (!for $b (i32.const 0) (local.get $nbank)
    (local.set $side (i32.and (local.get $b) (i32.const 1)))
    (local.set $row (i32.shr_u (local.get $b) (i32.const 1)))
    (local.set $u (f32.mul (select (f32.const 1) (f32.const -1) (local.get $side)) (f32.sub (local.get $hw) (f32.const @PN_TD))))
    (local.set $w0 (!madd (f32.convert_i32_u (local.get $row)) (!madd (f32.convert_i32_u (local.get $nt)) (f32.const @PN_TSTEP) (f32.const @PN_TROW))
                          (f32.add (local.get $sw0) (f32.const @(PN_SPL + PN_TGAP)))))
    (local.set $a (i32.add (i32.const @(PG_S + PN_BANK)) (i32.shl (local.get $b) (i32.const 4))))
    (i32.store8 offset=4 (local.get $a) (local.get $q))
    (i32.store8 offset=5 (local.get $a) (local.get $nt))
    (i32.store8 offset=6 (local.get $a) (local.get $side))
    (!for $j (i32.const 0) (local.get $nt)
      (local.set $w (!madd (f32.convert_i32_u (local.get $j)) (f32.const @PN_TSTEP) (local.get $w0)))
      (local.set $seg (call $pn_seg (local.get $u) (local.get $w) (local.get $u) (f32.add (local.get $w) (f32.const @PN_TLEN)) (f32.const @PN_WALLR) (i32.const @PN_KTGT) (local.get $q)))
      (i32.store8 offset=@(PG_S + PN_TGT + 4) (i32.shl (local.get $q) (i32.const 3)) (local.get $b))
      (i32.store8 offset=@(PG_S + PN_TGT + 5) (i32.shl (local.get $q) (i32.const 3)) (local.get $seg))
      (!inc $q)))
  (i32.store (i32.const @(PG_H + PN_NT)) (local.get $q))
  ;; the guides, each a slingshot in its middle, from the funnels' edges down to the pivots
  (!for $k (i32.const 0) (local.get $m)
    (local.set $uc (f32.sub (f32.mul (f32.add (f32.convert_i32_u (local.get $k)) (f32.const 0.5)) (local.get $f)) (local.get $hw)))
    (!for $side (i32.const 0) (i32.const 2)
      (local.set $sd (select (f32.const 1) (f32.const -1) (local.get $side)))
      (call $pn_guide (!madd (local.get $sd) (f32.mul (local.get $f) (f32.const 0.5)) (local.get $uc)) (local.get $wg)
                      (!madd (local.get $sd) (local.get $ap) (local.get $uc)) (local.get $wp)
                      (i32.add (i32.shl (local.get $k) (i32.const 1)) (local.get $side)))))
  ;; the bands: each solid in every band it reaches into, a ball's radius and some to spare
  (local.set $c (i32.load (i32.const @(PG_H + PN_NSEG))))
  (!for $b (i32.const 0) (i32.const @PN_NBAND)
    (local.set $w0 (!madd (f32.convert_i32_u (local.get $b)) (f32.div (f32.add (local.get $hl) (local.get $hl)) (f32.const @PN_NBAND)) (f32.neg (local.get $hl))))
    (local.set $w1 (f32.add (local.get $w0) (f32.div (f32.add (local.get $hl) (local.get $hl)) (f32.const @PN_NBAND))))
    (local.set $q (i32.const 0))
    (!for $i (i32.const 0) (local.get $c)
      (local.set $a (i32.add (i32.const @(PG_S + PN_SEG)) (i32.mul (local.get $i) (i32.const @PN_SEGSIZE))))
      (local.set $w (f32.load offset=@PN_S_W (local.get $a)))
      (local.set $u (!madd (f32.load offset=@PN_S_EW (local.get $a)) (f32.load offset=@PN_S_LEN (local.get $a)) (local.get $w)))
      (local.set $sd (f32.add (f32.load offset=@PN_S_RAD (local.get $a)) (f32.const 2)))
      (if (i32.and (f32.le (f32.sub (f32.min (local.get $w) (local.get $u)) (local.get $sd)) (local.get $w1))
                   (f32.ge (f32.add (f32.max (local.get $w) (local.get $u)) (local.get $sd)) (local.get $w0)))
        (then
          (if (i32.ge_u (local.get $q) (i32.const @PN_BANDCAP)) (then (unreachable)))
          (i32.store8 offset=@(PG_S + PN_BANDS) (i32.add (i32.mul (local.get $b) (i32.const @PN_BANDCAP)) (local.get $q)) (local.get $i))
          (!inc $q))))
    (i32.store8 offset=@(PG_S + PN_BANDN) (local.get $b) (local.get $q))))

;; Ball i of n on rows across the table under the bumpers, each row centred;
;; a newcomer or a ball back from a drain (n 1024) in the plunger lane,
;; spread along it.
(func $pn_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $cols i32) (local $row i32) (local $cnt i32) (local $u f32) (local $w f32) (local $cx f32) (local $hw f32) (local $plt f32) (local $plb f32) (local $z f32)
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $hw (f32.load (i32.const @(PG_H + PN_HW))))
  (if (i32.ge_u (local.get $n) (i32.const 1024))
    (then
      (local.set $plt (f32.load (i32.const @(PG_H + PN_PLTW))))
      (local.set $plb (f32.load (i32.const @(PG_H + PN_PLBW))))
      (local.set $u (f32.sub (local.get $hw) (f32.const @(PN_PLW / 2))))
      (local.set $w (f32.sub (f32.sub (local.get $plb) (f32.const 2))
                             (f32.mul (f32.convert_i32_u (i32.and (local.get $i) (i32.const 7)))
                                      (f32.mul (f32.sub (f32.sub (local.get $plb) (local.get $plt)) (f32.const 4)) (f32.const 0.125))))))
    (else
      (local.set $cols (i32.add (i32.trunc_sat_f32_u (f32.div (f32.mul (f32.sub (local.get $hw) (f32.const @PN_SPAWNU)) (f32.const 2)) (f32.const @PN_SPACE)))
                                (i32.const 1)))
      (local.set $row (i32.div_u (local.get $i) (local.get $cols)))
      (local.set $cnt (i32.sub (local.get $n) (i32.mul (local.get $row) (local.get $cols))))
      (if (i32.gt_u (local.get $cnt) (local.get $cols)) (then (local.set $cnt (local.get $cols))))
      (local.set $u (f32.mul (f32.sub (f32.convert_i32_u (i32.rem_u (local.get $i) (local.get $cols)))
                                      (f32.mul (f32.convert_i32_u (i32.sub (local.get $cnt) (i32.const 1))) (f32.const 0.5)))
                             (f32.const @PN_SPACE)))
      (local.set $w (!madd (f32.convert_i32_u (local.get $row)) (f32.const @PN_SPACE) (f32.load (i32.const @(PG_H + PN_SPAWNW)))))))
  ;; its height from where it is in the world, as ground will find it
  (local.set $z (f32.add (local.get $cx) (local.get $w)))
  (f32.add (local.get $cx) (local.get $u))
  (call $pn_h (i32.const 0) (f32.sub (local.get $z) (local.get $cx)))
  (local.get $z))

(func $pn_start)
(func $pn_begin (param $p i32) (param $d i32))

;; The table's plane under (x, z) on bank d if there's floor there and it's
;; no higher than y.
(func $pn_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $w f32) (local $h f32)
  (local.set $w (f32.sub (local.get $z) (f32.load offset=@PG_CX (local.get $d))))
  (if (i32.eqz (call $pn_on (local.get $d) (f32.sub (local.get $x) (f32.load offset=@PG_CX (local.get $d))) (local.get $w)))
    (then (return (f32.const -1000))))
  (local.set $h (call $pn_h (local.get $d) (local.get $w)))
  (select (local.get $h) (f32.const -1000) (f32.le (local.get $h) (local.get $y))))

;; Ball p after its roll on bank d. Under the plane (through a drain) it
;; meets nothing. On the floor, just over it and not rising it's put back on
;; it, and on it it's pulled down the table. Then the solids in its band: off
;; walls, thrown off slingshots and bumpers (FX), off a target still
;; standing on this bank's tick; the flippers of its funnel as they stand
;; this tick (a hop's top clears them); the plunger lane shoots it up. What
;; it met that pays it marks its PG_M. Writes only its record and bank d's FX.
(func $pn_push (param $p i32) (param $d i32)
  (local $pb i32) (local $fl i32) (local $t i32) (local $tp i32) (local $band i32) (local $i i32) (local $n i32) (local $a i32)
  (local $kind i32) (local $idx i32) (local $mb i32) (local $mt i32) (local $k i32) (local $side i32) (local $th i32) (local $th0 i32) (local $tb i32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vy f32) (local $vz f32) (local $r f32)
  (local $cx f32) (local $u f32) (local $w f32) (local $h f32) (local $e f32) (local $kmin f32) (local $vn f32)
  (local $uc f32) (local $sd f32) (local $s f32) (local $c f32) (local $om f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (if (i32.and (local.get $fl) (i32.const @(PF_FALL | PF_DEAD))) (then (return)))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $cx (f32.load offset=@PG_CX (local.get $d)))
  (local.set $u (f32.sub (local.get $px) (local.get $cx)))
  (local.set $w (f32.sub (local.get $pz) (local.get $cx)))
  (local.set $h (call $pn_h (local.get $d) (local.get $w)))
  (if (f32.lt (local.get $py) (f32.sub (local.get $h) (f32.const @PN_SINK))) (then (return)))
  (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (local.set $vy (!at f32 @(PLAYERS + P_VY) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  (local.set $r (call $b_rad (local.get $pb)))
  (local.set $t (i32.load offset=@HDR_TICK (local.get $d)))
  (local.set $tp (call $p_t (local.get $d)))
  ;; the floor
  (if (call $pn_on (local.get $d) (local.get $u) (local.get $w))
    (then
      (if (i32.and (i32.eqz (i32.and (local.get $fl) (i32.const @PF_GROUND)))
                   (i32.and (f32.le (local.get $py) (f32.add (local.get $h) (f32.const @PN_SNAP))) (f32.le (local.get $vy) (f32.const @PN_SNAPV))))
        (then
          (local.set $py (local.get $h))
          (local.set $vy (f32.const 0))
          (local.set $fl (i32.or (local.get $fl) (i32.const @PF_GROUND)))))
      (if (i32.and (local.get $fl) (i32.const @PF_GROUND))
        (then (local.set $vz (f32.add (local.get $vz) (f32.const @(PN_PULL * DT))))))))
  ;; the solids in its band
  (local.set $band (i32.trunc_sat_f32_u (f32.mul (f32.add (local.get $w) (f32.load offset=@(PG_H + PN_HL) (local.get $d)))
                                                 (f32.load offset=@(PG_H + PN_BANDK) (local.get $d)))))
  (if (i32.ge_u (local.get $band) (i32.const @PN_NBAND)) (then (local.set $band (i32.const @(PN_NBAND - 1)))))
  (local.set $n (i32.load8_u offset=@(PG_S + PN_BANDN) (local.get $band)))
  (!for $i (i32.const 0) (local.get $n)
    (local.set $a (i32.add (i32.const @(PG_S + PN_SEG))
                           (i32.mul (i32.load8_u offset=@(PG_S + PN_BANDS) (i32.add (i32.mul (local.get $band) (i32.const @PN_BANDCAP)) (local.get $i)))
                                    (i32.const @PN_SEGSIZE))))
    (local.set $kind (i32.load8_u offset=@PN_S_KIND (local.get $a)))
    (local.set $idx (i32.load8_u offset=@PN_S_IDX (local.get $a)))
    (if (i32.or (i32.ne (local.get $kind) (i32.const @PN_KTGT)) (call $pn_stands (local.get $idx) (local.get $t)))
      (then
        (local.set $e (f32.const @PN_WALLE))
        (local.set $kmin (f32.const 0))
        (if (i32.eq (local.get $kind) (i32.const @PN_KSLING)) (then (local.set $kmin (f32.const @PN_SLINGK))))
        (if (i32.eq (local.get $kind) (i32.const @PN_KTGT)) (then (local.set $e (f32.const @PN_TGTE))))
        (if (i32.eq (local.get $kind) (i32.const @PN_KDEF)) (then (local.set $e (f32.const @PN_DEFE))))
        (if (i32.eq (local.get $kind) (i32.const @PN_KBUMP)) (then (local.set $e (f32.const @PN_BUMPE)) (local.set $kmin (f32.const @PN_KICK))))
        (call $pn_hit (local.get $u) (local.get $w) (local.get $vx) (local.get $vz) (local.get $r)
                      (f32.load offset=@PN_S_U (local.get $a)) (f32.load offset=@PN_S_W (local.get $a))
                      (f32.load offset=@PN_S_EU (local.get $a)) (f32.load offset=@PN_S_EW (local.get $a))
                      (f32.load offset=@PN_S_LEN (local.get $a)) (f32.load offset=@PN_S_RAD (local.get $a))
                      (f32.const 0) (f32.const 0) (local.get $e) (local.get $kmin))
        (local.set $vn) (local.set $vz) (local.set $vx) (local.set $w) (local.set $u)
        (if (f32.ge (local.get $vn) (f32.const 0))
          (then
            (if (i32.eq (local.get $kind) (i32.const @PN_KBUMP))
              (then
                (local.set $mb (i32.add (local.get $idx) (i32.const 1)))
                (call $fx (local.get $d) (i32.const @PN_FX_KICK) (local.get $p) (i32.or (i32.const @(PN_JBUMP << 8)) (local.get $idx))
                          (f32.add (local.get $u) (local.get $cx)) (f32.add (local.get $py) (f32.const 1)) (f32.add (local.get $w) (local.get $cx)) (local.get $vn))))
            (if (i32.eq (local.get $kind) (i32.const @PN_KSLING))
              (then (call $fx (local.get $d) (i32.const @PN_FX_KICK) (local.get $p) (i32.or (i32.const @(PN_JSLING << 8)) (local.get $idx))
                              (f32.add (local.get $u) (local.get $cx)) (f32.add (local.get $py) (f32.const 1)) (f32.add (local.get $w) (local.get $cx)) (local.get $vn))))
            (if (i32.eq (local.get $kind) (i32.const @PN_KTGT)) (then (local.set $mt (i32.add (local.get $idx) (i32.const 1))))))))))
  ;; its funnel's flippers, below a hop's top
  (if (i32.and (f32.gt (local.get $w) (f32.sub (f32.load offset=@(PG_H + PN_WG) (local.get $d)) (f32.const 2)))
               (f32.lt (f32.sub (local.get $py) (local.get $h)) (f32.const @PN_BATH)))
    (then
      (call $pn_funnel (local.get $d) (local.get $u))
      (local.set $uc) (local.set $k)
      (!for $side (i32.const 0) (i32.const 2)
        (local.set $sd (select (f32.const -1) (f32.const 1) (local.get $side)))
        (local.set $tb (i32.sub (i32.sub (local.get $tp) (i32.const @PN_FWAIT)) (i32.mul (local.get $side) (i32.const @PN_FHALF))))
        (local.set $th (call $pn_ang (local.get $tb)))
        (local.set $th0 (call $pn_ang (i32.sub (local.get $tb) (i32.const 1))))
        (call $sincos (local.get $th))
        (local.set $c) (local.set $s)
        (local.set $om (f32.mul (f32.convert_i32_s (i32.sub (local.get $th) (local.get $th0))) (f32.const @(2 * Math.PI / 16384 / DT))))
        (call $pn_hit (local.get $u) (local.get $w) (local.get $vx) (local.get $vz) (local.get $r)
                      (f32.sub (local.get $uc) (f32.mul (local.get $sd) (f32.load offset=@(PG_H + PN_AP) (local.get $d)))) (f32.load offset=@(PG_H + PN_WP) (local.get $d))
                      (f32.mul (local.get $sd) (local.get $c)) (local.get $s)
                      (f32.load offset=@(PG_H + PN_LBAT) (local.get $d)) (f32.const @PN_BATR)
                      (f32.mul (local.get $om) (f32.neg (f32.mul (local.get $sd) (local.get $s)))) (f32.mul (local.get $om) (local.get $c))
                      (f32.const @PN_BATE) (f32.const 0))
        (local.set $vn) (local.set $vz) (local.set $vx) (local.set $w) (local.set $u)
        ;; batted (swinging up, met at 3 m/s or more): its speed out
        (if (i32.and (i32.lt_s (local.get $th) (local.get $th0)) (f32.gt (local.get $vn) (f32.const @(3 * PN_BATE))))
          (then (call $fx (local.get $d) (i32.const @PN_FX_KICK) (local.get $p)
                          (i32.or (i32.const @(PN_JBAT << 8)) (i32.add (i32.shl (local.get $k) (i32.const 1)) (local.get $side)))
                          (f32.add (local.get $u) (local.get $cx)) (f32.add (local.get $py) (f32.const 1)) (f32.add (local.get $w) (local.get $cx))
                          (f32.sqrt (!madd (local.get $vx) (local.get $vx) (f32.mul (local.get $vz) (local.get $vz))))))))))
  ;; the plunger lane
  (if (i32.and (i32.and (f32.gt (local.get $u) (f32.load offset=@(PG_H + PN_PLU) (local.get $d)))
                        (f32.gt (local.get $w) (f32.load offset=@(PG_H + PN_PLTW) (local.get $d))))
               (i32.and (f32.lt (local.get $w) (f32.load offset=@(PG_H + PN_PLBW) (local.get $d)))
                        (f32.lt (f32.sub (local.get $py) (local.get $h)) (f32.const @PN_PLH))))
    (then
      (if (f32.gt (local.get $vz) (f32.const @(-PN_PLUNGE)))
        (then
          (if (f32.gt (local.get $vz) (f32.const @(4 - PN_PLUNGE)))
            (then (call $fx (local.get $d) (i32.const @PN_FX_KICK) (local.get $p) (i32.const @(PN_JPLUNGE << 8))
                            (f32.add (local.get $u) (local.get $cx)) (local.get $py) (f32.add (local.get $w) (local.get $cx)) (f32.const @PN_PLUNGE))))
          (local.set $vz (f32.const @(-PN_PLUNGE)))
          (local.set $vx (f32.mul (local.get $vx) (f32.const 0.5)))))))
  (local.set $px (f32.add (local.get $u) (local.get $cx)))
  (local.set $pz (f32.add (local.get $w) (local.get $cx)))
  (!chk (local.get $px) 202 (local.get $p))
  (!chk (local.get $py) 203 (local.get $p))
  (!chk (local.get $pz) 204 (local.get $p))
  (!chk (local.get $vx) 205 (local.get $p))
  (!chk (local.get $vy) 206 (local.get $p))
  (!chk (local.get $vz) 207 (local.get $p))
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $px))
  (!put f32 @(PLAYERS + P_PY) (local.get $pb) (local.get $py))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $pz))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (local.get $vy))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (local.get $fl))
  (if (i32.or (local.get $mb) (local.get $mt))
    (then (!put i32 @(PLAYERS + PG_M) (local.get $pb)
            (i32.or (i32.shl (local.get $t) (i32.const 16)) (i32.or (i32.shl (local.get $mt) (i32.const 8)) (local.get $mb)))))))

;; ---- the pay, the confirmed world's

;; Slot p's score plus k (k may be less than 0), held to 0 .. 65535.
(func $pn_add (param $p i32) (param $k i32)
  (local $pb i32) (local $s i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (local.set $s (i32.add (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)) (local.get $k)))
  (if (i32.lt_s (local.get $s) (i32.const 0)) (then (local.set $s (i32.const 0))))
  (if (i32.gt_s (local.get $s) (i32.const 65535)) (then (local.set $s (i32.const 65535))))
  (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (local.get $s)))

;; Slot p is paid k for what (PN_W*) number j, at (u, w): the score, its FX.
(func $pn_pay (param $p i32) (param $k i32) (param $what i32) (param $j i32) (param $u f32) (param $w f32)
  (local $cx f32)
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (call $pn_add (local.get $p) (local.get $k))
  (call $fx (i32.const 0) (i32.const @PN_FX_SCORE) (local.get $p) (i32.or (i32.shl (local.get $what) (i32.const 8)) (local.get $j))
            (f32.add (local.get $u) (local.get $cx)) (f32.add (call $pn_h (i32.const 0) (local.get $w)) (f32.const 1.5)) (f32.add (local.get $w) (local.get $cx))
            (f32.convert_i32_u (local.get $k))))

;; Slot p hit target j on tick t: if it stood unhit, it's hit (it drops
;; PN_DROPT on), paying PN_TGTPAY; the bank's last pays PN_BANKPAY more, and
;; the bank is set to stand again.
(func $pn_target (param $p i32) (param $j i32) (param $t i32) (param $mult i32)
  (local $ta i32) (local $ba i32) (local $i i32) (local $first i32) (local $all i32) (local $sa i32)
  (local.set $ta (i32.add (i32.const @(PG_S + PN_TGT)) (i32.shl (local.get $j) (i32.const 3))))
  (if (i32.load (local.get $ta)) (then (return)))
  (i32.store (local.get $ta) (local.get $t))
  (local.set $sa (i32.add (i32.const @(PG_S + PN_SEG)) (i32.mul (i32.load8_u offset=5 (local.get $ta)) (i32.const @PN_SEGSIZE))))
  (call $pn_pay (local.get $p) (i32.mul (i32.const @PN_TGTPAY) (local.get $mult)) (i32.const @PN_WTGT) (local.get $j)
                (f32.load offset=@PN_S_U (local.get $sa)) (!madd (f32.load offset=@PN_S_LEN (local.get $sa)) (f32.const 0.5) (f32.load offset=@PN_S_W (local.get $sa))))
  (local.set $ba (i32.add (i32.const @(PG_S + PN_BANK)) (i32.shl (i32.load8_u offset=4 (local.get $ta)) (i32.const 4))))
  (local.set $first (i32.load8_u offset=4 (local.get $ba)))
  (local.set $all (i32.const 1))
  (!for $i (local.get $first) (i32.add (local.get $first) (i32.load8_u offset=5 (local.get $ba)))
    (if (i32.eqz (i32.load offset=@(PG_S + PN_TGT) (i32.shl (local.get $i) (i32.const 3)))) (then (local.set $all (i32.const 0)))))
  (if (local.get $all)
    (then
      (i32.store (local.get $ba) (i32.add (local.get $t) (i32.const @(PN_DROPT + PN_RESETT))))
      (i32.store offset=8 (local.get $ba) (i32.add (i32.load offset=8 (local.get $ba)) (i32.const 1)))
      (call $pn_pay (local.get $p) (i32.mul (i32.const @PN_BANKPAY) (local.get $mult)) (i32.const @PN_WBANK) (i32.load8_u offset=4 (local.get $ta))
                    (f32.load offset=@PN_S_U (local.get $sa)) (!madd (f32.load offset=@PN_S_LEN (local.get $sa)) (f32.const 0.5) (f32.load offset=@PN_S_W (local.get $sa)))))))

;; Slot p at (u, w) rolling vz down the table, tp ticks into play (tick t),
;; over the top lanes: onto a lane's switch it wasn't on last tick, rolling
;; down, it's paid PN_LANEPAY, unless that lane paid it within PN_LANECD; the
;; lane lights.
(func $pn_lanes (param $p i32) (param $u f32) (param $w f32) (param $vz f32) (param $tp i32) (param $t i32) (param $mult i32)
  (local $ba i32) (local $j i32) (local $in i32) (local $la i32) (local $last i32)
  (local.set $ba (i32.add (i32.const @(PG_S + PN_BALL)) (i32.shl (local.get $p) (i32.const 4))))
  (if (i32.and (f32.gt (local.get $w) (f32.add (f32.load (i32.const @(PG_H + PN_LTOP))) (f32.const @PN_LSWM)))
               (f32.lt (local.get $w) (f32.sub (f32.load (i32.const @(PG_H + PN_LBOT))) (f32.const @PN_LSWM))))
    (then
      (!for $j (i32.const 0) (i32.load (i32.const @(PG_H + PN_NL)))
        (if (f32.lt (f32.abs (f32.sub (local.get $u) (f32.load offset=@(PG_S + PN_LANE) (i32.shl (local.get $j) (i32.const 4)))))
                    (f32.const @(PN_LANEW / 2 - PN_LSWM)))
          (then (local.set $in (i32.add (local.get $j) (i32.const 1))))))))
  (if (i32.eq (local.get $in) (i32.load8_u (local.get $ba))) (then (return)))
  (i32.store8 (local.get $ba) (local.get $in))
  (if (i32.or (i32.eqz (local.get $in)) (f32.le (local.get $vz) (f32.const @PN_LANEV))) (then (return)))
  (local.set $j (i32.sub (local.get $in) (i32.const 1)))
  (local.set $last (i32.load16_u offset=2 (i32.add (local.get $ba) (i32.shl (local.get $j) (i32.const 1)))))
  (if (i32.and (i32.ne (local.get $last) (i32.const 0))
               (i32.lt_s (i32.sub (i32.add (local.get $tp) (i32.const 1)) (local.get $last)) (i32.const @PN_LANECD)))
    (then (return)))
  (i32.store16 offset=2 (i32.add (local.get $ba) (i32.shl (local.get $j) (i32.const 1))) (i32.add (local.get $tp) (i32.const 1)))
  (local.set $la (i32.add (i32.const @(PG_S + PN_LANE)) (i32.shl (local.get $j) (i32.const 4))))
  (i32.store offset=4 (local.get $la) (i32.add (local.get $t) (i32.const @PN_LLIT)))
  (i32.store offset=8 (local.get $la) (i32.add (i32.load offset=8 (local.get $la)) (i32.const 1)))
  (call $pn_pay (local.get $p) (i32.mul (i32.const @PN_LANEPAY) (local.get $mult)) (i32.const @PN_WLANE) (local.get $j)
                (f32.load (local.get $la)) (f32.mul (f32.add (f32.load (i32.const @(PG_H + PN_LTOP))) (f32.load (i32.const @(PG_H + PN_LBOT)))) (f32.const 0.5))))

;; The round's world, a tick of it: double time on the clock; banks due
;; standing again; in slot order each ball's pay for what its push met this
;; tick (a bumper, a target), the top lanes and the spinners it passes; then
;; the spinners turn, paying a point a turn.
(func $pn_tick
  (local $t i32) (local $tp i32) (local $mult i32) (local $p i32) (local $pb i32) (local $m i32) (local $j i32) (local $b i32) (local $i i32)
  (local $a i32) (local $first i32) (local $nsp i32) (local $want i32) (local $turns i32) (local $who i32)
  (local $cx f32) (local $u f32) (local $w f32) (local $sp f32)
  (local.set $t (i32.load (i32.const @HDR_TICK)))
  (local.set $tp (call $p_t (i32.const 0)))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $mult (select (i32.const 2) (i32.const 1) (i32.ge_u (local.get $tp) (i32.const @(PN_LEN - PN_DOUBLE)))))
  (if (i32.eq (local.get $tp) (i32.const @(PN_LEN - PN_DOUBLE)))
    (then (call $fx (i32.const 0) (i32.const @PN_FX_CALL) (i32.const 255) (i32.const 0) (local.get $cx) (f32.const @PLAT_Y) (local.get $cx) (f32.const 0))))
  ;; the banks standing again
  (!for $b (i32.const 0) (i32.load (i32.const @(PG_H + PN_NBANK)))
    (local.set $a (i32.add (i32.const @(PG_S + PN_BANK)) (i32.shl (local.get $b) (i32.const 4))))
    (if (i32.and (i32.ne (i32.load (local.get $a)) (i32.const 0)) (i32.ge_s (i32.sub (local.get $t) (i32.load (local.get $a))) (i32.const 0)))
      (then
        (i32.store (local.get $a) (i32.const 0))
        (local.set $first (i32.load8_u offset=4 (local.get $a)))
        (!for $j (local.get $first) (i32.add (local.get $first) (i32.load8_u offset=5 (local.get $a)))
          (i32.store offset=@(PG_S + PN_TGT) (i32.shl (local.get $j) (i32.const 3)) (i32.const 0)))
        (call $fx (i32.const 0) (i32.const @PN_FX_CALL) (i32.const 255) (i32.const 1) (local.get $cx) (f32.const @PLAT_Y) (local.get $cx) (f32.convert_i32_u (local.get $b))))))
  (local.set $nsp (i32.load (i32.const @(PG_H + PN_NSP))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (call $p_in (local.get $pb))
      (then
        (local.set $u (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (local.get $cx)))
        (local.set $w (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (local.get $cx)))
        ;; what its push met this tick
        (local.set $m (!at i32 @(PLAYERS + PG_M) (local.get $pb)))
        (if (i32.eq (i32.shr_u (local.get $m) (i32.const 16)) (i32.and (local.get $t) (i32.const 0xffff)))
          (then
            (local.set $j (i32.and (local.get $m) (i32.const 255)))
            (if (local.get $j)
              (then
                (local.set $a (i32.add (i32.const @(PG_S + PN_BUMP)) (i32.shl (i32.sub (local.get $j) (i32.const 1)) (i32.const 4))))
                (i32.store offset=8 (local.get $a) (i32.add (i32.load offset=8 (local.get $a)) (i32.const 1)))
                (call $pn_pay (local.get $p) (i32.mul (i32.const @PN_BUMPPAY) (local.get $mult)) (i32.const @PN_WBUMP) (i32.sub (local.get $j) (i32.const 1))
                              (f32.load (local.get $a)) (f32.load offset=4 (local.get $a)))))
            (local.set $j (i32.and (i32.shr_u (local.get $m) (i32.const 8)) (i32.const 255)))
            (if (local.get $j) (then (call $pn_target (local.get $p) (i32.sub (local.get $j) (i32.const 1)) (local.get $t) (local.get $mult))))))
        (call $pn_lanes (local.get $p) (local.get $u) (local.get $w) (!at f32 @(PLAYERS + P_VZ) (local.get $pb)) (local.get $tp) (local.get $t) (local.get $mult))
        ;; through a spinner's middle, along its lane: spun at least as fast as it went
        (!for $i (i32.const 0) (local.get $nsp)
          (local.set $a (i32.add (i32.const @(PG_S + PN_SPIN)) (i32.shl (local.get $i) (i32.const 5))))
          (local.set $sp (f32.abs (!at f32 @(PLAYERS + P_VZ) (local.get $pb))))
          (if (i32.and (i32.and (f32.lt (f32.abs (f32.sub (local.get $u) (f32.load (local.get $a)))) (f32.load offset=8 (local.get $a)))
                                (f32.lt (f32.abs (f32.sub (local.get $w) (f32.load offset=4 (local.get $a)))) (f32.const @PN_SPD)))
                       (f32.gt (local.get $sp) (f32.const 2)))
            (then
              (local.set $want (i32.trunc_sat_f32_u (f32.min (f32.mul (local.get $sp) (f32.const @PN_SPINK)) (f32.const @PN_SPINMAX))))
              (if (i32.gt_u (local.get $want) (i32.load offset=16 (local.get $a)))
                (then
                  (i32.store offset=16 (local.get $a) (local.get $want))
                  (i32.store offset=24 (local.get $a) (local.get $p))))))))))
  ;; the spinners turn, paying whoever spun them last a point a turn, and slow
  (!for $i (i32.const 0) (local.get $nsp)
    (local.set $a (i32.add (i32.const @(PG_S + PN_SPIN)) (i32.shl (local.get $i) (i32.const 5))))
    (i32.store offset=12 (local.get $a) (i32.add (i32.load offset=12 (local.get $a)) (i32.load offset=16 (local.get $a))))
    (local.set $turns (i32.shr_u (i32.load offset=12 (local.get $a)) (i32.const 14)))
    (if (i32.gt_u (local.get $turns) (i32.load offset=20 (local.get $a)))
      (then
        (local.set $who (i32.load offset=24 (local.get $a)))
        (if (i32.lt_u (local.get $who) (i32.const @NPLAYER))
          (then
            (if (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $who) (i32.const 6))) (i32.const @PF_LIVE))
              (then (call $pn_pay (local.get $who) (i32.mul (i32.sub (local.get $turns) (i32.load offset=20 (local.get $a))) (local.get $mult))
                              (i32.const @PN_WSPIN) (local.get $i) (f32.load (local.get $a)) (f32.load offset=4 (local.get $a)))))))
        (i32.store offset=20 (local.get $a) (local.get $turns))))
    (i32.store offset=16 (local.get $a) (i32.shr_u (i32.mul (i32.load offset=16 (local.get $a)) (i32.const 63)) (i32.const 6)))))

(func $pn_over (result i32) (i32.const 0))

;; Ball p down a drain: a fifth of its points gone.
(func $pn_out (param $p i32)
  (local $pb i32) (local $lost i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (local.set $lost (i32.div_u (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)) (i32.const 5)))
  (call $pn_add (local.get $p) (i32.sub (i32.const 0) (local.get $lost)))
  (call $fx (i32.const 0) (i32.const @PN_FX_DRAIN) (local.get $p) (local.get $lost)
            (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (f32.const 0)))
