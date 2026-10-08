import * as THREE from 'three';
import {RemotePlayer} from './remote-player.js';

const MAX = 4, SEND = 1 / 20, WIPE_DELAY = 2.5, PREFIX = 'bk0-lvl0-';
const $ = id => document.getElementById(id);
const E = new THREE.Euler(0, 0, 0, 'YXZ');
const clean = s => String(s || '').replace(/[^\w \-.]/g, '').trim().slice(0, 14) || 'WANDERER';
const newSeed = () => (Math.random() * 2 ** 32) >>> 0;
const code = () => Array.from({length: 5}, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.random() * 32 | 0]).join('');
const finite = d => [d.x, d.y, d.z, d.yaw, d.pitch].every(Number.isFinite);

export class Multiplayer {
  constructor(g) {
    this.g = g; this.coop = false; this.isHost = false; this.peer = null; this.hostConn = null;
    this.conns = new Map(); this.remotes = new Map();
    this.name = ''; this.room = ''; this.alive = true; this.spectating = false; this.follow = null;
    this.sendT = 0; this.wipeT = 0; this.seed = null;
    this.ui();
    addEventListener('beforeunload', () => this.peer?.destroy());
  }

  // ---------- lobby UI ----------
  ui() {
    const lobby = $('lobby');
    // keep lobby typing away from the game's key handlers (e.g. R = regenerate)
    for (const ev of ['keydown', 'keyup']) lobby.addEventListener(ev, e => e.stopPropagation());
    $('lb-solo').onclick = () => lobby.classList.add('hidden');
    $('lb-coop').onclick = () => { $('lb-modes').style.display = 'none'; $('lb-panel').style.display = 'block'; $('lb-name').focus() };
    $('lb-host').onclick = () => this.hostGame();
    $('lb-join').onclick = () => this.joinGame($('lb-room').value);
    $('lb-enter').onclick = () => lobby.classList.add('hidden');
    addEventListener('mousedown', () => { if (this.spectating) this.nextTarget() });
  }
  status(t) { $('lb-status').textContent = t }
  roster() {
    const list = [`${this.name}${this.alive ? '' : ' (LOST)'} (YOU)`];
    for (const r of this.remotes.values()) list.push(r.name + (r.alive ? '' : ' (LOST)'));
    $('lb-players').textContent = `PLAYERS ${list.length}/${MAX}: ` + list.join(', ');
    const h = $('mp-hud');
    h.style.display = this.coop ? 'block' : 'none';
    h.textContent = `ROOM ${this.room} · ${list.length}/${MAX}` + (this.spectating ? `\nSPECTATING: ${this.follow ? this.follow.name : 'NO SIGNAL'}${this.remotes.size > 1 ? ' — CLICK TO SWITCH' : ''}` : '');
  }
  lockButtons(on) { for (const id of ['lb-host', 'lb-join']) $(id).disabled = on }

  // ---------- connection setup (star topology: host relays) ----------
  hostGame() {
    if (!window.Peer) return this.status('PEERJS FAILED TO LOAD');
    this.name = clean($('lb-name').value); this.lockButtons(true); this.status('CREATING ROOM...');
    this.room = code();
    this.peer = new Peer(PREFIX + this.room);
    this.peer.on('open', () => {
      this.coop = true; this.isHost = true; this.alive = true;
      this.seed = newSeed(); this.g.level = -1; this.g.newLevel(this.seed);
      this.status(`ROOM ID: ${this.room} — SHARE IT WITH UP TO ${MAX - 1} FRIENDS`);
      $('lb-enter').style.display = 'inline-block'; this.roster();
    });
    this.peer.on('connection', conn => {
      conn.on('open', () => {
        if (this.conns.size >= MAX - 1) { conn.send({t: 'full'}); setTimeout(() => conn.close(), 300); return }
        this.conns.set(conn.peer, conn);
      });
      conn.on('data', d => this.receive(d, conn));
      conn.on('close', () => this.dropClient(conn.peer));
      conn.on('error', () => this.dropClient(conn.peer));
    });
    this.peer.on('error', e => {
      if (e.type === 'unavailable-id') { this.peer.destroy(); return this.hostGame() }
      this.status('NETWORK ERROR: ' + e.type); if (!this.coop) this.lockButtons(false);
    });
  }

