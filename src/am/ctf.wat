;; CAPTURE THE FLAG (M_CTF, prefix cf; constants and AO's fields in
;; src/am/ctf.mjs): red's flag and blue's, each on its side's stand
;; (MAP_FLAGS' point, its feet height by $stand), and each home, carried by a
;; slot, or dropped (where it lies, and CF_LEFT ticks before it goes home).
;; Every tick of play, each step for flag 0 then flag 1 before the next step:
;;   1. a carried flag whose carrier has gone (left, its slot rejoined) or
;;      died drops where it was, at the carrier's feet as the last tick left
;;      them;
;;   2. a carried flag goes where its carrier's feet are; the carrier
;;      captures if they are at its own stand (within CF_CAP_R across,
;;      CF_TOUCH_H up or down) while its own flag is home: a point for its
;;      side, MR_POINTS + 1, the carry over, the flag home;
;;   3. a dropped flag counts down, and goes home when its time is up;
;;   4. a home or dropped flag is touched (within CF_TOUCH_R across,
;;      CF_TOUCH_H up or down) by the first fighter in slot order who is
;;      alive, carried nothing as this step began, and for whom the touch
;;      does something: an enemy takes it, one of its own side returns it if
;;      it lies dropped (MR_AUX + 1). Its own side standing on it at home is
;;      passed over, so a defender on the stand never shields it from an
;;      enemy.
;; Step by step rather than flag by flag, so neither side wins a tie on its
;; colour: captures come before takes for both, and a blue fighter taking
;; red's flag can still return blue's on that tick, as a red one returning
;; red's can then take blue's. A fighter takes only the enemy's flag, so
;; carries one at most. A carrier who dies drops it at its feet. A dropped
;; flag falls onto what is under it (the ground, or the highest box top no
;; higher). Each event is news (FX_MODE, CF_MX_*). The core ends the match
;; at CF_CAPS and the clock.

;; Flag k's record in AO (k 0 red's, 1 blue's).
(func $cf_at (param $k i32) (result i32)
  (i32.add (i32.const @(AO + CF_FLAG)) (i32.mul (local.get $k) (i32.const @CF_FSIZE))))

;; Flag k's news: what as the size, owner who did it (255 nobody), shot the
;; flag's side, where the flag is.
(func $cf_news (param $k i32) (param $what i32) (param $owner i32)
  (local $f i32)
  (local.set $f (call $cf_at (local.get $k)))
  (call $fx (i32.const 0) (i32.const @FX_MODE) (local.get $owner) (local.get $k)
            (f32.load offset=@CF_POS (local.get $f)) (f32.load offset=@(CF_POS + 4) (local.get $f)) (f32.load offset=@(CF_POS + 8) (local.get $f))
            (f32.convert_i32_u (local.get $what))))

;; Flag k goes home: on its stand, nobody's.
(func $cf_home (param $k i32)
  (local $f i32)
  (local.set $f (call $cf_at (local.get $k)))
  (f32.store offset=@CF_POS (local.get $f) (f32.load offset=@CF_STAND (local.get $f)))
  (f32.store offset=@(CF_POS + 4) (local.get $f) (f32.load offset=@(CF_STAND + 4) (local.get $f)))
  (f32.store offset=@(CF_POS + 8) (local.get $f) (f32.load offset=@(CF_STAND + 8) (local.get $f)))
  (i32.store8 offset=@CF_STATE (local.get $f) (i32.const @CF_HOME))
  (i32.store16 offset=@CF_LEFT (local.get $f) (i32.const 0)))

;; Flag k, its carrier's no more, falls from (x, y, z) onto what is under it
;; (as $move lands feet: a box top up to 1 cm over them counts), to lie
;; CF_RETURN; news, its carrier the owner.
(func $cf_drop (param $k i32) (param $x f32) (param $y f32) (param $z f32)
  (local $f i32)
  (local.set $f (call $cf_at (local.get $k)))
  (f32.store offset=@CF_POS (local.get $f) (local.get $x))
  (f32.store offset=@(CF_POS + 4) (local.get $f) (call $stand (local.get $x) (local.get $z) (f32.add (local.get $y) (f32.const 0.01))))
  (f32.store offset=@(CF_POS + 8) (local.get $f) (local.get $z))
  (i32.store8 offset=@CF_STATE (local.get $f) (i32.const @CF_DROPPED))
  (i32.store16 offset=@CF_LEFT (local.get $f) (i32.const @CF_RETURN))
  (call $cf_news (local.get $k) (i32.const @CF_MX_DROP) (i32.load8_u offset=@CF_BY (local.get $f))))

;; Play begins: each flag's stand resolved from the map, both flags home; the target.
(func $cf_start
  (local $k i32) (local $f i32) (local $m i32)
  (!for $k (i32.const 0) (i32.const 2)
    (local.set $f (call $cf_at (local.get $k)))
    (local.set $m (i32.add (i32.const @MAP_FLAGS) (i32.shl (local.get $k) (i32.const 4))))
    (f32.store offset=@CF_STAND (local.get $f) (f32.load (local.get $m)))
    (f32.store offset=@(CF_STAND + 4) (local.get $f) (call $stand (f32.load (local.get $m)) (f32.load offset=4 (local.get $m)) (f32.load offset=8 (local.get $m))))
    (f32.store offset=@(CF_STAND + 8) (local.get $f) (f32.load offset=4 (local.get $m)))
    (call $cf_home (local.get $k)))
  (i32.store (i32.const @AH_TARGET) (i32.const @CF_CAPS)))

;; Every tick of play: the head's four steps. Never ends the match itself.
(func $cf_tick (result i32)
  (call $cf_gone (i32.const 0))
  (call $cf_gone (i32.const 1))
  (call $cf_carry (i32.const 0))
  (call $cf_carry (i32.const 1))
  (call $cf_lie (i32.const 0))
  (call $cf_lie (i32.const 1))
  (drop (call $cf_touch (i32.const 1) (call $cf_touch (i32.const 0) (i32.const -1))))
  (i32.const 0))

;; 1. Flag k carried by one gone or dead: down where it was (the carry, if
;; somehow still on, put down with it).
(func $cf_gone (param $k i32)
  (local $f i32) (local $p i32)
  (local.set $f (call $cf_at (local.get $k)))
  (local.set $p (i32.load8_u offset=@CF_BY (local.get $f)))
  (if (i32.and (i32.eq (i32.load8_u offset=@CF_STATE (local.get $f)) (i32.const @CF_CARRIED))
               (i32.ne (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @(PF_LIVE | PF_DEAD | PF_CARRY)))
                       (i32.const @(PF_LIVE | PF_CARRY))))
    (then
      (call $a_carry (local.get $p) (i32.const 0))
      (call $cf_drop (local.get $k) (f32.load offset=@CF_POS (local.get $f)) (f32.load offset=@(CF_POS + 4) (local.get $f)) (f32.load offset=@(CF_POS + 8) (local.get $f))))))

