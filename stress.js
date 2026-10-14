// stress.js
// Psychological Panic, Hallucination & False Jumpscare Director

import { JumpscareSystem } from './jumpscare.js';

export class StressSystem {
  constructor(player) {
    this.player = player;

    // --------------------------------
    // CORE STRESS
    // --------------------------------
    this.value = 0;
    this.maxStress = 100;
    this.lastYaw = null;

    // --------------------------------
    // ORIGINAL TRACKERS
    // --------------------------------
    this.flashlightTime = 0;
    this.standStillTime = 0;
    this.eventCooldown = 12.0;

    // --------------------------------
    // STRESS TUNING
    // --------------------------------
    this.turnThreshold = 2.2;
    this.turnGain = 7.5;

    this.windingGain = 16.0;
    this.runningGain = 8.5;
    this.movingGain = 2.0;
    this.recoveryGain = 4.5;

    this.proximityGain = 18.0;

    // --------------------------------
    // EVENT DIRECTOR
    // --------------------------------
    this.pendingEvents = [];
    this.eventHistory = new Map();

    this.lastEventType = null;
    this.lastMajorEventTime = -1000;
    this.directorTime = 0;

    this.unpredictability = 1.0;
    this.quietChance = 0.18;
    this.repeatCooldown = 16.0;
    this.majorEventCooldown = 12.0;

    // --------------------------------
    // ANTICIPATION
    // --------------------------------
    this.anticipation = 0;
    this.anticipationType = null;
    this.anticipationTimer = 0;
    this.anticipationDuration = 0;

    // --------------------------------
    // PLAYER BEHAVIOR PROFILE
    // --------------------------------
    this.profile = {
      totalTurns: 0,
      fastTurns: 0,
      sprintTime: 0,
      windingTime: 0,
      flashlightUse: 0,
      repeatedBackChecks: 0,
      stationaryTime: 0,
      lastTurnDirection: 0,
      lastTurnTime: -1000,
      lastBackCheckTime: -1000,
      lastProfileUpdate: 0,
      previousTurnSpeed: 0,
      turnHabit: 0,
      sprintHabit: 0,
      flashlightHabit: 0,
      hidingHabit: 0
    };

    // --------------------------------
    // THREAT & HEARTBEAT TRACKING
    // --------------------------------
    this.monsterDistance = Infinity;
    this.monsterThreat = 0;
    this.closeThreatTime = 0;
    this.timeSinceThreat = 999;
    this.heartbeatTimer = 0;

    // --------------------------------
    // REASSURANCE
    // --------------------------------
    this.reassuranceTime = 0;
    this.reassuranceActive = false;
    this.reassuranceDuration = 0;

    // --------------------------------
    // VISUAL & HUD INTERFERENCE
    // --------------------------------
    this.visualBatteryOverride = null;
    this.visualBatteryTimer = 0;
    this.maxVisualBatteryDuration = 0.65;
    this.hudHallucinationTimer = 0;

    // --------------------------------
    // "DON'T LOOK BACK" TRACKERS
    // --------------------------------
    this.dlbState = 'inactive';
    this.dlbTimer = 0;
    this.dlbSurvivalTimer = 0;
    this.dlbOrigin = null;

    this._fwdX = 0;
    this._fwdZ = -1;
    this._barEl = null;
    this._pctEl = null;
    this._statusEl = null;
    this._hookedKill = false;

    this.stats = {
      eventsTriggered: 0,
      eventsSuppressed: 0,
      quietPeriods: 0,
      anticipationEvents: 0
    };
  }

  _cacheDom() {
    if (typeof document === 'undefined') return;
    if (!this._barEl) this._barEl = document.getElementById('bar')?.firstElementChild || null;
    if (!this._pctEl) this._pctEl = document.getElementById('pct');
    if (!this._statusEl) this._statusEl = document.getElementById('status');

    // Ensure JumpscareSystem is initialized on game instance
    const g = this.player?.g;
    if (g && !this._hookedKill) {
      this._hookedKill = true;
      if (!g.jumpscare || typeof g.jumpscare.triggerFalse !== 'function') {
        g.jumpscare = new JumpscareSystem(g);
      }
    }
  }

