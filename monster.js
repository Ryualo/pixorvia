// ═══════════════════════════════════════════════════════════════════════════════
// Monster-only controller. Transport, maze, player and POV effects stay in
// their owners.
//
// Architecture:
//   ┌─────────────────────────────────────────────────────┐
//   │  PATROL ←──→ AMBUSH ←──→ STALK ←──→ CHASE           │
//   │    ↕            ↕          ↕                        │
//   │  INVESTIGATE → SEARCH ←───┘                         │
//   │                                                     │
//   │  Special overlays: FURY, LURE, FLEE, FLASH          │
//   │  New behaviors:    HALLWAY_STARE, CORNER_PEEK       │
//   └─────────────────────────────────────────────────────┘
//
// The Director AI modulates aggression based on time since last scare event,
// creating natural tension curves rather than constant pressure.
// ═══════════════════════════════════════════════════════════════════════════════

export function createMonsterAI(Base, THREE, CFG) {

  // ─── Named Constants ─────────────────────────────────────────────────────────
  const CELL = CFG.CELL;
  const INV_CELL = 1 / CELL;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const cap = v => Math.min(8, v);

  // Perception
  const SENSE_INTERVAL       = 0.25;
  const SIGHT_RANGE          = 25;
  const CLOSE_SIGHT_RANGE    = 3;
  const SOUND_RANGE_RUN      = 23;
  const SOUND_RANGE_WALK     = 10;
  const NEAR_THRESHOLD       = 3.5;
  const NEAR_THRESHOLD_HEARD = 4.5;

  // Movement
  const CATCH_RADIUS         = 1.1;
  const TURN_RATE            = 9;
  const COLLISION_RADIUS     = 0.2;
  const WAYPOINT_ARRIVAL     = 0.1;
  const MOVE_SUBSTEP         = 0.1;

  // Timers & Cooldowns
  const SCREAM_COOLDOWN_MIN  = 9;
  const SCREAM_COOLDOWN_VAR  = 5;
  const FAKE_SOUND_MIN       = 10;
  const FAKE_SOUND_VAR       = 12;
  const CHASE_PLAN_INTERVAL  = 0.65;
  const PATROL_PLAN_INTERVAL = 1.6;
  const FLASH_COOLDOWN       = 10;
  const BEAM_COOLDOWN        = 6;
  const NEAR_COOLDOWN        = 6;
  const LURE_COOLDOWN        = 5;
  const FURY_COOLDOWN        = 22;

  // State durations
  const INVESTIGATE_TIMEOUT  = 7;
  const SEARCH_TIMEOUT       = 10;
  const PATROL_CHANGE_TIME   = 14;
  const AMBUSH_TIMEOUT       = 12;
  const STALK_ENGAGE_TIME    = 9;

  // Speeds
  const FURY_FLEE_SPEED_MULT = 4;
  const FURY_CHASE_SPEED     = 2.5;
  const STALK_RETREAT_MULT   = 3.4;
  const FLASH_CHASE_MULT     = 1.5;
  const NEAR_CHASE_BASE      = 1.4;
  const NEAR_CHASE_POWER     = 0.6;
  const BEAM_FLEE_SPEED_MULT = 4.2;

  // Trail
  const TRAIL_STEP_DIST      = 0.9;
  const TRAIL_MAX_COUNT      = 600;
  const TRAIL_LIFETIME       = 300;
  const TRAIL_FADE_INTERVAL  = 0.25;

  // Director AI
  const DIRECTOR_QUIET_THRESHOLD   = 30;
  const DIRECTOR_RECENT_DEATH_COOL = 15;
  const DIRECTOR_MAX_AGGRESSION    = 1.0;
  const DIRECTOR_MIN_AGGRESSION    = 0.0;

  // Hallway Stare
  const STARE_MIN_DIST     = 14;
  const STARE_MAX_DIST     = 25;
  const STARE_DURATION_MIN = 2.0;
  const STARE_DURATION_MAX = 5.0;
  const STARE_COOLDOWN     = 18;

  // Corner Peek
  const PEEK_DURATION  = 2.5;
  const PEEK_COOLDOWN  = 12;
  const PEEK_LEAN_DIST = 0.35;

  // Mimic Steps
  const MIMIC_COOLDOWN    = 20;
  const MIMIC_MIN_DIST    = 8;
  const MIMIC_MAX_DIST    = 20;
  const MIMIC_BURST_COUNT = 4;

  // Chase acceleration
  const CHASE_ACCEL_TIME  = 1.2;

  // ─── Monster Class ────────────────────────────────────────────────────────────

  return class HuntingMonster extends Base {

    // ═════════════════════════════════════════════════════════════════════════
    // AUTHORITY & INITIALIZATION
    // ═════════════════════════════════════════════════════════════════════════

    authority() { return !this.g.share?.on || this.g.share.host; }

    _cacheDom() {
      if (typeof document === 'undefined') return;
      if (!this._vhsEl) this._vhsEl = document.getElementById('vhs');
      if (!this._dangerEl) this._dangerEl = document.getElementById('danger');
    }

    reset() {
      if (this._broken?.length) this.restoreWorld();
      this._cacheDom();
      if (this._vhsEl) {
        if (this._distanceOpacityActive) this._vhsEl.style.opacity = '';
        if (this._lastFilterStr) this._vhsEl.style.filter = '';
      }
      if (this._dangerEl) this._dangerEl.style.opacity = '0';
      super.reset();

      // ── Core state ──
      this.mode   = 'PATROL';
      this.target = null;
      this.known  = null;
      this.goal   = -1;
      this.seenT  = 0;

      // ── Timers ──
      this.senseT     = 0;
      this.planT      = 0;
      this.stateT     = 0;
      this.pauseT     = 0;
      this.screamT    = 0;
      this.fakeT      = FAKE_SOUND_MIN;
      this.age        = 0;
      this.decayT     = 0;
      this.trailFadeT = 0;

      // ── Trail system ──
      this.trailDistance = 0;
      this.trailSeq      = 0;
      this.trail         = [];
      this.trailSent     = 0;
      this.trailPhase    = 0;
      this.fullT         = 0;

      // ── Networking ──
      this.soundSeq    = 0;
      this.sound       = null;
      this.catchSeq    = 0;
      this.caught      = null;
      this.seenSound   = 0;
      this.seenCatch   = 0;
      this.seenCat     = 0;
      this.seenTrail   = 0;
      this.epoch       = (this.epoch || 0) + 1;
      this.remoteEpoch = null;

      // ── Tracking ──
      this.tracks   = new Map();
      this.observed = new Map();
      this.retreat  = false;

      // ── Stalk & Psychological state ──
      this._stalkT          = 0;
      this._stalkDir        = 1;
      this._playerWasMoving = false;
      this._echoStepTimer   = 0;
      this._crankCreeping   = false;

      // ── Visual effects & DOM cache guards ──
      this._glitch                = 0;
      this._glitchShown           = false;
      this._lastDangerOp          = '0';
      this._lastVhsOp             = '';
      this._lastFilterStr         = '';
      this._lastChromaStr         = '';
      this._distanceOpacityActive = false;
      this._lastVisibleDistance   = Infinity;
      this._headBone              = undefined;

      // ── Flash / beam response ──
      this._flashResponse = null;
      this._hunt          = null;
      this._lure          = null;
      this._flashReadyAt  = 0;
      this._nearReadyAt   = 0;
      this._lureReadyAt   = 0;
      this._beamPollAt    = 0;
      this._beamSeen      = new Map();

      // ── Fury system ──
      this.fury              = 0;
      this._fury             = null;
      this._broken           = [];
      this._brokenSet        = new Set();
      this._dimCellX         = -1;
      this._dimCellZ         = -1;
      this._lightingSnapshot = null;
      this._worldDimActive   = false;
      this._flickerSnapshots = new Map();
      this._quietPhaseUntil  = 0;

      // ── Memory / learning ──
      this.memory = new Map();
      this.escape = new Float32Array(4);

      // ── Director AI — dynamic tension manager ──
      this._lastScareTime = 0;
      this._lastDeathTime = 0;
      this._aggression    = 0.3;
      this._directorT     = 0;

      // ── Hallway Stare ──
      this._stareReadyAt    = 0;
      this._staring         = false;
      this._stareUntil      = 0;
      this._stareTarget     = null;
      this._stareTeleported = false;

      // ── Corner Peek ──
      this._peekReadyAt = 0;
      this._peeking     = false;
      this._peekUntil   = 0;
      this._peekOrigin  = null;
      this._peekDir     = null;

      // ── Mimic Steps ──
      this._mimicReadyAt  = 0;
      this._mimicBurst    = 0;
      this._mimicPos      = null;
      this._mimicInterval = 0;

      // ── Chase acceleration ──
      this._chaseAccelT = 0;

      // ── Lights-out flicker warning ──
      this._flickerWarning = false;
      this._flickerT       = 0;

      // Survive maze regeneration; only general tendencies persist
      this.habits  = this.habits || { follow: 0, hide: 0, deaths: 0 };
      this.scratch = this.scratch || new THREE.Vector3();
      this.facing  = this.facing || new THREE.Vector3();
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SPATIAL UTILITIES (Zero-Allocation via flatGrid)
    // ═════════════════════════════════════════════════════════════════════════

    _isFloor(cx, cz) {
      const w = this.g.world, n = w.n;
      if (cx < 0 || cz < 0 || cx >= n || cz >= n) return false;
      return w.flatGrid ? w.flatGrid[cx * n + cz] === 0 : w.grid[cx]?.[cz] === 0;
    }

    cellId(x, z) {
      const w = this.g.world, n = w.n;
      const cx = Math.round(x * INV_CELL), cz = Math.round(z * INV_CELL);
      if (cx < 0 || cz < 0 || cx >= n || cz >= n) return -1;
      const k = cx * n + cz;
      const t = w.flatGrid ? w.flatGrid[k] : w.grid[cx]?.[cz];
      return t === 0 ? k : -1;
    }

    record(id, key, amount) {
      if (id < 0) return;
      let r = this.memory.get(id);
      if (!r) { r = { route: 0, hide: 0, follow: 0, deaths: 0 }; this.memory.set(id, r); }
      r[key] = cap(r[key] + amount);
    }

    line(ax, az, bx, bz) {
      const w = this.g.world, n = w.n, fg = w.flatGrid;
      const dx = bx - ax, dz = bz - az;
      const dist = Math.hypot(dx, dz);
      const steps = Math.ceil(dist / 0.45);
      if (steps <= 1) return true;

      const invSteps = 1 / steps;
      const pilHalf = CELL * 0.17 + 0.08;

      for (let i = 1; i < steps; i++) {
        const t = i * invSteps;
        const px = ax + dx * t, pz = az + dz * t;
        const cx = Math.round(px * INV_CELL), cz = Math.round(pz * INV_CELL);
        if (cx < 0 || cz < 0 || cx >= n || cz >= n) return false;
        const cellType = fg ? fg[cx * n + cz] : w.grid[cx][cz];
        if (cellType === 1) return false;
        if (cellType === 2) {
          if (Math.abs(px - cx * CELL) < pilHalf && Math.abs(pz - cz * CELL) < pilHalf) {
            return false;
          }
        }
      }
      return true;
    }

    isCorner(cx, cz) {
      let count = 0, sumX = 0, sumZ = 0;
      for (let i = 0; i < 4; i++) {
        const dx = DIRS[i][0], dz = DIRS[i][1];
        if (this._isFloor(cx + dx, cz + dz)) {
          count++;
          sumX += dx;
          sumZ += dz;
        }
      }
      return count === 2 && (sumX !== 0 || sumZ !== 0);
    }

    isLongHallway(cx, cz, minLength = 5) {
      if (!this._isFloor(cx, cz + 1) && !this._isFloor(cx, cz - 1)) {
        let hLen = 1;
        for (let d = 1; d <= minLength; d++) { if (this._isFloor(cx + d, cz)) hLen++; else break; }
        for (let d = 1; d <= minLength; d++) { if (this._isFloor(cx - d, cz)) hLen++; else break; }
        if (hLen >= minLength) return 'h';
      }
      if (!this._isFloor(cx + 1, cz) && !this._isFloor(cx - 1, cz)) {
        let vLen = 1;
        for (let d = 1; d <= minLength; d++) { if (this._isFloor(cx, cz + d)) vLen++; else break; }
        for (let d = 1; d <= minLength; d++) { if (this._isFloor(cx, cz - d)) vLen++; else break; }
        if (vLen >= minLength) return 'v';
      }
      return false;
    }

    pathToCell(targetCell) {
      const w = this.g.world, n = w.n, fg = w.flatGrid;
      const mx = Math.round(this.pos.x * INV_CELL), my = Math.round(this.pos.z * INV_CELL);
      const start = mx * n + my;
      this.path.length = 0;
      if (start === targetCell || targetCell < 0) {
        this.goal = targetCell;
        return true;
      }

      const prev = this.prev, q = this.q;
      prev.fill(-1);
      let h = 0, t = 0, found = false;
      q[t++] = start;
      prev[start] = start;

      while (h < t) {
        const id = q[h++];
        if (id === targetCell) { found = true; break; }
        const x = (id / n) | 0, y = id % n;
        for (let i = 0; i < 4; i++) {
          const X = x + DIRS[i][0], Y = y + DIRS[i][1];
          if (X < 0 || Y < 0 || X >= n || Y >= n) continue;
          const k = X * n + Y;
          if (prev[k] === -1 && (fg ? fg[k] === 0 : w.grid[X][Y] === 0)) {
            prev[k] = id;
            q[t++] = k;
          }
        }
      }

      if (!found) {
        this.goal = -1;
        return false;
      }
      let cur = targetCell;
      while (cur !== start) {
        this.path.push(cur);
        cur = prev[cur];
      }
      this.path.reverse();
      this.goal = targetCell;
      return true;
    }

    _hasRecentTrailNear(x, z, maxAge, radius) {
      const rSq = radius * radius;
      for (let i = this.trail.length - 1; i >= 0; i--) {
        const t = this.trail[i];
        if (this.age - t.time >= maxAge) break;
        const dx = t.x - x, dz = t.z - z;
        if (dx * dx + dz * dz < rSq) return true;
      }
      return false;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PLAYER ENUMERATION
    // ═════════════════════════════════════════════════════════════════════════

    players(fn) {
      const g = this.g, mp = g.mp;
      if (!g.dead && (!mp?.coop || mp.alive)) {
        const speed = g.player.moving
          ? (g.player.winding && !g.dark ? CFG.WALK * 0.4
            : g.player.running ? CFG.RUN : CFG.WALK)
          : 0;
        fn(mp?.peer?.id || 'local', g.camera.position, speed);
      }
      if (mp?.coop) {
        const now = performance.now();
        for (const [id, r] of mp.remotes) {
          if (!r.alive || !r.buf.length) continue;
          const b = r.buf, p = b[b.length - 1], a = b[Math.max(0, b.length - 3)];
          if (now - p.t > 1500) continue;
          const speed = p.t > a.t
            ? Math.min(CFG.RUN, Math.hypot(p.x - a.x, p.z - a.z) * 1000 / (p.t - a.t))
            : 0;
          fn(id, p, speed);
        }
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // DIRECTOR AI — Dynamic Tension Manager
    // ═════════════════════════════════════════════════════════════════════════

    markScare() { this._lastScareTime = this.age; }

    markDeath() { this._lastDeathTime = this.age; this._lastScareTime = this.age; }

    updateDirector(dt) {
      this._directorT -= dt;
      if (this._directorT > 0) return;
      const step = 1.0;
      this._directorT = step;

      const quietTime = this.age - this._lastScareTime;
      const deathRecovery = this.age - this._lastDeathTime;

      if (deathRecovery < DIRECTOR_RECENT_DEATH_COOL) {
        this._aggression = Math.max(DIRECTOR_MIN_AGGRESSION, this._aggression - step * 0.08);
        return;
      }
      if (quietTime > DIRECTOR_QUIET_THRESHOLD) {
        const ramp = Math.min(1, (quietTime - DIRECTOR_QUIET_THRESHOLD) / 60);
        this._aggression = Math.min(DIRECTOR_MAX_AGGRESSION, this._aggression + ramp * 0.04);
      } else {
        this._aggression = Math.max(0.3, this._aggression - step * 0.02);
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PERCEPTION
    // ═════════════════════════════════════════════════════════════════════════

    sense() {
      const w = this.g.world;
      const mcx = Math.round(this.pos.x * INV_CELL), mcz = Math.round(this.pos.z * INV_CELL);
      this.flood(mcx, mcz);

      let best = null, bestScore = -Infinity;
      this.observed.clear();

      this.players((id, p, speed) => {
        const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
        const d = Math.hypot(dx, dz), cell = this.cellId(p.x, p.z);
        const dot = (dx * this.dir.x + dz * this.dir.z) / (d || 1);

        const sight = d < SIGHT_RANGE && (d < CLOSE_SIGHT_RANGE || dot > -0.15)
          && this.line(this.pos.x, this.pos.z, p.x, p.z);

        const pd = cell < 0 ? -1 : this.distMap[cell];
        const range = speed > 4 ? SOUND_RANGE_RUN : speed > 0.4 ? SOUND_RANGE_WALK : 0;
        const heard = range > 0 && pd >= 0 && pd * CELL < range;

        if (!sight && !heard) return;

        const ox = sight ? p.x : (cell / w.n | 0) * CELL;
        const oz = sight ? p.z : (cell % w.n) * CELL;
        const near = sight ? d < NEAR_THRESHOLD
          : heard && d < NEAR_THRESHOLD_HEARD && pd >= 0 && pd <= 2;
        const power = near ? Math.max(0, Math.min(1, 1 - d / NEAR_THRESHOLD_HEARD)) : 0;

        const obs = { id, x: ox, z: oz, cell, sight, d, speed, near, power };
        this.observed.set(id, obs);

        // ── Track movement patterns ──
        const old = this.tracks.get(id);
        let vx = 0, vz = 0;
        if (old && old.cell !== cell) {
          vx = Math.sign(ox - old.x);
          vz = Math.sign(oz - old.z);
          this.record(cell, 'route', 0.3);
          if (this.mode === 'CHASE') {
            const ex = ox - old.x, ez = oz - old.z;
            const k = Math.abs(ex) > Math.abs(ez) ? (ex > 0 ? 0 : 1) : (ez > 0 ? 2 : 3);
            this.escape[k] = cap(this.escape[k] + 0.2);
          }
          if (this._hasRecentTrailNear(ox, oz, 42, 2.5)) {
            this.record(cell, 'follow', 0.2);
            this.habits.follow = cap(this.habits.follow + 0.05);
          }
        } else if (old) {
          vx = old.vx || 0;
          vz = old.vz || 0;
          if (sight && speed < 0.3 && this.openCount(cell / w.n | 0, cell % w.n) <= 2) {
            this.record(cell, 'hide', 0.025);
            this.habits.hide = cap(this.habits.hide + 0.005);
          }
        }
        this.tracks.set(id, { cell, x: ox, z: oz, vx, vz, time: this.age });

        const learned = this.memory.get(cell);
        const routeBias = learned ? Math.min(2.5, (learned.route || 0) * 0.22
          + (learned.hide || 0) * 0.12 + (learned.follow || 0) * 0.08) : 0;
        const targetBias = id === this.target ? 5 : 0;
        const score = (sight ? 20 : 5) - d * 0.4 + targetBias + routeBias;
        if (score > bestScore) { bestScore = score; best = obs; }
      });

      // ── Active hunt override ──
      let hunt = this._hunt;
      if (hunt) {
        const mp = this.g.mp, local = mp?.peer?.id || 'local';
        const alive = hunt.id === local
          ? !this.g.dead && (!mp?.coop || mp.alive)
          : mp?.remotes.get(hunt.id)?.alive;
        if (!alive || this.age >= hunt.until) {
          this._hunt = null; hunt = null;
          this.change(this.observed.has(this.target) ? 'STALK' : 'SEARCH');
          this.pauseT = 0.6;
          this._nearReadyAt = Math.max(this._nearReadyAt, this.age + 3);
        }
      }
      if (hunt) {
        const seen = this.observed.get(hunt.id);
        if (seen) this.known = { x: seen.x, z: seen.z, cell: seen.cell, time: this.age };
        this.target = hunt.id;
        if (seen?.near) hunt.power = Math.max(hunt.power || 0, seen.power);
        return;
      }

      // ── Proximity ambush ──
      let near = null;
      for (const obs of this.observed.values()) {
        if (obs.near && (!near || obs.d < near.d)) near = obs;
      }

      // ── Active lure override ──
      if (this._lure) {
        const seen = this.observed.get(this._lure.id);
        if (seen) this.known = { x: seen.x, z: seen.z, cell: seen.cell, time: this.age };
        this.target = this._lure.id;
        return;
      }

      // ── Close-range pounce ──
      if (near && near.d < 2 && !this._lure && this.age >= this._nearReadyAt) {
        this._nearReadyAt = this.age + NEAR_COOLDOWN;
        this._hunt = { kind: 'near', id: near.id, power: near.power, until: this.age + 2.2 };
        this.target = near.id;
        this.known = { x: near.x, z: near.z, cell: near.cell, time: this.age };
        this.change('CHASE');
        this.retreat = false; this.pauseT = 0.15;
        this.planT = 0; this.goal = -1; this.path.length = 0;
        this.dir.set(near.x - this.pos.x, 0, near.z - this.pos.z).normalize();
        this.scream();
        this.addFury(near.id, 0.5);
        this.markScare();
        return;
      }

      // ── Best observation processing ──
      if (best) {
        this.target = best.id;
        this.known = { x: best.x, z: best.z, cell: best.cell, time: this.age };

        if (best.sight) {
          this.markScare();

          if (this.mode === 'PATROL' || this.mode === 'INVESTIGATE' || this.mode === 'SEARCH') {
            const attackChance = 0.08 + this._aggression * 0.12;
            const attack = best.d < 10 && this.age >= this._lureReadyAt
              && Math.random() < attackChance;
            if (attack) {
              this._lureReadyAt = this.age + 18;
              this._hunt = { kind: 'ordinary', id: best.id, until: this.age + 3 };
              this.change('CHASE');
            } else {
              if (this.tryHallwayStare(best)) return;
              this.change('STALK');
            }
          }

          if ((this.mode === 'STALK' || this.mode === 'AMBUSH')
            && best.d < 11 && this.age >= this._lureReadyAt) {
            if (this.startLure(best)) return;
          }

          if (this.mode === 'STALK' && this.stateT > STALK_ENGAGE_TIME) {
            this.change('AMBUSH');
          }
        } else if (this.mode === 'PATROL') {
          this.change('INVESTIGATE');
        }
      }

      // ── Staleness transitions ──
      if (this.known && this.age - this.known.time > 0.8
        && (this.mode === 'CHASE' || this.mode === 'STALK')) this.change('SEARCH');
      if (this.known && this.age - this.known.time > 22) {
        this.known = null; this.target = null; this.change('PATROL');
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STATE TRANSITIONS
    // ═════════════════════════════════════════════════════════════════════════

    change(mode) {
      if (this.mode === mode) return;
      this._staring = false;
      this._stareTeleported = false;
      this._peeking = false;
      this.peeking  = false;
      this.lingerT  = 0;
      this.mode = mode; this.stateT = 0; this.planT = 0;
      this.goal = -1; this.path.length = 0; this.retreat = false;
      this._chaseAccelT = 0;
      this.pauseT = mode === 'CHASE' ? 0.45 : 0;
      if (mode === 'STALK') this._stalkDir = Math.random() < 0.5 ? -1 : 1;
      if (mode === 'CHASE') { this.scream(); this.markScare(); }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SOUND SYSTEM
    // ═════════════════════════════════════════════════════════════════════════

    soundAt(kind, x = this.pos.x, z = this.pos.z) {
      this.sound = { seq: ++this.soundSeq, kind, x, z, time: this.age };
      this.playSound(this.sound);
    }

    playSound(s) {
      if (!s || s.seq <= this.seenSound) return;
      this.seenSound = s.seq;
      if (this.age - s.time > 2) return;
      const a = this.g.audio; if (!a) return;
      this.scratch.set(s.x, 0, s.z);
      const d = Math.hypot(s.x - this.g.camera.position.x, s.z - this.g.camera.position.z);

      if (s.kind === 'scream') {
        (a.roar || a.shriek).call(a, this.scratch);
      } else if (s.kind === 'mimic') {
        if (a.ctx && a.stepBuf && a.spatial) {
          const x = a.ctx, t = x.currentTime, src = x.createBufferSource(), f = x.createBiquadFilter(), g = x.createGain();
          src.buffer = a.stepBuf;
          src.playbackRate.value = 0.85 + Math.random() * 0.3;
          f.type = 'lowpass';
          f.frequency.value = 650 + Math.random() * 300;
          g.gain.setValueAtTime(0.35, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
          src.connect(f); f.connect(g);
          a.spatial(g, this.scratch, 1, d);
          src.start(t); src.stop(t + 0.22);
        } else if (a.monsterStep) {
          a.monsterStep(this.scratch, d);
        }
      } else if (s.kind === 'dart') {
        if (a.whoosh) a.whoosh.call(a, this.scratch);
      } else {
        (a.whisper || a.shriek).call(a, this.scratch, d);
      }
    }

    scream(force = false) {
      if (this._flashResponse && !force) return;
      if (!force && this.screamT > 0) return;
      this.screamT = SCREAM_COOLDOWN_MIN + Math.random() * SCREAM_COOLDOWN_VAR;
      this.soundAt('scream');
      this.markScare();
    }

    // ═════════════════════════════════════════════════════════════════════════
    // HALLWAY STARE & PSYCHOLOGICAL HORROR UPGRADES
    // ═════════════════════════════════════════════════════════════════════════

    tryHallwayStare(obs) {
      if (this.age < this._stareReadyAt) return false;
      if (obs.d < STARE_MIN_DIST || obs.d > STARE_MAX_DIST) return false;
      if (!obs.sight) return false;

      const mcx = Math.round(this.pos.x * INV_CELL), mcz = Math.round(this.pos.z * INV_CELL);
      if (!this.isLongHallway(mcx, mcz)) return false;

      const cam = this.g.camera;
      if (cam) {
        cam.getWorldDirection(this.scratch);
        const dx = this.pos.x - cam.position.x, dz = this.pos.z - cam.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.1) {
          const dot = (dx * this.scratch.x + dz * this.scratch.z) / dist;
          if (dot < 0.5) return false;
        }
      }

      if (Math.random() > 0.3 + this._aggression * 0.4) return false;

      this._staring = true;
      this._stareTeleported = false;
      this.lingerT = 1;
      this._stareUntil = this.age + STARE_DURATION_MIN
        + Math.random() * (STARE_DURATION_MAX - STARE_DURATION_MIN);
      this._stareReadyAt = this.age + STARE_COOLDOWN;
      this._stareTarget = obs.id;
      this.dir.set(obs.x - this.pos.x, 0, obs.z - this.pos.z).normalize();
      this.soundAt('fake');
      this.markScare();
      return true;
    }

    /**
     * 1. One-Delayed-Step Echo & 3. Flashlight-Crank Exploitation
     */
    psychologicalTick(dt) {
      const g = this.g, p = g.player;
      if (!this.active || g.dead || this.mode === 'CHASE' || this._fury || this._hunt) return;

      const d = this.dist();

      // ── A. The "One Extra Step" Echo when Player Stops Walking ──
      if (p.moving && d < 16 && d > 3.5) {
        this._playerWasMoving = true;
        this._echoStepTimer = 0.24 + Math.random() * 0.12;
      } else if (this._playerWasMoving && !p.moving) {
        this._echoStepTimer -= dt;
        if (this._echoStepTimer <= 0) {
          this._playerWasMoving = false;
          if (Math.random() < 0.45 + this._aggression * 0.35) {
            g.camera.getWorldDirection(this.scratch);
            const bx = g.camera.position.x - this.scratch.x * 3.8;
            const bz = g.camera.position.z - this.scratch.z * 3.8;
            this.scratch.set(bx, 0, bz);
            g.audio?.monsterStep?.(this.scratch, 3.8);
            this.markScare();
          }
        }
      }

      // ── B. Flashlight-Crank Predator (Advances only while player holds E) ──
      if (p.winding && !g.dark && d < 20 && d > 3.2 && (this.mode === 'STALK' || this.mode === 'AMBUSH' || this.mode === 'SEARCH')) {
        g.camera.getWorldDirection(this.facing);
        const dx = this.pos.x - g.camera.position.x, dz = this.pos.z - g.camera.position.z;
        const dot = (dx * this.facing.x + dz * this.facing.z) / (d || 1);
        if (dot < 0.55 || !g.flash.on) {
          if (this.known) this.pathToCell(this.known.cell);
          this.move(dt, CFG.WALK * 1.65);
          this._crankCreeping = true;
        }
      } else if (this._crankCreeping && !p.winding) {
        this._crankCreeping = false;
        this.pauseT = Math.max(this.pauseT, 1.1);
        this.speed = 0;
      }
    }

    /**
     * 2. Upgraded Hallway Stare with "Weeping Angel" Light-Blink Vanish / Teleport
     */
    hallwayStareTick(dt) {
      if (!this._staring) return false;

      const obs = this.observed.get(this._stareTarget);
      const tooClose = obs && obs.d < 7.5;
      const expired = this.age >= this._stareUntil;

      const blinkLights = () => {
        this.startFlickerWarning();
        this._flickerT = 0.34;
        this.g.audio?.pop?.(this.pos);
        if (this.g.glitch) this.g.glitch();
      };

      if (tooClose) {
        this._staring = false;
        this._stareTeleported = false;
        this.lingerT = 0;
        blinkLights();
        this._hunt = { kind: 'ordinary', id: this._stareTarget, until: this.age + 3 };
        this.change('CHASE');
        return true;
      }

      // Mid-stare "Weeping Angel" step-forward on a light blink
      if (!this._stareTeleported && obs && obs.d > 13 && this._stareUntil - this.age < 1.6 && Math.random() < 0.45) {
        this._stareTeleported = true;
        const stepX = this.pos.x + this.dir.x * CELL * 2;
        const stepZ = this.pos.z + this.dir.z * CELL * 2;
        if (!this.g.world.collides(stepX, stepZ, COLLISION_RADIUS)) {
          blinkLights();
          this.pos.x = stepX;
          this.pos.z = stepZ;
          this._stareUntil = this.age + 1.1;
        }
      }

      if (expired) {
        this._staring = false;
        this._stareTeleported = false;
        this.lingerT = 0;
        blinkLights();
        if (obs && this.cornerRoute(obs) && this.path.length) {
          const vanishId = this.path[Math.min(2, this.path.length - 1)];
          const n = this.g.world.n;
          this.pos.set(((vanishId / n) | 0) * CELL, 0, (vanishId % n) * CELL);
          this.path.length = 0;
        }
        this.change('STALK');
        this.retreat = true;
        this._stalkT = this.age + 2.5;
        return true;
      }

      if (obs) this.dir.set(obs.x - this.pos.x, 0, obs.z - this.pos.z).normalize();
      this.speed = 0;
      this.lingerT = 1;
      const jitter = Math.sin(this.age * 7) * 0.003;
      this.dir.x += jitter;
      this.dir.normalize();
      this.renderLocal(dt);
      return true;
    }

    /**
     * 4. Dead-End Executioner Speed Modifier
     */
    getChaseSpeed(baseChaseSpeed) {
      if (!this.known) return baseChaseSpeed;
      const n = this.g.world.n;
      const pcx = (this.known.cell / n) | 0, pcz = this.known.cell % n;
      const d = Math.hypot(this.known.x - this.pos.x, this.known.z - this.pos.z);

      if (d < 7.5 && d > 1.8 && this.openCount(pcx, pcz) === 1 && !this._hunt) {
        this.startFlickerWarning();
        return CFG.WALK * 0.48;
      }
      return baseChaseSpeed;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // CORNER PEEK — Lean around corners while stalking
    // ═════════════════════════════════════════════════════════════════════════

    tryCornerPeek() {
      if (this.age < this._peekReadyAt || !this.known) return false;
      const w = this.g.world;
      const mcx = Math.round(this.pos.x * INV_CELL), mcz = Math.round(this.pos.z * INV_CELL);
      if (!this.isCorner(mcx, mcz)) return false;

      const k = this.known;
      const d = Math.hypot(k.x - this.pos.x, k.z - this.pos.z);
      if (d < 4 || d > 15) return false;
      if (this.line(this.pos.x, this.pos.z, k.x, k.z)) return false;

      for (let i = 0; i < 4; i++) {
        const dx = DIRS[i][0], dz = DIRS[i][1];
        const px = this.pos.x + dx * PEEK_LEAN_DIST;
        const pz = this.pos.z + dz * PEEK_LEAN_DIST;
        if (w.collides(px, pz, 0.1)) continue;
        if (this.line(px, pz, k.x, k.z)) {
          this._peeking = true;
          this.peeking  = true;
          this._peekUntil = this.age + PEEK_DURATION;
          this._peekReadyAt = this.age + PEEK_COOLDOWN;
          this._peekOrigin = { x: this.pos.x, z: this.pos.z };
          this._peekDir = { x: dx, z: dz };
          return true;
        }
      }
      return false;
    }

    cornerPeekTick(dt) {
      if (!this._peeking) return false;
      if (this.age >= this._peekUntil) {
        if (this._peekOrigin) { this.pos.x = this._peekOrigin.x; this.pos.z = this._peekOrigin.z; }
        this._peeking = false;
        this.peeking  = false;
        return true;
      }
      const t = Math.max(0, Math.min(1,
        (this.age - (this._peekUntil - PEEK_DURATION)) / PEEK_DURATION));
      const lean = Math.sin(t * Math.PI) * PEEK_LEAN_DIST;
      if (this._peekOrigin && this._peekDir) {
        const nx = this._peekOrigin.x + this._peekDir.x * lean;
        const nz = this._peekOrigin.z + this._peekDir.z * lean;
        if (!this.g.world.collides(nx, nz, COLLISION_RADIUS)) {
          this.pos.x = nx; this.pos.z = nz;
        } else {
          this._peekUntil = this.age;
          this.pos.x = this._peekOrigin.x; this.pos.z = this._peekOrigin.z;
          this._peeking = false;
          this.peeking  = false;
          return true;
        }
      }
      if (this.known) this.dir.set(this.known.x - this.pos.x, 0, this.known.z - this.pos.z).normalize();
      this.speed = 0;
      this.renderLocal(dt);
      return true;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // MIMIC STEPS — Fake footsteps from adjacent corridors
    // ═════════════════════════════════════════════════════════════════════════

    tryMimicSteps() {
      if (this.age < this._mimicReadyAt) return;
      if (this.mode === 'CHASE' || this._hunt || this._fury) return;
      if (!this.known) return;

      const k = this.known;
      const d = Math.hypot(k.x - this.pos.x, k.z - this.pos.z);
      if (d < MIMIC_MIN_DIST || d > MIMIC_MAX_DIST) return;
      if (Math.random() > 0.02 + this._aggression * 0.05) return;

      const pcx = Math.round(k.x * INV_CELL), pcz = Math.round(k.z * INV_CELL);
      for (let i = 0; i < 4; i++) {
        const nx = pcx + DIRS[i][0] * 3, nz = pcz + DIRS[i][1] * 3;
        if (!this._isFloor(nx, nz)) continue;
        const mx = nx * CELL, mz = nz * CELL;
        if (this.line(k.x, k.z, mx, mz)) continue;

        this._mimicReadyAt = this.age + MIMIC_COOLDOWN;
        this._mimicBurst = MIMIC_BURST_COUNT;
        this._mimicPos = { x: mx, z: mz };
        this._mimicInterval = 0;
        this.markScare();
        return;
      }
    }

    mimicStepTick(dt) {
      if (this._mimicBurst <= 0 || !this._mimicPos) return;
      this._mimicInterval -= dt;
      if (this._mimicInterval > 0) return;
      this._mimicInterval = 0.35 + Math.random() * 0.15;
      this._mimicBurst--;
      this.soundAt('mimic', this._mimicPos.x, this._mimicPos.z);
      if (this._mimicBurst <= 0) this._mimicPos = null;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // LIGHTS-OUT WARNING — Flicker lights before fury
    // ═════════════════════════════════════════════════════════════════════════

    startFlickerWarning() {
      if (this._flickerWarning) return;
      this._flickerWarning = true;
      this._flickerT = 0;
      this._flickerSnapshots.clear();
      const w = this.g.world;
      if (!w?.fixtures) return;
      const R2 = 15 * 15;
      for (const f of w.fixtures) {
        const dx = f.pos.x - this.pos.x, dz = f.pos.z - this.pos.z;
        if (f.dead || dx * dx + dz * dz > R2) continue;
        this._flickerSnapshots.set(f, { flick: f.flick, dead: f.dead });
      }
    }

    flickerWarningTick(dt) {
      if (!this._flickerWarning) return;
      this._flickerT += Math.max(0, dt);
      const w = this.g.world;
      if (w?.fixtures) {
        const phase = this._flickerT;
        const flicker = (Math.sin(phase * 31) > 0.45 || Math.sin(phase * 9.7) > 0.94) ? 1 : 0.08;
        for (const [f, saved] of this._flickerSnapshots) {
          if (!f.dead && !saved.dead) w.setTube(f, flicker);
        }
        if (w.dirty) { w.tubes.instanceColor.needsUpdate = true; w.dirty = false; }
      }
      if (this._flickerT >= 0.5) {
        this._flickerWarning = false;
        if (w?.fixtures) {
          for (const [f, saved] of this._flickerSnapshots) {
            if (!f.dead && !saved.dead) w.setTube(f, Number.isFinite(saved.flick) ? saved.flick : 1);
          }
          if (w.dirty) { w.tubes.instanceColor.needsUpdate = true; w.dirty = false; }
        }
        this._flickerSnapshots.clear();
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PATHFINDING & PLANNING (With Predictive Junction Interception)
    // ═════════════════════════════════════════════════════════════════════════

    plan() {
      const w = this.g.world, n = w.n, k = this.known, mode = this.mode;

      if ((mode === 'CHASE' || mode === 'INVESTIGATE'
        || (mode === 'SEARCH' && this.stateT < 4)) && k) {
        let targetCell = k.cell;
        // 5. Predictive Junction Interception: if player broke LOS during CHASE,
        // project 2 cells ahead along their movement direction to cut them off!
        const obs = this.observed.get(this.target);
        const tr = this.tracks.get(this.target);
        if (mode === 'CHASE' && !obs?.sight && tr && (tr.vx || tr.vz)) {
          const pcx = (k.cell / n) | 0, pcz = k.cell % n;
          for (let step = 2; step >= 1; step--) {
            const ix = pcx + tr.vx * step, iz = pcz + tr.vz * step;
            if (this._isFloor(ix, iz)) {
              targetCell = ix * n + iz;
              break;
            }
          }
        }
        this.pathToCell(targetCell);
        return;
      }

      if (mode === 'AMBUSH' && this.goal >= 0) return;

      const maxDepth = mode === 'PATROL' ? 14 : 12;
      this.search(maxDepth, (id, depth, x, z) => {
        const cx = (id / n) | 0, cz = id % n;
        const open = this.openCount(cx, cz);

        if (k) {
          const dx = x - k.x, dz = z - k.z, d = Math.hypot(dx, dz);
          if (mode === 'SEARCH' && d > 18) return -Infinity;
          if (mode === 'AMBUSH') {
            if (d < 6 || d > 22 || open > 2 || this.line(k.x, k.z, x, z)) return -Infinity;
          }
          if (mode === 'STALK') {
            if (this.retreat) return d * 0.5 - depth * 0.6 + Math.random() * 2;
            return -Math.abs(d - 4) * 0.7 - depth * 0.25 + Math.random() * 3;
          }
        } else if (mode === 'AMBUSH' && open > 2) return -Infinity;

        const r = this.memory.get(id);
        let learned = r ? r.route * 0.45 + r.hide * 0.6 + r.follow * 0.35 - r.deaths * 0.65 : 0;

        if (k) {
          const dx = x - k.x, dz = z - k.z;
          const dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 0 : 1) : (dz > 0 ? 2 : 3);
          learned += this.escape[dir] * 0.25;
          if (mode === 'AMBUSH') {
            const marked = this._hasRecentTrailNear(x, z, 42, 3);
            learned += marked ? -2 : 2;
          }
        }

        let wallBonus = 0;
        if (mode === 'STALK' || mode === 'AMBUSH') {
          wallBonus = (4 - open) >= 2 ? 1.5 : 0;
        }

        return Math.min(3, Math.max(-3, learned)) + Math.random() * 4 - depth * 0.16
          + (mode === 'PATROL' ? Math.min(depth, 8) * 0.3 : 0) + wallBonus;
      });
      this.goal = this.path.length ? this.path[this.path.length - 1] : -1;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SPAWNING
    // ═════════════════════════════════════════════════════════════════════════

    spawn() {
      if (!this.authority()) return;
      const w = this.g.world, n = w.n;
      let best = -1, score = -Infinity;
      const minDist = 24 - this._aggression * 6;
      const maxDist = 65 - this._aggression * 15;

      const pList = [];
      this.players((id, p) => pList.push(p));
      if (!pList.length) { this.respawn = 3; return; }

      for (let x = 1; x < n - 1; x++) {
        const wx = x * CELL;
        for (let z = 1; z < n - 1; z++) {
          if (!this._isFloor(x, z)) continue;
          const wz = z * CELL;
          let near = Infinity, visible = false;
          for (let i = 0; i < pList.length; i++) {
            const p = pList[i];
            const d = Math.hypot(wx - p.x, wz - p.z);
            if (d < near) near = d;
          }
          if (near < minDist || near > maxDist) continue;

          for (let i = 0; i < pList.length; i++) {
            const p = pList[i];
            const dx = wx - p.x, dz = wz - p.z;
            if (dx * dx + dz * dz < 900 && this.line(wx, wz, p.x, p.z)) {
              visible = true;
              break;
            }
          }
          if (visible) continue;

          const s = Math.random() * 10 - Math.abs(near - 32) * 0.2;
          if (s > score) { score = s; best = x * n + z; }
        }
      }
      if (best < 0) { this.respawn = 3; return; }
      this.pos.set((best / n | 0) * CELL, 0, (best % n) * CELL);
      this.lastGoo.copy(this.pos);
      this.active = true; this.pooled = false; this.group.visible = true;
      this.change('PATROL');
    }

    // ═════════════════════════════════════════════════════════════════════════
    // FLASHLIGHT / CAMERA DETECTION
    // ═════════════════════════════════════════════════════════════════════════

    lightHeadHit(direction, origin, beam = false, range = beam ? Math.min(6, CFG.BEAM_RANGE) : 8) {
      const radius = beam ? 0.38 : 0.5;
      this.body.localToWorld(this.scratch.set(0, 2.72, 0.1));
      const dx = this.scratch.x - origin.x;
      const dy = this.scratch.y - origin.y;
      const dz = this.scratch.z - origin.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      const length = Math.hypot(direction.x, direction.y, direction.z);
      if (length < 0.001 || distanceSq < 0.0001 || distanceSq > range * range) return false;
      const along = (dx * direction.x + dy * direction.y + dz * direction.z) / length;
      if (along <= 0 || distanceSq - along * along > radius * radius) return false;
      return this.line(origin.x, origin.z, this.scratch.x, this.scratch.z);
    }

    onFlash(beam = false) {
      const g = this.g, mp = g.mp;
      if (mp && !mp._monsterFlashBridge) {
        const receive = mp.receive;
        mp.receive = function (d, conn) {
          if (d?.t === 'monster-flash') {
            if (this.coop && this.isHost && this.conns.get(conn?.peer) === conn) {
              this.g.monster.acceptFlash(conn.peer, d, true);
            }
            return;
          }
          return receive.call(this, d, conn);
        };
        mp._monsterFlashBridge = true;
      }

      if (beam) {
        const now = performance.now();
        if (now < this._beamPollAt) return;
        this._beamPollAt = now + 100;
      }
      if (!this.active || g.dead || g.dark || (mp?.coop && !mp.alive)) return;

      let v;
      if (beam) {
        this.body.localToWorld(this.scratch.set(0, 2.72, 0.1));
        if (!g.flash.hits(this.scratch)) return;
        v = g.flash.dirW;
      } else {
        g.camera.getWorldDirection(this.facing);
        v = this.facing;
      }

      const c = g.camera.position;
      if (!this.lightHeadHit(v, c, beam)) return;

      const request = {
        t: 'monster-flash', beam, seed: mp?.seed, level: g.level,
        x: c.x, y: c.y, z: c.z, dx: v.x, dy: v.y, dz: v.z
      };
      if (this.authority()) {
        this.acceptFlash(mp?.peer?.id || 'local', request, false);
      } else {
        mp?.emit(request);
      }
    }

    acceptFlash(id, d, remote) {
      const g = this.g, mp = g.mp;
      if (!this.authority() || !this.active || g.dark
        || d.level !== g.level || typeof d.beam !== 'boolean') return;
      if (![d.x, d.y, d.z, d.dx, d.dy, d.dz].every(Number.isFinite)) return;
      const len = Math.hypot(d.dx, d.dy, d.dz);
      if (Math.abs(len - 1) > 0.05) return;

      if (remote) {
        const r = mp?.remotes.get(id);
        const p = r?.buf[r.buf.length - 1];
        if (d.seed !== mp.seed || !r?.alive || !p || performance.now() - p.t > 750) return;
        if (Math.hypot(d.x - p.x, d.y - p.y, d.z - p.z) > 1.25) return;
        const cp = Math.cos(p.pitch);
        const alignment = -Math.sin(p.yaw) * cp * d.dx + Math.sin(p.pitch) * d.dy - Math.cos(p.yaw) * cp * d.dz;
        if (alignment / len < 0.94) return;
      } else if (g.dead || (mp?.coop && !mp.alive)
        || (d.beam && (!g.flash.on || g.flash.spot.intensity < 0.5))) {
        return;
      }

      this.facing.set(d.dx, d.dy, d.dz);
      if (!this.lightHeadHit(this.facing, d, d.beam)) return;

      const dx = this.pos.x - d.x, dz = this.pos.z - d.z;
      const flat = Math.hypot(dx, dz);
      const cell = this.cellId(d.x, d.z);
      if (cell < 0) return;

      if (d.beam) {
        if (this._flashResponse || this.freeze > 0
          || (this._hunt?.kind === 'flash' && this.age < this._hunt.until)) return;
        const last = this._beamSeen.get(id);
        if ((last !== undefined && this.age - last < BEAM_COOLDOWN)
          || (this._hunt?.kind === 'flee' && this.age < this._hunt.until)) return;

        this._beamSeen.set(id, this.age);
        this._lure = null;
        this._hunt = { kind: 'flee', id, x: d.x, z: d.z, cell, until: this.age + 3 };
        this.target = id;
        this.known = { x: d.x, z: d.z, cell, time: this.age };
        this.change('STALK'); this.retreat = true;
        this.addFury(id, 0.34);
        this.freeze = 0; this.pauseT = 0; this.stateT = 0;
        this.path.length = 0; this.goal = -1; this.planT = 0;
        return;
      }

      if (this.age < this._flashReadyAt || this._flashResponse || this.freeze > 0) return;

      this._flashReadyAt = this.age + FLASH_COOLDOWN;
      this._lure = null;
      this.addFury(id, 0.4);
      this._hunt = { kind: 'flash', id, power: 0, until: this.age + 4.35 };
      this._flashResponse = {
        epoch: this.epoch, id, until: this.age + 0.35,
        rx: flat > 1e-5 ? dx / flat : -this.dir.x,
        rz: flat > 1e-5 ? dz / flat : -this.dir.z
      };
      this.target = id;
      this.known = { x: d.x, z: d.z, cell, time: this.age };
      this.change('CHASE');
      this.freeze = 0.35; this.retreat = false;
      this.pauseT = 0; this.stateT = 0;
      this.path.length = 0; this.goal = -1; this.planT = 0;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // CORNER ROUTE — Find a position around a corner from the target
    // ═════════════════════════════════════════════════════════════════════════

    cornerRoute(k) {
      const w = this.g.world, n = w.n;
      if (!k || k.cell < 0) return false;
      this.flood(k.cell / n | 0, k.cell % n);
      const here = this.cellId(this.pos.x, this.pos.z);
      const start = here < 0 ? -1 : this.distMap[here];
      if (start < 0) return false;

      const ok = this.search(8, (id, depth, x, z) => {
        const away = this.distMap[id], cx = id / n | 0, cz = id % n;
        const open = this.openCount(cx, cz);
        if (away <= start || open < 2 || this.line(k.x, k.z, x, z)) return -Infinity;

        const side = this._isFloor(cx + 1, cz) || this._isFloor(cx - 1, cz);
        const forward = this._isFloor(cx, cz + 1) || this._isFloor(cx, cz - 1);
        const r = this.memory.get(id);
        const learned = r ? Math.min(2, r.route * 0.3 + r.follow * 0.4 - r.deaths * 0.5) : 0;
        return (side && forward ? 5 : 0) + (open >= 3 ? 2 : 0)
          + Math.min(4, away - start) - depth * 0.6 + learned;
      }, Math.max(1, start));

      this.goal = ok ? this.path[this.path.length - 1] : -1;
      return ok;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // LURE SYSTEM — Bait the player into following, then ambush
    // ═════════════════════════════════════════════════════════════════════════

    startLure(obs) {
      if (!this.authority() || !this.active || this._hunt
        || this._flashResponse || this.freeze > 0
        || this.age < this._lureReadyAt) return false;

      this._lureReadyAt = this.age + LURE_COOLDOWN;
      this.change('AMBUSH');
      if (!this.cornerRoute(obs)) {
        this.change('STALK'); this.pauseT = 1; return false;
      }
      this.target = obs.id;
      this._lure = {
        id: obs.id, phase: 'escape', until: this.age + 4,
        originCell: obs.cell, rounds: 0, followed: false
      };
      this.retreat = true; this.pauseT = 0; this.speed = 0;
      return true;
    }

    lureTick(dt) {
      const h = this._lure;
      if (!h || !this.authority()) return false;

      const mp = this.g.mp, local = mp?.peer?.id || 'local';
      const alive = h.id === local
        ? !this.g.dead && (!mp?.coop || mp.alive)
        : mp?.remotes.get(h.id)?.alive;
      if (!this.active || !alive) {
        this._lure = null; this.retreat = false; this.change('SEARCH'); return false;
      }

      const obs = this.observed.get(h.id);
      if (obs && obs.cell !== h.originCell && obs.d < 10) h.followed = true;

      let speed = 0;
      if (h.phase === 'escape') {
        this.retreat = true; this.pauseT = 0;
        speed = CFG.RUN * (obs && obs.d < 4 ? FURY_FLEE_SPEED_MULT : 3);

        const n = this.g.world.n, id = this.goal;
        const arrived = id >= 0 && !this.path.length
          && Math.hypot(this.pos.x - (id / n | 0) * CELL, this.pos.z - (id % n) * CELL) < 0.5;

        if (arrived) {
          h.phase = 'wait'; h.until = this.age + 3.5;
          this.retreat = false; speed = 0; this.soundAt('fake');
        } else if (this.age >= h.until || !this.path.length) {
          this._lure = null; this.retreat = false;
          this.change('STALK'); this.pauseT = 0.7;
          this._lureReadyAt = this.age + LURE_COOLDOWN;
          this.speed = 0; this.renderLocal(dt); return true;
        }
      } else {
        this.retreat = false;
        if (h.followed && obs && h.rounds < 2 && (obs.d < 8 || this.age >= h.until)) {
          if (this.cornerRoute(obs)) {
            h.rounds++; h.phase = 'escape'; h.until = this.age + 4;
            h.originCell = obs.cell; h.followed = false; this.retreat = true;
            speed = CFG.RUN * (obs.d < 4 ? FURY_FLEE_SPEED_MULT : 3);
          } else {
            h.until = Math.min(h.until, this.age + 0.5);
          }
        }
        if (h.phase === 'wait' && this.age >= h.until) {
          this._lure = null; this.retreat = false;
          this._lureReadyAt = this.age + 7;
          this._nearReadyAt = Math.max(this._nearReadyAt, this.age + 1);

          const attack = h.followed && obs?.sight && obs.d < 6
            && Math.random() < 0.15 + this._aggression * 0.15;
          if (attack) {
            this._hunt = { kind: 'ordinary', id: h.id, until: this.age + 2.5 };
            this.change('CHASE');
          } else if (!h.followed) {
            this.target = h.id;
            this._hunt = { kind: 'ordinary', id: h.id, until: this.age + 3.5 };
            this.change('CHASE');
          } else {
            this.change(obs ? 'STALK' : 'SEARCH');
          }
          this.pauseT = 0; this.speed = 0; this.renderLocal(dt); return true;
        }
      }

      const x = this.pos.x, z = this.pos.z;
      this.move(dt, speed);
      const moved = Math.hypot(this.pos.x - x, this.pos.z - z);
      this.speed = moved / Math.max(dt, 1e-6);
      if (moved > 0.001) this.leaveTrail(moved);
      this.renderLocal(dt);
      return true;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // FLEE — Generalized high-speed retreat from being spotted or flashed
    // ═════════════════════════════════════════════════════════════════════════

    fleeTick(dt) {
      const h = this._hunt;
      if (!h || h.kind !== 'flee') return false;
      if (!this.active) { this._hunt = null; return false; }

      const brokenLOS = !this.line(this.pos.x, this.pos.z, h.x, h.z);
      const arrived = this.goal >= 0 && !this.path.length;

      if (this.age >= h.until || (brokenLOS && arrived && this.age > h.until - 2.5)) {
        this._hunt = null; this.retreat = false; this.speed = 0;
        this.change('SEARCH'); this.pauseT = 0.6; this.senseT = 0.6;
        this._nearReadyAt = Math.max(this._nearReadyAt, this.age + 1);
        this.renderLocal(dt); return true;
      }

      this.retreat = true; this.freeze = 0; this.pauseT = 0;
      if (this.planT <= 0) {
        this.planT = 0.9;
        const w = this.g.world, n = w.n;
        this.flood(h.cell / n | 0, h.cell % n);
        const here = this.cellId(this.pos.x, this.pos.z);
        const start = here >= 0 ? this.distMap[here] : -1;

        if (start >= 0) {
          this.search(12, (id, depth, x, z) => {
            const away = this.distMap[id];
            if (away <= start) return -Infinity;
            const cx = id / n | 0, cz = id % n;
            const side = this._isFloor(cx + 1, cz) || this._isFloor(cx - 1, cz);
            const forward = this._isFloor(cx, cz + 1) || this._isFloor(cx, cz - 1);
            const open = this.openCount(cx, cz);
            const visible = this.line(h.x, h.z, x, z);

            return (away - start) * 3 - depth * 0.3
              + (open === 2 && side && forward ? 5 : 0) - (open === 1 ? 6 : 0)
              - (visible ? 10 : 0);
          }, Math.max(1, start - 1));
        } else { this.path.length = 0; }
        this.goal = this.path.length ? this.path[this.path.length - 1] : -1;
      }

      const x = this.pos.x, z = this.pos.z;
      this.move(dt, CFG.RUN * BEAM_FLEE_SPEED_MULT);
      const moved = Math.hypot(this.pos.x - x, this.pos.z - z);
      this.speed = moved / Math.max(dt, 1e-6);
      if (moved > 0.001) this.leaveTrail(moved);
      this.renderLocal(dt);
      return true;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // FLASH RESPONSE — Recoil then charge
    // ═════════════════════════════════════════════════════════════════════════

    flashTick(dt) {
      const r = this._flashResponse;
      if (!r) return false;
      if (r.epoch !== this.epoch || !this.active) {
        this._flashResponse = null; this._hunt = null; this.freeze = 0; return false;
      }

      const mp = this.g.mp, local = mp?.peer?.id || 'local';
      const alive = r.id === local
        ? !this.g.dead && (!mp?.coop || mp.alive)
        : mp?.remotes.get(r.id)?.alive;
      if (!alive) {
        this._flashResponse = null; this._hunt = null; this.freeze = 0;
        this.target = null; this.change('SEARCH'); return false;
      }

      this.target = r.id;
      if (this.age < r.until) {
        this.freeze = r.until - this.age; this.pauseT = 0;
        const x = this.pos.x, z = this.pos.z;
        const step = Math.min(dt, 0.1) * 0.8;
        this.stepBy(r.rx * step, r.rz * step);
        const moved = Math.hypot(this.pos.x - x, this.pos.z - z);
        this.speed = moved / Math.max(dt, 1e-6);
        if (moved > 0.001) this.leaveTrail(moved);
        this.dir.set(-r.rx, 0, -r.rz);
        this.renderLocal(dt); return true;
      }

      this._flashResponse = null; this.freeze = 0;
      this.change('CHASE'); this.retreat = false; this.pauseT = 0;
      this.planT = 0; this.senseT = 0; this.screamT = 0; this.scream();
      return false;
    }

    enterBloodlust() { if (this.authority() && this.active) this.scream(); }

    // ═════════════════════════════════════════════════════════════════════════
    // FURY SYSTEM — Rage mode with lights destruction
    // ═════════════════════════════════════════════════════════════════════════

    addFury(id, amount) {
      if (!this.authority() || !this.active || this._fury) return;
      this.fury = Math.min(1.6, this.fury + amount);
      if (this.fury >= 1 && id && this.age >= (this._furyGuardAt || 0)) {
        this._furyGuardAt = this.age + FURY_COOLDOWN;
        this.enterFury(id);
      }
    }

    dimWorld(force = false) {
      const g = this.g, w = g.world;
      if (!w || !w.fixtures) return;
      if (!this._worldDimActive) {
        this._worldDimActive = true;
        this._broken.length = 0;
        this._brokenSet.clear();
        this._dimCellX = -1;
        this._dimCellZ = -1;
        this._lightingSnapshot = g.lighting && !g.lighting.dark
          ? { amb: g.lighting.amb.intensity, hemi: g.lighting.hemi.intensity }
          : null;
      }

      const cx = Math.round(this.pos.x * INV_CELL), cz = Math.round(this.pos.z * INV_CELL);
      if (force || cx !== this._dimCellX || cz !== this._dimCellZ) {
        this._dimCellX = cx;
        this._dimCellZ = cz;
        const R = 13, R2 = R * R;
        const F = w.fixtures;
        for (let i = 0; i < F.length; i++) {
          const f = F[i];
          if (f.dead) continue;
          const dx = f.pos.x - this.pos.x, dz = f.pos.z - this.pos.z;
          if (dx * dx + dz * dz > R2) continue;
          if (!this._brokenSet.has(f)) {
            this._brokenSet.add(f);
            this._broken.push({
              fixture: f, dead: f.dead, dying: f.dying,
              stress: f.stress, flick: f.flick
            });
          }
          f.dead = true; f.flick = 0; w.setTube(f, 0);
        }
        if (w.dirty) { w.tubes.instanceColor.needsUpdate = true; w.dirty = false; }
      }

      const L = g.lighting;
      if (L && !L.dark) {
        L.amb.intensity = Math.min(L.amb.intensity, 0.07);
        L.hemi.intensity = Math.min(L.hemi.intensity, 0.05);
        this._furyDim = true;
      }
    }

    restoreWorld() {
      const g = this.g, w = g.world;
      for (const saved of this._broken) {
        const f = saved.fixture;
        f.dead = saved.dead;
        f.dying = saved.dying;
        f.stress = saved.stress;
        f.flick = saved.flick;
        w?.setTube?.(f, saved.dead ? 0 : (Number.isFinite(saved.flick) ? saved.flick : 1));
      }
      this._broken.length = 0;
      this._brokenSet?.clear();
      this._dimCellX = -1;
      this._dimCellZ = -1;
      if (w?.dirty) { w.tubes.instanceColor.needsUpdate = true; w.dirty = false; }
      const L = g.lighting;
      if (this._furyDim && L && !L.dark && this._lightingSnapshot) {
        L.amb.intensity = this._lightingSnapshot.amb;
        L.hemi.intensity = this._lightingSnapshot.hemi;
      }
      this._lightingSnapshot = null;
      this._worldDimActive = false;
      this._furyDim = false;
    }

    enterFury(id) {
      if (!this.authority() || !this.active || this._fury) return;
      this.startFlickerWarning();

      this._fury = { id, phase: 'flee', until: this.age + 0.9 };
      this.retreat = true; this.pauseT = 0; this.freeze = 0;
      this._flashResponse = null; this.screamT = 0;
      this.change('CHASE'); this.scream(true);
      this.path.length = 0; this.goal = -1; this.planT = 0;
      this.dimWorld(true);
      this.markScare();
    }

    endFury() {
      if (!this._fury) return;
      this._fury = null; this.fury = 0; this.retreat = false;
      this.restoreWorld();
      this.change('SEARCH'); this.pauseT = 0.6;
      this._furyGuardAt = Math.max(this._furyGuardAt || 0, this.age + 8);
    }

    furyTick(dt) {
      const F = this._fury;
      if (!F || !this.authority()) return false;
      if (!this.active) { this.endFury(); return false; }

      const mp = this.g.mp, local = mp?.peer?.id || 'local';
      const alive = F.id === local
        ? !this.g.dead && (!mp?.coop || mp.alive)
        : mp?.remotes.get(F.id)?.alive;
      if (!alive) { this.endFury(); return false; }

      this.target = F.id; this.retreat = true;
      this.freeze = 0; this.pauseT = 0;
      this.scream();
      this.dimWorld();

      const x0 = this.pos.x, z0 = this.pos.z;

      if (F.phase === 'flee') {
        if (this.planT <= 0) {
          this.planT = 1.1;
          const obs = this.observed.get(F.id) || this.known;
          if (obs && this.cornerRoute(obs)) this._lure = null;
          else { this.path.length = 0; this.goal = -1; }
        }
        this.move(dt, CFG.RUN * FURY_FLEE_SPEED_MULT);
      } else {
        const obs = this.observed.get(F.id);
        if (obs && obs.sight) {
          this.known = { x: obs.x, z: obs.z, cell: obs.cell, time: this.age };
        }
        if (this.planT <= 0) {
          this.planT = 0.5;
          if (this.known) this.pathToCell(this.known.cell);
        }
        const gain = obs && obs.d < 2.2 ? 0.42 : 0.16;
        this.fury = Math.max(0, this.fury - dt * gain);

        this.move(dt, CFG.RUN * FURY_CHASE_SPEED);

        this.players((id, p) => {
          if (id !== F.id) return;
          if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) > CATCH_RADIUS) return;
          if (!this.line(this.pos.x, this.pos.z, p.x, p.z)) return;
          this.record(this.cellId(p.x, p.z), 'deaths', 1);
          this.habits.deaths = cap(this.habits.deaths + 0.3);
          this.caught = { seq: ++this.catchSeq, id, time: this.age };
          this.markDeath();
          if (id === local) {
            this.g.killPlayer();
            if (this.g.mp?.coop) { this.active = true; this.group.visible = true; }
          } else this.g.onPlayerDeath(id);
          this.endFury();
        });

        if (this.fury <= 0) { this.endFury(); this.renderLocal(dt); return true; }
      }

      if (F.phase === 'flee' && this.age >= F.until) F.phase = 'chase';

      const moved = Math.hypot(this.pos.x - x0, this.pos.z - z0);
      this.speed = moved / Math.max(dt, 1e-6);
      if (moved > 0.001) this.leaveTrail(moved);

      this.renderLocal(dt);
      return true;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // MOVEMENT — With chase acceleration curve
    // ═════════════════════════════════════════════════════════════════════════

    move(dt, speed) {
      if (!this.authority() || !this.active || speed <= 0 || dt <= 0) return;
      const w = this.g.world, n = w.n;
      const steps = Math.max(1, Math.ceil(speed * Math.min(dt, 0.1) / MOVE_SUBSTEP));
      const slice = Math.min(dt, 0.1) / steps;

      for (let i = 0; i < steps; i++) {
        let x, z;
        if (this.path.length) {
          const id = this.path[0];
          const cx = (id / n) | 0, cz = id % n;
          if (!this._isFloor(cx, cz)) {
            this.path.length = 0; this.planT = 0; return;
          }
          x = cx * CELL; z = cz * CELL;
          if (Math.hypot(x - this.pos.x, z - this.pos.z) < WAYPOINT_ARRIVAL) {
            this.path.shift(); continue;
          }
        } else {
          const k = this.known;
          if (!k || (this.mode !== 'CHASE' && this.mode !== 'INVESTIGATE' && this.mode !== 'SEARCH')
            || this.goal !== k.cell || this.cellId(this.pos.x, this.pos.z) !== k.cell) return;
          x = k.x; z = k.z;
        }
        const dx = x - this.pos.x, dz = z - this.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.035) return;

        const bend = (Math.sin(this.age * 2.3 + x * 0.17)
          + 0.5 * Math.sin(this.age * 4.1 + z * 0.23)) * 0.1 * Math.min(1, d);
        const desired = Math.atan2(dx, dz) + bend;
        const yaw = Math.atan2(this.dir.x, this.dir.z);
        const delta = Math.atan2(Math.sin(desired - yaw), Math.cos(desired - yaw));
        const turn = Math.max(-TURN_RATE * slice, Math.min(TURN_RATE * slice, delta));
        const heading = yaw + turn;
        this.dir.set(Math.sin(heading), 0, Math.cos(heading));

        const alignment = Math.cos(desired - heading);
        if (alignment < 0.25) continue;
        const length = Math.min(d, speed * slice) * Math.max(0.45, alignment);
        let mx = this.dir.x * length, mz = this.dir.z * length;

        if (w.collides(this.pos.x + mx, this.pos.z + mz, COLLISION_RADIUS)) {
          mx = dx / d * length; mz = dz / d * length;
          if (w.collides(this.pos.x + mx, this.pos.z + mz, COLLISION_RADIUS)) {
            const cellX = Math.round(this.pos.x * INV_CELL);
            const cellZ = Math.round(this.pos.z * INV_CELL);
            const cx = cellX * CELL - this.pos.x, cz = cellZ * CELL - this.pos.z;
            const cd = Math.hypot(cx, cz);
            if (cd < 0.035) continue;
            const s = Math.min(length, cd) / cd;
            mx = cx * s; mz = cz * s;
          }
        }
        this.stepBy(mx, mz);
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TRAIL SYSTEM
    // ═════════════════════════════════════════════════════════════════════════

    dropTrail(x, z, size, yaw) {
      if (this.g.world.collides(x, z, size * 0.55)) return;
      const t = { seq: ++this.trailSeq, x, z, size, yaw, time: this.age, slot: this.g.goo.idx };
      this.g.goo.drop(x, z, size, size * 0.65, yaw);
      this.trail.push(t);
      if (this.trail.length > TRAIL_MAX_COUNT) {
        const old = this.trail.shift(), goo = this.g.goo;
        goo.m.makeScale(0, 0, 0);
        goo.mesh.setMatrixAt(old.slot, goo.m);
        goo.mesh.instanceMatrix.needsUpdate = true;
      }
    }

    leaveTrail(distance) {
      this.trailDistance += distance;
      if (this.trailDistance < TRAIL_STEP_DIST) return;
      this.trailDistance = 0;
      const phase = ++this.trailPhase || (this.trailPhase = 1);
      if (phase % 13 > 9) return;

      const off = Math.sin(phase * 1.17) * 0.85 + Math.sin(phase * 0.43) * 0.25;
      const x = this.pos.x - this.dir.z * off, z = this.pos.z + this.dir.x * off;
      this.dropTrail(x, z, (1.7 + Math.random() * 1.2) * (phase % 13 > 7 ? 0.55 : 1), phase * 0.83);

      if (phase % 7 === 0) {
        const cx = Math.round(this.pos.x * INV_CELL), cz = Math.round(this.pos.z * INV_CELL);
        for (let i = 0; i < 4; i++) {
          const dx = DIRS[i][0], dz = DIRS[i][1];
          if (!this._isFloor(cx + dx, cz + dz) || dx * this.dir.x + dz * this.dir.z > 0.5) continue;
          for (let j = 1; j <= 5; j++) if (j !== 3) {
            const bend = Math.sin(j * 1.3) * 0.65;
            this.dropTrail(
              cx * CELL + dx * j * 0.85 - dz * bend,
              cz * CELL + dz * j * 0.85 + dx * bend,
              1.5 - j * 0.18, j * 0.9
            );
          }
          break;
        }
      }
    }

    fadeTrail() {
      if (!this.trail.length) return;
      const goo = this.g.goo;
      let expiredCount = 0;

      for (let i = 0; i < this.trail.length; i++) {
        const t = this.trail[i], life = this.age - t.time;
        if (life >= TRAIL_LIFETIME) {
          goo.m.makeScale(0, 0, 0);
          goo.mesh.setMatrixAt(t.slot, goo.m);
          expiredCount++;
        } else {
          const scale = 1 - life / TRAIL_LIFETIME;
          goo.q.setFromAxisAngle(goo.up, t.yaw);
          goo.p.set(t.x, 0.02, t.z);
          goo.s.set(t.size * scale, 1, t.size * 0.65 * scale);
          goo.m.compose(goo.p, goo.q, goo.s);
          goo.mesh.setMatrixAt(t.slot, goo.m);
        }
      }
      if (expiredCount > 0) this.trail.splice(0, expiredCount);
      goo.mesh.instanceMatrix.needsUpdate = true;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // MAIN UPDATE LOOP
    // ═════════════════════════════════════════════════════════════════════════

    update(dt) {
      if (!this.authority()) return;

      // ── Timers ──
      this.age += dt; this.stateT += dt; this.screamT -= dt;
      this.fakeT -= dt; this.pauseT -= dt;
      this.g.camCD = Math.max(0, this.g.camCD - dt);
      this.planT -= dt; this.freeze = Math.max(0, this.freeze - dt);

      // ── Director AI ──
      this.updateDirector(dt);

      // ── Throttled Trail Fade ──
      if ((this.trailFadeT -= dt) <= 0) {
        this.trailFadeT = TRAIL_FADE_INTERVAL;
        this.fadeTrail();
      }

      // ── Memory decay ──
      if ((this.decayT -= dt) <= 0) {
        this.decayT = 1;
        for (const [id, r] of this.memory) {
          r.route *= 0.992; r.hide *= 0.992; r.follow *= 0.992; r.deaths *= 0.992;
          if (r.route < 0.01 && r.hide < 0.01 && r.follow < 0.01 && r.deaths < 0.01) {
            this.memory.delete(id);
          }
        }
        for (let i = 0; i < 4; i++) this.escape[i] *= 0.992;
        this.habits.follow *= 0.992;
        this.habits.hide   *= 0.992;
        this.habits.deaths *= 0.992;
        for (const [id, r] of this.tracks) if (this.age - r.time > 30) this.tracks.delete(id);
      }

      if (!this._fury) this.fury = Math.max(0, this.fury - dt * 0.018);
      this.onFlash(true);
      this.flickerWarningTick(dt);

      // ── Camera visibility tracking (Spotted -> Flee) ──
      let inView = false, pDist = 0, pCam = null;
      if (this.g.camera && !this.g.dead && this.active) {
        const c = this.g.camera.position;
        this.g.camera.getWorldDirection(this.facing);
        const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
        pDist = Math.hypot(dx, dz);
        const dot = (dx * this.facing.x + dz * this.facing.z) / (pDist || 1);
        if (dot > 0.75 && this.line(c.x, c.z, this.pos.x, this.pos.z)) {
          inView = true;
          pCam = c;
        }
      }

      if (inView) this.seenT += dt;
      else this.seenT = Math.max(0, this.seenT - dt * 2);

      if (inView && this.seenT > 0.6 && pDist > 8 && !this._hunt && !this._fury && this.mode !== 'CHASE' && this.mode !== 'AMBUSH') {
        this._hunt = {
          kind: 'flee',
          id: this.target || (this.g.mp?.peer?.id || 'local'),
          x: pCam.x, z: pCam.z,
          cell: this.cellId(pCam.x, pCam.z),
          until: this.age + 4
        };
        this.change('STALK');
        this.retreat = true;
        this.freeze = 0; this.pauseT = 0; this.stateT = 0;
        this.path.length = 0; this.goal = -1; this.planT = 0;
        this.seenT = 0;
        if (this.g.audio?.whoosh) this.soundAt('dart');
      }

      // ── Priority overlays ──
      if (this.furyTick(dt)) return;
      if (this.flashTick(dt)) return;
      if (this.fleeTick(dt)) return;

      // ── Perception ──
      if ((this.senseT -= dt) <= 0) {
        this.senseT = SENSE_INTERVAL;
        if (this.active) this.sense();
      }
      if (!this.active) { if ((this.respawn -= dt) <= 0) this.spawn(); return; }

      // ── Behavior overlays ──
      this.psychologicalTick(dt);
      if (this.lureTick(dt)) return;
      if (this.hallwayStareTick(dt)) return;
      if (this.cornerPeekTick(dt)) return;
      this.tryMimicSteps();
      this.mimicStepTick(dt);

      // ── State transitions ──
      const k = this.known;
      if (this.mode === 'INVESTIGATE'
        && (!this.path.length && this.goal >= 0 || this.stateT > INVESTIGATE_TIMEOUT))
        this.change('SEARCH');
      if (this.mode === 'SEARCH' && this.stateT > SEARCH_TIMEOUT) {
        this.change(Math.random() < 0.75 + Math.min(0.1, this.habits.follow * 0.02) ? 'AMBUSH' : 'PATROL');
      }
      const patrolChangeT = PATROL_CHANGE_TIME - this._aggression * 4;
      if (this.mode === 'PATROL' && this.stateT > patrolChangeT && Math.random() < dt * 0.16)
        this.change('AMBUSH');
      if (this.mode === 'AMBUSH' && this.stateT > AMBUSH_TIMEOUT) this.change('PATROL');

      if (this.mode === 'STALK' && this.retreat
        && this.age >= (this._stalkT || 0) && this.stateT > 2.5) {
        this.retreat = false; this._stalkT = 0; this.pauseT = 0;
        this._lureReadyAt = this.age + 1;
      }

      // ── Planning ──
      if (this.planT <= 0) {
        this.planT = this.mode === 'CHASE' ? CHASE_PLAN_INTERVAL : PATROL_PLAN_INTERVAL;
        if (this.mode === 'STALK' && !this.retreat) {
          if (this.tryCornerPeek()) { /* handled next frame */ }
          else {
            const cx = Math.round(this.pos.x * INV_CELL), cz = Math.round(this.pos.z * INV_CELL);
            const open = this.openCount(cx, cz);
            if (open <= 2 && Math.random() < 0.45) {
              this.retreat = true;
              this._stalkT = this.age + 2.5 + Math.random() * 2;
            } else if (k) {
              const px = k.x - this.pos.x, pz = k.z - this.pos.z, pd = Math.hypot(px, pz) || 1;
              const side = (this._stalkDir || 1) * 1.2;
              this.dir.set(px / pd - pz / pd * side, 0, pz / pd + px / pd * side).normalize();
            }
          }
        }
        this.plan();
      }

      if (this.mode === 'CHASE') this.scream();

      // ── Fake sounds — Director AI modulates frequency ──
      if (this.fakeT <= 0 && this.mode !== 'CHASE') {
        if (this.age >= this._quietPhaseUntil && this._lastScareTime > 0
          && this.age - this._lastScareTime < 7 && Math.random() < 0.28) {
          this._quietPhaseUntil = this.age + 4 + Math.random() * 4;
          this.fakeT = 1.5;
        } else {
          this.fakeT = (FAKE_SOUND_MIN + Math.random() * FAKE_SOUND_VAR)
            * (1 - this._aggression * 0.3);
          const id = this.goal, n = this.g.world.n;
          if (id >= 0) {
            const cx = (id / n) | 0, cz = id % n;
            let pickX = cx, pickZ = cz;
            if (Math.random() < 0.55) {
              let cLen = 0;
              const candX = [0, 0, 0, 0], candZ = [0, 0, 0, 0];
              for (let i = 0; i < 4; i++) {
                const nx = cx + DIRS[i][0] * 2, nz = cz + DIRS[i][1] * 2;
                if (this._isFloor(nx, nz)) { candX[cLen] = nx; candZ[cLen] = nz; cLen++; }
              }
              if (cLen > 0) {
                const idx = (Math.random() * cLen) | 0;
                pickX = candX[idx]; pickZ = candZ[idx];
              }
            }
            this.soundAt('fake', pickX * CELL, pickZ * CELL);
          }
        }
      }

      // ── Speed with chase acceleration & Dead-End Executioner ──
      const obs = this.observed.get(this.target);
      const chaseSpeed = obs?.speed > 0.1 ? Math.min(CFG.RUN, obs.speed) : CFG.WALK;
      let speed;

      if (this.mode === 'CHASE') {
        this._chaseAccelT = Math.min(this._chaseAccelT + dt, CHASE_ACCEL_TIME);
        const ratio = this._chaseAccelT / CHASE_ACCEL_TIME;
        speed = this.getChaseSpeed(CFG.WALK + (chaseSpeed - CFG.WALK) * (ratio * ratio));
      } else if (this.mode === 'STALK') {
        speed = this.retreat ? CFG.RUN * STALK_RETREAT_MULT : CFG.WALK * 0.95;
      } else {
        speed = CFG.WALK;
      }

      const hunt = this._hunt;
      if (this.mode === 'CHASE' && hunt && hunt.id === this.target && this.age < hunt.until) {
        if (hunt.kind === 'flash') speed = CFG.RUN * FLASH_CHASE_MULT;
        else if (hunt.kind === 'near') {
          const power = Math.max(0, Math.min(1, hunt.power || 0));
          speed = CFG.RUN * (NEAR_CHASE_BASE + NEAR_CHASE_POWER * power);
        }
      }

      if (this.freeze > 0 || this.pauseT > 0 || (this.mode === 'AMBUSH' && !this.path.length)) speed = 0;

      const x = this.pos.x, z = this.pos.z;
      this.move(dt, speed);
      const moved = Math.hypot(this.pos.x - x, this.pos.z - z);
      this.speed = moved / dt;
      if (moved > 0.001) this.leaveTrail(moved);
      if (this.speed < 0.1 && k) this.dir.set(k.x - this.pos.x, 0, k.z - this.pos.z).normalize();

      this.renderLocal(dt);

      // ── Catch check ──
      if (this.mode === 'CHASE' && this.freeze <= 0 && this.pauseT <= 0
        && (!this.caught || this.age - this.caught.time > 2)) {
        this.players((id, p) => {
          if (this.caught && this.age - this.caught.time < 2) return;
          if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) > CATCH_RADIUS) return;
          if (!this.line(this.pos.x, this.pos.z, p.x, p.z)) return;
          this.record(this.cellId(p.x, p.z), 'deaths', 1);
          this.habits.deaths = cap(this.habits.deaths + 0.3);
          this.caught = { seq: ++this.catchSeq, id, time: this.age };
          this.markDeath();
          if (id === (this.g.mp?.peer?.id || 'local')) {
            this.g.killPlayer();
            if (this.g.mp?.coop) { this.active = true; this.group.visible = true; }
          } else this.g.onPlayerDeath(id);
          this._hunt = null; this.known = null; this.target = null;
          this.change('SEARCH'); this.pauseT = 2;
        });
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // RENDERING & VISUAL EFFECTS (DOM-Cached & Dirty-Checked)
    // ═════════════════════════════════════════════════════════════════════════

    renderLocal(dt, remoteLit = false) {
      if (!this.authority()) this.onFlash(true);
      const g = this.g, d = this.dist();
      this.scratch.set(this.pos.x, 1.8, this.pos.z);
      const lit = remoteLit || (!g.dead && g.flash.hits(this.scratch));
      this.animate(dt, lit, d);

      // ── Procedural head-tracking ──
      if (this.body?.skeleton) {
        if (this._headBone === undefined) {
          this._headBone = this.body.skeleton.getBoneByName?.('Head')
            || this.body.skeleton.getBoneByName?.('head') || null;
        }
        const headBone = this._headBone;
        if (headBone) {
          let nearestP = null, nearestD = Infinity;
          this.players((id, p) => {
            const pd = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
            if (pd < nearestD) { nearestD = pd; nearestP = p; }
          });
          if (nearestP && nearestD < 15) {
            const targetX = nearestP.x - this.pos.x, targetZ = nearestP.z - this.pos.z;
            const targetYaw = Math.atan2(targetX, targetZ);
            const bodyYaw = Math.atan2(this.dir.x, this.dir.z);
            let headTurn = targetYaw - bodyYaw;
            headTurn = Math.atan2(Math.sin(headTurn), Math.cos(headTurn));
            headTurn = Math.max(-1.05, Math.min(1.05, headTurn));
            headBone.rotation.y = headBone.rotation.y * 0.85 + headTurn * 0.15;
          }
        }
      }

      this._cacheDom();
      if (!g.dead) this.glitchSpike(dt, this.fury);

      const el = this._dangerEl;
      if (el) {
        const opStr = !g.dead && this.mode === 'CHASE'
          ? ((Math.max(0, (14 - d) / 14) * 0.85).toFixed(2)) : '0';
        if (opStr !== this._lastDangerOp) {
          el.style.opacity = opStr;
          this._lastDangerOp = opStr;
        }
      }

      this.distanceDistortion(d);
    }

    distanceDistortion(d) {
      const v = this._vhsEl; if (!v) return;
      const inactive = d > 20 || this.g.dead || !Number.isFinite(d);
      if (inactive) {
        if (this._distanceOpacityActive) {
          v.style.opacity = '';
          this._lastVhsOp = '';
          this._distanceOpacityActive = false;
        }
        this._lastVisibleDistance = d;
        return;
      }

      const proximity = Math.max(0, 1 - d / 20);
      const warp = proximity * proximity * 0.3;
      if (this._glitch > warp) {
        if (this._distanceOpacityActive) {
          v.style.opacity = '';
          this._lastVhsOp = '';
          this._distanceOpacityActive = false;
        }
        this._lastVisibleDistance = d;
        return;
      }
      if (warp > 0.01) {
        const noise = Math.random() * warp * 0.35;
        const opStr = Math.min(1, 0.3 + warp + noise).toFixed(2);
        if (opStr !== this._lastVhsOp) {
          v.style.opacity = opStr;
          this._lastVhsOp = opStr;
        }
        this._distanceOpacityActive = true;
      } else if (this._distanceOpacityActive) {
        v.style.opacity = '';
        this._lastVhsOp = '';
        this._distanceOpacityActive = false;
      }
      this._lastVisibleDistance = d;
    }

    glitchSpike(dt, fury) {
      const v = this._vhsEl; if (!v) return;
      const target = Math.max(0, Math.min(1, (fury || 0) / 1.2));

      if (target <= this._glitch) this._glitch = Math.max(target, this._glitch - dt * 0.5);
      else this._glitch = target;

      const amt = this._glitch;
      const filterStr = amt > 0.02
        ? `saturate(${(1 + amt * 0.8).toFixed(2)}) contrast(${(1 + amt * 0.5).toFixed(2)})`
        : '';
      if (filterStr !== this._lastFilterStr) {
        v.style.filter = filterStr;
        this._lastFilterStr = filterStr;
      }

      const chromaStr = amt > 0.02 ? `${(amt * 3).toFixed(1)}px` : '0px';
      if (chromaStr !== this._lastChromaStr && v.style.setProperty) {
        v.style.setProperty('--chroma-shift', chromaStr);
        this._lastChromaStr = chromaStr;
      }

      if (amt >= 0.99 && !this._glitchShown) {
        this._glitchShown = true;
        if (this.g.glitch) this.g.glitch();
      } else if (amt < 0.5) this._glitchShown = false;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // NETWORKING — Snapshot sync
    // ═════════════════════════════════════════════════════════════════════════

    snapshot() {
      const full = this.age >= this.fullT; if (full) this.fullT = this.age + 3;
      const trail = [];
      for (let i = 0; i < this.trail.length; i++) {
        const t = this.trail[i];
        if (full || t.seq > this.trailSent) {
          trail.push({ seq: t.seq, x: t.x, z: t.z, size: t.size, yaw: t.yaw, time: t.time });
        }
      }
      this.trailSent = this.trailSeq;
      return {
        epoch: this.epoch, age: this.age, target: this.target,
        full, trail, sound: this.sound, caught: this.caught,
        fury: this._fury ? this.fury : 0,
        staring: this._staring,
        aggression: this._aggression
      };
    }

    receiveSnapshot(s) {
      if (this.authority() || !s) return;
      if (s.epoch !== this.remoteEpoch) {
        this.remoteEpoch = s.epoch; this.seenTrail = 0;
        this.seenSound = 0; this.seenCat = 0;
        this.trail = []; this.g.goo.clear();
      }
      this.age = s.age; this.target = s.target;
      if (s.full) { this.trail = []; this.g.goo.clear(); this.seenTrail = 0; }
      for (const t of s.trail || []) {
        if (t.seq <= this.seenTrail) continue;
        this.seenTrail = t.seq;
        const slot = this.g.goo.idx;
        this.g.goo.drop(t.x, t.z, t.size, t.size * 0.65, t.yaw);
        this.trail.push({ ...t, slot });
        if (this.trail.length > TRAIL_MAX_COUNT) {
          const old = this.trail.shift(), goo = this.g.goo;
          goo.m.makeScale(0, 0, 0);
          goo.mesh.setMatrixAt(old.slot, goo.m);
          goo.mesh.instanceMatrix.needsUpdate = true;
        }
      }
      if ((this.trailFadeT -= 1 / 60) <= 0) {
        this.trailFadeT = TRAIL_FADE_INTERVAL;
        this.fadeTrail();
      }
      this.playSound(s.sound);
      this.fury = s.fury || 0;
      this._aggression = s.aggression || 0.3;
      this._cacheDom();
      this.glitchSpike(1 / 60, this.fury);
      if (this.fury > 0 && !this._furyDim) this.dimWorld();
      else if (this.fury <= 0 && this._furyDim) this.restoreWorld();
      if (s.caught && s.caught.seq > this.seenCat) {
        this.seenCat = s.caught.seq;
        if (s.caught.id === this.g.mp?.peer?.id && !this.g.dead) this.g.killPlayer();
      }
    }
  };
}
