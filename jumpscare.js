// jumpscare.js
// Zero-Stutter 3D Real-Monster Executions, Cooldown-Gated False Jumpscares & Abyssal Scream Engine

import * as THREE from 'three';

const FALSE_SCARE_MIN_COOLDOWN = 110000; // 110 seconds minimum between false jumpscares
const FALSE_SCARE_VAR_COOLDOWN = 50000;  // +0 to 50s random variance (110s - 160s total)
const SPAWN_GRACE_PERIOD       = 35000;  // No false jumpscares in the first 35s of a level

export class JumpscareSystem {
  constructor(game) {
    this.g = game;
    this.active = false;
    this.falseActive = false;
    this.duration = 3800;

    // Hard cooldown timestamp (ms) so false jumpscares can NEVER double-fire or spam
    this.falseCooldownUntil = performance.now() + SPAWN_GRACE_PERIOD;
    this.lastFalseTime = -999999;

    this._raf = 0;
    this._falseRaf = 0;
    this._phantom = null;
    this._camOverride = null;
    this._savedCam = null;

    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._camDir = new THREE.Vector3();

    this._execOverlay = null;
    this._falseOverlay = null;

    this._distCurve = null;
    this._noiseBuf = null;
    this._snapBuf = null;

    this._createStyleAndOverlays();
    this._hookGameSystems();

    setTimeout(() => this._prewarm(), 250);
  }

  _prewarm() {
    if (!this.g?.monster?.body) return;
    this._getOrBuildPhantomMonster();
    this._getDistortionCurve();
  }

  /** Returns true only when a false jumpscare is off cooldown and no scare is currently active. */
  canTriggerFalse(force = false) {
    if (this.active || this.falseActive || this.g?.dead) return false;
    if (force) return true;
    const now = performance.now();
    if (now < this.falseCooldownUntil) return false;
    if (now - this.lastFalseTime < FALSE_SCARE_MIN_COOLDOWN) return false;
    return true;
  }

  _hookGameSystems() {
    const g = this.g;
    if (!g || g._realMonsterKillHooked) return;
    g._realMonsterKillHooked = true;

    // 1. Hook Player.update(dt) so camera overrides apply cleanly after normal movement
    if (g.player && !g.player._jumpscareHooked) {
      g.player._jumpscareHooked = true;
      const origPlayerUpdate = g.player.update.bind(g.player);
      g.player.update = (dt) => {
        if ((this.falseActive && this._camOverride?.lockMove) || this.active) {
          g.player.moving = false;
        } else {
          origPlayerUpdate(dt);
        }
        if (this._camOverride && g.camera) {
          this._applyCameraPose(g.camera, this._camOverride);
        }
      };
    }

    // 2. Hook Flashlight.update(dt) to tint existing fill light crimson without adding new PointLights
    if (g.flash && !g.flash._jumpscareHooked) {
      g.flash._jumpscareHooked = true;
      const origFlashUpdate = g.flash.update.bind(g.flash);
      g.flash.update = (dt) => {
        origFlashUpdate(dt);
        if (this.active || this.falseActive) {
          g.flash.fill.color.setHex(0xff2208);
          g.flash.fill.distance = 7.5;
          g.flash.fill.intensity = 5.2;
        }
      };
    }

    // 3. Hook Game.respawn() to reset camera and grant a 35s grace period
    if (g.respawn) {
      const origRespawn = g.respawn.bind(g);
      g.respawn = (seed) => {
        this._forceResetCamera();
        this.falseCooldownUntil = performance.now() + SPAWN_GRACE_PERIOD;
        origRespawn(seed);
      };
    }

    // 4. Override Game.killPlayer() for the 3.8s 3D execution
    g.killPlayer = () => {
      if (g.dead) return;
      g.dead = true;
      this._forceResetCamera();

      const legacy = document.getElementById('jumpscare');
      if (legacy) {
        legacy.classList.remove('active');
        legacy.style.display = 'none';
      }

      const startEl = document.getElementById('start');
      document.body.classList.add('in-execution');
      try { g.player.controls.unlock(); } catch (_) {}
      if (startEl) startEl.classList.add('hidden');

      if (g.mp?.coop) {
        g.mp.die();
        g.onPlayerDeath(g.mp.peer?.id || 'local');
      }

      this.trigger({
        onComplete: () => {
          document.body.classList.remove('in-execution');
          this._forceResetCamera();
          if (!g.dead) return;
          if (g.mp?.coop) g.mp.spectate();
          else g.respawn();
        }
      });
    };
  }

  _restoreFlashlightFill() {
    const f = this.g?.flash;
    if (f?.fill) {
      f.fill.color.setHex(0xffe8bd);
      f.fill.distance = 3;
      f.fill.intensity = f.on ? 0.5 : 0;
    }
  }

  _applyCameraPose(cam, pose) {
    if (!cam || !pose) return;
    if (pose.x !== undefined) cam.position.x = pose.x;
    if (pose.y !== undefined) cam.position.y = pose.y;
    if (pose.z !== undefined) cam.position.z = pose.z;

    cam.rotation.order = 'YXZ';
    cam.rotation.set(
      pose.pitch ?? cam.rotation.x,
      pose.yaw ?? cam.rotation.y,
      pose.roll ?? 0,
      'YXZ'
    );
    cam.quaternion.setFromEuler(cam.rotation);
  }