  _updateCameraOrientation(camera) {
    const q = camera.quaternion;
    const fx = -2 * (q.x * q.z + q.w * q.y);
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const len = Math.hypot(fx, fz) || 1;
    this._fwdX = fx / len;
    this._fwdZ = fz / len;
    return Math.atan2(this._fwdX, this._fwdZ);
  }

  // ================================================
  // MAIN UPDATE
  // ================================================

  update(dt) {
    const p = this.player;
    const g = p?.g;
    if (!p || !g || !g.camera) return;

    if (g.dead) {
      if (this.dlbState !== 'inactive') {
        this.dlbState = 'inactive';
        if (g.monster) g.monster.freeze = 0;
      }
      return;
    }

    dt = Math.max(0, Math.min(dt, 0.1));
    this.directorTime += dt;
    this._cacheDom();

    const camera = g.camera;
    const yaw = this._updateCameraOrientation(camera);

    // --------------------------------
    // CAMERA MOVEMENT / WHIPLASH
    // --------------------------------
    let turnSpeed = 0;
    let yawDelta = 0;

    if (this.lastYaw !== null) {
      yawDelta = Math.atan2(
        Math.sin(yaw - this.lastYaw),
        Math.cos(yaw - this.lastYaw)
      );
      turnSpeed = Math.abs(yawDelta) / Math.max(dt, 0.001);

      if (turnSpeed > this.turnThreshold) {
        const excess = turnSpeed - this.turnThreshold;
        this.value += Math.min(excess, 8) * this.turnGain * dt;

        this.profile.fastTurns++;
        this.profile.turnHabit = Math.min(1, this.profile.turnHabit + dt * 0.16);
        this.profile.lastTurnDirection = Math.sign(yawDelta);
        this.profile.lastTurnTime = this.directorTime;

        if (Math.abs(yawDelta) > Math.PI * 0.65) {
          if (this.directorTime - this.profile.lastBackCheckTime < 5) {
            this.profile.repeatedBackChecks = Math.min(10, this.profile.repeatedBackChecks + 1);
          }
          this.profile.lastBackCheckTime = this.directorTime;
        }
      } else {
        this.profile.turnHabit = Math.max(0, this.profile.turnHabit - dt * 0.025);
      }
    }

    if (this.profile.repeatedBackChecks > 0) {
      this.profile.repeatedBackChecks = Math.max(0, this.profile.repeatedBackChecks - dt * 0.08);
    }

    this.lastYaw = yaw;
    this.profile.totalTurns += Math.abs(yawDelta);

    // --------------------------------
    // FLASHLIGHT TRACKING
    // --------------------------------
    if (g.flash && g.flash.on && !g.dark) {
      this.flashlightTime += dt;
      this.profile.flashlightUse += dt;
      this.profile.flashlightHabit = Math.min(1, this.profile.flashlightHabit + dt * 0.025);
    } else {
      this.flashlightTime = Math.max(0, this.flashlightTime - dt * 2);
      this.profile.flashlightHabit = Math.max(0, this.profile.flashlightHabit - dt * 0.01);
    }

    // --------------------------------
    // STANDING STILL / HIDING
    // --------------------------------
    if (!p.moving && !p.winding) {
      this.standStillTime += dt;
      this.profile.stationaryTime += dt;
      this.profile.hidingHabit = Math.min(1, this.profile.hidingHabit + dt * 0.025);
    } else {
      this.standStillTime = 0;
      this.profile.hidingHabit = Math.max(0, this.profile.hidingHabit - dt * 0.02);
    }

    // --------------------------------
    // MONSTER & ENVIRONMENT PROXIMITY
    // --------------------------------
    this._updateThreat(dt);

    if (this.monsterThreat > 0) {
      this.value += this.monsterThreat * this.proximityGain * dt;
      this.closeThreatTime += dt;
      this.timeSinceThreat = 0;
    } else {
      this.closeThreatTime = Math.max(0, this.closeThreatTime - dt * 0.5);
      this.timeSinceThreat += dt;
    }

    if (g.dark) {
      this.value += 9.0 * dt;
    } else if (g.lighting && g.lighting.maxStress > 0.25) {
      this.value += g.lighting.maxStress * 6.5 * dt;
    }

    // --------------------------------
    // PLAYER ACTIONS & RECOVERY
    // --------------------------------
    if (p.winding) {
      this.value += this.windingGain * dt;
      this.profile.windingTime += dt;
    } else if (p.running) {
      this.value += this.runningGain * dt;
      this.profile.sprintTime += dt;
      this.profile.sprintHabit = Math.min(1, this.profile.sprintHabit + dt * 0.035);
    } else if (p.moving) {
      if (this.monsterThreat > 0.1 || this.value < 28) {
        this.value += this.movingGain * dt;
      } else {
        this.value -= (this.recoveryGain * 0.55) * dt;
      }
      this.profile.sprintHabit = Math.max(0, this.profile.sprintHabit - dt * 0.02);
    } else {
      this.value -= this.recoveryGain * dt;
      this.profile.sprintHabit = Math.max(0, this.profile.sprintHabit - dt * 0.02);
    }

    // --------------------------------
    // FALSE REASSURANCE
    // --------------------------------
    this._updateReassurance(dt);

    // --------------------------------
    // STRESS CLAMP
    // --------------------------------
    this.value = Math.max(0, Math.min(this.maxStress, this.value));
    p.stress = this.value;

    // --------------------------------
    // PHYSIOLOGICAL HEARTBEAT & VISUALS
    // --------------------------------
    this._updateHeartbeat(dt);
    this._updateVisualInterference(dt);
    this._updatePendingEvents(dt);

    // --------------------------------
    // PSYCHOLOGICAL EVENT DIRECTOR
    // --------------------------------
    this.eventCooldown -= dt;

    if (
      this.eventCooldown <= 0 &&
      this.value > 32 &&
      g.monster &&
      g.monster.active &&
      !g.dead
    ) {
      this.triggerEvent(g.monster, turnSpeed);
    }

    // --------------------------------
    // "DON'T LOOK BACK" STATE MACHINE
    // --------------------------------
    this._updateDontLookBack(dt);
  }

