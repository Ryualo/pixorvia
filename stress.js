// stress.js
// Psychological Panic & Stress Director
//
// Features:
// - Camera whiplash detection
// - Running, movement, dynamo, and recovery stress
// - Flashlight overuse tracking
// - Player behavior profiling
// - Monster proximity awareness
// - Weighted psychological event selection
// - Event memory and repetition prevention
// - Delayed events and anticipation
// - False reassurance and quiet periods
// - Safe visual battery interference
// - Original horror events preserved
//
// Compatible with:
// const stress = new StressSystem(player);
// stress.update(dt);
// stress.reset();
// stress.add(amount);
// stress.remove(amount);

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
    this.eventCooldown = 15.0;

    // --------------------------------
    // STRESS TUNING
    // --------------------------------

    this.turnThreshold = 2.0;
    this.turnGain = 8.0;

    this.windingGain = 18.0;
    this.runningGain = 10.0;
    this.movingGain = 4.0;
    this.recoveryGain = 1.5;

    // Stress caused by environmental danger.
    this.proximityGain = 0;

    // --------------------------------
    // EVENT DIRECTOR
    // --------------------------------

    this.pendingEvents = [];
    this.eventHistory = new Map();

    this.lastEventType = null;
    this.lastMajorEventTime = -1000;

    this.directorTime = 0;

    // Higher values mean events are less predictable.
    this.unpredictability = 1.0;

    // The director sometimes chooses not to scare the player.
    this.quietChance = 0.22;

    // Avoid repeating an event type too soon.
    this.repeatCooldown = 18.0;

    // Keep major events separated.
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

      // Decaying behavioral scores.
      turnHabit: 0,
      sprintHabit: 0,
      flashlightHabit: 0,
      hidingHabit: 0
    };

    // --------------------------------
    // THREAT TRACKING
    // --------------------------------

    this.monsterDistance = Infinity;
    this.monsterThreat = 0;

    // How long the monster has been close.
    this.closeThreatTime = 0;

    // Time since the monster was last nearby.
    this.timeSinceThreat = 999;

    // --------------------------------
    // REASSURANCE
    // --------------------------------

    this.reassuranceTime = 0;
    this.reassuranceActive = false;

    // A brief calm period after sufficiently intense events.
    this.reassuranceDuration = 0;

    // --------------------------------
    // VISUAL INTERFERENCE
    // --------------------------------

    // This does NOT overwrite the real flashlight battery.
    // The UI can optionally read this property.
    this.visualBatteryOverride = null;
    this.visualBatteryTimer = 0;

    this.maxVisualBatteryDuration = 0.5;

    // --------------------------------
    // "DON'T LOOK BACK" TRACKERS
    // --------------------------------
    this.dlbState = 'inactive';
    this.dlbTimer = 0;
    this.dlbOrigin = null;

    // --------------------------------
    // EVENT STATISTICS
    // --------------------------------

    this.stats = {
      eventsTriggered: 0,
      eventsSuppressed: 0,
      quietPeriods: 0,
      anticipationEvents: 0
    };
  }

  // ================================================
  // MAIN UPDATE
  // ================================================

  update(dt) {
    const p = this.player;
    const g = p.g;

    if (!p || !g || !g.camera) return;

    // Prevent huge changes after frame stalls.
    dt = Math.max(0, Math.min(dt, 0.1));

    this.directorTime += dt;

    const camera = g.camera;
    const yaw = camera.rotation.y;

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

        // Fast turns increase stress, but extreme speeds
        // cannot cause an unlimited one-frame spike.
        this.value += Math.min(excess, 8) * this.turnGain * dt;

        this.profile.fastTurns++;
        this.profile.turnHabit = Math.min(
          1,
          this.profile.turnHabit + dt * 0.16
        );

        this.profile.lastTurnDirection = Math.sign(yawDelta);
        this.profile.lastTurnTime = this.directorTime;

        // Detect repeated attempts to check behind.
        if (
          Math.abs(yawDelta) > Math.PI * 0.65 &&
          this.directorTime - this.profile.lastBackCheckTime < 5
        ) {
          this.profile.repeatedBackChecks++;
        }

        if (Math.abs(yawDelta) > Math.PI * 0.65) {
          this.profile.lastBackCheckTime = this.directorTime;
        }
      } else {
        this.profile.turnHabit = Math.max(
          0,
          this.profile.turnHabit - dt * 0.025
        );
      }
    }

    this.lastYaw = yaw;

    this.profile.totalTurns += Math.abs(yawDelta);

    // --------------------------------
    // FLASHLIGHT TRACKING
    // --------------------------------

    if (g.flash && g.flash.on && !g.dark) {
      this.flashlightTime += dt;
      this.profile.flashlightUse += dt;

      this.profile.flashlightHabit = Math.min(
        1,
        this.profile.flashlightHabit + dt * 0.025
      );
    } else {
      this.flashlightTime = Math.max(
        0,
        this.flashlightTime - dt * 2
      );

      this.profile.flashlightHabit = Math.max(
        0,
        this.profile.flashlightHabit - dt * 0.01
      );
    }

    // --------------------------------
    // STANDING STILL / HIDING
    // --------------------------------

    if (!p.moving && !p.winding) {
      this.standStillTime += dt;
      this.profile.stationaryTime += dt;

      this.profile.hidingHabit = Math.min(
        1,
        this.profile.hidingHabit + dt * 0.025
      );
    } else {
      this.standStillTime = 0;

      this.profile.hidingHabit = Math.max(
        0,
        this.profile.hidingHabit - dt * 0.02
      );
    }

    // --------------------------------
    // PLAYER ACTIONS
    // --------------------------------

    if (p.winding) {
      this.value += this.windingGain * dt;
      this.profile.windingTime += dt;
    } else if (p.running) {
      this.value += this.runningGain * dt;
      this.profile.sprintTime += dt;

      this.profile.sprintHabit = Math.min(
        1,
        this.profile.sprintHabit + dt * 0.035
      );
    } else if (p.moving) {
      this.value += this.movingGain * dt;

      this.profile.sprintHabit = Math.max(
        0,
        this.profile.sprintHabit - dt * 0.02
      );
    } else {
      this.value -= this.recoveryGain * dt;

      this.profile.sprintHabit = Math.max(
        0,
        this.profile.sprintHabit - dt * 0.02
      );
    }

    // --------------------------------
    // MONSTER PROXIMITY
    // --------------------------------

    this._updateThreat(dt);

    // Environmental danger increases psychological tension.
    if (this.monsterThreat > 0) {
      this.value += this.monsterThreat * this.proximityGain * dt;
      this.closeThreatTime += dt;
      this.timeSinceThreat = 0;
    } else {
      this.closeThreatTime = Math.max(
        0,
        this.closeThreatTime - dt * 0.5
      );

      this.timeSinceThreat += dt;
    }

    // --------------------------------
    // FALSE REASSURANCE
    // --------------------------------

    this._updateReassurance(dt);

    // --------------------------------
    // STRESS CLAMP
    // --------------------------------

    this.value = Math.max(
      0,
      Math.min(this.maxStress, this.value)
    );

    p.stress = this.value;

    // --------------------------------
    // TEMPORARY VISUAL EFFECTS
    // --------------------------------

    this._updateVisualInterference(dt);

    // --------------------------------
    // ANTICIPATION QUEUE
    // --------------------------------

    this._updatePendingEvents(dt);

    // --------------------------------
    // PSYCHOLOGICAL EVENT DIRECTOR
    // --------------------------------

    this.eventCooldown -= dt;

    if (
      this.eventCooldown <= 0 &&
      this.value > 35 &&
      g.monster &&
      g.monster.active &&
      !g.dead
    ) {
      this.triggerEvent(g.monster, turnSpeed);
    }

    // --------------------------------
    // "DON'T LOOK BACK" STATE MACHINE
    // --------------------------------
    if (this.dlbState !== 'inactive' && g.monster && !g.dead) {
      const m = g.monster;
      const c = g.camera.position;
      
      const dx = m.pos.x - c.x;
      const dz = m.pos.z - c.z;
      const dist = Math.hypot(dx, dz);
      
      // Calculate exactly where the player's camera is facing
      const fwdX = Math.sin(yaw);
      const fwdZ = Math.cos(yaw);
      
      // Dot product: > 0.5 means looking at it. < -0.6 means it's strictly in the blind spot.
      const lookDot = (dx * fwdX + dz * fwdZ) / (dist || 1);
      
      // PHASE 1: The monster is physically navigating the maze to get behind you
      if (this.dlbState === 'approaching') {
        this.dlbTimer -= dt;
        
        // If it successfully gets within 3.5 units AND is directly behind you without being seen
        if (dist < 3.5 && lookDot < -0.6) {
          this.dlbState = 'standoff';
          this.dlbOrigin = { x: c.x, z: c.z };
          this.dlbTimer = 0; // Reset timer for audio pulsing
          
          // The moment it arrives, play a deep, terrifying rumble
          if (g.audio.tone) g.audio.tone(45, 2.0, 0.4, 'sawtooth', m.pos);
        } 
        // Cancel the event if it takes too long or if the player spots it approaching
        else if (this.dlbTimer <= 0 || (dist < 8 && lookDot > 0.5)) {
          this.dlbState = 'inactive';
        }
      } 
      
      // PHASE 2: It is standing right behind you. Do. Not. Turn. Around.
      else if (this.dlbState === 'standoff') {
        // Magnetically lock it exactly 1.8 units behind the camera so it perfectly tracks your movement
        const backwardYaw = yaw + Math.PI;
        m.pos.x = c.x + Math.sin(backwardYaw) * 1.8;
        m.pos.z = c.z + Math.cos(backwardYaw) * 1.8;
        
        if (m.dir) m.dir.set(c.x - m.pos.x, 0, c.z - m.pos.z).normalize();
        m.freeze = 0.5; // Disable normal AI movement
        
        // Heartbeat Audio Loop
        this.dlbTimer += dt;
        if (this.dlbTimer > 0.8) {
          this.dlbTimer = 0;
          if (g.audio.thud) g.audio.thud(c, true); // Deep heartbeat thud
        }

        // FATAL: The player turned the camera to look at it
        if (lookDot > 0.3) {
          this.dlbState = 'inactive';
          m.freeze = 0;
          if (g.killPlayer) g.killPlayer();
        } 
        // SAFE: The player kept looking forward and successfully walked 4 units away
        else if (this.dlbOrigin && Math.hypot(c.x - this.dlbOrigin.x, c.z - this.dlbOrigin.z) > 4.0) {
          this.dlbState = 'inactive';
          m.freeze = 0;
          if (m.change) m.change('SEARCH'); // It gives up and wanders off
          if (g.audio && g.audio.whisper) g.audio.whisper(c, 0); // Creepy audio cue that it vanished
        }
      }
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

    if (
      !monster ||
      !monster.active ||
      !g.camera ||
      g.dead
    ) {
      return;
    }

    const monsterPosition = this._getMonsterPosition(monster);

    if (!monsterPosition) return;

    const cameraPosition = g.camera.position;

    const dx = monsterPosition.x - cameraPosition.x;
    const dz = monsterPosition.z - cameraPosition.z;

    const distance = Math.sqrt(dx * dx + dz * dz);

    this.monsterDistance = distance;

    // Full threat inside 4 units.
    // Threat fades out beyond 20 units.
    const near = 4;
    const far = 20;

    const t = Math.max(
      0,
      Math.min(1, (far - distance) / (far - near))
    );

    // Smoothstep interpolation.
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

    // If the player is recovering and danger is distant,
    // allow a genuine calm period.
    if (
      this.value < 50 &&
      this.monsterThreat < 0.15 &&
      !this.player.running &&
      !this.player.winding
    ) {
      this.reassuranceTime += dt;
    } else {
      this.reassuranceTime = Math.max(
        0,
        this.reassuranceTime - dt * 0.5
      );
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

    if (
      !monster ||
      !monster.active ||
      g.dead ||
      this.value < 35
    ) {
      return;
    }

    // Do not start a new event while another is waiting
    // to resolve. This prevents overlapping delayed scares.
    if (this.pendingEvents.length > 0) {
      this.eventCooldown = 1.0 + Math.random() * 1.5;
      return;
    }

    const candidates = this._buildEventCandidates(
      level,
      turnSpeed
    );

    if (candidates.length === 0) {
      this.eventCooldown = 5 + Math.random() * 5;
      return;
    }

    // Sometimes nothing happens.
    // Quiet periods are part of the horror design.
    const dangerBonus = this.monsterThreat * 0.18;

    const quietRoll = Math.random();

    if (
      quietRoll <
      Math.max(0.04, this.quietChance - dangerBonus)
    ) {
      this.stats.quietPeriods++;

      this.eventCooldown = 8 + Math.random() * 12;

      return;
    }

    const chosen = this._weightedChoice(candidates);

    if (!chosen) {
      this.eventCooldown = 5.0 + Math.random() * 5.0; 
      return; 
    }

    // Longer cooldowns than the original version.
    // Nearby threats can still create short bursts.
    const closeThreatBonus = this.monsterThreat > 0.8;

    if (closeThreatBonus) {
      this.eventCooldown = 5 + Math.random() * 4;
    } else {
      this.eventCooldown = 9 + Math.random() * 12;
    }

    // Occasionally create anticipation instead of
    // delivering the scare immediately.
    const canAnticipate =
      chosen.anticipation &&
      level > 0.4 &&
      !this.reassuranceActive;

    const anticipationChance =
      0.35 + level * 0.25;

    if (
      canAnticipate &&
      Math.random() < anticipationChance
    ) {
      this._scheduleEvent(
        chosen.type,
        1.5 + Math.random() * 3.5,
        chosen.warning
      );

      this.stats.anticipationEvents++;
      return;
    }

    this._executeEvent(chosen.type, monster, turnSpeed);
  }

  // ================================================
  // CANDIDATE EVENTS
  // ================================================

  _buildEventCandidates(level, turnSpeed) {
    const candidates = [];

    const add = (
      type,
      weight,
      condition,
      anticipation = false,
      warning = null
    ) => {
      if (!condition) return;

      const adjustedWeight = this._adjustEventWeight(
        type,
        weight
      );

      if (adjustedWeight > 0) {
        candidates.push({
          type,
          weight: adjustedWeight,
          anticipation,
          warning
        });
      }
    };

    // 1. SENSORY OVERLOAD
    add(
      "sensoryOverload",
      1.0 + level * 1.5,
      level > 0.95,
      false
    );

    // 2. PARANOIA DROP
    add(
      "paranoiaDrop",
      1.4 + this.profile.hidingHabit,
      level > 0.4 && this.standStillTime > 2,
      true,
      "distantStep"
    );

    // 3. FLASHLIGHT BURNOUT
    add(
      "flashlightBurnout",
      1.0 + this.profile.flashlightHabit,
      level > 0.6 && this.flashlightTime > 12,
      true,
      "flashlightWarning"
    );

    // 4. WHIPLASH
    add(
      "whiplash",
      1.0 + this.profile.turnHabit * 1.5,
      level > 0.5 && turnSpeed > this.turnThreshold,
      true,
      "distantStep"
    );

    // 5. DOPPELGANGER ECHO
    add(
      "doppelgangerEcho",
      1.0 + level * 0.8,
      level > 0.4,
      true,
      "distantStep"
    );

    // 6. PHANTOM GLANCE
    add(
      "phantomGlance",
      0.7 + this.profile.repeatedBackChecks * 0.1,
      level > 0.35 && turnSpeed > this.turnThreshold,
      false
    );

    // 7. NEARBY THREAT
    add(
      "nearbyThreat",
      0.8 + this.monsterThreat * 2,
      this.monsterThreat > 0.4,
      true,
      "distantStep"
    );

    // 8. BEHAVIORAL PARANOIA
    add(
      "behavioralParanoia",
      0.8 + this.profile.turnHabit,
      level > 0.45 &&
        this.profile.repeatedBackChecks >= 2,
      true,
      "distantStep"
    );

    // 10. DON'T LOOK BACK
    add(
      "dontLookBack",
      1.5,
      level > 0.85 && !this.player.moving && this.dlbState === 'inactive',
      false
    );

    // 9. THE EMPTY RESPONSE
    add(
      "falseReassurance",
      0.5,
      level > 0.5 &&
        this.monsterThreat < 0.4 &&
        this.timeSinceThreat > 3,
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

    // Hard suppression for very recent repetitions.
    if (elapsed < 5) return 0;

    // Gradually restore probability over time.
    if (elapsed < this.repeatCooldown) {
      const recovery = elapsed / this.repeatCooldown;

      return baseWeight * recovery * 0.25;
    }

    // Penalize the last event to encourage variety.
    if (type === this.lastEventType) {
      return baseWeight * 0.35;
    }

    return baseWeight;
  }

  _weightedChoice(candidates) {
    let total = 0;

    for (const candidate of candidates) {
      total += candidate.weight;
    }

    if (total <= 0) return null;

    let roll = Math.random() * total;

    for (const candidate of candidates) {
      roll -= candidate.weight;

      if (roll <= 0) return candidate;
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

    // Prevent unbounded growth.
    if (this.eventHistory.size > 32) {
      const oldest = this.eventHistory.keys().next().value;

      this.eventHistory.delete(oldest);
    }
  }

  // ================================================
  // ANTICIPATION SYSTEM
  // ================================================

  _scheduleEvent(type, delay, warning = null) {
    // Only one pending major event at a time.
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
    this.anticipation = Math.max(
      0,
      this.anticipation - dt * 0.5
    );
    return;
  }

  // Update every queued event independently.
  for (let i = this.pendingEvents.length - 1; i >= 0; i--) {
    const event = this.pendingEvents[i];
    event.remaining -= dt;

    if (event.type === "echoFollowup") {
      if (event.remaining > 0) continue;

      this.pendingEvents.splice(i, 1);

      const g = this.player.g;

      if (
        g &&
        !g.dead &&
        g.monster &&
        g.monster.active &&
        g.monster.soundAt
      ) {
        g.monster.soundAt(
          "mimic",
          event.x,
          event.z
        );
      }

      continue;
    }

    // Anticipation events are processed below.
    if (event.remaining > 0) continue;

    this.pendingEvents.splice(i, 1);

    this.anticipation = 0;
    this.anticipationType = null;

    const g = this.player.g;

    if (
      !g ||
      g.dead ||
      !g.monster ||
      !g.monster.active
    ) {
      continue;
    }

    if (
      this.monsterThreat < 0.05 &&
      this.value < 42 &&
      Math.random() < 0.55
    ) {
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

  const anticipationEvent = this.pendingEvents.find(
    event => event.type !== "echoFollowup"
  );

  if (anticipationEvent) {
    this.anticipationTimer = Math.max(
      0,
      anticipationEvent.remaining
    );

    this.anticipation = Math.max(
      0,
      Math.min(
        1,
        anticipationEvent.remaining /
          Math.max(this.anticipationDuration, 0.001)
      )
    );
  }
}

  _playWarning(type) {
    const g = this.player.g;

    if (!g || g.dead || !g.camera) return;

    const c = g.camera.position;

    switch (type) {
      case "distantStep": {
        // Quiet cue, not a full scare.
        if (g.monster && g.monster.soundAt) {
          const yaw = g.camera.rotation.y + Math.PI;

          const x = c.x + Math.sin(yaw) * 10;
          const z = c.z + Math.cos(yaw) * 10;

          g.monster.soundAt("mimic", x, z);
        }

        break;
      }

      case "flashlightWarning": {
        if (
          g.monster &&
          g.monster.startFlickerWarning
        ) {
          g.monster.startFlickerWarning();
        }

        break;
      }
    }
  }

  // ================================================
  // EVENT EXECUTION
  // ================================================

  _executeEvent(type, monster, turnSpeed = 0) {
    const p = this.player;
    const g = p.g;

    if (
      !g ||
      !g.camera ||
      g.dead ||
      !monster ||
      !monster.active
    ) {
      return;
    }

    const level = this.normalized;
    const c = g.camera.position;

    this._rememberEvent(type);

    switch (type) {
      // --------------------------------
      // 1. SENSORY OVERLOAD
      // --------------------------------

      case "sensoryOverload": {
        if (g.audio && g.audio.whisper) {
          g.audio.whisper(c, 0);
        }

        if (g.glitch) {
          g.glitch();
        }

        if (monster.addFury) {
          monster.addFury(p.id || "local", 0.15);
        }

        break;
      }

      // --------------------------------
      // 2. PARANOIA DROP
      // --------------------------------

      case "paranoiaDrop": {
        const backwardYaw =
          g.camera.rotation.y + Math.PI;

        const dropX =
          c.x + Math.sin(backwardYaw) * 2;

        const dropZ =
          c.z + Math.cos(backwardYaw) * 2;

        if (
          g.world &&
          g.world.collides &&
          !g.world.collides(dropX, dropZ, 0.1)
        ) {
          if (g.goo && g.goo.pool) {
            g.goo.pool(dropX, dropZ, 0.8);
          }

          if (monster.soundAt) {
            monster.soundAt(
              "mimic",
              dropX,
              dropZ
            );
          }
        }

        break;
      }

      // --------------------------------
      // 3. FLASHLIGHT BURNOUT
      // --------------------------------

      case "flashlightBurnout": {
        if (monster.startFlickerWarning) {
          monster.startFlickerWarning();
        }

        // Trigger a brief visual interference without
        // overwriting the actual battery charge.
        this._setVisualBatteryOverride(
          0.02,
          0.4
        );

        break;
      }

      // --------------------------------
      // 4. WHIPLASH
      // --------------------------------

      case "whiplash": {
        const backwardYaw =
          g.camera.rotation.y + Math.PI;

        const fakeX =
          c.x + Math.sin(backwardYaw) * 15;

        const fakeZ =
          c.z + Math.cos(backwardYaw) * 15;

        if (monster.soundAt) {
          monster.soundAt(
            "mimic",
            fakeX,
            fakeZ
          );
        }

        break;
      }

      // --------------------------------
      // 5. DOPPELGANGER ECHO
      // --------------------------------

      case "doppelgangerEcho": {
        const side =
          Math.random() < 0.5 ? -1 : 1;

        const echoX = c.x + side * 4;
        const echoZ = c.z + side * 4;

        // The second echo is deliberately delayed.
        // It is processed through the update loop instead
        // of setTimeout, so it can be cancelled on reset.
        this.pendingEvents.push({
          type: "echoFollowup",
          remaining: 0.5 + Math.random() * 0.4,
          x: echoX,
          z: echoZ,
          warned: true
        });

        this.pendingEvents.push({
          type: "echoFollowup",
          remaining: 1.0 + Math.random() * 0.5,
          x: echoX,
          z: echoZ,
          warned: true
        });

        if (monster.soundAt) {
          monster.soundAt(
            "mimic",
            echoX,
            echoZ
          );
        }

        break;
      }

      // --------------------------------
      // 6. PHANTOM GLANCE
      // --------------------------------

      case "phantomGlance": {
        if (g.glitch) {
          g.glitch();
        }

        if (g.audio && g.audio.whisper) {
          g.audio.whisper(c, 0);
        }

        this._setVisualBatteryOverride(
          Math.random() * 0.3,
          0.2
        );

        break;
      }

      // --------------------------------
      // 7. NEARBY THREAT
      // --------------------------------

      case "nearbyThreat": {
        // A sound behind the player, adjusted by threat.
        const yaw =
          g.camera.rotation.y + Math.PI;

        const distance =
          5 + Math.random() * 7 *
          (1 - this.monsterThreat);

        const x =
          c.x + Math.sin(yaw) * distance;

        const z =
          c.z + Math.cos(yaw) * distance;

        if (monster.soundAt) {
          monster.soundAt("mimic", x, z);
        }

        // Strong nearby threat can subtly intensify hunting.
        if (
          this.monsterThreat > 0.8 &&
          monster.addFury
        ) {
          monster.addFury(
            p.id || "local",
            0.05
          );
        }

        break;
      }

      // --------------------------------
      // 8. BEHAVIORAL PARANOIA
      // --------------------------------

      case "behavioralParanoia": {
        // Repeatedly checking behind causes a sound
        // to occur somewhere the player isn't looking.
        const direction =
          this.profile.lastTurnDirection || 1;

        const yaw =
          g.camera.rotation.y +
          direction * Math.PI * 0.5;

        const distance = 8 + Math.random() * 6;

        const x =
          c.x + Math.sin(yaw) * distance;

        const z =
          c.z + Math.cos(yaw) * distance;

        if (monster.soundAt) {
          monster.soundAt("mimic", x, z);
        }

        break;
      }

      // --------------------------------
      // 10. DON'T LOOK BACK
      // --------------------------------

      case "dontLookBack": {
        // Put the mechanic into the organically 'approaching' phase
        this.dlbState = 'approaching';
        this.dlbTimer = 25.0; // The monster has 25 seconds to organically sneak up
        
        // Command the monster's AI to stop retreating and start stalking the player
        if (monster.change) monster.change('STALK');
        monster.retreat = false; 
        break;
      }

      // --------------------------------
      // 9. FALSE REASSURANCE
      // --------------------------------

      case "falseReassurance": {
        // Nothing visibly attacks the player.
        // The game deliberately gives them a quiet moment.
        this._beginReassurance();

        break;
      }

      // --------------------------------
      // DELAYED ECHO
      // --------------------------------

      case "echoFollowup": {
        // Handled in _updatePendingEvents.
        break;
      }
    }
  }

  // ================================================
  // PENDING EVENT PROCESSOR
  // ================================================

  // This replaces setTimeout-based event scheduling.
  // It is called by update(), including after frame stalls.

  _processPendingFollowups(dt) {
    // Reserved for future event extensions.
    // Main pending events are handled in _updatePendingEvents.
  }

  // ================================================
  // VISUAL BATTERY INTERFERENCE
  // ================================================

  _setVisualBatteryOverride(value, duration) {
    this.visualBatteryOverride = Math.max(
      0,
      Math.min(1, value)
    );

    this.visualBatteryTimer = Math.min(
      this.maxVisualBatteryDuration,
      Math.max(0, duration)
    );

    const g = this.player.g;

    if (g && g.flash) {
      // UI can optionally display this temporary value.
      // g.flash.battery remains the real battery charge.
      g.flash.stressVisualBattery =
        this.visualBatteryOverride;
    }
  }

  _updateVisualInterference(dt) {
    if (this.visualBatteryTimer <= 0) return;

    this.visualBatteryTimer -= dt;

    if (this.visualBatteryTimer <= 0) {
      this.visualBatteryTimer = 0;
      this.visualBatteryOverride = null;

      const g = this.player.g;

      if (g && g.flash) {
        g.flash.stressVisualBattery = null;
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
    this.eventCooldown = 15.0;

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

    this.reassuranceTime = 0;
    this.reassuranceActive = false;
    this.reassuranceDuration = 0;

    this.visualBatteryOverride = null;
    this.visualBatteryTimer = 0;

    this.dlbState = 'inactive';
    this.dlbTimer = 0;
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

    if (g && g.flash) {
      g.flash.stressVisualBattery = null;
    }

    this.player.stress = 0;
  }

  add(amount) {
    this.value = Math.max(
      0,
      Math.min(
        this.maxStress,
        this.value + amount
      )
    );

    this.player.stress = this.value;
  }

  remove(amount) {
    this.value = Math.max(
      0,
      Math.min(
        this.maxStress,
        this.value - amount
      )
    );

    this.player.stress = this.value;
  }

  get normalized() {
    return this.value / this.maxStress;
  }

  get panicking() {
    return this.value >= 95;
  }
}