  _forceResetCamera() {
    cancelAnimationFrame(this._raf);
    cancelAnimationFrame(this._falseRaf);
    this._raf = 0;
    this._falseRaf = 0;
    this._camOverride = null;
    this._restoreFlashlightFill();

    if (this._phantom) {
      this._phantom.grp.visible = false;
    }
    if (this._execOverlay) {
      this._execOverlay.className = 'exec-overlay';
    }
    if (this._falseOverlay) {
      this._falseOverlay.className = 'false-scare-overlay';
    }

    const cam = this.g?.camera;
    if (!cam) return;

    this._euler.setFromQuaternion(cam.quaternion, 'YXZ');
    const cleanYaw = this._savedCam ? this._savedCam.yaw : this._euler.y;
    const cleanPitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this._savedCam ? this._savedCam.pitch : this._euler.x));

    cam.rotation.order = 'YXZ';
    cam.rotation.set(cleanPitch, cleanYaw, 0, 'YXZ');
    cam.quaternion.setFromEuler(cam.rotation);
    cam.position.y = 1.62;
    this._savedCam = null;
  }

  _getOrBuildPhantomMonster() {
    const g = this.g;
    const m = g?.monster;
    if (!m || !m.body) return null;
    if (this._phantom) return this._phantom;

    const grp = new THREE.Group();
    grp.visible = false;
    grp.frustumCulled = false;
    g.scene.add(grp);

    const bodyClone = m.body.clone(true);
    const phBodyMat = m.voidMat ? m.voidMat(0) : m.bodyMat.clone();
    const phLimbMat = m.voidMat ? m.voidMat(1) : m.limbMat.clone();
    const phEyeMat = m.eyeMat ? m.eyeMat.clone() : null;

    bodyClone.traverse(node => {
      node.frustumCulled = false;
      if (node.isMesh) {
        node.material = (node.material === m.limbMat) ? phLimbMat : phBodyMat;
      } else if (node.isSprite && phEyeMat) {
        node.material = phEyeMat;
      }
    });

    grp.add(bodyClone);

    const torsoPivot = bodyClone.children[0];
    const headBone = torsoPivot?.children.find(c => c.type === 'Group' && c.position.y > 1.3);
    const jaw = headBone?.children.find(c => c.type === 'Group');
    const armGroups = torsoPivot?.children.filter(c => c.type === 'Group' && Math.abs(c.position.x) > 0.2) || [];
    const arms = armGroups.map(shoulder => ({
      shoulder,
      elbow: shoulder.children.find(c => c.type === 'Group'),
      sx: Math.sign(shoulder.position.x) || 1
    }));
    const legGroups = bodyClone.children.filter(c => c.type === 'Group' && c !== torsoPivot);
    const legs = legGroups.map(hip => ({
      hip,
      knee: hip.children.find(c => c.type === 'Group'),
      sx: Math.sign(hip.position.x) || 1
    }));
    const eyes = [];
    if (headBone) {
      headBone.traverse(n => { if (n.isSprite) eyes.push(n); });
    }

    this._phantom = {
      grp, bodyClone, torsoPivot, headBone, jaw, arms, legs, eyes,
      phBodyMat, phLimbMat, phEyeMat, stride: 0
    };
    return this._phantom;
  }

  _setPhantomVisibility(ph, opacity = 0.98) {
    if (!ph) return;
    ph.phBodyMat.visible = opacity > 0.01;
    ph.phLimbMat.visible = opacity > 0.01;
    ph.phBodyMat.opacity = opacity;
    ph.phLimbMat.opacity = opacity;
    if (ph.phEyeMat) ph.phEyeMat.opacity = Math.min(1, opacity * 1.15);
    for (const e of ph.eyes) {
      e.visible = opacity > 0.01;
      e.scale.setScalar(0.155);
    }
  }

  _poseMonsterRig(rig, opts) {
    const {
      torsoPitch = 0.25,
      torsoRoll = 0,
      torsoY = 1.15,
      headPitch = 0,
      headYaw = 0,
      headRoll = 0,
      jawOpen = 0.65,
      armPitchL = -1.2,
      armPitchR = -1.2,
      armRollL = -0.25,
      armRollR = 0.25,
      elbowPitchL = -0.65,
      elbowPitchR = -0.65,
      strideSpeed = 0,
      dt = 0.016
    } = opts;

    const torso = rig.torsoPivot;
    const head = rig.headBone;
    const jaw = rig.jaw;
    const arms = rig.arms;
    const legs = rig.legs;

    if (torso) {
      torso.position.y = torsoY;
      torso.rotation.set(torsoPitch, 0, torsoRoll);
    }
    if (head) head.rotation.set(headPitch, headYaw, headRoll);
    if (jaw) jaw.rotation.x = jawOpen;

    if (arms && arms.length >= 2) {
      const aL = arms[0].sx < 0 ? arms[0] : arms[1];
      const aR = arms[0].sx > 0 ? arms[0] : arms[1];
      aL.shoulder.rotation.set(armPitchL, 0, armRollL);
      if (aL.elbow) aL.elbow.rotation.x = elbowPitchL;
      aR.shoulder.rotation.set(armPitchR, 0, armRollR);
      if (aR.elbow) aR.elbow.rotation.x = elbowPitchR;
    }
    if (legs && legs.length >= 2) {
      if (strideSpeed > 0) {
        rig.stride = (rig.stride || 0) + dt * strideSpeed;
        for (let i = 0; i < 2; i++) {
          const leg = legs[i];
          const ph = rig.stride + i * Math.PI;
          const s = Math.sin(ph), cs = Math.cos(ph);
          leg.hip.rotation.x = s * 0.65 - Math.max(0, cs) * 0.35;
          if (leg.knee) leg.knee.rotation.x = 0.2 + Math.max(0, cs) * 0.95;
        }
      } else {
        for (let i = 0; i < 2; i++) {
          legs[i].hip.rotation.x = -0.12;
          if (legs[i].knee) legs[i].knee.rotation.x = 0.24;
        }
      }
    }
  }

  // ==========================================================================
  // 1. FATAL 3D EXECUTIONS USING THE REAL `g.monster` MODEL
  // ==========================================================================
  trigger(options = {}) {
    if (this.active) return;
    this.falseActive = false;
    this._forceResetCamera();
    this.active = true;

    const g = this.g;
    const cam = g?.camera;
    const m = g?.monster;
    if (!cam || !m) return;

    const types = ['CHOKE_HANG', 'SKULL_SLAM', 'ANKLE_DRAG', 'JAW_RIP'];
    const type = options.type || types[Math.floor(Math.random() * types.length)];

    m.active = true;
    m.group.visible = true;
    m.freeze = 10.0;
    m.bodyMat.opacity = 1;
    m.limbMat.opacity = 1;
    m.bodyMat.visible = true;
    m.limbMat.visible = true;
    m.eyeMat.opacity = 1;
    for (const e of m.eyes) {
      e.visible = true;
      e.scale.setScalar(0.15);
    }

    this._euler.setFromQuaternion(cam.quaternion, 'YXZ');
    const startX = cam.position.x;
    const startY = 1.62;
    const startZ = cam.position.z;
    this._savedCam = { yaw: this._euler.y, pitch: this._euler.x };

    cam.getWorldDirection(this._camDir);
    this._camDir.y = 0;
    if (this._camDir.lengthSq() < 0.001) this._camDir.set(0, 0, -1);
    this._camDir.normalize();

    let dirX = this._camDir.x, dirZ = this._camDir.z;
    if (g.world?.collides(startX + dirX * 0.9, startZ + dirZ * 0.9, 0.2)) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!g.world.collides(startX + dx * 1.1, startZ + dz * 1.1, 0.2)) {
          dirX = dx; dirZ = dz;
          break;
        }
      }
    }

    const monsterYawToPlayer = Math.atan2(-dirX, -dirZ);
    const playerYawToMonster = Math.atan2(-dirX, -dirZ);

    const overlay = this._execOverlay;
    overlay.className = 'exec-overlay active';

    this._playAbyssalScream(1.0, 3.6);
    g.glitch?.();

    let lastTime = performance.now();
    let elapsed = 0;
    let hit1 = false, hit2 = false, floorHit = false;
    let curYaw = this._euler.y;

    const animate = (now) => {
      const rawDt = (now - lastTime) * 0.001;
      lastTime = now;
      const dt = Math.max(0.001, Math.min(rawDt, 0.033));
      elapsed += dt * 1000;

      const u = Math.min(1, elapsed / this.duration);
      const s = elapsed * 0.001;

      m.t += dt;
      m.U.uTime.value = m.t;
      m.U.uWarp.value = 3.0;
      m.U.uShudder.value = 3.6;

      for (let i = 0; i < m.puffs.length; i++) {
        const sp = m.puffs[i];
        sp.visible = true;
        const ud = sp.userData;
        ud.life = (ud.life + dt / ud.dur) % 1;
        const L = ud.life;
        sp.position.set(Math.cos(ud.a + s * 2.4) * ud.r, ud.y0 + L * ud.rise, Math.sin(ud.a + s * 2.4) * ud.r);
        sp.scale.setScalar(ud.size * (0.85 + L));
        sp.material.opacity = Math.sin(L * Math.PI) * 0.58;
      }

      let poseX = startX, poseY = startY, poseZ = startZ;
      let posePitch = 0, poseRoll = 0;
      curYaw += Math.atan2(Math.sin(playerYawToMonster - curYaw), Math.cos(playerYawToMonster - curYaw)) * Math.min(1, dt * 24);
      let poseYaw = curYaw;

      if (type === 'CHOKE_HANG') {
        m.pos.set(startX + dirX * 0.76, 0, startZ + dirZ * 0.76);
        m.group.rotation.y = monsterYawToPlayer;

        if (u < 0.16) {
          const p = u / 0.16;
          posePitch = 0.14 * p;
          poseRoll = Math.sin(s * 60) * 0.09;
          this._poseMonsterRig(m, {
            torsoPitch: 0.35, headPitch: 0.1, headRoll: Math.sin(s * 35) * 0.3,
            jawOpen: 0.85, armPitchL: -1.55 * p, armPitchR: -1.55 * p,
            armRollL: -0.18, armRollR: 0.18, elbowPitchL: -0.45, elbowPitchR: -0.45
          });
        } else if (u < 0.56) {
          const p = (u - 0.16) / 0.40;
          const lift = Math.sin(p * Math.PI * 0.5);
          poseX = startX + Math.sin(s * 48) * 0.035;
          poseZ = startZ + Math.cos(s * 44) * 0.035;
          poseY = startY + lift * 0.85;
          poseYaw = playerYawToMonster + Math.sin(s * 32) * 0.09;
          posePitch = -0.34 * lift + Math.sin(s * 40) * 0.07;
          poseRoll = Math.sin(s * 24) * 0.15;

          this._poseMonsterRig(m, {
            torsoPitch: -0.14 * lift, torsoY: 1.15 + lift * 0.14,
            headPitch: -0.5 * lift, headRoll: Math.sin(s * 20) * 0.58,
            jawOpen: 0.72 + Math.sin(s * 32) * 0.25,
            armPitchL: -2.1, armPitchR: -2.1, armRollL: 0.12, armRollR: -0.12,
            elbowPitchL: -0.35, elbowPitchR: -0.35
          });
          if (!hit1) { hit1 = true; overlay.classList.add('blood-active'); }
        } else if (u < 0.66) {
          if (!hit2) {
            hit2 = true;
            this._playBoneSnapSound();
            this._playAbyssalScream(0.85, 1.2);
            overlay.classList.add('crack-active');
            g.glitch?.();
          }
          const p = (u - 0.56) / 0.10;
          poseY = startY + 0.85;
          poseRoll = p * 1.42;
          posePitch = -0.34 + p * 0.68;

          this._poseMonsterRig(m, {
            torsoPitch: 0.25, headPitch: 0.2, headRoll: -0.8, jawOpen: 0.95,
            armPitchL: -1.6, armPitchR: -2.2, armRollL: -0.55, armRollR: 0.45
          });
        } else {
          const p = Math.min(1, (u - 0.66) / 0.16);
          const fall = p * p;
          poseY = (startY + 0.85) * (1 - fall) + 0.13 * fall;
          posePitch = 0.34 * (1 - fall) + 0.22 * fall;
          poseRoll = 1.42 * (1 - fall) + 1.28 * fall;
          poseYaw = playerYawToMonster;

          this._poseMonsterRig(m, {
            torsoPitch: 0.48, headPitch: 0.55, headRoll: 0.68, jawOpen: 0.38,
            armPitchL: -0.45, armPitchR: -0.45, elbowPitchL: -0.3, elbowPitchR: -0.3
          });
          if (p >= 0.92 && !floorHit) {
            floorHit = true;
            this._playImpactThud(1.6);
            overlay.classList.add('dropped-active');
          }
        }

      } else if (type === 'SKULL_SLAM') {
        m.pos.set(startX + dirX * 0.8, 0, startZ + dirZ * 0.8);
        m.group.rotation.y = monsterYawToPlayer;

        if (u < 0.16) {
          const p = u / 0.16;
          this._poseMonsterRig(m, {
            torsoPitch: 0.4, headPitch: 0.15, headRoll: -0.5, jawOpen: 0.85,
            armPitchL: -1.55 * p, armPitchR: -1.55 * p, armRollL: 0.22, armRollR: -0.22,
            elbowPitchL: -0.75, elbowPitchR: -0.75
          });
        } else if (u < 0.38) {
          const p = (u - 0.16) / 0.22;
          const down = p < 0.55 ? (p / 0.55) ** 2 : 1 - ((p - 0.55) / 0.45) * 0.72;
          poseY = startY * (1 - down) + 0.18 * down;
          posePitch = -down * 0.95;
          poseRoll = down * 0.38;

          this._poseMonsterRig(m, {
            torsoPitch: 0.35 + down * 0.75, torsoY: 1.15 - down * 0.35,
            headPitch: 0.3, jawOpen: 0.88,
            armPitchL: -1.55 + down * 0.65, armPitchR: -1.55 + down * 0.65
          });
          if (p >= 0.52 && !hit1) {
            hit1 = true;
            this._playImpactThud(1.45);
            overlay.classList.add('blood-active');
          }
        } else if (u < 0.64) {
          const p = (u - 0.38) / 0.26;
          const down = p < 0.6 ? (p / 0.6) ** 2 : 1;
          poseY = (startY * 0.72) * (1 - down) + 0.12 * down;
          posePitch = 0.15 * (1 - down) - 0.65 * down;
          poseRoll = -down * 1.15;

          this._poseMonsterRig(m, {
            torsoPitch: 0.3 + down * 0.85, torsoY: 1.15 - down * 0.42,
            headPitch: 0.4, headRoll: 0.75, jawOpen: 0.98,
            armPitchL: -1.6 + down * 0.8, armPitchR: -1.6 + down * 0.8
          });
          if (p >= 0.56 && !hit2) {
            hit2 = true;
            this._playImpactThud(1.75);
            this._playBoneSnapSound();
            overlay.classList.add('crack-active');
            g.glitch?.();
          }
        } else {
          const p = (u - 0.64) / 0.36;
          poseY = 0.13;
          posePitch = -0.65 * (1 - p) + 0.24 * p;
          poseRoll = -1.15 * (1 - p) - 1.34 * p;
          poseYaw = playerYawToMonster;

          this._poseMonsterRig(m, {
            torsoPitch: 1.15 * (1 - p) + 0.28 * p, torsoY: 0.73 * (1 - p) + 1.15 * p,
            headPitch: 0.55, headRoll: -0.65, jawOpen: 0.45,
            armPitchL: -0.5, armPitchR: -0.5
          });
          if (!floorHit) { floorHit = true; overlay.classList.add('dropped-active'); }
        }

      } else if (type === 'ANKLE_DRAG') {
        if (u < 0.18) {
          const p = (u / 0.18) ** 2;
          poseY = startY * (1 - p) + 0.16 * p;
          posePitch = p * 0.38;
          poseRoll = -p * 0.28;

          m.pos.set(startX + dirX * 2.1, 0, startZ + dirZ * 2.1);
          m.group.rotation.y = monsterYawToPlayer;
          this._poseMonsterRig(m, {
            torsoPitch: 0.55, headPitch: 0.45, jawOpen: 0.75,
            armPitchL: -1.2, armPitchR: -1.2
          });
          if (p >= 0.88 && !hit1) { hit1 = true; this._playImpactThud(1.5); }
        } else if (u < 0.62) {
          const p = (u - 0.18) / 0.44;
          const dist = 2.1 * (1 - p) + 0.68 * p;
          m.pos.set(startX + dirX * dist, 0, startZ + dirZ * dist);
          m.group.rotation.y = monsterYawToPlayer;

          poseY = 0.16 + Math.abs(Math.sin(s * 36)) * 0.04;
          posePitch = 0.38 + p * 0.22 + Math.sin(s * 30) * 0.06;
          poseRoll = -0.28 + Math.cos(s * 28) * 0.14;
          poseYaw = playerYawToMonster + Math.sin(s * 22) * 0.08;

          this._poseMonsterRig(m, {
            torsoPitch: 0.68, torsoY: 1.05, headPitch: 0.45,
            headRoll: Math.sin(s * 18) * 0.65, jawOpen: 0.88,
            armPitchL: -1.45, armPitchR: -1.45, strideSpeed: 13, dt
          });
        } else if (u < 0.78) {
          m.pos.set(startX + dirX * 0.58, 0, startZ + dirZ * 0.58);
          this._poseMonsterRig(m, {
            torsoPitch: 1.28, torsoY: 0.62, headPitch: 0.25,
            headRoll: -0.45, jawOpen: 1.0, armPitchL: -1.65, armPitchR: -1.65
          });
          poseY = 0.15;
          posePitch = 0.58;
          poseRoll = Math.sin(s * 55) * 0.35;
          if (!hit2) {
            hit2 = true;
            this._playBoneSnapSound();
            this._playAbyssalScream(0.9, 1.3);
            overlay.classList.add('blood-active', 'crack-active');
            g.glitch?.();
          }
        } else {
          const p = (u - 0.78) / 0.22;
          poseY = 0.12;
          posePitch = 0.60 * (1 - p) + 0.18 * p;
          poseRoll = 1.36 * p;
          overlay.classList.add('dropped-active');
        }

      } else {
        // JAW_RIP
        m.pos.set(startX + dirX * 0.72, 0, startZ + dirZ * 0.72);
        m.group.rotation.y = monsterYawToPlayer;

        if (u < 0.58) {
          const p = u / 0.58;
          posePitch = 0.18 + Math.sin(s * 42) * 0.14;
          poseRoll = Math.cos(s * 38) * 0.24;
          const slash = Math.sin(s * 26);

          this._poseMonsterRig(m, {
            torsoPitch: 0.32, headPitch: 0.15, headRoll: slash * 0.58,
            jawOpen: 0.88 + Math.sin(s * 34) * 0.2,
            armPitchL: -1.65 + slash * 0.55, armPitchR: -1.65 - slash * 0.55,
            armRollL: -0.3 + slash * 0.25, armRollR: 0.3 + slash * 0.25,
            elbowPitchL: -0.55, elbowPitchR: -0.55
          });
          if (p > 0.26 && !hit1) {
            hit1 = true;
            this._playBoneSnapSound();
            overlay.classList.add('blood-active');
          }
          if (p > 0.62 && !hit2) {
            hit2 = true;
            this._playBoneSnapSound();
            overlay.classList.add('crack-active');
          }
        } else {
          const p = (u - 0.58) / 0.42;
          const bounce = p < 0.45
            ? (p / 0.45) ** 2
            : 1 - Math.abs(Math.sin((p - 0.45) * Math.PI * 2.5)) * 0.18 * (1 - p);
          poseY = startY * (1 - bounce) + 0.13 * bounce;
          posePitch = 0.22 * bounce;
          poseRoll = 1.32 * bounce;

          this._poseMonsterRig(m, {
            torsoPitch: 0.45, headPitch: 0.52, headRoll: 0.72, jawOpen: 0.42,
            armPitchL: -0.5, armPitchR: -0.5
          });
          if (p > 0.44 && !floorHit) {
            floorHit = true;
            this._playImpactThud(1.6);
            overlay.classList.add('dropped-active');
          }
        }
      }

      this._camOverride = { x: poseX, y: poseY, z: poseZ, yaw: poseYaw, pitch: posePitch, roll: poseRoll, lockMove: true };
      this._applyCameraPose(cam, this._camOverride);

      if (u < 1) {
        this._raf = requestAnimationFrame(animate);
      } else {
        this.active = false;
        this._forceResetCamera();
        if (typeof options.onComplete === 'function') {
          options.onComplete();
        } else if (options.isTest) {
          m.reset();
        }
      }
    };

    this._raf = requestAnimationFrame(animate);
  }

  // ==========================================================================
  // 2. COOLDOWN-GATED, SINGLE-INSTANCE FALSE JUMPSCARES (ZERO DOUBLE-TRIGGERS)
  // ==========================================================================
  triggerFalse(variant = null, force = false) {
    // Hard mutex + 110-160s cooldown check so two false jumpscares can NEVER overlap or fire back-to-back!
    if (!this.canTriggerFalse(force)) return false;

    const g = this.g;
    const cam = g?.camera;
    const m = g?.monster;
    if (!cam || !m) return false;

    const ph = this._getOrBuildPhantomMonster();
    if (!ph) return false;

    // Lock mutex & arm the 110–160s cooldown immediately BEFORE starting the animation!
    this.falseActive = true;
    const nowMs = performance.now();
    this.lastFalseTime = nowMs;
    this.falseCooldownUntil = nowMs + FALSE_SCARE_MIN_COOLDOWN + Math.random() * FALSE_SCARE_VAR_COOLDOWN;
    cancelAnimationFrame(this._falseRaf);

    const types = ['phantom_stalk_rush', 'blindspot_grab', 'ankle_drag_hallucination', 'ceiling_drop_ambush'];
    const chosen = variant || types[Math.floor(Math.random() * types.length)];
    const dur = chosen === 'ankle_drag_hallucination' ? 3200
      : chosen === 'phantom_stalk_rush' ? 2850
      : chosen === 'ceiling_drop_ambush' ? 2500 : 2650;

    this._euler.setFromQuaternion(cam.quaternion, 'YXZ');
    const startX = cam.position.x;
    const startY = 1.62;
    const startZ = cam.position.z;
    this._savedCam = { yaw: this._euler.y, pitch: this._euler.x };

    cam.getWorldDirection(this._camDir);
    this._camDir.y = 0;
    if (this._camDir.lengthSq() < 0.001) this._camDir.set(0, 0, -1);
    this._camDir.normalize();
    const fwdX = this._camDir.x, fwdZ = this._camDir.z;
    const facePlayerYaw = Math.atan2(-fwdX, -fwdZ);

    ph.grp.visible = true;
    this._setPhantomVisibility(ph, 0.98);

    const fOverlay = this._falseOverlay;
    fOverlay.className = 'false-scare-overlay active';

    this._playFalseScareAudioSequence(chosen, dur / 1000);
    g.glitch?.();

    let lastTime = performance.now();
    let elapsed = 0;
    let climaxScreamFired = false;

    const animateFalse = (now) => {
      if (this.active || g.dead || !this.falseActive) {
        this.falseActive = false;
        this._forceResetCamera();
        return;
      }

      const rawDt = (now - lastTime) * 0.001;
      lastTime = now;
      const dt = Math.max(0.001, Math.min(rawDt, 0.033));
      elapsed += dt * 1000;

      const u = Math.min(1, elapsed / dur);
      const s = elapsed * 0.001;

      m.t += dt;
      m.U.uTime.value = m.t;
      m.U.uWarp.value = 2.8;
      m.U.uShudder.value = 3.2;

      this._setPhantomVisibility(ph, u > 0.85 ? ((elapsed % 60 < 30) ? 0.9 : 0.15) : 0.98);

      const curX = cam.position.x;
      const curZ = cam.position.z;

      if (chosen === 'phantom_stalk_rush') {
        if (u < 0.48) {
          const p = u / 0.48;
          ph.grp.position.set(startX + fwdX * 5.8, 0, startZ + fwdZ * 5.8);
          ph.grp.rotation.y = facePlayerYaw;
          if (g.flash) g.flash.flk = Math.random() < 0.45 ? 0.06 : 0.7;

          this._poseMonsterRig(ph, {
            torsoPitch: 0.24, headPitch: 0.12,
            headRoll: Math.sin(p * Math.PI * 5) > 0 ? 0.85 : -0.82,
            jawOpen: 0.35 + p * 0.45,
            armPitchL: -0.4, armPitchR: -0.4
          });
          this._camOverride = {
            y: startY,
            pitch: this._savedCam.pitch + Math.sin(s * 24) * 0.015,
            roll: Math.sin(s * 18) * 0.03,
            lockMove: false
          };
        } else {
          if (!climaxScreamFired) {
            climaxScreamFired = true;
            this._playAbyssalScream(0.95, 1.45);
            fOverlay.classList.add('climax');
            g.glitch?.();
          }
          const p = (u - 0.48) / 0.52;
          const ease = p ** 1.35;
          const dist = 5.8 * (1 - ease) + 0.52 * ease;
          ph.grp.position.set(curX + fwdX * dist, 0, curZ + fwdZ * dist);
          ph.grp.rotation.y = facePlayerYaw;

          this._poseMonsterRig(ph, {
            torsoPitch: 0.45, headPitch: 0.15,
            headRoll: Math.sin(s * 36) * 0.52,
            jawOpen: 0.98,
            armPitchL: -1.75, armPitchR: -1.75,
            elbowPitchL: -0.45, elbowPitchR: -0.45,
            strideSpeed: 20, dt
          });

          const shake = Math.sin(p * Math.PI);
          this._camOverride = {
            y: startY - shake * 0.08,
            yaw: this._savedCam.yaw + Math.sin(s * 55) * 0.06 * shake,
            pitch: this._savedCam.pitch + shake * 0.18,
            roll: Math.cos(s * 48) * 0.16 * shake,
            lockMove: true
          };
        }

      } else if (chosen === 'blindspot_grab') {
        const rightX = -fwdZ, rightZ = fwdX;
        ph.grp.position.set(
          startX + rightX * 0.54 - fwdX * 0.15,
          0,
          startZ + rightZ * 0.54 - fwdZ * 0.15
        );
        ph.grp.rotation.y = Math.atan2(-rightX, -rightZ);

        if (!climaxScreamFired) {
          climaxScreamFired = true;
          this._playAbyssalScream(0.92, 1.6);
          fOverlay.classList.add('climax');
        }

        const wrench = u < 0.18 ? (u / 0.18) : u < 0.80 ? 1.0 : Math.max(0, 1 - (u - 0.80) / 0.20);

        this._poseMonsterRig(ph, {
          torsoPitch: 0.38, headPitch: 0.2,
          headRoll: -0.68 + Math.sin(s * 28) * 0.28,
          jawOpen: 0.92,
          armPitchL: -1.62, armPitchR: -1.62,
          armRollL: -0.25, armRollR: 0.25,
          elbowPitchL: -0.58, elbowPitchR: -0.58
        });

        this._camOverride = {
          x: startX,
          y: startY - wrench * 0.06,
          z: startZ,
          yaw: this._savedCam.yaw - wrench * 1.35 + Math.sin(s * 45) * 0.05 * wrench,
          pitch: this._savedCam.pitch + wrench * 0.18 + Math.cos(s * 40) * 0.05 * wrench,
          roll: wrench * 0.26 * Math.cos(s * 20),
          lockMove: true
        };

      } else if (chosen === 'ceiling_drop_ambush') {
        if (!climaxScreamFired) {
          climaxScreamFired = true;
          this._playAbyssalScream(0.95, 1.5);
          fOverlay.classList.add('climax');
        }
        const drop = u < 0.18 ? (u / 0.18) ** 2 : u < 0.82 ? 1.0 : 1 - (u - 0.82) / 0.18;
        ph.grp.position.set(startX + fwdX * 0.72, (1 - drop) * 1.45, startZ + fwdZ * 0.72);
        ph.grp.rotation.y = facePlayerYaw;

        this._poseMonsterRig(ph, {
          torsoPitch: 0.65, headPitch: 0.35,
          headRoll: Math.sin(s * 32) * 0.75,
          jawOpen: 0.96,
          armPitchL: -1.85, armPitchR: -1.85,
          armRollL: -0.35, armRollR: 0.35,
          elbowPitchL: -0.4, elbowPitchR: -0.4
        });

        this._camOverride = {
          x: startX,
          y: startY - drop * 0.12,
          z: startZ,
          yaw: this._savedCam.yaw + Math.sin(s * 50) * 0.05 * drop,
          pitch: Math.min(0.65, this._savedCam.pitch + drop * 0.28),
          roll: Math.sin(s * 44) * 0.15 * drop,
          lockMove: true
        };

      } else {
        if (u < 0.18) {
          const p = (u / 0.18) ** 2;
          ph.grp.position.set(startX + fwdX * 3.6, 0, startZ + fwdZ * 3.6);
          ph.grp.rotation.y = facePlayerYaw;

          this._camOverride = {
            x: startX,
            y: startY * (1 - p) + 0.20 * p,
            z: startZ,
            yaw: this._savedCam.yaw,
            pitch: this._savedCam.pitch * (1 - p) + 0.36 * p,
            roll: p * 0.38,
            lockMove: true
          };
        } else if (u < 0.78) {
          const p = (u - 0.18) / 0.60;
          if (p > 0.55 && !climaxScreamFired) {
            climaxScreamFired = true;
            this._playAbyssalScream(0.92, 1.3);
            fOverlay.classList.add('climax');
          }
          const dist = 3.6 * (1 - p) + 0.72 * p;
          ph.grp.position.set(startX + fwdX * dist, 0, startZ + fwdZ * dist);
          ph.grp.rotation.y = facePlayerYaw;

          this._poseMonsterRig(ph, {
            torsoPitch: 0.48 + p * 0.42,
            headPitch: 0.42,
            headRoll: Math.sin(s * 16) * 0.58,
            jawOpen: 0.85,
            armPitchL: -1.45, armPitchR: -1.45,
            strideSpeed: 12, dt
          });

          this._camOverride = {
            x: startX,
            y: 0.20 + Math.abs(Math.sin(s * 30)) * 0.03,
            z: startZ,
            yaw: this._savedCam.yaw + Math.sin(s * 24) * 0.05,
            pitch: 0.36 + p * 0.18,
            roll: 0.38 + Math.sin(s * 22) * 0.1,
            lockMove: true
          };
        } else {
          const p = (u - 0.78) / 0.22;
          const inv = 1 - p;
          this._camOverride = {
            x: startX,
            y: 0.20 * inv + startY * p,
            z: startZ,
            yaw: this._savedCam.yaw,
            pitch: 0.54 * inv + this._savedCam.pitch * p,
            roll: 0.38 * inv,
            lockMove: true
          };
        }
      }

      if (u < 1) {
        this._falseRaf = requestAnimationFrame(animateFalse);
      } else {
        this.falseActive = false;
        this._forceResetCamera();
        this._playHauntingAftermath();
        g.glitch?.();
      }
    };

    this._falseRaf = requestAnimationFrame(animateFalse);
    return true;
  }

  // ==========================================================================
  // 3. PRE-BAKED AUDIO ENGINE
  // ==========================================================================
  _getAudioContext() {
    this.g?.audio?.init?.();
    const ctx = this.g?.audio?.ctx || this._fallbackCtx || new (window.AudioContext || window.webkitAudioContext)();
    this._fallbackCtx = ctx;
    if (ctx.state === 'suspended') ctx.resume();
    if (this.g?.audio?.master) {
      const t = ctx.currentTime;
      this.g.audio.master.gain.cancelScheduledValues(t);
      this.g.audio.master.gain.setValueAtTime(0.95, t);
    }
    this._ensureAudioBuffers(ctx);
    return ctx;
  }

  _ensureAudioBuffers(ctx) {
    if (!this._noiseBuf) {
      if (this.g?.audio?.noise) {
        this._noiseBuf = this.g.audio.noise;
      } else {
        const len = Math.floor(ctx.sampleRate * 0.5);
        this._noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = this._noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
    }
    if (!this._snapBuf) {
      const bufSize = Math.floor(ctx.sampleRate * 0.22);
      this._snapBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = this._snapBuf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.04));
      }
    }
  }

  _getDistortionCurve() {
    if (this._distCurve) return this._distCurve;
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(x * 6.5);
    }
    return (this._distCurve = curve);
  }

  _playAbyssalScream(volume = 1.0, dur = 2.2) {
    try {
      const ctx = this._getAudioContext();
      const now = ctx.currentTime;

      if (this.g?.audio?.roar && this.g?.camera) {
        this.g.audio.roar(this.g.camera.position);
      }

      const out = ctx.createGain();
      out.gain.setValueAtTime(Math.min(1.0, volume * 0.95), now);
      out.gain.exponentialRampToValueAtTime(0.008, now + dur);
      out.connect(ctx.destination);

      const shaper = ctx.createWaveShaper();
      shaper.curve = this._getDistortionCurve();
      shaper.oversample = 'none';
      shaper.connect(out);

      const sub = ctx.createOscillator();
      const subG = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(135, now);
      sub.frequency.exponentialRampToValueAtTime(21, now + Math.min(1.6, dur));
      subG.gain.setValueAtTime(1.1, now);
      subG.gain.exponentialRampToValueAtTime(0.01, now + dur);
      sub.connect(subG);
      subG.connect(out);
      sub.start(now);
      sub.stop(now + dur);

      const screamFreqs = [390, 820, 1780, 2950, 4100];
      for (let idx = 0; idx < screamFreqs.length; idx++) {
        const f = screamFreqs[idx];
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = idx % 2 === 0 ? 'sawtooth' : 'square';
        osc.frequency.setValueAtTime(f * 0.85, now);
        osc.frequency.linearRampToValueAtTime(f * 1.28, now + 0.12);
        osc.frequency.exponentialRampToValueAtTime(f * 0.42, now + dur * 0.92);

        const lfo = ctx.createOscillator();
        const lfoG = ctx.createGain();
        lfo.frequency.value = 26 + idx * 7;
        lfoG.gain.value = f * 0.09;
        lfo.connect(lfoG);
        lfoG.connect(osc.frequency);

        g.gain.setValueAtTime(0.24, now);
        g.gain.exponentialRampToValueAtTime(0.005, now + dur * 0.95);
        osc.connect(g);
        g.connect(shaper);

        osc.start(now);
        lfo.start(now);
        osc.stop(now + dur);
        lfo.stop(now + dur);
      }

      if (this._noiseBuf) {
        const noise = ctx.createBufferSource();
        noise.buffer = this._noiseBuf;
        noise.loop = true;
        const nDur = Math.min(1.4, dur);

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(2800, now);
        bp.frequency.exponentialRampToValueAtTime(750, now + nDur);
        bp.Q.value = 1.4;

        const nG = ctx.createGain();
        nG.gain.setValueAtTime(0.55, now);
        nG.gain.exponentialRampToValueAtTime(0.01, now + nDur);
        noise.connect(bp);
        bp.connect(nG);
        nG.connect(shaper);
        noise.start(now);
        noise.stop(now + nDur);
      }
    } catch (_) {}
  }

  _playHauntingAftermath() {
    try {
      const ctx = this._getAudioContext();
      const now = ctx.currentTime;

      const ring = ctx.createOscillator();
      const ringG = ctx.createGain();
      ring.type = 'sine';
      ring.frequency.setValueAtTime(3850, now);
      ringG.gain.setValueAtTime(0.001, now);
      ringG.gain.linearRampToValueAtTime(0.08, now + 0.08);
      ringG.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);
      ring.connect(ringG);
      ringG.connect(ctx.destination);
      ring.start(now);
      ring.stop(now + 3.3);

      [110, 116.5, 233].forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = i === 0 ? 'triangle' : 'sine';
        o.frequency.setValueAtTime(f, now);
        o.frequency.linearRampToValueAtTime(f * 0.94, now + 2.8);
        g.gain.setValueAtTime(0.001, now);
        g.gain.linearRampToValueAtTime(0.12 / (i + 1), now + 0.35);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 2.9);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(now);
        o.stop(now + 3.0);
      });

      if (this.g?.audio?.whisper && this.g?.camera) {
        this.g.audio.whisper(this.g.camera.position, 0.5);
      }
    } catch (_) {}
  }

  _playFalseScareAudioSequence(chosen, durSec) {
    try {
      const ctx = this._getAudioContext();
      const now = ctx.currentTime;

      if (chosen === 'phantom_stalk_rush') {
        [62, 93, 186, 440].forEach((f, i) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = i % 2 ? 'sawtooth' : 'triangle';
          osc.frequency.setValueAtTime(f, now);
          osc.frequency.exponentialRampToValueAtTime(f * 2.1, now + 1.38);
          g.gain.setValueAtTime(0.02, now);
          g.gain.exponentialRampToValueAtTime(0.22, now + 1.35);
          g.gain.exponentialRampToValueAtTime(0.001, now + durSec);
          osc.connect(g);
          g.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + durSec);
        });
      } else {
        this._playImpactThud(1.3);
      }
    } catch (_) {}
  }

  _playBoneSnapSound() {
    try {
      const ctx = this._getAudioContext();
      if (!this._snapBuf) return;
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this._snapBuf;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1350;
      filter.Q.value = 1.8;

      const gain = ctx.createGain();
      gain.gain.value = 1.0;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start(now);
    } catch (_) {}
  }

  _playImpactThud(vol = 1.0) {
    try {
      const ctx = this._getAudioContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(20, now + 0.38);
      gain.gain.setValueAtTime(Math.min(1, 0.98 * vol), now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.42);
    } catch (_) {}
  }

  _createStyleAndOverlays() {
    if (typeof document === 'undefined') return;
    if (!document.getElementById('jumpscare-style')) {
      const style = document.createElement('style');
      style.id = 'jumpscare-style';
      style.textContent = `
        body.in-execution #start {
          opacity: 0 !important;
          pointer-events: none !important;
        }
        .exec-overlay, .false-scare-overlay {
          position: fixed;
          inset: 0;
          z-index: 999999;
          pointer-events: none;
          overflow: hidden;
          display: none;
        }
        .exec-overlay.active, .false-scare-overlay.active {
          display: block;
        }
        .exec-strobe {
          position: absolute;
          inset: 0;
          background: radial-gradient(circle, rgba(255,40,10,0.28) 0%, rgba(0,0,0,0.85) 100%);
          animation: exec-flicker 0.11s steps(2) 5 forwards;
        }
        @keyframes exec-flicker {
          0% { opacity: 0.9; }
          50% { opacity: 0.1; }
          100% { opacity: 0; }
        }
        .false-scare-overlay {
          background: radial-gradient(circle at 50% 50%, transparent 30%, rgba(90,0,0,0.45) 80%, rgba(0,0,0,0.92) 100%);
          opacity: 0.65;
          transition: opacity 0.15s;
        }
        .false-scare-overlay.climax {
          opacity: 1;
          animation: exec-flicker 0.09s steps(2) 4;
        }
        .exec-blood {
          position: absolute;
          inset: 0;
          opacity: 0;
          background: radial-gradient(circle at 50% 45%, rgba(100,0,0,0.12) 0%, rgba(130,5,5,0.68) 68%, rgba(30,0,0,0.94) 100%);
          transition: opacity 0.15s ease-out;
        }
        .exec-overlay.blood-active .exec-blood {
          opacity: 1;
        }
        .exec-cracks {
          position: absolute;
          inset: 0;
          opacity: 0;
          background-image:
            linear-gradient(38deg, transparent 48.5%, rgba(255,255,255,0.65) 49%, rgba(0,0,0,0.8) 49.6%, transparent 50.2%),
            linear-gradient(-52deg, transparent 46%, rgba(255,255,255,0.5) 46.5%, transparent 47.2%),
            linear-gradient(115deg, transparent 54%, rgba(255,255,255,0.45) 54.4%, transparent 55%);
        }
        .exec-overlay.crack-active .exec-cracks {
          opacity: 0.92;
        }
        .exec-rec {
          position: absolute;
          left: 24px;
          bottom: 28px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.18em;
          color: #ff3b2f;
          text-shadow: 0 2px 8px #000;
          opacity: 0;
        }
        .exec-overlay.dropped-active .exec-rec {
          opacity: 1;
          animation: blink 0.35s steps(1) infinite;
        }
      `;
      document.head.appendChild(style);
    }

    this._execOverlay = document.createElement('div');
    this._execOverlay.className = 'exec-overlay';
    this._execOverlay.innerHTML = `
      <div class="exec-strobe"></div>
      <div class="exec-blood"></div>
      <div class="exec-cracks"></div>
      <div class="exec-rec">● CAMCORDER DROPPED ON FLOOR // SUBJECT TERMINATED</div>
    `;
    document.body.appendChild(this._execOverlay);

    this._falseOverlay = document.createElement('div');
    this._falseOverlay.className = 'false-scare-overlay';
    document.body.appendChild(this._falseOverlay);
  }
}
