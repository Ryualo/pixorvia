// ============================================================================
//  SHARED WORLD STATE  (host authoritative)
// ============================================================================
import * as THREE from 'three';

const SEND = 1 / 12;      // 12 snapshots/sec, host -> clients
const LURK = -50;         // far away "hidden" slot; never interpolates into view
const POS_LERP = 10, ROT_LERP = 10;

export class NetworkWorld {
  constructor(g) {
    this.g = g;
    this.on = false;
    this.host = false;
    this.sendT = 0;
    this.lurking = true;
    this.dead = false;
    this.lastSent = -1;
    this.snap = null;
    this.lastSnap = -1;
    this.prevLurk = true;
    this.v = new THREE.Vector3(LURK, 0, LURK);
    this.posA = new THREE.Vector3(LURK, 0, LURK);
    this.posB = new THREE.Vector3(LURK, 0, LURK);
    this.wyaw = 0;
    this.lastMode = 'stalk';
    this.lit = false;
    this._sentDeadLights = new Set();
    this._scratch = new THREE.Vector3();
  }

  attach() {
    this.on = true; this.sendT = 0; this.lurking = true;
    this.snap = null; this.dead = false;
    this._sentDeadLights.clear();
  }
  detach() {
    this.on = false; this.host = false;
    this.snap = null; this.dead = false;
    this._sentDeadLights.clear();
  }

  receive(d) {
    if (d.t === 'monster-state') {
      if (this.host || !this.on) return;
      this.snap = { ...d, t: performance.now() };
      this.g.monster.receiveSnapshot(d.ai);

      // Apply newly popped ceiling light fixtures from host
      const w = this.g.world;
      if (d.deadLights?.length && w?.fixtures) {
        for (const idx of d.deadLights) {
          const f = w.fixtures[idx];
          if (f && !f.dead) {
            f.dead = true; f.flick = 0;
            w.setTube(f, 0);
            this.g.audio?.pop?.(f.pos);
          }
        }
        if (w.dirty) { w.tubes.instanceColor.needsUpdate = true; w.dirty = false; }
      }
      return;
    }
    if (d.t === 'world-state' || d.t === 'world-event') this.applyWorld(d);
  }

  tick(dt) {
    if (!this.on || !this.host) return;
    if ((this.sendT -= dt) > 0) return;
    this.sendT = SEND;
    this.emitMonster();
  }