  // ================================================
  // "DON'T LOOK BACK" MECHANIC
  // ================================================

  _updateDontLookBack(dt) {
    const g = this.player.g;
    if (this.dlbState === 'inactive' || !g.monster || !g.monster.active || g.dead) return;

    const m = g.monster;
    const c = g.camera.position;

    const dx = m.pos.x - c.x;
    const dz = m.pos.z - c.z;
    const dist = Math.hypot(dx, dz);

    const lookDot = (dx * this._fwdX + dz * this._fwdZ) / (dist || 1);

    if (this.dlbState === 'approaching') {
      this.dlbTimer -= dt;

      if (dist < 3.8 && lookDot < -0.55) {
        this.dlbState = 'standoff';
        this.dlbOrigin = { x: c.x, z: c.z };
        this.dlbTimer = 0;
        this.dlbSurvivalTimer = 8.5;

        if (g.audio?.tone) g.audio.tone(45, 2.0, 0.38, 'sawtooth', m.pos);
        if (g.audio?.whisper) g.audio.whisper(m.pos, 1.5);
        if (g.warn) g.warn("DON'T LOOK BACK", 1800);
      } else if (this.dlbTimer <= 0 || (dist < 8 && lookDot > 0.45)) {
        this.dlbState = 'inactive';
      }
    } else if (this.dlbState === 'standoff') {
      this.dlbSurvivalTimer -= dt;

      const targetX = c.x - this._fwdX * 1.65;
      const targetZ = c.z - this._fwdZ * 1.65;
      if (!g.world.collides(targetX, targetZ, 0.2)) {
        m.pos.x = targetX;
        m.pos.z = targetZ;
      }

      if (m.dir) m.dir.set(this._fwdX, 0, this._fwdZ);
      m.freeze = 0.5;
      if (m.renderLocal) m.renderLocal(dt);

      // FATAL: Player turned the camera past their shoulder to look at it
      if (lookDot > 0.25) {
        this.dlbState = 'inactive';
        m.freeze = 0;
        if (g.killPlayer) g.killPlayer();
        return;
      }

      const walkedDist = this.dlbOrigin ? Math.hypot(c.x - this.dlbOrigin.x, c.z - this.dlbOrigin.z) : 0;
      if (walkedDist > 3.8 || this.dlbSurvivalTimer <= 0) {
        this.dlbState = 'inactive';
        m.freeze = 0;
        if (m.change) m.change('SEARCH');
        m.pauseT = 1.5;
        if (g.audio?.whisper) g.audio.whisper(c, 0);
      }
    }
  }

  // ================================================
  // PHYSIOLOGICAL HEARTBEAT
  // ================================================