  joinGame(raw) {
    if (!window.Peer) return this.status('PEERJS FAILED TO LOAD');
    const room = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!room) return this.status('ENTER A ROOM ID');
    this.name = clean($('lb-name').value); this.room = room; this.lockButtons(true); this.status('CONNECTING...');
    this.peer = new Peer();
    this.peer.on('open', () => {
      const conn = this.hostConn = this.peer.connect(PREFIX + room, {reliable: true});
      conn.on('open', () => conn.send({t: 'hello', name: this.name}));
      conn.on('data', d => this.receive(d, conn));
      conn.on('close', () => this.endCoop('HOST DISCONNECTED'));
    });
    this.peer.on('error', e => {
      this.status(e.type === 'peer-unavailable' ? 'ROOM NOT FOUND' : 'NETWORK ERROR: ' + e.type);
      if (this.coop) this.endCoop('CONNECTION LOST');
      else { this.peer?.destroy(); this.peer = null; this.lockButtons(false) }
    });
  }
  dropClient(id) {
    if (!this.conns.has(id)) return;
    this.conns.delete(id); this.removeRemote(id); this.broadcast({t: 'leave', id});
  }
  endCoop(msg) {
    if (!this.coop) return;
    const wasDead = !this.alive;
    this.coop = false; this.isHost = false; this.spectating = false; this.follow = null; this.alive = true;
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    this.conns.clear(); this.hostConn = null; this.peer?.destroy(); this.peer = null;
    this.lockButtons(false); this.status(msg); $('mp-hud').style.display = 'none';
    $('lb-enter').style.display = 'none';
    if (wasDead) this.g.respawn();
    this.g.say(msg, 2500);
  }

  // ---------- messaging ----------
  broadcast(msg, except) { for (const c of this.conns.values()) if (c !== except && c.open) c.send(msg) }
  emit(msg) { if (this.isHost) this.broadcast(msg); else if (this.hostConn?.open) this.hostConn.send(msg) }
  addRemote(id, name, alive = true) {
    if (this.remotes.has(id) || id === this.peer?.id || this.remotes.size >= MAX - 1) return;
    const r = new RemotePlayer(this.g.scene, id, clean(name)); r.alive = alive;
    this.remotes.set(id, r); this.roster();
  }
  removeRemote(id) {
    const r = this.remotes.get(id); if (!r) return;
    r.dispose(); this.remotes.delete(id);
    if (this.follow === r) this.follow = null;
    this.roster();
  }
  setAlive(id, alive) { const r = this.remotes.get(id); if (r) { r.alive = alive; this.roster() } }

  receive(d, conn) {
    if (!d || typeof d.t !== 'string') return;
    if (this.isHost) {
      const id = conn.peer; // never trust a client-supplied id
      if (d.t !== 'hello' && !this.remotes.has(id)) return;
      switch (d.t) {
        case 'hello': {
          if (!this.conns.has(id) || this.remotes.has(id)) return;
          const players = [{id: this.peer.id, name: this.name, alive: this.alive}];
          for (const r of this.remotes.values()) players.push({id: r.id, name: r.name, alive: r.alive});
          conn.send({t: 'welcome', seed: this.seed, level: this.g.level, players});
          this.addRemote(id, d.name);
          this.broadcast({t: 'join', id, name: clean(d.name)}, conn);
          this.g.say(clean(d.name) + ' JOINED', 1800);
          break;
        }
        case 's':
          if (finite(d)) { this.remotes.get(id).push(d); this.broadcast({t: 's', id, x: d.x, y: d.y, z: d.z, yaw: d.yaw, pitch: d.pitch}, conn) }
          break;
        case 'player-death': case 'player-alive':
          this.setAlive(id, d.t === 'player-alive'); this.broadcast({t: d.t, id}, conn); break;
        case 'escape': this.escape(); break;
      }
      return;
    }
    switch (d.t) {
      case 'welcome':
        this.coop = true; this.alive = true;
        for (const p of d.players || []) this.addRemote(p.id, p.name, p.alive !== false);
        this.startLevel(d.seed, d.level);
        this.status(`CONNECTED TO ROOM ${this.room}`); $('lb-enter').style.display = 'inline-block';
        break;
      case 'join': this.addRemote(d.id, d.name); this.g.say(clean(d.name) + ' JOINED', 1800); break;
      case 'leave': this.removeRemote(d.id); break;
      case 's': if (finite(d)) this.remotes.get(d.id)?.push(d); break;
      case 'player-death': case 'player-alive': this.setAlive(d.id, d.t === 'player-alive'); break;
      case 'escape': if (Number.isInteger(d.seed) && Number.isInteger(d.level)) this.startLevel(d.seed, d.level); break;
      case 'full': this.status('ROOM FULL (4/4)'); this.hostConn = null; this.peer?.destroy(); this.peer = null; this.lockButtons(false); break;
    }
  }

  // ---------- game events ----------
  // whole team moves to a new, identically-seeded level (host authoritative)
  escape() {
    if (!this.isHost) return this.emit({t: 'escape'});
    const seed = newSeed(), level = this.g.level + 1;
    this.broadcast({t: 'escape', seed, level});
    this.startLevel(seed, level);
  }
  startLevel(seed, level) {
    const g = this.g;
    this.seed = seed; this.spectating = false; this.wipeT = 0;
    if (this.follow) this.follow.hidden = false;
    this.follow = null;
    for (const r of this.remotes.values()) { r.alive = true; r.hidden = false; r.buf.length = 0 }
    g.level = level - 1;
    if (g.dead) g.respawn(seed); else g.newLevel(seed);
    if (!this.alive) { this.alive = true; this.emit({t: 'player-alive', id: this.peer?.id}) }
    this.roster();
  }
  die() {
    if (!this.alive) return;
    this.alive = false; this.emit({t: 'player-death', id: this.peer?.id}); this.roster();
  }
  // called once the jumpscare finishes
  spectate() { this.spectating = true; this.nextTarget() }
  nextTarget() {
    const alive = [...this.remotes.values()].filter(r => r.alive);
    if (this.follow) this.follow.hidden = false;
    const i = alive.indexOf(this.follow);
    this.follow = alive.length ? alive[(i + 1) % alive.length] : null;
    if (this.follow) this.follow.hidden = true;
    this.roster();
  }

  // ---------- per-frame hook (called from Game loop) ----------
  update(dt) {
    if (!this.coop) return;
    for (const r of this.remotes.values()) r.update();
    const cam = this.g.camera;
    if ((this.sendT -= dt) <= 0) {
      this.sendT = SEND;
      if (this.alive && !this.g.dead) {
        E.setFromQuaternion(cam.quaternion);
        this.emit({t: 's', id: this.peer?.id, x: cam.position.x, y: cam.position.y, z: cam.position.z, yaw: E.y, pitch: E.x});
      }
    }
    if (this.spectating) {
      if (this.follow && !this.follow.alive) { this.follow.hidden = false; this.follow = null }
      if (!this.follow && [...this.remotes.values()].some(r => r.alive)) this.nextTarget();
      if (this.follow) { cam.position.copy(this.follow.pos); E.set(this.follow.pitch, this.follow.yaw, 0); cam.quaternion.setFromEuler(E) }
      // host restarts the team once everybody is lost
      if (this.isHost && ![...this.remotes.values()].some(r => r.alive)) {
        if ((this.wipeT += dt) > WIPE_DELAY) this.escape();
      } else this.wipeT = 0;
    }
  }
}

