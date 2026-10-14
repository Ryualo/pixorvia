import * as THREE from 'three';

const EYE = 1.62, HEIGHT = 1.75, DELAY = 100; // ms of interpolation delay
let baseTex = null, beamTex = null, flareTex = null, aspect = .45;

// Procedural glitch silhouette, used until (or instead of) player_glitch.png
function fallbackTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(12,10,6,.96)';
  x.beginPath(); x.arc(64, 40, 22, 0, Math.PI * 2); x.fill();
  x.fillRect(40, 64, 48, 100); x.fillRect(28, 68, 12, 84); x.fillRect(88, 68, 12, 84);
  x.fillRect(42, 162, 18, 94); x.fillRect(68, 162, 18, 94);
  for (let i = 0; i < 16; i++) {
    const y = Math.random() * 256 | 0, h = 1 + Math.random() * 5 | 0, img = x.getImageData(0, y, 128, h);
    x.clearRect(0, y, 128, h); x.putImageData(img, (Math.random() - .5) * 26 | 0, y);
  }
  x.fillStyle = 'rgba(235,225,175,.9)'; x.fillRect(54, 36, 6, 3); x.fillRect(68, 36, 6, 3);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function getTexture() {
  if (baseTex) return baseTex;
  baseTex = fallbackTexture();
  new THREE.TextureLoader().load('player_glitch.png', t => {
    aspect = t.image.width / t.image.height;
    baseTex.image = t.image; baseTex.needsUpdate = true;
  }, undefined, () => {});
  return baseTex;
}

function getBeamTextures() {
  if (!beamTex) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 256;
    const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, 'rgba(255,242,205,0)');
    gr.addColorStop(.15, 'rgba(255,242,205,.18)');
    gr.addColorStop(.85, 'rgba(255,242,205,.75)');
    gr.addColorStop(1, 'rgba(255,250,230,1)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 256);
    beamTex = new THREE.CanvasTexture(c);
  }
  if (!flareTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,252,235,1)');
    gr.addColorStop(.25, 'rgba(255,235,180,.8)');
    gr.addColorStop(1, 'rgba(255,220,140,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    flareTex = new THREE.CanvasTexture(c);
  }
}

function nameTag(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 28px ui-monospace,Menlo,monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const w = Math.min(250, x.measureText(name).width + 24);
  x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(128 - w / 2, 14, w, 38);
  x.fillStyle = '#e7d994'; x.fillText(name, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({map: t, transparent: true, depthWrite: false}));
  s.scale.set(1.2, .3, 1); s.position.y = HEIGHT + .3; return s;
}

const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export class RemotePlayer {
  constructor(scene, id, name) {
    this.scene = scene; this.id = id; this.name = name;
    this.alive = true; this.hidden = false; this.flashOn = true;
    this.buf = [];
    this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0; this.walkPhase = 0;

    this.group = new THREE.Group(); this.group.visible = false;
    this.mat = new THREE.SpriteMaterial({map: getTexture(), transparent: true, depthWrite: false, color: 0xc4bb9c});
    this.body = new THREE.Sprite(this.mat); this.body.center.set(.5, 0);
    this.tag = nameTag(name);

    // 3D Synced Flashlight Rig (Real SpotLight + Volumetric Cone + Lens Glare)
    getBeamTextures();
    this.aim = new THREE.Group();
    this.aim.position.y = EYE;
    this.aim.rotation.order = 'YXZ';

    this.spot = new THREE.Group(); // Toggled by multiplayer.js when teammate presses F
    this.spot.position.set(.12, -.16, -.15);

    const coneGeo = new THREE.ConeGeometry(1.65, 7.5, 16, 1, true);
    coneGeo.translate(0, -3.75, 0);
    coneGeo.rotateX(Math.PI / 2);
    this.beamMat = new THREE.MeshBasicMaterial({
      map: beamTex, color: 0xfff2d0, transparent: true, opacity: .16,
      depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending
    });
    this.beam = new THREE.Mesh(coneGeo, this.beamMat);

    this.flareMat = new THREE.SpriteMaterial({
      map: flareTex, color: 0xfff2d0, transparent: true, opacity: .9,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.flare = new THREE.Sprite(this.flareMat);
    this.flare.scale.set(.38, .38, 1);

    this.light = new THREE.SpotLight(0xfff2d0, 0, 20, Math.PI / 7.5, .55, 1.4);
    this.lightTarget = new THREE.Object3D();
    this.lightTarget.position.set(0, 0, -1);
    this.spot.add(this.beam, this.flare, this.light, this.lightTarget);
    this.light.target = this.lightTarget;
    this.aim.add(this.spot);

    this.group.add(this.body, this.tag, this.aim);
    scene.add(this.group);
  }

  push(s) {
    if (s.f !== undefined) this.flashOn = !!s.f;
    this.buf.push({t: performance.now(), x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch});
    if (this.buf.length > 12) this.buf.shift();
  }

  update() {
    const b = this.buf;
    const active = this.alive && b.length > 0;
    this.group.visible = active;
    if (!active) { this.light.intensity = 0; return; }

    const rt = performance.now() - DELAY;
    let a = b[0], c = b[b.length - 1], k = 1;
    if (rt <= a.t) { c = a; }
    else for (let i = 0; i < b.length - 1; i++) {
      if (b[i].t <= rt && rt <= b[i + 1].t) { a = b[i]; c = b[i + 1]; k = (rt - a.t) / Math.max(1, c.t - a.t); break; }
    }
    if (c === b[b.length - 1] && rt > c.t) { a = c; k = 1; }

    const nx = a.x + (c.x - a.x) * k, ny = a.y + (c.y - a.y) * k, nz = a.z + (c.z - a.z) * k;
    const stepDist = Math.hypot(nx - this.pos.x, nz - this.pos.z);
    if (stepDist > .002 && stepDist < 2) this.walkPhase += stepDist * 3.2;

    this.pos.set(nx, ny, nz);
    this.yaw = lerpAngle(a.yaw, c.yaw, k);
    this.pitch = a.pitch + (c.pitch - a.pitch) * k;

    this.group.position.set(this.pos.x, this.pos.y - EYE, this.pos.z);
    this.aim.rotation.set(this.pitch, this.yaw, 0);

    // Hide body sprite/cone when spectating inside this player's head, but keep their SpotLight illuminating the maze!
    const showBody = !this.hidden;
    this.body.visible = this.tag.visible = showBody;
    this.beam.visible = this.flare.visible = showBody && this.flashOn;
    this.light.intensity = this.flashOn ? 5.5 : 0;

    if (!showBody) return;

    const glitch = Math.random() < .07;
    const bob = Math.abs(Math.sin(this.walkPhase)) * .045;
    this.body.position.set(glitch ? (Math.random() - .5) * .18 : 0, bob, 0);
    this.body.scale.set(HEIGHT * aspect * (glitch ? .8 + Math.random() * .45 : 1), HEIGHT * (glitch ? .96 + Math.random() * .08 : 1), 1);
    this.mat.opacity = glitch ? .35 + Math.random() * .5 : .9 + Math.random() * .1;
  }

  dispose() {
    this.scene.remove(this.group);
    this.mat.dispose();
    this.beam.geometry.dispose();
    this.beamMat.dispose();
    this.flareMat.dispose();
    this.tag.material.map.dispose();
    this.tag.material.dispose();
  }
}
