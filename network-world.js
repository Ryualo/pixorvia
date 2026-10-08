// ============================================================================
//  SHARED WORLD STATE  (host authoritative)
//
//  The host runs the only monster AI in a session and owns every world event
//  that is supposed to look the same for everybody (power out, level change,
//  monster position + mode).  Clients never simulate the monster themselves —
//  they mirror the host's snapshot and glide the body between updates.
//
//  Purely local POV (camera, aim, flashlight on/off, stress, hallucination,
//  jumpscare) is deliberately NOT part of this file.
// ============================================================================
import * as THREE from 'three';

const SEND = 1 / 10;      // world snapshots/sec, host -> clients
const LURK = -50;         // far away "hidden" slot; never interpolates into view
const POS_LERP = 9, ROT_LERP = 9;

export class NetworkWorld {
  constructor(g) {
    this.g = g;
    this.on = false;         // true while in a co-op session
    this.host = false;       // am I the authority?
    this.sendT = 0;
    this.lurking = true;
    this.dead = false;         // local player died -> mirror stays hidden
    this.lastSent = -1;
    this.snap = null;        // newest snapshot from the host
    this.lastSnap = -1;      // world.time stamp of the previous snapshot
    this.prevLurk = true;
    this.v = new THREE.Vector3(LURK, 0, LURK);
    this.posA = new THREE.Vector3(LURK, 0, LURK);
    this.posB = new THREE.Vector3(LURK, 0, LURK);
    this.wyaw = 0;
    this.lastMode = 'stalk';
    this.lit = false;          // did the host's flashlight catch it -> shimmer everywhere
    // scratch (no per-frame allocation)
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._x = new THREE.Vector3(1, 0, 0);
    this._y = new THREE.Vector3(0, 1, 0);
    this._z = new THREE.Vector3(0, 0, 1);
  }

  attach() { this.on = true; this.sendT = 0; this.lurking = true; this.snap = null; this.dead = false }
  detach() { this.on = false; this.host = false; this.snap = null; this.dead = false }

  // ---------- incoming ---------- (called from Multiplayer.receive)
  receive(d) {
    if (d.t === 'monster-state') {
      if (this.host || !this.on) return;
      this.snap = {...d, t: performance.now()};
      return;
    }
    if (d.t === 'world-state' || d.t === 'world-event') this.applyWorld(d);
  }

  // ---------- host sampling ---------- (called from Multiplayer.update)
  tick(dt) {
    if (!this.on || !this.host) return;
    this.sendT -= dt;
    if (this.sendT > 0) return;
    this.sendT = SEND;
    this.emitMonster();
  }

  /* ---------------------------------------------------------------------
     HOST: broadcast the monster's position + AI mode
     --------------------------------------------------------------------- */
  emitMonster() {
    const m = this.g.monster;
    // the monster is "present" only while it is actually hunting in this level;
    // pooled (blackout) / inactive instances are parked far outside the maze
    const lurk = !(m.active && !m.pooled && m.group.visible);
    const st = {lurk, x: LURK, y: 0, z: LURK, yaw: 0, pitch: 0, mode: 'idle', speed: 0, ts: m.ts || 0};
    if (!lurk) {
      st.x = m.pos.x; st.y = m.pos.y; st.z = m.pos.z;
      const e = this.g.monsterEuler(m);
      st.yaw = e.y; st.pitch = e.x;
      st.mode = m.mode || 'stalk';
      st.speed = m.speed || 0;
    }
    this.lurking = lurk;
    this.lastSent = lurk ? 1 : 0;
    this.g.mp.emit({t: 'monster-state', ...st});
  }

  // the local player died: stop drawing the mirrored monster until the next
  // level, so a client never keeps rendering a body it is not simulating.
  hide() { this.dead = true; const m = this.g.monster; if (m) { m.group.visible = false; m.active = false } }

  /* ---------------------------------------------------------------------
     CLIENT: place the mirrored monster body for this frame
     --------------------------------------------------------------------- */
  update(dt) {
    if (!this.on || this.host || !this.snap) return;
    const s = this.snap, m = this.g.monster;
    if (this.dead && !s.lurk) { m.group.visible = false; return }
    this.dead = false;

    // --- presence edge: show / hide exactly where the host says it is ---
    if (s.lurk !== this.prevLurk) {
      this.prevLurk = s.lurk;
      if (s.lurk) { m.active = false; m.group.visible = false; m.lastYaw = 0 }
      else {
        m.active = true; m.group.visible = true;
        this.posA.set(s.x, s.y, s.z); this.posB.copy(this.posA);
        this.v.copy(this.posA); m.pos.copy(this.posA);
        m.lastYaw = s.yaw || 0; this.wyaw = m.lastYaw;
      }
      this.lastSnap = s.t; // never interpolate across a teleport
    }
    if (s.t !== this.lastSnap) {
      this.lastSnap = s.t;
      this.posA.copy(this.posB);
      this.posB.set(s.x, s.y, s.z);
      if (s.mode) m.mode = s.mode;
    }
    if (s.lurk || !m.group.visible) return;

    // glide between host snapshots (they already arrive in host time order)
    const k = Math.min(1, dt * POS_LERP);
    this.v.lerp(this.posB, k);
    m.pos.copy(this.v);

    const yaw = s.yaw || 0;
    this.wyaw += Math.atan2(Math.sin(yaw - this.wyaw), Math.cos(yaw - this.wyaw)) * Math.min(1, dt * ROT_LERP);
    m.lastYaw = this.wyaw;
    this.g.monsterFace(yaw, s.pitch || 0, this.wyaw);

    // the local audio bed keeps reacting to the real (remote) position
    m.lastDist = Math.hypot(m.pos.x - this.g.camera.position.x, m.pos.z - this.g.camera.position.z);
    m.threat = s.mode === 'strike' ? 1 : m.threat * .95;
  }

  /* ---------------------------------------------------------------------
     SHARED WORLD EVENTS  (power, level, objective)
     Host decides once, clients apply the same thing locally.
     --------------------------------------------------------------------- */
  applyWorld(d) {
    const g = this.g;
    if (d.e === 'power') {
      // a real blackout affects everybody; your own flashlight never does
      g.blackout(true);
      return;
    }
    if (d.e === 'dark') {
      const el = document.getElementById('dark');
      if (el) el.style.opacity = d.on ? .35 : 0;
      return;
    }
    if (d.e === 'level') {
      if (Number.isInteger(d.level) && d.level >= 0) g.level = d.level - 1;
      g.newLevel(d.seed);
      return;
    }
  }

  // raise a shared world event: host applies + broadcasts, client only applies
  world(e, extra) {
    if (!this.on) return;
    if (this.host) {
      this.g.mp.broadcast({t: 'world-event', e, ...(extra || {})});
      this.applyWorld({e, ...(extra || {})});
    } else this.g.mp.emit({t: 'world-event', e, ...(extra || {})});
  }
}