  /** Checks if the host OR any co-op client is shining their flashlight on the monster. */
  _isMonsterLit(m) {
    const g = this.g;
    if (!m.active || g.dark) return false;
    this._scratch.set(m.pos.x, 1.8, m.pos.z);
    if (!g.dead && g.flash.hits(this._scratch)) return true;

    if (g.mp?.coop) {
      for (const r of g.mp.remotes.values()) {
        if (!r.alive || r.flashOn === false || !r.pos) continue;
        const dx = m.pos.x - r.pos.x, dz = m.pos.z - r.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 24 || d < 0.01) continue;
        const fx = -Math.sin(r.yaw || 0), fz = -Math.cos(r.yaw || 0);
        if ((dx * fx + dz * fz) / d > 0.88 && g.world.los(r.pos.x, r.pos.z, m.pos.x, m.pos.z)) {
          return true;
        }
      }
    }
    return false;
  }

  /* ---------------------------------------------------------------------
     HOST: broadcast monster position, pose, flashlight hit & popped bulbs
     --------------------------------------------------------------------- */
  emitMonster(fullLights = false) {
    const g = this.g, m = g.monster, F = g.world?.fixtures || [];
    const lurk = !(m.active && m.group.visible);

    const deadLights = [];
    for (let i = 0; i < F.length; i++) {
      if (F[i].dead && (fullLights || !this._sentDeadLights.has(i))) {
        this._sentDeadLights.add(i);
        deadLights.push(i);
      }
    }

    const st = {
      lurk, x: LURK, y: 0, z: LURK, yaw: 0, pitch: 0,
      mode: 'idle', speed: 0, lit: false,
      peek: false, ling: 0, frz: 0, flk: false,
      deadLights: deadLights.length ? deadLights : undefined
    };

    if (!lurk) {
      st.x = +m.pos.x.toFixed(2);
      st.y = +m.pos.y.toFixed(2);
      st.z = +m.pos.z.toFixed(2);
      const e = g.monsterEuler(m);
      st.yaw = +e.y.toFixed(3);
      st.pitch = +e.x.toFixed(3);
      st.mode = m.mode || 'STALK';
      st.speed = +(m.speed || 0).toFixed(2);
      st.lit = this._isMonsterLit(m);
      st.peek = !!(m.peeking || m._peeking);
      st.ling = +(m.lingerT || 0).toFixed(2);
      st.frz = +(m.freeze || 0).toFixed(2);
      st.flk = !!m._flickerWarning;
    }

    this.lurking = lurk;
    this.lastSent = lurk ? 1 : 0;
    g.mp.emit({ t: 'monster-state', ...st, ai: m.snapshot() });
  }

  hide() { /* Local death cannot remove the shared monster. */ }

  /* ---------------------------------------------------------------------
     CLIENT: place and animate the mirrored monster body for this frame
     --------------------------------------------------------------------- */
  update(dt) {
    if (!this.on || this.host || !this.snap) return;
    const s = this.snap, m = this.g.monster;
    m.active = !s.lurk;
    m.group.visible = !s.lurk;
    if (s.mode) m.mode = s.mode;
    this.dead = false;

    if (s.lurk !== this.prevLurk) {
      this.prevLurk = s.lurk;
      if (s.lurk) {
        m.active = false; m.group.visible = false; m.lastYaw = 0;
      } else {
        m.active = true; m.group.visible = true;
        this.posA.set(s.x, s.y, s.z);
        this.posB.copy(this.posA);
        this.v.copy(this.posA);
        m.pos.copy(this.posA);
        m.lastYaw = s.yaw || 0;
        this.wyaw = m.lastYaw;
      }
      this.lastSnap = s.t;
    }

    if (s.t !== this.lastSnap) {
      this.lastSnap = s.t;
      this.posA.copy(this.posB);
      this.posB.set(s.x, s.y, s.z);
      if (s.mode) m.mode = s.mode;
      // If monster blink-teleported (> 6m jump), snap immediately instead of lerping through walls
      if (this.v.distanceToSquared(this.posB) > 36) {
        this.v.copy(this.posB);
      }
    }

    // Advance warning light-flickers on client
    if (s.flk && !m._flickerWarning && m.startFlickerWarning) m.startFlickerWarning();
    m.flickerWarningTick?.(dt);

    if (s.lurk || !m.group.visible) return;

    const k = Math.min(1, dt * POS_LERP);
    this.v.lerp(this.posB, k);
    m.pos.copy(this.v);

    const yaw = s.yaw || 0;
    this.wyaw += Math.atan2(Math.sin(yaw - this.wyaw), Math.cos(yaw - this.wyaw)) * Math.min(1, dt * ROT_LERP);
    m.lastYaw = this.wyaw;
    m.speed = s.speed || 0;
    m.peeking = m._peeking = !!s.peek;
    m.lingerT = s.ling || 0;
    m.freeze = s.frz || 0;
    this.lit = !!s.lit;

    m.dir.set(Math.sin(yaw), 0, Math.cos(yaw));
    m.renderLocal(dt, this.lit);
    this.g.monsterFace(yaw, s.pitch || 0, this.wyaw);

    m.lastDist = Math.hypot(m.pos.x - this.g.camera.position.x, m.pos.z - this.g.camera.position.z);
    m.threat = s.mode === 'CHASE' ? 1 : (m.threat || 0) * .95;
  }

  applyWorld(d) {
    const g = this.g;
    if (d.e === 'power') {
      g.blackout(true);
      return;
    }
    if (d.e === 'dark') {
      const el = document.getElementById('dark');
      if (el) el.style.opacity = d.on ? .35 : 0;
      return;
    }
    if (d.e === 'level') {
      this._sentDeadLights.clear();
      if (Number.isInteger(d.level) && d.level >= 0) g.level = d.level - 1;
      g.newLevel(d.seed);
      return;
    }
  }

  world(e, extra) {
    if (!this.on) return;
    if (this.host) {
      this.g.mp.broadcast({ t: 'world-event', e, ...(extra || {}) });
      this.applyWorld({ e, ...(extra || {}) });
    } else {
      this.g.mp.emit({ t: 'world-event', e, ...(extra || {}) });
    }
  }
}