;; 2. Flag k carried: at its carrier's feet; a capture at the carrier's own
;; stand while its own flag is home.
(func $cf_carry (param $k i32)
  (local $f i32) (local $own i32) (local $p i32) (local $pb i32) (local $r i32)
  (local.set $f (call $cf_at (local.get $k)))
  (if (i32.ne (i32.load8_u offset=@CF_STATE (local.get $f)) (i32.const @CF_CARRIED)) (then (return)))
  (local.set $own (call $cf_at (i32.sub (i32.const 1) (local.get $k))))
  (local.set $p (i32.load8_u offset=@CF_BY (local.get $f)))
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (f32.store offset=@CF_POS (local.get $f) (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (f32.store offset=@(CF_POS + 4) (local.get $f) (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (f32.store offset=@(CF_POS + 8) (local.get $f) (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (if (i32.and (i32.eq (i32.load8_u offset=@CF_STATE (local.get $own)) (i32.const @CF_HOME))
               (call $a_near (local.get $p) (f32.load offset=@CF_STAND (local.get $own)) (f32.load offset=@(CF_STAND + 4) (local.get $own))
                             (f32.load offset=@(CF_STAND + 8) (local.get $own)) (f32.const @CF_CAP_R) (f32.const @CF_TOUCH_H)))
    (then
      (call $a_score (i32.sub (i32.const 1) (local.get $k)) (i32.const 1))
      (local.set $r (i32.shl (local.get $p) (i32.const 3)))
      (i32.store16 offset=@(MODE_REC + MR_POINTS) (local.get $r) (i32.add (i32.load16_u offset=@(MODE_REC + MR_POINTS) (local.get $r)) (i32.const 1)))
      (call $a_carry (local.get $p) (i32.const 0))
      (call $cf_news (local.get $k) (i32.const @CF_MX_CAP) (local.get $p))
      (call $cf_home (local.get $k)))))

;; 3. Flag k dropped: one tick less to lie, or home if none are left.
(func $cf_lie (param $k i32)
  (local $f i32) (local $left i32)
  (local.set $f (call $cf_at (local.get $k)))
  (if (i32.ne (i32.load8_u offset=@CF_STATE (local.get $f)) (i32.const @CF_DROPPED)) (then (return)))
  (local.set $left (i32.load16_u offset=@CF_LEFT (local.get $f)))
  (if (local.get $left)
    (then (i32.store16 offset=@CF_LEFT (local.get $f) (i32.sub (local.get $left) (i32.const 1))))
    (else
      (call $cf_news (local.get $k) (i32.const @CF_MX_HOME) (i32.const 255))
      (call $cf_home (local.get $k)))))

;; 4. Flag k home or dropped: the first in slot order who is alive and
;; carries nothing (P_FL's live, dead and carry bits just PF_LIVE), or is
;; `took` (who took flag 0 in this step, -1 nobody: it carried nothing as
;; the step began), and whose touch does something: an enemy's takes it,
;; its own side's sends a dropped one home. Who took it, or -1.
(func $cf_touch (param $k i32) (param $took i32) (result i32)
  (local $f i32) (local $p i32) (local $pb i32) (local $r i32) (local $st i32) (local $mine i32)
  (local.set $f (call $cf_at (local.get $k)))
  (local.set $st (i32.load8_u offset=@CF_STATE (local.get $f)))
  (if (i32.eq (local.get $st) (i32.const @CF_CARRIED)) (then (return (i32.const -1))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.or (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @(PF_LIVE | PF_DEAD | PF_CARRY))) (i32.const @PF_LIVE))
                (i32.eq (local.get $p) (local.get $took)))
      (then
        (local.set $mine (i32.eq (call $a_team (local.get $p)) (local.get $k)))
        (if (i32.and (i32.or (i32.eqz (local.get $mine)) (i32.eq (local.get $st) (i32.const @CF_DROPPED)))
                     (call $a_near (local.get $p) (f32.load offset=@CF_POS (local.get $f)) (f32.load offset=@(CF_POS + 4) (local.get $f))
                                   (f32.load offset=@(CF_POS + 8) (local.get $f)) (f32.const @CF_TOUCH_R) (f32.const @CF_TOUCH_H)))
          (then
            (if (local.get $mine)
              (then
                (local.set $r (i32.shl (local.get $p) (i32.const 3)))
                (i32.store16 offset=@(MODE_REC + MR_AUX) (local.get $r) (i32.add (i32.load16_u offset=@(MODE_REC + MR_AUX) (local.get $r)) (i32.const 1)))
                (call $cf_news (local.get $k) (i32.const @CF_MX_RETURN) (local.get $p))
                (call $cf_home (local.get $k))
                (return (i32.const -1))))
            (call $cf_news (local.get $k) (i32.const @CF_MX_TAKE) (local.get $p))
            (i32.store8 offset=@CF_STATE (local.get $f) (i32.const @CF_CARRIED))
            (i32.store8 offset=@CF_BY (local.get $f) (local.get $p))
            (i32.store16 offset=@CF_LEFT (local.get $f) (i32.const 0))
            (call $a_carry (local.get $p) (i32.const 1))
            (return (local.get $p)))))))
  (i32.const -1))

;; q died (at a's hand or its own): a flag it carried drops at its feet. The
;; core puts its carry down after.
(func $cf_kill (param $q i32) (param $a i32) (param $cause i32)
  (local $k i32) (local $f i32) (local $qb i32)
  (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
  (!for $k (i32.const 0) (i32.const 2)
    (local.set $f (call $cf_at (local.get $k)))
    (if (i32.and (i32.eq (i32.load8_u offset=@CF_STATE (local.get $f)) (i32.const @CF_CARRIED))
                 (i32.eq (i32.load8_u offset=@CF_BY (local.get $f)) (local.get $q)))
      (then (call $cf_drop (local.get $k) (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (!at f32 @(PLAYERS + P_PZ) (local.get $qb)))))))

;; No spawn point is barred.
(func $cf_bar (param $x f32) (param $y f32) (param $z f32) (result i32)
  (i32.const 0))
