import * as THREE from 'three';
import {RemotePlayer} from './remote-player.js';
import {NetworkWorld} from './network-world.js';

const MAX = 4, SEND = 1 / 20, WIPE_DELAY = 2.5, TIMEOUT = 10000, ID_RETRIES = 5;
const PEER_SRC = ['https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'];
const ERR = {
  'peer-unavailable': 'ROOM NOT FOUND — CHECK THE ROOM ID', 'unavailable-id': 'ROOM ID TAKEN',
  network: 'CANNOT REACH SIGNALING SERVER', 'server-error': 'SIGNALING SERVER ERROR',
  'socket-error': 'SIGNALING SOCKET ERROR', 'socket-closed': 'SIGNALING SOCKET CLOSED',
  disconnected: 'NOT CONNECTED TO SIGNALING SERVER', webrtc: 'WEBRTC FAILED (NAT / FIREWALL)',
  'browser-incompatible': 'BROWSER DOES NOT SUPPORT WEBRTC', 'ssl-unavailable': 'HTTPS REQUIRED',
};
const errText = e => 'CONNECTION FAILED: ' + (ERR[e?.type] || String(e?.type || 'UNKNOWN').toUpperCase()) + (e?.message ? ` (${e.message})` : '');
const $ = id => document.getElementById(id);