  _updateHeartbeat(dt) {
    const g = this.player.g;
    if (!g.audio?.thud || g.dead) return;

    const standoff = this.dlbState === 'standoff';
    if (this.value < 62 && !standoff) {
      this.heartbeatTimer = 0;
      return;
    }

    const intensity = standoff ? 1.0 : Math.max(0, (this.value - 62) / 38);
    const interval = standoff ? 0.42 : (0.92 - intensity * 0.48);

    this.heartbeatTimer -= dt;
    if (this.heartbeatTimer <= 0) {
      this.heartbeatTimer = interval;
      g.audio.thud(g.camera.position, true);
    }
  }

  // ================================================
  // THREAT ESTIMATION
  // ================================================

  _updateThreat(dt) {
    const p = this.player;
    const g = p.g;
    const monster = g.monster;

    this.monsterThreat = 0;
    this.monsterDistance = Infinity;

    if (!monster || !monster.active || !g.camera || g.dead) return;

    const monsterPosition = this._getMonsterPosition(monster);
    if (!monsterPosition) return;

    const cameraPosition = g.camera.position;
    const dx = monsterPosition.x - cameraPosition.x;
    const dz = monsterPosition.z - cameraPosition.z;
    const distance = Math.hypot(dx, dz);

    this.monsterDistance = distance;

    const near = 4;
    const far = 22;
    const t = Math.max(0, Math.min(1, (far - distance) / (far - near)));
    this.monsterThreat = t * t * (3 - 2 * t);
  }

  _getMonsterPosition(monster) {
    return monster.pos || null;
  }

  // ================================================
  // REASSURANCE / QUIET PERIODS
  // ================================================

  _updateReassurance(dt) {
    if (this.reassuranceDuration > 0) {
      this.reassuranceDuration -= dt;
      if (this.reassuranceDuration <= 0) {
        this.reassuranceActive = false;
      }
    }

    if (
      this.value < 50 &&
      this.monsterThreat < 0.15 &&
      !this.player.running &&
      !this.player.winding
    ) {
      this.reassuranceTime += dt;
    } else {
      this.reassuranceTime = Math.max(0, this.reassuranceTime - dt * 0.5);
    }
  }

  _beginReassurance() {
    this.reassuranceActive = true;
    this.reassuranceDuration = 4 + Math.random() * 8;
    this.reassuranceTime = 0;
  }

  // ================================================
  // EVENT DIRECTOR
  // ================================================

  triggerEvent(monster, turnSpeed = 0) {
    const g = this.player.g;
    const level = this.normalized;

    if (!monster || !monster.active || g.dead || this.value < 32) return;

    if (this.pendingEvents.length > 0) {
      this.eventCooldown = 1.0 + Math.random() * 1.5;
      return;
    }

    const candidates = this._buildEventCandidates(level, turnSpeed);
    if (candidates.length === 0) {
      this.eventCooldown = 4 + Math.random() * 4;
      return;
    }

    const dangerBonus = this.monsterThreat * 0.18;
    if (Math.random() < Math.max(0.04, this.quietChance - dangerBonus)) {
      this.stats.quietPeriods++;
      this.eventCooldown = 7 + Math.random() * 9;
      return;
    }

    const chosen = this._weightedChoice(candidates);
    if (!chosen) {
      this.eventCooldown = 5.0 + Math.random() * 5.0;
      return;
    }

    const closeThreatBonus = this.monsterThreat > 0.75;
    this.eventCooldown = closeThreatBonus
      ? 4.5 + Math.random() * 3.5
      : 8.0 + Math.random() * 10.0;

    const canAnticipate = chosen.anticipation && level > 0.38 && !this.reassuranceActive;
    const anticipationChance = 0.35 + level * 0.25;

    if (canAnticipate && Math.random() < anticipationChance) {
      this._scheduleEvent(chosen.type, 1.2 + Math.random() * 2.8, chosen.warning);
      this.stats.anticipationEvents++;
      return;
    }

    this._executeEvent(chosen.type, monster, turnSpeed);
  }

  // ================================================
  // CANDIDATE EVENTS (Uses add(...) ONLY!)
  // ================================================

