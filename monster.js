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
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const cap  = (v) => Math.min(8, v);

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
  const FURY_CHASE_SPEED     = 2.5;    // BUG FIX: was 1.05 — way too slow
  const STALK_RETREAT_MULT   = 3.4;
  const FLASH_CHASE_MULT     = 1.5;
  const NEAR_CHASE_BASE      = 1.4;
  const NEAR_CHASE_POWER     = 0.6;
  const BEAM_FLEE_SPEED_MULT = 4.2;    // Multiplier for fleeing when spotted

  // Trail
  const TRAIL_STEP_DIST      = 0.9;
  // FIX: Let the monster drop 3x as many puddles and keep them for 5 minutes
  const TRAIL_MAX_COUNT      = 600;
  const TRAIL_LIFETIME       = 300;

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

    reset() {
      // A restart/maze regeneration can happen during fury. Restore owned
      // lighting before clearing the saved restoration data.
      if (this._broken?.length) this.restoreWorld();
      const oldVhs = typeof document !== 'undefined' ? document.getElementById('vhs') : null;
      if (oldVhs && this._distanceOpacityActive) oldVhs.style.opacity = '';
      super.reset();

      // ── Core state ──
      this.mode     = 'PATROL';
      this.target   = null;
      this.known    = null;
      this.goal     = -1;
      this.seenT    = 0; // Tracks how long the player has looked directly at it

      // ── Timers ──
      this.senseT   = 0;
      this.planT    = 0;
      this.stateT   = 0;
      this.pauseT   = 0;
      this.screamT  = 0;
      this.fakeT    = FAKE_SOUND_MIN;
      this.age      = 0;
      this.decayT   = 0;

      // ── Trail system ──
      this.trailDistance = 0;
      this.trailSeq     = 0;
      this.trail        = [];
      this.trailSent    = 0;
      this.trailPhase   = 0;
      this.fullT        = 0;

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

      // ── Stalk state ──
      this._stalkT   = 0;
      this._stalkDir = 1;

      // ── Visual effects ──
      this._glitch      = 0;
      this._glitchShown = false;

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
      this.fury     = 0;
      this._fury    = null;
      this._broken  = [];
      this._lightingSnapshot = null;
      this._worldDimActive = false;
      this._flickerSnapshots = new Map();
      this._distanceOpacityActive = false;
      this._lastVisibleDistance = Infinity;
      this._quietPhaseUntil = 0;

      // ── Memory / learning ──
      this.memory = new Map();
      this.escape = new Float32Array(4);

      // ── Director AI — dynamic tension manager ──
      this._lastScareTime  = 0;
      this._lastDeathTime  = 0;
      this._aggression     = 0.3;
      this._directorT      = 0;

      // ── Hallway Stare — freeze and stare from long corridors ──
      this._stareReadyAt = 0;
      this._staring      = false;
      this._stareUntil   = 0;
      this._stareTarget  = null;

      // ── Corner Peek — lean around corners while stalking ──
      this._peekReadyAt = 0;
      this._peeking     = false;
      this._peekUntil   = 0;
      this._peekOrigin  = null;
      this._peekDir     = null;

      // ── Mimic Steps — fake footsteps from adjacent corridors ──
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
    // SPATIAL UTILITIES
    // ═════════════════════════════════════════════════════════════════════════

    /** Convert world coords to a flat cell ID, or -1 if that cell is a wall. */
    cellId(x, z) {
      const w = this.g.world, c = w.cell(x, z);
      return w.grid[c.x]?.[c.y] === 0 ? c.x * w.n + c.y : -1;
    }

    /** Record a learned observation about a cell. */
    record(id, key, amount) {
      if (id < 0) return;
      let r = this.memory.get(id);
      if (!r) { r = { route: 0, hide: 0, follow: 0, deaths: 0 }; this.memory.set(id, r); }
      r[key] = cap(r[key] + amount);
    }

    /** Raycast LOS — pillars also block monster perception. */
    line(ax, az, bx, bz) {
      const w = this.g.world;
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.45);
      for (let i = 1; i < n; i++) {
        if (w.collides(ax + (bx - ax) * i / n, az + (bz - az) * i / n, 0.08))
          return false;
      }
      return true;
    }

    /** Check if a cell is a corner (exactly 2 open neighbors at a right angle). */
    isCorner(cx, cz) {
      const w = this.g.world;
      const openDirs = [];
      for (const [dx, dz] of DIRS) {
        if (w.grid[cx + dx]?.[cz + dz] === 0) openDirs.push([dx, dz]);
      }
      if (openDirs.length !== 2) return false;
      const [a, b] = openDirs;
      return a[0] * b[0] + a[1] * b[1] === 0; // perpendicular
    }

    /** Check if a position is in a long straight corridor (min 5 cells). */
    isLongHallway(cx, cz, minLength = 5) {
      const w = this.g.world;
      // Horizontal
      let hLen = 1;
      for (let d = 1; d <= minLength; d++) { if (w.grid[cx + d]?.[cz] === 0) hLen++; else break; }
      for (let d = 1; d <= minLength; d++) { if (w.grid[cx - d]?.[cz] === 0) hLen++; else break; }
      if (hLen >= minLength && w.grid[cx]?.[cz + 1] !== 0 && w.grid[cx]?.[cz - 1] !== 0) return 'h';
      // Vertical
      let vLen = 1;
      for (let d = 1; d <= minLength; d++) { if (w.grid[cx]?.[cz + d] === 0) vLen++; else break; }
      for (let d = 1; d <= minLength; d++) { if (w.grid[cx]?.[cz - d] === 0) vLen++; else break; }
      if (vLen >= minLength && w.grid[cx + 1]?.[cz] !== 0 && w.grid[cx - 1]?.[cz] !== 0) return 'v';
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
        for (const [id, r] of mp.remotes) {
          if (!r.alive || !r.buf.length) continue;
          const b = r.buf, p = b[b.length - 1], a = b[Math.max(0, b.length - 3)];
          if (performance.now() - p.t > 1500) continue;
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

    /** Record a scare event (monster seen, scream heard, etc.) */
    markScare() { this._lastScareTime = this.age; }

    /** Record a player death — triggers cooldown. */
    markDeath() { this._lastDeathTime = this.age; this._lastScareTime = this.age; }

    /** Update aggression based on time since last scare/death. */
    updateDirector(dt) {
      this._directorT -= dt;
      if (this._directorT > 0) return;
      this._directorT = 1.0;

      const quietTime = this.age - this._lastScareTime;
      const deathRecovery = this.age - this._lastDeathTime;

      if (deathRecovery < DIRECTOR_RECENT_DEATH_COOL) {
        this._aggression = Math.max(DIRECTOR_MIN_AGGRESSION, this._aggression - dt * 0.08);
        return;
      }
      if (quietTime > DIRECTOR_QUIET_THRESHOLD) {
        const ramp = Math.min(1, (quietTime - DIRECTOR_QUIET_THRESHOLD) / 60);
        this._aggression = Math.min(DIRECTOR_MAX_AGGRESSION, this._aggression + ramp * 0.04);
      } else {
        this._aggression = Math.max(0.3, this._aggression - dt * 0.02);
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PERCEPTION
    // ═════════════════════════════════════════════════════════════════════════

    sense() {
      const w = this.g.world, mc = w.cell(this.pos.x, this.pos.z);
      this.flood(mc.x, mc.y);

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

        // Sound gives a cell center, never a silent player's live position
        const ox = sight ? p.x : (cell / w.n | 0) * CELL;
        const oz = sight ? p.z : (cell % w.n) * CELL;
        const near = sight ? d < NEAR_THRESHOLD
          : heard && d < NEAR_THRESHOLD_HEARD && pd >= 0 && pd <= 2;
        const power = near ? Math.max(0, Math.min(1, 1 - d / NEAR_THRESHOLD_HEARD)) : 0;

        const obs = { id, x: ox, z: oz, cell, sight, d, speed, near, power };
        this.observed.set(id, obs);

        // ── Track movement patterns ──
        const old = this.tracks.get(id);
        if (old && old.cell !== cell) {
          this.record(cell, 'route', 0.3);
          if (this.mode === 'CHASE') {
            const ex = ox - old.x, ez = oz - old.z;
            const k = Math.abs(ex) > Math.abs(ez) ? (ex > 0 ? 0 : 1) : (ez > 0 ? 2 : 3);
            this.escape[k] = cap(this.escape[k] + 0.2);
          }
          if (this.trail.some(t => this.age - t.time < 42 && Math.hypot(t.x - ox, t.z - oz) < 2.5)) {
            this.record(cell, 'follow', 0.2);
            this.habits.follow = cap(this.habits.follow + 0.05);
          }
        } else if (old && sight && speed < 0.3 && this.openCount(cell / w.n | 0, cell % w.n) <= 2) {
          this.record(cell, 'hide', 0.025);
          this.habits.hide = cap(this.habits.hide + 0.005);
        }
        this.tracks.set(id, { cell, x: ox, z: oz, time: this.age });

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
        this.target = this._lure.id; // BUG FIX: was missing target assignment
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
            // Director AI modulates attack probability
            const attackChance = 0.08 + this._aggression * 0.12;
            const attack = best.d < 10 && this.age >= this._lureReadyAt
              && Math.random() < attackChance;
            if (attack) {
              this._lureReadyAt = this.age + 18;
              this._hunt = { kind: 'ordinary', id: best.id, until: this.age + 3 };
              this.change('CHASE');
            } else {
              // Try hallway stare first — classic backrooms horror moment
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
      this._peeking = false;
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
        // Mimic footsteps — use footstep audio if available, otherwise whisper
        if (a.footstep) a.footstep.call(a, this.scratch, d);
        else (a.whisper || a.shriek).call(a, this.scratch, d);
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
    // HALLWAY STARE — Freeze and stare from end of long corridor
    // ═════════════════════════════════════════════════════════════════════════

    tryHallwayStare(obs) {
      if (this.age < this._stareReadyAt) return false;
      if (obs.d < STARE_MIN_DIST || obs.d > STARE_MAX_DIST) return false;
      if (!obs.sight) return false;

      const w = this.g.world, mc = w.cell(this.pos.x, this.pos.z);
      if (!this.isLongHallway(mc.x, mc.y)) return false;

      // Check if the player is roughly looking toward us
      const cam = this.g.camera;
      if (cam) {
        cam.getWorldDirection(this.scratch);
        const dx = this.pos.x - cam.position.x, dz = this.pos.z - cam.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.1) {
          const dot = (dx * this.scratch.x + dz * this.scratch.z) / dist;
          if (dot < 0.5) return false; // Player not looking toward us
        }
      }

      // Director AI makes stares more frequent when aggression is high
      if (Math.random() > 0.3 + this._aggression * 0.4) return false;

      this._staring = true;
      this._stareUntil = this.age + STARE_DURATION_MIN
        + Math.random() * (STARE_DURATION_MAX - STARE_DURATION_MIN);
      this._stareReadyAt = this.age + STARE_COOLDOWN;
      this._stareTarget = obs.id;
      this.dir.set(obs.x - this.pos.x, 0, obs.z - this.pos.z).normalize();
      this.soundAt('fake');
      this.markScare();
      return true;
    }

    hallwayStareTick(dt) {
      if (!this._staring) return false;

      const obs = this.observed.get(this._stareTarget);
      const tooClose = obs && obs.d < 8;
      const expired = this.age >= this._stareUntil;

      if (tooClose) {
        this._staring = false;
        if (Math.random() < 0.3 + this._aggression * 0.3) {
          this._hunt = { kind: 'ordinary', id: this._stareTarget, until: this.age + 3 };
          this.change('CHASE');
        } else {
          this.change('STALK'); this.retreat = true;
          this._stalkT = this.age + 3;
        }
        return true;
      }
      if (expired) {
        this._staring = false;
        this.change('STALK'); this.retreat = true;
        this._stalkT = this.age + 2;
        return true;
      }

      // Face the player, stay perfectly still with uncanny jitter
      if (obs) this.dir.set(obs.x - this.pos.x, 0, obs.z - this.pos.z).normalize();
      this.speed = 0;
      const jitter = Math.sin(this.age * 7) * 0.003;
      this.dir.x += jitter;
      this.dir.normalize();
      this.renderLocal(dt);
      return true;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // CORNER PEEK — Lean around corners while stalking
    // ═════════════════════════════════════════════════════════════════════════

    tryCornerPeek() {
      if (this.age < this._peekReadyAt || !this.known) return false;
      const w = this.g.world, mc = w.cell(this.pos.x, this.pos.z);
      if (!this.isCorner(mc.x, mc.y)) return false;

      const k = this.known;
      const d = Math.hypot(k.x - this.pos.x, k.z - this.pos.z);
      if (d < 4 || d > 15) return false;
      if (this.line(this.pos.x, this.pos.z, k.x, k.z)) return false;

      for (const [dx, dz] of DIRS) {
        const px = this.pos.x + dx * PEEK_LEAN_DIST;
        const pz = this.pos.z + dz * PEEK_LEAN_DIST;
        if (w.collides(px, pz, 0.1)) continue;
        if (this.line(px, pz, k.x, k.z)) {
          this._peeking = true;
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
        return true;
      }
      const t = Math.max(0, Math.min(1,
        (this.age - (this._peekUntil - PEEK_DURATION)) / PEEK_DURATION));
      const lean = Math.sin(t * Math.PI) * PEEK_LEAN_DIST;
      if (this._peekOrigin && this._peekDir) {
        const nx = this._peekOrigin.x + this._peekDir.x * lean;
        const nz = this._peekOrigin.z + this._peekDir.z * lean;
        // Validate every interpolated step, not just the endpoint. A peek must
        // never push the model through a wall on narrow procedural corridors.
        if (!this.g.world.collides(nx, nz, COLLISION_RADIUS)) {
          this.pos.x = nx; this.pos.z = nz;
        } else {
          this._peekUntil = this.age;
          this.pos.x = this._peekOrigin.x; this.pos.z = this._peekOrigin.z;
          this._peeking = false;
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

      const d = Math.hypot(this.known.x - this.pos.x, this.known.z - this.pos.z);
      if (d < MIMIC_MIN_DIST || d > MIMIC_MAX_DIST) return;
      if (Math.random() > 0.02 + this._aggression * 0.05) return;

      const w = this.g.world, k = this.known, pc = w.cell(k.x, k.z);
      for (const [dx, dz] of DIRS) {
        const nx = pc.x + dx * 3, nz = pc.y + dz * 3;
        if (w.grid[nx]?.[nz] !== 0) continue;
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
        // Irregular pulses are less mechanical than a clean on/off sine wave.
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
    // PATHFINDING & PLANNING
    // ═════════════════════════════════════════════════════════════════════════

    plan() {
      const w = this.g.world, k = this.known, mode = this.mode;

      if ((mode === 'CHASE' || mode === 'INVESTIGATE'
        || (mode === 'SEARCH' && this.stateT < 4)) && k) {
        const here = this.cellId(this.pos.x, this.pos.z);
        if (here === k.cell) { this.path.length = 0; this.goal = k.cell; return; }
        this.search(w.n * w.n, (id) => id === k.cell ? 1 : -Infinity);
        this.goal = k.cell; return;
      }

      if (mode === 'AMBUSH' && this.goal >= 0) return;

      const maxDepth = mode === 'PATROL' ? 14 : 12;
      this.search(maxDepth, (id, depth, x, z) => {
        const r = this.memory.get(id);
        const open = this.openCount(id / w.n | 0, id % w.n);
        let learned = r ? r.route * 0.45 + r.hide * 0.6 + r.follow * 0.35 - r.deaths * 0.65 : 0;

        if (k) {
          const dx = x - k.x, dz = z - k.z, d = Math.hypot(dx, dz);
          const dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 0 : 1) : (dz > 0 ? 2 : 3);
          learned += this.escape[dir] * 0.25;

          if (mode === 'AMBUSH') {
            if (d < 6 || d > 22 || open > 2 || this.line(k.x, k.z, x, z)) return -Infinity;
            const marked = this.trail.some(t => this.age - t.time < 42 && Math.hypot(t.x - x, t.z - z) < 3);
            learned += marked ? -2 : 2;
          }
          if (mode === 'STALK') {
            if (this.retreat) return d * 0.5 - depth * 0.6 + Math.random() * 2;
            // FIX: Changed distance from 12 to 4 so it breathes down your neck
            return -Math.abs(d - 4) * 0.7 - depth * 0.25 + Math.random() * 3;
          }
          if (mode === 'SEARCH' && d > 18) return -Infinity;
        } else if (mode === 'AMBUSH' && open > 2) return -Infinity;

        // Wall-hugging preference for stalk/ambush
        let wallBonus = 0;
        if (mode === 'STALK' || mode === 'AMBUSH') {
          const cx = id / w.n | 0, cz = id % w.n;
          let adjacent = 0;
          for (const [ddx, ddz] of DIRS) { if (w.grid[cx + ddx]?.[cz + ddz] !== 0) adjacent++; }
          wallBonus = adjacent >= 2 ? 1.5 : 0;
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
      const w = this.g.world;
      let best = -1, score = -Infinity;
      // Director AI: more aggressive = closer spawns
      const minDist = 24 - this._aggression * 6;
      const maxDist = 65 - this._aggression * 15;

      for (let x = 1; x < w.n - 1; x++) for (let z = 1; z < w.n - 1; z++) {
        if (w.grid[x][z] !== 0) continue;
        let near = Infinity, visible = false, count = 0;
        this.players((id, p) => {
          count++; const d = Math.hypot(x * CELL - p.x, z * CELL - p.z);
          near = Math.min(near, d);
          if (d < 30 && this.line(x * CELL, z * CELL, p.x, p.z)) visible = true;
        });
        if (!count || near < minDist || near > maxDist || visible) continue;
        const s = Math.random() * 10 - Math.abs(near - 32) * 0.2;
        if (s > score) { score = s; best = x * w.n + z; }
      }
      if (best < 0) { this.respawn = 3; return; }
      this.pos.set((best / w.n | 0) * CELL, 0, (best % w.n) * CELL);
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
        // Triggers the generalized fleeTick to run away from light
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

        const side = w.grid[cx + 1]?.[cz] === 0 || w.grid[cx - 1]?.[cz] === 0;
        const forward = w.grid[cx]?.[cz + 1] === 0 || w.grid[cx]?.[cz - 1] === 0;
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

          // Director AI modulates post-lure attack probability
          const attack = h.followed && obs?.sight && obs.d < 6
            && Math.random() < 0.15 + this._aggression * 0.15;
          if (attack) {
            this._hunt = { kind: 'ordinary', id: h.id, until: this.age + 2.5 };
            this.change('CHASE');
          } else if (!h.followed) {
            // FIX: If the player ignores the lure, punish them by attacking their back
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

      // Finish fleeing if timer runs out or if successfully broken LOS and reached hideout early
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
            const side = w.grid[cx + 1]?.[cz] === 0 || w.grid[cx - 1]?.[cz] === 0;
            const forward = w.grid[cx]?.[cz + 1] === 0 || w.grid[cx]?.[cz - 1] === 0;
            const open = this.openCount(cx, cz);
            
            // Heavily penalize cells still visible to the player's last known spot
            const visible = this.line(h.x, h.z, x, z);
            
            return (away - start) * 3 - depth * 0.3
              + (open === 2 && side && forward ? 5 : 0) - (open === 1 ? 6 : 0)
              - (visible ? 10 : 0);
          }, Math.max(1, start - 1));
        } else { this.path.length = 0; }
        this.goal = this.path.length ? this.path[this.path.length - 1] : -1;
      }

      const x = this.pos.x, z = this.pos.z;
      this.move(dt, CFG.RUN * BEAM_FLEE_SPEED_MULT); // Dart/Flee speed mapping
      const moved = Math.hypot(this.pos.x - x, this.pos.z - z);
      this.speed = moved / Math.max(dt, 1e-6);
      if (moved > 0.001) this.leaveTrail(moved);
      this.fadeTrail(); this.renderLocal(dt);
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

    dimWorld() {
      const g = this.g, w = g.world;
      if (!w || !w.fixtures) return;
      if (!this._worldDimActive) {
        this._worldDimActive = true;
        this._broken.length = 0;
        this._lightingSnapshot = g.lighting && !g.lighting.dark
          ? { amb: g.lighting.amb.intensity, hemi: g.lighting.hemi.intensity }
          : null;
      }
      const R = 13, R2 = R * R;
      for (const f of w.fixtures) {
        if (f.dead) continue;
        const dx = f.pos.x - this.pos.x, dz = f.pos.z - this.pos.z;
        if (dx * dx + dz * dz > R2) continue;
        // Save each fixture once. Restore its original state instead of
        // pretending every light was healthy and at 100% brightness.
        if (!this._broken.some(entry => entry.fixture === f)) {
          this._broken.push({ fixture: f, dead: f.dead, dying: f.dying,
            stress: f.stress, flick: f.flick });
        }
        f.dead = true; f.flick = 0; w.setTube(f, 0);
      }
      if (w.dirty) { w.tubes.instanceColor.needsUpdate = true; w.dirty = false; }
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
      // ── LIGHTS-OUT WARNING — flicker before the darkness falls ──
      this.startFlickerWarning();

      this._fury = { id, phase: 'flee', until: this.age + 0.9 };
      this.retreat = true; this.pauseT = 0; this.freeze = 0;
      this._flashResponse = null; this.screamT = 0;
      this.change('CHASE'); this.scream(true);
      this.path.length = 0; this.goal = -1; this.planT = 0;
      this.dimWorld();
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

      // ╔══════════════════════════════════════════════════════════════════╗
      // ║ BUG FIX: Save position BEFORE move() so `moved` is nonzero!    ║
      // ║ Previously x,z were saved AFTER move(), making moved always 0. ║
      // ║ This broke trail generation and speed tracking during fury.    ║
      // ╚══════════════════════════════════════════════════════════════════╝
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
          const k = this.known;
          if (k) {
            const here = this.cellId(this.pos.x, this.pos.z);
            if (here === k.cell) { this.path.length = 0; this.goal = k.cell; }
            else {
              this.search(this.g.world.n * this.g.world.n, id => id === k.cell ? 1 : -Infinity);
              this.goal = k.cell;
            }
          }
        }
        const gain = obs && obs.d < 2.2 ? 0.42 : 0.16;
        this.fury = Math.max(0, this.fury - dt * gain);

        // BUG FIX: fury chase speed was 1.05x (barely above walk!) — now 2.5x
        this.move(dt, CFG.RUN * FURY_CHASE_SPEED);

        // Catch check during fury
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

      // BUG FIX: compute moved from SAVED pre-move position
      const moved = Math.hypot(this.pos.x - x0, this.pos.z - z0);
      this.speed = moved / Math.max(dt, 1e-6);
      if (moved > 0.001) this.leaveTrail(moved);

      this.fadeTrail();
      // flickerWarningTick is owned by update(); do not advance it twice in fury.
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
          x = (id / n | 0) * CELL; z = (id % n) * CELL;
          if (w.grid[id / n | 0]?.[id % n] !== 0) {
            this.path.length = 0; this.planT = 0; return;
          }
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

        // Organic movement: sinusoidal path deviation
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
            const cell = w.cell(this.pos.x, this.pos.z);
            const cx = cell.x * CELL - this.pos.x, cz = cell.y * CELL - this.pos.z;
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
        const c = this.g.world.cell(this.pos.x, this.pos.z);
        for (const [dx, dz] of DIRS) {
          if (this.g.world.grid[c.x + dx]?.[c.y + dz] !== 0 || dx * this.dir.x + dz * this.dir.z > 0.5) continue;
          for (let j = 1; j <= 5; j++) if (j !== 3) {
            const bend = Math.sin(j * 1.3) * 0.65;
            this.dropTrail(
              c.x * CELL + dx * j * 0.85 - dz * bend,
              c.y * CELL + dz * j * 0.85 + dx * bend,
              1.5 - j * 0.18, j * 0.9
            );
          }
          break;
        }
      }
    }

    fadeTrail() {
      const goo = this.g.goo;
      for (let i = this.trail.length - 1; i >= 0; i--) {
        const t = this.trail[i], life = this.age - t.time;
        const scale = Math.max(0, 1 - life / TRAIL_LIFETIME);
        goo.q.setFromAxisAngle(goo.up, t.yaw);
        goo.p.set(t.x, 0.02, t.z);
        goo.s.set(t.size * scale, 1, t.size * 0.65 * scale);
        goo.m.compose(goo.p, goo.q, goo.s);
        goo.mesh.setMatrixAt(t.slot, goo.m);
        if (life >= TRAIL_LIFETIME) this.trail.splice(i, 1);
      }
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

      // ── Memory decay ──
      if ((this.decayT -= dt) <= 0) {
        this.decayT = 1;
        for (const [id, r] of this.memory) {
          for (const key in r) r[key] *= 0.992;
          if (Object.values(r).every(v => v < 0.01)) this.memory.delete(id);
        }
        for (let i = 0; i < 4; i++) this.escape[i] *= 0.992;
        for (const key in this.habits) this.habits[key] *= 0.992;
        for (const [id, r] of this.tracks) if (this.age - r.time > 30) this.tracks.delete(id);
      }

      if (!this._fury) this.fury = Math.max(0, this.fury - dt * 0.018);
      this.onFlash(true);
      this.flickerWarningTick(dt);

      // ── Camera visibility tracking (Spotted -> Flee) ──
      // Tracks if the player's direct sightline lands on the monster
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

      // Spotted! Run away very fast until out of sight (game.js dart/retreat integration)
      if (inView && this.seenT > 0.6 && pDist > 8 && !this._hunt && !this._fury && this.mode !== 'CHASE' && this.mode !== 'AMBUSH') {
         this._hunt = { kind: 'flee', id: this.target || (this.g.mp?.peer?.id || 'local'), x: pCam.x, z: pCam.z, cell: this.cellId(pCam.x, pCam.z), until: this.age + 4 };
         this.change('STALK');
         this.retreat = true;
         this.freeze = 0; this.pauseT = 0; this.stateT = 0;
         this.path.length = 0; this.goal = -1; this.planT = 0;
         this.seenT = 0;
         if (this.g.audio?.whoosh) this.soundAt('dart'); // Audible phantom rush
      }

      // ── Priority overlays ──
      if (this.furyTick(dt)) return;
      if (this.flashTick(dt)) return;
      if (this.fleeTick(dt)) return;

      // ── Perception ──
      if ((this.senseT -= dt) <= 0) {
        this.senseT = SENSE_INTERVAL;
        this.fadeTrail();
        if (this.active) this.sense();
      }
      if (!this.active) { if ((this.respawn -= dt) <= 0) this.spawn(); return; }

      // ── Behavior overlays ──
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
      // Director AI: patrol→ambush faster when aggressive
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
            const c = this.g.world.cell(this.pos.x, this.pos.z);
            const open = this.openCount(c.x, c.y);
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
        // Let the world go unnaturally quiet after a scare, then resume with a
        // single misleading sound. This avoids constant noise and builds tension.
        if (this.age >= this._quietPhaseUntil && this._lastScareTime > 0
          && this.age - this._lastScareTime < 7 && Math.random() < 0.28) {
          this._quietPhaseUntil = this.age + 4 + Math.random() * 4;
          this.fakeT = 1.5;
        } else {
          this.fakeT = (FAKE_SOUND_MIN + Math.random() * FAKE_SOUND_VAR)
            * (1 - this._aggression * 0.3);
          const id = this.goal, n = this.g.world.n;
          if (id >= 0) {
            const cx = (id / n | 0), cz = id % n;
            // Offset the lure into a nearby valid cell where possible, rather
            // than making every fake sound originate at the monster's goal.
            const candidates = DIRS.map(([dx, dz]) => [cx + dx * 2, cz + dz * 2])
              .filter(([x, z]) => this.g.world.grid[x]?.[z] === 0);
            const pick = candidates.length && Math.random() < 0.55
              ? candidates[(Math.random() * candidates.length) | 0] : [cx, cz];
            this.soundAt('fake', pick[0] * CELL, pick[1] * CELL);
          }
        }
      }

      // ── Speed with chase acceleration ──
      const obs = this.observed.get(this.target);
      const chaseSpeed = obs?.speed > 0.1 ? Math.min(CFG.RUN, obs.speed) : CFG.WALK;
      let speed;

      if (this.mode === 'CHASE') {
        // Acceleration curve: ramp up instead of instant max speed
        this._chaseAccelT = Math.min(this._chaseAccelT + dt, CHASE_ACCEL_TIME);
        const eased = (this._chaseAccelT / CHASE_ACCEL_TIME) ** 2; // quadratic ease-in
        speed = CFG.WALK + (chaseSpeed - CFG.WALK) * eased;
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
    // RENDERING & VISUAL EFFECTS
    // ═════════════════════════════════════════════════════════════════════════

    renderLocal(dt) {
      if (!this.authority()) this.onFlash(true);
      const g = this.g, d = this.dist();
      this.scratch.set(this.pos.x, 1.8, this.pos.z);
      const lit = !g.dead && g.flash.hits(this.scratch);
      this.animate(dt, lit, d);

      // ── Procedural head-tracking ──
      if (this.body?.skeleton) {
        const headBone = this.body.skeleton.getBoneByName?.('Head')
          || this.body.skeleton.getBoneByName?.('head');
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
            headTurn = Math.max(-1.05, Math.min(1.05, headTurn)); // ±60°
            headBone.rotation.y = headBone.rotation.y * 0.85 + headTurn * 0.15; // smooth lerp
          }
        }
      }

      if (!g.dead) this.glitchSpike(dt, this.fury);

      const el = typeof document !== 'undefined' ? document.getElementById('danger') : null;
      if (el) {
        el.style.opacity = !g.dead && this.mode === 'CHASE'
          ? String(Math.max(0, (14 - d) / 14) * 0.85) : '0';
      }

      // ── Distance-based screen distortion ──
      this.distanceDistortion(d);
    }

    /** Distance-based screen warp — closer = more distorted. */
    distanceDistortion(d) {
      const v = typeof document !== 'undefined' ? document.getElementById('vhs') : null; if (!v) return;
      const inactive = d > 20 || this.g.dead || !Number.isFinite(d);
      if (inactive) {
        if (this._distanceOpacityActive) v.style.opacity = '';
        this._distanceOpacityActive = false;
        this._lastVisibleDistance = d;
        return;
      }

      const proximity = Math.max(0, 1 - d / 20);
      const warp = proximity * proximity * 0.3;
      // Let the fury/glitch layer own the display while its effect is stronger.
      if (this._glitch > warp) {
        if (this._distanceOpacityActive) v.style.opacity = '';
        this._distanceOpacityActive = false;
        this._lastVisibleDistance = d;
        return;
      }
      if (warp > 0.01) {
        const noise = Math.random() * warp * 0.35;
        v.style.opacity = String(Math.min(1, 0.3 + warp + noise));
        this._distanceOpacityActive = true;
      } else if (this._distanceOpacityActive) {
        v.style.opacity = '';
        this._distanceOpacityActive = false;
      }
      this._lastVisibleDistance = d;
    }

    /** Fury glitch with chromatic aberration scaling. */
    glitchSpike(dt, fury) {
      const v = typeof document !== 'undefined' ? document.getElementById('vhs') : null; if (!v) return;
      const target = Math.max(0, Math.min(1, (fury || 0) / 1.2));

      if (target <= this._glitch) this._glitch = Math.max(target, this._glitch - dt * 0.5);
      else this._glitch = target;

      const amt = this._glitch;
      v.style.filter = amt > 0.02
        ? `saturate(${(1 + amt * 0.8).toFixed(2)}) contrast(${(1 + amt * 0.5).toFixed(2)})`
        : '';

      // Chromatic aberration CSS variable for post-processing
      if (v.style.setProperty) {
        v.style.setProperty('--chroma-shift', `${(amt * 3).toFixed(1)}px`);
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
      const trail = this.trail
        .filter(t => full || t.seq > this.trailSent)
        .map(({ seq, x, z, size, yaw, time }) => ({ seq, x, z, size, yaw, time }));
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
        if (t.seq <= this.seenTrail) continue; this.seenTrail = t.seq;
        const slot = this.g.goo.idx;
        this.g.goo.drop(t.x, t.z, t.size, t.size * 0.65, t.yaw);
        this.trail.push({ ...t, slot });
      }
      this.fadeTrail(); this.playSound(s.sound);
      this.fury = s.fury || 0;
      this._aggression = s.aggression || 0.3;
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