// make sure the PeerJS global exists before any multiplayer code touches it
let peerLoad = null;
const loadPeer = () => window.Peer ? Promise.resolve(window.Peer) : (peerLoad ||= new Promise((res, rej) => {
  const next = i => {
    if (i >= PEER_SRC.length) { peerLoad = null; return rej(new Error('PEERJS FAILED TO LOAD')) }
    const s = document.createElement('script'); s.src = PEER_SRC[i];
    s.onload = () => window.Peer ? res(window.Peer) : next(i + 1);
    s.onerror = () => { s.remove(); next(i + 1) };
    document.head.appendChild(s);
  };
  next(0);
}));
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
    this.sess = 0; this.timer = 0; // sess invalidates callbacks from torn-down peers
    this.share = new NetworkWorld(g); // ONE authoritative monster/world state per session
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
  arm() { this.disarm(); this.timer = setTimeout(() => this.fail('CONNECTION FAILED (TIMED OUT)'), TIMEOUT) }
  disarm() { clearTimeout(this.timer); this.timer = 0 }
  // abort a pending (or live) connection and show why
  fail(msg) {
    this.disarm();
    if (this.coop) return this.endCoop(msg);
    this.sess++;
    this.hostConn?.close(); this.hostConn = null; this.peer?.destroy(); this.peer = null;
    this.conns.clear(); this.isHost = false; this.lockButtons(false); this.status(msg);
  }

  async hostGame(tries = 0) {
    this.name = clean($('lb-name').value); this.lockButtons(true); this.status('LOADING PEERJS...');
    try { await loadPeer() } catch { return this.fail('PEERJS FAILED TO LOAD — CHECK YOUR INTERNET') }
    const s = ++this.sess, room = code();
    this.status('CREATING ROOM...');
    const peer = this.peer = new Peer(room, {debug: 1}); // room ID == real PeerJS ID
    this.arm();
    peer.on('open', id => {
      if (s !== this.sess) return;
      this.disarm(); this.room = id;
      this.coop = true; this.isHost = true; this.alive = true;
      this.share.attach(); this.share.host = true; // host runs the only monster AI
      this.seed = newSeed(); this.g.level = -1; this.g.newLevel(this.seed);
      this.status(`ROOM ID: ${id} — SHARE IT WITH UP TO ${MAX - 1} FRIENDS`);
      $('lb-enter').style.display = 'inline-block'; this.roster();
    });
    peer.on('connection', conn => this.acceptClient(conn, s));
    peer.on('disconnected', () => {
      if (s !== this.sess || peer.destroyed) return;
      if (!this.coop) return this.fail(errText({type: 'disconnected'}));
      // existing players stay connected P2P; reconnect so new players can still join
      this.status(`ROOM ID: ${this.room} — SIGNALING LOST, RECONNECTING...`); peer.reconnect();
    });
    peer.on('close', () => { if (s === this.sess) this.fail('ROOM CLOSED') });
    peer.on('error', e => {
      if (s !== this.sess) return;
      if (e.type === 'unavailable-id' && tries < ID_RETRIES) {
        this.sess++; this.disarm(); peer.destroy(); this.peer = null;
        return this.hostGame(tries + 1);
      }
      if (this.coop) { this.status(errText(e)); return } // room stays up for connected players
      this.fail(errText(e));
    });
  }
  acceptClient(conn, s) {
    conn.on('open', () => {
      if (s !== this.sess) return conn.close();
      if (this.conns.size >= MAX - 1) { conn.send({t: 'full'}); setTimeout(() => conn.close(), 300); return }
      this.conns.set(conn.peer, conn);
    });
    conn.on('data', d => { if (s === this.sess) this.receive(d, conn) });
    conn.on('close', () => { if (s === this.sess) this.dropClient(conn.peer) });
    conn.on('error', () => { if (s === this.sess) this.dropClient(conn.peer) });
  }

  async joinGame(raw) {
    const room = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (room.length < 5 || room.length > 6) return this.status('ENTER THE 5–6 CHARACTER ROOM ID');
    this.name = clean($('lb-name').value); this.room = room; this.lockButtons(true); this.status('LOADING PEERJS...');
    try { await loadPeer() } catch { return this.fail('PEERJS FAILED TO LOAD — CHECK YOUR INTERNET') }
    const s = ++this.sess;
    this.status('CONNECTING TO SIGNALING SERVER...');
    const peer = this.peer = new Peer({debug: 1});
    this.arm(); // cleared only when the host's welcome arrives
    peer.on('open', () => {
      if (s !== this.sess) return;
      this.status(`CONNECTING TO ROOM ${room}...`);
      const conn = this.hostConn = peer.connect(room, {reliable: true}); // exact PeerJS ID
      conn.on('open', () => {
        if (s !== this.sess) return;
        this.status(`CONNECTED — SYNCING WITH ROOM ${room}...`);
        conn.send({t: 'hello', name: this.name});
      });
      conn.on('data', d => { if (s === this.sess) this.receive(d, conn) });
      conn.on('close', () => { if (s === this.sess) this.fail(this.coop ? 'HOST DISCONNECTED' : 'CONNECTION FAILED: HOST CLOSED THE CONNECTION') });
      conn.on('error', e => { if (s === this.sess) this.fail(errText(e)) });
    });
    peer.on('disconnected', () => {
      if (s !== this.sess || peer.destroyed) return;
      if (this.hostConn?.open) peer.reconnect(); // P2P link is still alive
      else this.fail(errText({type: 'disconnected'}));
    });
    peer.on('close', () => { if (s === this.sess) this.fail('CONNECTION CLOSED') });
    peer.on('error', e => {
      if (s !== this.sess) return;
      if (this.coop && this.hostConn?.open) { this.g.say(errText(e), 2500); return } // signaling hiccup only
      this.fail(errText(e));
    });
  }
  dropClient(id) {
    if (!this.conns.has(id)) return;
    this.conns.delete(id); this.removeRemote(id); this.broadcast({t: 'leave', id});
  }
  endCoop(msg) {
    if (!this.coop) return;
    this.disarm(); this.sess++;
    const wasDead = !this.alive;
    this.coop = false; this.isHost = false; this.spectating = false; this.follow = null; this.alive = true;
    this.share.detach();
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
        case 'monster-state': // clients never author these; drop anything they claim
          break;
        case 'world-event': // clients request, the host decides
          if (d.e === 'escape') this.escape();
          // a client ran out of battery: the blackout is a shared world event,
          // so the host re-applies it for itself and relays it to everyone else
          else if (d.e === 'power') this.share.world('power');
          break;
        case 'escape': this.escape(); break;
      }
      return;
    }
    switch (d.t) {
      case 'welcome':
        if (this.coop) break;
        this.disarm(); this.coop = true; this.alive = true;
    this.share.attach(); this.share.host = false;
        for (const p of d.players || []) this.addRemote(p.id, p.name, p.alive !== false);
        this.startLevel(d.seed, d.level);
        this.status(`CONNECTED TO ROOM ${this.room}`); $('lb-enter').style.display = 'inline-block';
        break;
      case 'join': this.addRemote(d.id, d.name); this.g.say(clean(d.name) + ' JOINED', 1800); break;
      case 'leave': this.removeRemote(d.id); break;
      case 's': if (finite(d)) this.remotes.get(d.id)?.push(d); break;
      case 'player-death': case 'player-alive': this.setAlive(d.id, d.t === 'player-alive'); break;
      case 'escape': if (Number.isInteger(d.seed) && Number.isInteger(d.level)) this.startLevel(d.seed, d.level); break;
      case 'monster-state': case 'world-event': this.share.receive(d); break;
      case 'full': this.fail(`CONNECTION FAILED: ROOM FULL (${MAX}/${MAX})`); break;
    }
  }

  // ---------- game events ----------
  // whole team moves to a new, identically-seeded level (host authoritative)
  escape() {
    if (!this.isHost) return this.emit({t: 'world-event', e: 'escape'});
    const seed = newSeed(), level = this.g.level + 1;
    this.share.world('level', {seed, level});
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