  _buildEventCandidates(level, turnSpeed) {
    const candidates = [];

    const add = (type, weight, condition, anticipation = false, warning = null) => {
      if (!condition) return;
      const adjustedWeight = this._adjustEventWeight(type, weight);
      if (adjustedWeight > 0) {
        candidates.push({ type, weight: adjustedWeight, anticipation, warning });
      }
    };

    // 1. SENSORY OVERLOAD
    add("sensoryOverload", 1.0 + level * 1.5, level > 0.88, false);

    // 2. PARANOIA DROP
    add(
      "paranoiaDrop",
      1.4 + this.profile.hidingHabit,
      level > 0.38 && this.standStillTime > 1.8,
      true,
      "distantStep"
    );

    // 3. FLASHLIGHT BURNOUT
    add(
      "flashlightBurnout",
      1.1 + this.profile.flashlightHabit,
      level > 0.5 && this.flashlightTime > 10,
      true,
      "flashlightWarning"
    );

    // 4. WHIPLASH
    add(
      "whiplash",
      1.0 + this.profile.turnHabit * 1.5,
      level > 0.45 && turnSpeed > this.turnThreshold,
      true,
      "distantStep"
    );

    // 5. DOPPELGANGER ECHO
    add(
      "doppelgangerEcho",
      1.0 + level * 0.8,
      level > 0.35,
      true,
      "distantStep"
    );

    // 6. PHANTOM GLANCE
    add(
      "phantomGlance",
      0.8 + this.profile.repeatedBackChecks * 0.15,
      level > 0.32 && turnSpeed > this.turnThreshold,
      false
    );

    // 7. NEARBY THREAT
    add(
      "nearbyThreat",
      0.9 + this.monsterThreat * 2,
      this.monsterThreat > 0.35,
      true,
      "distantStep"
    );

    // 8. BEHAVIORAL PARANOIA
    add(
      "behavioralParanoia",
      0.9 + this.profile.turnHabit,
      level > 0.4 && this.profile.repeatedBackChecks >= 1.5,
      true,
      "distantStep"
    );

    // 9. FALSE REASSURANCE
    add(
      "falseReassurance",
      0.5,
      level > 0.5 && this.monsterThreat < 0.4 && this.timeSinceThreat > 3,
      false
    );

    // 10. DON'T LOOK BACK
    add(
      "dontLookBack",
      1.6,
      level > 0.78 && !this.player.moving && this.dlbState === 'inactive',
      false
    );

    // 11. CEILING DRIP
    add(
      "ceilingDrip",
      1.1 + level * 0.6,
      level > 0.42 && !this.player.running,
      false
    );

    // 12. PARANOIA HUD CORRUPTION
    add(
      "paranoiaHudGlitch",
      1.2 + level * 0.8,
      level > 0.52,
      false
    );

    // 13. FALSE JUMPSCARE — PHANTOM 3D STALK & CORRIDOR CHARGE
    add(
      "falseJumpscareLunge",
      1.4 + level * 1.6,
      level > 0.58 && this.monsterDistance > 8,
      true,
      "flashlightWarning"
    );

    // 14. FALSE JUMPSCARE — 3D BLINDSPOT SHOULDER GRAB
    add(
      "falseJumpscareGrab",
      1.5 + this.profile.turnHabit * 1.4,
      level > 0.48 && (turnSpeed > this.turnThreshold * 0.85 || this.standStillTime > 2.5),
      false
    );

    // 15. FALSE JUMPSCARE — PANIC FLOOR DRAG HALLUCINATION
    add(
      "falseJumpscareTrip",
      1.3 + this.profile.sprintHabit * 1.5,
      level > 0.72 && this.player.moving,
      false
    );

    return candidates;
  }

  // ================================================
  // EVENT MEMORY
  // ================================================

  _adjustEventWeight(type, baseWeight) {
    const last = this.eventHistory.get(type);
    if (!last) return baseWeight;

    const elapsed = this.directorTime - last.time;
    if (elapsed < 5) return 0;

    if (elapsed < this.repeatCooldown) {
      const recovery = elapsed / this.repeatCooldown;
      return baseWeight * recovery * 0.25;
    }

    if (type === this.lastEventType) {
      return baseWeight * 0.35;
    }

    return baseWeight;
  }

  _weightedChoice(candidates) {
    let total = 0;
    for (let i = 0; i < candidates.length; i++) total += candidates[i].weight;
    if (total <= 0) return null;

    let roll = Math.random() * total;
    for (let i = 0; i < candidates.length; i++) {
      roll -= candidates[i].weight;
      if (roll <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  _rememberEvent(type) {
    this.eventHistory.set(type, {
      time: this.directorTime,
      stress: this.value,
      threat: this.monsterThreat
    });

    this.lastEventType = type;
    this.lastMajorEventTime = this.directorTime;
    this.stats.eventsTriggered++;

    if (this.eventHistory.size > 32) {
      const oldest = this.eventHistory.keys().next().value;
      this.eventHistory.delete(oldest);
    }
  }

  // ================================================
  // ANTICIPATION SYSTEM
  // ================================================

  _scheduleEvent(type, delay, warning = null) {
    this.pendingEvents.push({
      type,
      remaining: delay,
      warning,
      warned: false
    });

    this.anticipation = 1;
    this.anticipationType = type;
    this.anticipationTimer = delay;
    this.anticipationDuration = delay;
  }

  _updatePendingEvents(dt) {
    if (this.pendingEvents.length === 0) {
      this.anticipation = Math.max(0, this.anticipation - dt * 0.5);
      return;
    }

    for (let i = this.pendingEvents.length - 1; i >= 0; i--) {
      const event = this.pendingEvents[i];

      if (!event.warned && event.warning) {
        event.warned = true;
        this._playWarning(event.warning);
      }

      event.remaining -= dt;

      if (event.type === "echoFollowup") {
        if (event.remaining > 0) continue;
        this.pendingEvents.splice(i, 1);

        const g = this.player.g;
        if (g && !g.dead && g.monster?.active && g.monster.soundAt) {
          g.monster.soundAt("mimic", event.x, event.z);
        }
        continue;
      }

      if (event.remaining > 0) continue;

      this.pendingEvents.splice(i, 1);
      this.anticipation = 0;
      this.anticipationType = null;

      const g = this.player.g;
      if (!g || g.dead || !g.monster?.active) continue;

      if (this.monsterThreat < 0.05 && this.value < 40 && Math.random() < 0.45) {
        this.stats.eventsSuppressed++;
        continue;
      }

      this._executeEvent(event.type, g.monster, 0);
    }

    if (this.pendingEvents.length === 0) {
      this.anticipation = 0;
      this.anticipationType = null;
      return;
    }

    const anticipationEvent = this.pendingEvents.find(e => e.type !== "echoFollowup");
    if (anticipationEvent) {
      this.anticipationTimer = Math.max(0, anticipationEvent.remaining);
      this.anticipation = Math.max(
        0,
        Math.min(1, anticipationEvent.remaining / Math.max(this.anticipationDuration, 0.001))
      );
    }
  }

  _playWarning(type) {
    const g = this.player.g;
    if (!g || g.dead || !g.camera) return;

    const c = g.camera.position;

    switch (type) {
      case "distantStep": {
        if (g.monster?.soundAt) {
          const x = c.x - this._fwdX * 10;
          const z = c.z - this._fwdZ * 10;
          g.monster.soundAt("mimic", x, z);
        }
        break;
      }
      case "flashlightWarning": {
        if (g.monster?.startFlickerWarning) {
          g.monster.startFlickerWarning();
        }
        break;
      }
    }
  }

  // ================================================
  // EVENT EXECUTION (switch / case goes HERE!)
  // ================================================

  _executeEvent(type, monster, turnSpeed = 0) {
    const p = this.player;
    const g = p.g;
    if (!g || !g.camera || g.dead || !monster || !monster.active) return;

    const c = g.camera.position;
    this._rememberEvent(type);

    switch (type) {
      case "sensoryOverload": {
        if (g.audio?.whisper) g.audio.whisper(c, 0);
        if (g.glitch) g.glitch();
        if (monster.addFury) monster.addFury(g.mp?.peer?.id || "local", 0.15);
        break;
      }

      case "paranoiaDrop": {
        const dropX = c.x - this._fwdX * 2.0;
        const dropZ = c.z - this._fwdZ * 2.0;

        if (g.world && !g.world.collides(dropX, dropZ, 0.1)) {
          if (g.goo?.pool) g.goo.pool(dropX, dropZ, 0.85);
          if (monster.soundAt) monster.soundAt("mimic", dropX, dropZ);
        }
        break;
      }

      case "flashlightBurnout": {
        if (monster.startFlickerWarning) monster.startFlickerWarning();
        this._setVisualBatteryOverride(0.02, 0.55);
        if (g.audio?.click) g.audio.click();
        break;
      }

      case "whiplash": {
        const fakeX = c.x - this._fwdX * 12;
        const fakeZ = c.z - this._fwdZ * 12;
        if (monster.soundAt) monster.soundAt("mimic", fakeX, fakeZ);
        break;
      }

      case "doppelgangerEcho": {
        const side = Math.random() < 0.5 ? -1 : 1;
        const rightX = -this._fwdZ * side;
        const rightZ = this._fwdX * side;
        const echoX = c.x + rightX * 4.5;
        const echoZ = c.z + rightZ * 4.5;

        this.pendingEvents.push({
          type: "echoFollowup",
          remaining: 0.42 + Math.random() * 0.25,
          x: echoX - this._fwdX * 1.5,
          z: echoZ - this._fwdZ * 1.5,
          warned: true
        });

        this.pendingEvents.push({
          type: "echoFollowup",
          remaining: 0.88 + Math.random() * 0.3,
          x: echoX - this._fwdX * 3.0,
          z: echoZ - this._fwdZ * 3.0,
          warned: true
        });

        if (monster.soundAt) monster.soundAt("mimic", echoX, echoZ);
        break;
      }

      case "phantomGlance": {
        if (g.glitch) g.glitch();
        if (g.audio?.whisper) g.audio.whisper(c, 0);
        this._setVisualBatteryOverride(Math.random() * 0.25, 0.3);
        break;
      }

      case "nearbyThreat": {
        const distance = 4.5 + Math.random() * 6 * (1 - this.monsterThreat);
        const x = c.x - this._fwdX * distance;
        const z = c.z - this._fwdZ * distance;

        if (monster.soundAt) monster.soundAt("mimic", x, z);
        if (this.monsterThreat > 0.8 && monster.addFury) {
          monster.addFury(g.mp?.peer?.id || "local", 0.05);
        }
        break;
      }

      case "behavioralParanoia": {
        const dir = this.profile.lastTurnDirection || 1;
        const sideX = -this._fwdZ * dir;
        const sideZ = this._fwdX * dir;
        const distance = 7 + Math.random() * 5;

        const x = c.x + sideX * distance;
        const z = c.z + sideZ * distance;
        if (monster.soundAt) monster.soundAt("mimic", x, z);
        break;
      }

      case "falseReassurance": {
        this._beginReassurance();
        break;
      }

      case "dontLookBack": {
        this.dlbState = 'approaching';
        this.dlbTimer = 25.0;
        if (monster.change) monster.change('STALK');
        monster.retreat = false;
        break;
      }

      case "ceilingDrip": {
        const dripX = c.x + this._fwdX * 1.85;
        const dripZ = c.z + this._fwdZ * 1.85;
        if (g.world && !g.world.collides(dripX, dripZ, 0.15)) {
          if (g.goo?.drop) g.goo.drop(dripX, dripZ, 1.3, 1.1);
          if (g.audio?.pop) {
            monster.scratch.set(dripX, 3.0, dripZ);
            g.audio.pop(monster.scratch);
          }
        }
        break;
      }

      case "paranoiaHudGlitch": {
        if (this._statusEl) {
          const msgs = [
            "AUDIO: IT IS BEHIND YOU",
            "SIGNAL: DO NOT TURN AROUND",
            "AUDIO: BREATHING DETECTED",
            "WARNING: PROXIMITY ALERT",
            "AUDIO: FOOTSTEPS SYNCED"
          ];
          this._statusEl.textContent = msgs[(Math.random() * msgs.length) | 0];
          g._lastSt = '';
          if (g.glitch) g.glitch();
        }
        break;
      }

      // 13. FALSE 3D JUMPSCARE: 2.9s PHANTOM STALK & CORRIDOR CHARGE (Uses cloned g.monster!)
      case "falseJumpscareLunge": {
        g.jumpscare?.triggerFalse?.('phantom_stalk_rush');
        if (g.warn) g.warn('OPTIC HALLUCINATION // HIGH STRESS', 2600);
        break;
      }

      // 14. FALSE 3D JUMPSCARE: 2.7s BLINDSPOT SHOULDER GRAB (Uses cloned g.monster!)
      case "falseJumpscareGrab": {
        g.jumpscare?.triggerFalse?.('blindspot_grab');
        if (g.warn) g.warn('AUDITORY PARANOIA // DO NOT PANIC', 2400);
        break;
      }

      // 15. FALSE 3D JUMPSCARE: 3.3s KNOCKED PRONE & FLOOR DRAG HALLUCINATION
      case "falseJumpscareTrip": {
        g.jumpscare?.triggerFalse?.('ankle_drag_hallucination');
        if (g.warn) g.warn('PANIC VERTIGO — SCRAMBLE UP!', 2800);
        break;
      }
    }
  }

  // ================================================
  // VISUAL BATTERY & BEAM INTERFERENCE
  // ================================================

  _setVisualBatteryOverride(value, duration) {
    this.visualBatteryOverride = Math.max(0, Math.min(1, value));
    this.visualBatteryTimer = Math.min(this.maxVisualBatteryDuration, Math.max(0, duration));

    const g = this.player.g;
    if (g?.flash) {
      g.flash.stressVisualBattery = this.visualBatteryOverride;
      g.flash.flk = 0.08;
    }
  }

  _updateVisualInterference(dt) {
    if (this.visualBatteryTimer <= 0) return;

    this.visualBatteryTimer -= dt;
    const g = this.player.g;

    if (this.visualBatteryTimer > 0 && this.visualBatteryOverride !== null) {
      if (g?.flash) g.flash.flk = Math.random() < 0.5 ? 0.05 : 0.35;
      const pct = Math.round(this.visualBatteryOverride * 100);
      if (this._barEl) this._barEl.style.width = pct + '%';
      if (this._pctEl) this._pctEl.textContent = pct + '%';
    } else {
      this.visualBatteryTimer = 0;
      this.visualBatteryOverride = null;
      if (g?.flash) {
        g.flash.stressVisualBattery = null;
        g.flash._lastPct = -1;
      }
    }
  }

  // ================================================
  // STANDARD CONTROLLER METHODS
  // ================================================

  reset() {
    this.value = 0;
    this.lastYaw = null;

    this.flashlightTime = 0;
    this.standStillTime = 0;
    this.eventCooldown = 12.0;

    this.pendingEvents.length = 0;
    this.eventHistory.clear();

    this.lastEventType = null;
    this.lastMajorEventTime = -1000;
    this.directorTime = 0;

    this.anticipation = 0;
    this.anticipationType = null;
    this.anticipationTimer = 0;
    this.anticipationDuration = 0;

    this.monsterDistance = Infinity;
    this.monsterThreat = 0;
    this.closeThreatTime = 0;
    this.timeSinceThreat = 999;
    this.heartbeatTimer = 0;

    this.reassuranceTime = 0;
    this.reassuranceActive = false;
    this.reassuranceDuration = 0;

    this.visualBatteryOverride = null;
    this.visualBatteryTimer = 0;

    this.dlbState = 'inactive';
    this.dlbTimer = 0;
    this.dlbSurvivalTimer = 0;
    this.dlbOrigin = null;

    this.profile = {
      totalTurns: 0,
      fastTurns: 0,
      sprintTime: 0,
      windingTime: 0,
      flashlightUse: 0,
      repeatedBackChecks: 0,
      stationaryTime: 0,
      lastTurnDirection: 0,
      lastTurnTime: -1000,
      lastBackCheckTime: -1000,
      lastProfileUpdate: 0,
      previousTurnSpeed: 0,
      turnHabit: 0,
      sprintHabit: 0,
      flashlightHabit: 0,
      hidingHabit: 0
    };

    this.stats = {
      eventsTriggered: 0,
      eventsSuppressed: 0,
      quietPeriods: 0,
      anticipationEvents: 0
    };

    const g = this.player.g;
    if (g?.flash) {
      g.flash.stressVisualBattery = null;
      g.flash._lastPct = -1;
    }

    this.player.stress = 0;
  }

  add(amount) {
    this.value = Math.max(0, Math.min(this.maxStress, this.value + amount));
    this.player.stress = this.value;
  }

  remove(amount) {
    this.value = Math.max(0, Math.min(this.maxStress, this.value - amount));
    this.player.stress = this.value;
  }

  get normalized() {
    return this.value / this.maxStress;
  }

  get panicking() {
    return this.value >= 90;
  }
}
