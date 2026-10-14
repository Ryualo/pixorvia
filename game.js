import * as THREE from 'three';
import { StressSystem } from './stress.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Multiplayer } from './multiplayer.js';
import { createMonsterAI } from './monster.js';

const CFG = {
  SIZE: 51, CELL: 4, WALL_H: 3.1, EYE: 1.62, R: .3,
  WALK: 3.1, RUN: 5.4, BOB_AMP: .045, BOB_FREQ: 9, STEP: 1 / 60,
  FOG: [0x171406, 3, 24], LIGHTS: 5, LIGHT_RANGE: 15, FIXTURE_EVERY: 3,
  M_WANDER: 1.5, M_STALK: 2.0, M_HUNT: 5.8, M_FLEE: 18,
  WAKE: 18, BEAM_RANGE: 24, BEAM_ANGLE: .3,
  DRAIN: 1 / 100, CHARGE: 1 / 300
};
const T = { FLOOR: 0, WALL: 1, PILLAR: 2 };
const $ = id => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const rnd = (a, b) => a + Math.random() * (b - a);
const mulberry32 = s => () => {
  s = s + 0x6D2B79F5 | 0;
  let t = Math.imul(s ^ s >>> 15, 1 | s);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3(), FWD = new THREE.Vector3();

/* ===================== FAST PROCEDURAL TEXTURES ===================== */
const Tex = {
  make(size, fn) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    fn(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  },
  // OPTIMIZATION: Direct ImageData pixel blending instead of 9,000+ fillRect() & string parses
  noise(g, s, n, a) {
    const img = g.getImageData(0, 0, s, s);
    const D = img.data;
    const invA = 1 - a;
    for (let i = 0; i < n; i++) {
      const v = rnd(45, 220) | 0;
      const r = v, gr = (v * .92) | 0, b = (v * .5) | 0;
      const x0 = (Math.random() * s) | 0;
      const y0 = (Math.random() * s) | 0;
      const w = Math.random() < .45 ? 2 : 1;
      const h = Math.random() < .45 ? 2 : 1;
      for (let dy = 0; dy < h; dy++) {
        const y = (y0 + dy) % s;
        for (let dx = 0; dx < w; dx++) {
          const idx = (y * s + ((x0 + dx) % s)) << 2;
          D[idx]     = D[idx]     * invA + r  * a;
          D[idx + 1] = D[idx + 1] * invA + gr * a;
          D[idx + 2] = D[idx + 2] * invA + b  * a;
        }
      }
    }
    g.putImageData(img, 0, 0);
  },
  blot(g, x, y, rx, ry, c0, c1) {
    const gr = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    gr.addColorStop(0, c0);
    gr.addColorStop(.4, c1);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(x, y, rx, ry, rnd(0, Math.PI), 0, Math.PI * 2);
    g.fill();
  },
  wall(seed) {
    return this.make(512, (g, s) => {
      const P = ['#c8b55c', '#c5b05a', '#d0bc69', '#c0aa51'];
      g.fillStyle = P[seed % 4];
      g.fillRect(0, 0, s, s);
      for (let x = 0; x < s; x++) {
        g.strokeStyle = `rgba(70,55,18,${.018 + Math.random() * .035})`;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + Math.sin(x * .12) * 2, s);
        g.stroke();
      }
      g.fillStyle = 'rgba(120,100,30,.10)';
      for (let x = 0; x < s; x += 32) g.fillRect(x, 0, 12, s);
      g.strokeStyle = 'rgba(95,76,22,.26)';
      g.lineWidth = 1.4;
      g.beginPath();
      for (let y = 16; y < s; y += 32) {
        for (let x = 16; x < s; x += 32) {
          const w = (Math.random() - .5) * 1.8;
          g.moveTo(x, y - 7 + w);
          g.lineTo(x + 5, y);
          g.lineTo(x, y + 7 - w);
          g.lineTo(x - 5, y);
          g.closePath();
        }
      }
      g.stroke();
      g.fillStyle = 'rgba(60,46,14,.22)';
      g.fillRect(s / 2 - 1, 0, 1.5, s);
      g.fillStyle = 'rgba(255,240,170,.08)';
      g.fillRect(s / 2 + 1, 0, 2, s);
      for (let i = 0; i < 3 + seed; i++) {
        const x = rnd(0, s), h = rnd(60, 240), gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, 'rgba(80,60,15,.28)');
        gr.addColorStop(1, 'rgba(80,60,15,0)');
        g.fillStyle = gr;
        g.fillRect(x, 0, rnd(10, 45), h);
      }
      const bd = g.createLinearGradient(0, s, 0, s - 90);
      bd.addColorStop(0, 'rgba(55,45,14,.35)');
      bd.addColorStop(1, 'rgba(55,45,14,0)');
      g.fillStyle = bd;
      g.fillRect(0, s - 90, s, 90);
      for (let i = 0; i < 12; i++) {
        this.blot(g, rnd(-30, s + 30), rnd(-30, s + 30), rnd(8, 62), rnd(5, 35),
          `rgba(${55 + rnd(0, 40) | 0},${48 + rnd(0, 30) | 0},${12 + rnd(0, 15) | 0},${rnd(.08, .2)})`,
          `rgba(88,70,22,${rnd(.025, .09)})`);
      }
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(${40 + rnd(0, 25) | 0},${45 + rnd(0, 25) | 0},20,${rnd(.1, .35)})`;
        g.fillRect(rnd(0, s), s - Math.abs(rnd(-1, 1) * rnd(0, 120)), rnd(1, 3), rnd(1, 3));
      }
      this.noise(g, s, 9000, .028);
    });
  },
  carpet(seed) {
    return this.make(512, (g, s) => {
      g.fillStyle = ['#b5a059', '#ad9751', '#bfa961'][seed % 3];
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < s; i += 4) {
        g.strokeStyle = `rgba(110,85,20,${rnd(.06, .14)})`;
        g.beginPath();
        g.moveTo(i, 0); g.lineTo(i, s);
        g.moveTo(0, i); g.lineTo(s, i);
        g.stroke();
      }
      // OPTIMIZATION: Direct buffer write for 18,000 carpet fibers
      const img = g.getImageData(0, 0, s, s);
      const D = img.data;
      for (let i = 0; i < 18000; i++) {
        const v = rnd(60, 150) | 0;
        const r = v, gr = (v * .85) | 0, b = (v * .35) | 0;
        const a = rnd(.05, .18), invA = 1 - a;
        const x0 = (Math.random() * s) | 0, y0 = (Math.random() * s) | 0;
        const w = Math.random() < .6 ? 2 : 1, h = Math.random() < .6 ? 2 : 1;
        for (let dy = 0; dy < h; dy++) {
          const y = (y0 + dy) % s;
          for (let dx = 0; dx < w; dx++) {
            const idx = (y * s + ((x0 + dx) % s)) << 2;
            D[idx]     = D[idx]     * invA + r  * a;
            D[idx + 1] = D[idx + 1] * invA + gr * a;
            D[idx + 2] = D[idx + 2] * invA + b  * a;
          }
        }
      }
      g.putImageData(img, 0, 0);
      for (let i = 0; i < 12; i++) {
        this.blot(g, rnd(0, s), rnd(0, s), rnd(20, 90), rnd(20, 90), 'rgba(45,35,10,.16)', 'rgba(45,35,10,0)');
      }
    });
  },
  ceiling() {
    return this.make(256, (g, s) => {
      g.fillStyle = '#d4cda9';
      g.fillRect(0, 0, s, s);
      this.noise(g, s, 4000, .08);
      g.strokeStyle = 'rgba(88,82,60,.45)';
      g.lineWidth = 5;
      g.strokeRect(0, 0, s, s);
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(s / 2, 0); g.lineTo(s / 2, s);
      g.moveTo(0, s / 2); g.lineTo(s, s / 2);
      g.stroke();
    });
  },
  smoke() {
    return this.make(64, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(0,0,0,.9)');
      gr.addColorStop(.5, 'rgba(0,0,0,.45)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
    });
  }
};

/* ===================== SHARED MATERIALS & CACHED GEOMETRIES ===================== */
const MATS = {};
const GEOS = {};

// Strips unseen top (+Y) and bottom (-Y) faces from vertical wall/pillar boxes (-33% triangles)
function makeOpenEndedBox(w, h, d) {
  const box = new THREE.BoxGeometry(w, h, d);
  const srcIndex = box.index.array;
  // In THREE.BoxGeometry, face groups are: 0:+X, 1:-X, 2:+Y(top), 3:-Y(bottom), 4:+Z, 5:-Z (6 indices each)
  const newIndices = new Uint16Array(24);
  let ptr = 0;
  for (let face = 0; face < 6; face++) {
    if (face === 2 || face === 3) continue; // Skip top and bottom faces
    const offset = face * 6;
    for (let k = 0; k < 6; k++) newIndices[ptr++] = srcIndex[offset + k];
  }
  box.setIndex(new THREE.BufferAttribute(newIndices, 1));
  box.clearGroups();
  return box;
}

function buildMaterialsAndGeometries() {
  MATS.walls = [0, 1, 2, 3].map(i => new THREE.MeshLambertMaterial({ map: Tex.wall(i) }));
  MATS.floors = [0, 1, 2].map(i => new THREE.MeshLambertMaterial({ map: Tex.carpet(i) }));
  MATS.ceil = new THREE.MeshLambertMaterial({ map: Tex.ceiling() });
  const pt = MATS.walls[1].map.clone();
  pt.repeat.set(.35, 1);
  pt.needsUpdate = true;
  MATS.pillar = new THREE.MeshLambertMaterial({ map: pt });
  MATS.metal = new THREE.MeshLambertMaterial({ color: 0x8d8971 });
  MATS.recess = new THREE.MeshLambertMaterial({ color: 0x4a4636 });
  MATS.cap = new THREE.MeshLambertMaterial({ color: 0x35342c });
  MATS.tube = new THREE.MeshBasicMaterial({ color: 0xffffff });
  MATS.smoke = Tex.smoke();

  // Cache static geometries once across all levels; bake rotations directly into vertices
  const C = CFG.CELL, H = CFG.WALL_H;
  GEOS.wall = makeOpenEndedBox(C, H, C);
  GEOS.pillar = makeOpenEndedBox(C * .34, H, C * .34);

  GEOS.floor = new THREE.PlaneGeometry(C, C);
  GEOS.floor.rotateX(-Math.PI / 2);

  GEOS.ceil = new THREE.PlaneGeometry(C, C);
  GEOS.ceil.rotateX(Math.PI / 2);

  // Fixture boxes don't need top faces (+Y is flush with the ceiling)
  GEOS.housing = new THREE.BoxGeometry(1.9, .08, .8);
  GEOS.recess = new THREE.BoxGeometry(1.7, .04, .62);

  GEOS.tube = new THREE.CylinderGeometry(.04, .04, 1.5, 6, 1, true);
  GEOS.tube.rotateZ(Math.PI / 2);

  GEOS.cap = new THREE.CylinderGeometry(.06, .06, .08, 6);
  GEOS.cap.rotateZ(Math.PI / 2);
}

/* ===================== MAZE GENERATOR ===================== */
class Maze {
  constructor(n) { this.n = n; }
  generate() {
    const n = this.n;
    const g = Array.from({ length: n }, () => new Array(n).fill(T.WALL));
    const st = [1 * n + 1];
    g[1][1] = T.FLOOR;

    while (st.length) {
      const cur = st[st.length - 1];
      const x = (cur / n) | 0, y = cur % n;
      let oLen = 0;
      const ox = [0, 0, 0, 0], oy = [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) {
        const dx = DIRS[i][0], dy = DIRS[i][1];
        const X = x + dx * 2, Y = y + dy * 2;
        if (X > 0 && Y > 0 && X < n - 1 && Y < n - 1 && g[X][Y] === T.WALL) {
          ox[oLen] = dx; oy[oLen] = dy; oLen++;
        }
      }
      if (!oLen) { st.pop(); continue; }
      const pick = (Math.random() * oLen) | 0;
      const dx = ox[pick], dy = oy[pick];
      g[x + dx][y + dy] = g[x + dx * 2][y + dy * 2] = T.FLOOR;
      st.push((x + dx * 2) * n + (y + dy * 2));
    }

    for (let x = 1; x < n - 1; x++) {
      for (let y = 1; y < n - 1; y++) {
        if (g[x][y] === T.WALL && ((x + y) & 1) === 1 && Math.random() < .12) g[x][y] = T.FLOOR;
      }
    }

    const rooms = [];
    const carve = (w, h) => {
      const x = 2 + (Math.random() * (n - w - 4) | 0);
      const y = 2 + (Math.random() * (n - h - 4) | 0);
      for (let a = x; a < x + w; a++) {
        for (let b = y; b < y + h; b++) g[a][b] = T.FLOOR;
      }
      rooms.push([x, y, w, h]);
    };
    for (let i = 0; i < 4; i++) carve(7 + (Math.random() * 5 | 0), 7 + (Math.random() * 5 | 0));
    for (let i = 0; i < 10; i++) carve(3 + (Math.random() * 3 | 0), 3 + (Math.random() * 3 | 0));

    for (const [x, y, w, h] of rooms) {
      if (w >= 7 && h >= 7) {
        for (let a = x + 2; a < x + w - 1; a += 3) {
          for (let b = y + 2; b < y + h - 1; b += 3) {
            if (Math.random() < .55) g[a][b] = T.PILLAR;
          }
        }
      }
    }

    const half = n * .5;
    let sp = { x: n >> 1, y: n >> 1 }, bestSq = 1e9;
    for (let x = 1; x < n - 1; x++) {
      const dxSq = (x - half) * (x - half);
      if (dxSq >= bestSq) continue;
      for (let y = 1; y < n - 1; y++) {
        if (g[x][y] === T.FLOOR) {
          const dSq = dxSq + (y - half) * (y - half);
          if (dSq < bestSq) { bestSq = dSq; sp = { x, y }; }
        }
      }
    }
    this.seal(g, sp.x, sp.y);
    return { grid: g, spawn: sp, rooms };
  }

  seal(g, sx, sy) {
    const n = this.n, seen = new Uint8Array(n * n), st = [sx * n + sy];
    seen[sx * n + sy] = 1;
    while (st.length) {
      const id = st.pop(), x = (id / n) | 0, y = id % n;
      for (let i = 0; i < 4; i++) {
        const X = x + DIRS[i][0], Y = y + DIRS[i][1], k = X * n + Y;
        if (X >= 0 && Y >= 0 && X < n && Y < n && !seen[k] && g[X][Y] !== T.WALL) {
          seen[k] = 1;
          st.push(k);
        }
      }
    }
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        if (!seen[x * n + y]) g[x][y] = T.WALL;
      }
    }
  }
}

/* ===================== WORLD & SPATIAL INDEXING ===================== */
class World {
  constructor(scene, data) {
    this.scene = scene;
    this.grid = data.grid;
    this.n = data.grid.length;
    this.largeRooms = (data.rooms || []).filter(r => r[2] >= 7 && r[3] >= 7);
    this.root = new THREE.Group();
    scene.add(this.root);
    this.fixtures = [];
    this.dirty = false;

    // OPTIMIZATION: Flat typed arrays for O(1) collision, room membership, and audio openness
    const n = this.n, N = n * n;
    this.flatGrid = new Uint8Array(N);
    this.roomMask = new Uint8Array(N);
    this.opennessMap = new Uint8Array(N);

    for (let x = 0; x < n; x++) {
      const col = this.grid[x], rowOff = x * n;
      for (let y = 0; y < n; y++) this.flatGrid[rowOff + y] = col[y];
    }
    for (const [rx, ry, rw, rh] of this.largeRooms) {
      for (let x = rx; x < rx + rw; x++) {
        const rowOff = x * n;
        for (let y = ry; y < ry + rh; y++) this.roomMask[rowOff + y] = 1;
      }
    }
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        let open = 0;
        const x0 = Math.max(0, x - 3), x1 = Math.min(n - 1, x + 3);
        const y0 = Math.max(0, y - 3), y1 = Math.min(n - 1, y + 3);
        for (let ax = x0; ax <= x1; ax++) {
          const rowOff = ax * n;
          for (let ay = y0; ay <= y1; ay++) {
            if (this.flatGrid[rowOff + ay] === T.FLOOR) open++;
          }
        }
        this.opennessMap[x * n + y] = open;
      }
    }

    this.build();
  }

  w(i) { return i * CFG.CELL; }

  // Uses flat coordinate arrays [x0,y0,z0, x1,y1,z1, ...] to avoid thousands of small array allocations
  instFlat(geo, mat, coords) {
    const count = (coords.length / 3) | 0;
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    mesh.count = count;
    const arr = mesh.instanceMatrix.array;
    for (let i = 0; i < count; i++) {
      const cOff = i * 3, mOff = i * 16;
      arr[mOff] = 1;     arr[mOff + 1] = 0; arr[mOff + 2] = 0;  arr[mOff + 3] = 0;
      arr[mOff + 4] = 0; arr[mOff + 5] = 1; arr[mOff + 6] = 0;  arr[mOff + 7] = 0;
      arr[mOff + 8] = 0; arr[mOff + 9] = 0; arr[mOff + 10] = 1; arr[mOff + 11] = 0;
      arr[mOff + 12] = coords[cOff];
      arr[mOff + 13] = coords[cOff + 1];
      arr[mOff + 14] = coords[cOff + 2];
      arr[mOff + 15] = 1;
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.root.add(mesh);
    return mesh;
  }

  build() {
    const H = CFG.WALL_H, halfH = H * .5, n = this.n;
    const walls = [[], [], [], []], floors = [[], [], []], ceil = [], pillars = [];
    const housing = [], recess = [], tubes = [], caps = [];
    const fy = H - .05;

    for (let x = 0; x < n; x++) {
      const rowOff = x * n, X = this.w(x);
      for (let y = 0; y < n; y++) {
        const t = this.flatGrid[rowOff + y], Z = this.w(y);
        if (t === T.WALL) {
          if (this.open(x + 1, y) || this.open(x - 1, y) || this.open(x, y + 1) || this.open(x, y - 1)) {
            walls[(x * 13 + y * 7) & 3].push(X, halfH, Z);
          }
          continue;
        }
        floors[(x * 7 + y * 3) % 3].push(X, 0, Z);
        ceil.push(X, H, Z);
        if (t === T.PILLAR) {
          pillars.push(X, halfH, Z);
        } else if (x % CFG.FIXTURE_EVERY === 0 && y % CFG.FIXTURE_EVERY === 0 && Math.random() < .92) {
          housing.push(X, fy, Z);
          recess.push(X, fy - .05, Z);
          for (const dz of [-.19, .19]) {
            tubes.push(X, fy - .075, Z + dz);
            caps.push(X - .79, fy - .075, Z + dz, X + .79, fy - .075, Z + dz);
          }
          this.fixtures.push({
            pos: new THREE.Vector3(X, H - .25, Z),
            stress: 0, dead: false, dying: 0, flick: 1,
            phase: Math.random() * 10, idx: this.fixtures.length
          });
        }
      }
    }

    walls.forEach((c, i) => this.instFlat(GEOS.wall, MATS.walls[i], c));
    floors.forEach((c, i) => this.instFlat(GEOS.floor, MATS.floors[i], c));
    this.instFlat(GEOS.ceil, MATS.ceil, ceil);
    this.instFlat(GEOS.pillar, MATS.pillar, pillars);
    this.instFlat(GEOS.housing, MATS.metal, housing);
    this.instFlat(GEOS.recess, MATS.recess, recess);
    this.instFlat(GEOS.cap, MATS.cap, caps);

    this.tubes = this.instFlat(GEOS.tube, MATS.tube, tubes);
    this.tubeColor = new THREE.Color();
    const tubeCount = (tubes.length / 3) | 0;
    for (let i = 0; i < tubeCount; i++) this.tubes.setColorAt(i, this.tubeColor.setRGB(1, .96, .8));
    if (this.tubes.instanceColor) this.tubes.instanceColor.needsUpdate = true;
  }

  setTube(f, b) {
    const c = this.tubeColor.setRGB(.06 + b * .94, .06 + b * .9, .05 + b * .75);
    this.tubes.setColorAt(f.idx * 2, c);
    this.tubes.setColorAt(f.idx * 2 + 1, c);
    this.dirty = true;
  }

  dispose() {
    // Geometries are cached in GEOS and reused across levels; only remove the root group
    this.scene.remove(this.root);
  }

  open(x, y) {
    if (x < 0 || y < 0 || x >= this.n || y >= this.n) return false;
    return this.flatGrid[x * this.n + y] !== T.WALL;
  }

  cell(px, pz) {
    return { x: Math.round(px / CFG.CELL), y: Math.round(pz / CFG.CELL) };
  }

  isLargeRoomCell(x, y) {
    if (x < 0 || y < 0 || x >= this.n || y >= this.n) return false;
    return this.roomMask[x * this.n + y] === 1;
  }

  getOpenness(x, y) {
    if (x < 0 || y < 0 || x >= this.n || y >= this.n) return 0;
    return this.opennessMap[x * this.n + y];
  }

  box(x, y) {
    const t = this.grid[x]?.[y], h = CFG.CELL / 2, cx = this.w(x), cz = this.w(y);
    if (t === undefined || t === T.WALL) return [cx - h, cz - h, cx + h, cz + h];
    if (t === T.PILLAR) { const p = CFG.CELL * .17; return [cx - p, cz - p, cx + p, cz + p]; }
    return null;
  }

  // OPTIMIZATION: Zero-allocation AABB collision check
  collides(px, pz, r) {
    const C = CFG.CELL, invC = 1 / C, halfW = C * .5, pilR = C * .17, n = this.n;
    const x0 = Math.round((px - r) * invC), x1 = Math.round((px + r) * invC);
    const y0 = Math.round((pz - r) * invC), y1 = Math.round((pz + r) * invC);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const t = (x >= 0 && y >= 0 && x < n && y < n) ? this.flatGrid[x * n + y] : T.WALL;
        if (t === T.FLOOR) continue;
        const ext = t === T.PILLAR ? pilR : halfW;
        const cx = x * C, cz = y * C;
        if (px + r > cx - ext && px - r < cx + ext && pz + r > cz - ext && pz - r < cz + ext) return true;
      }
    }
    return false;
  }

  // OPTIMIZATION: Zero-allocation Line-of-Sight check using flatGrid
  los(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const d = Math.hypot(dx, dz), s = Math.ceil(d * 2);
    const invC = 1 / CFG.CELL, n = this.n, fg = this.flatGrid;
    for (let i = 1; i < s; i++) {
      const t = i / s;
      const cx = Math.round((ax + dx * t) * invC);
      const cy = Math.round((az + dz * t) * invC);
      if (cx < 0 || cy < 0 || cx >= n || cy >= n) return false;
      const cell = fg[cx * n + cy];
      if (cell !== T.FLOOR && cell !== T.PILLAR) return false;
    }
    return true;
  }
}

/* ===================== PUDDLE / SLIME SLICK ===================== */
class GooTrail {
  constructor(scene) {
    this.count = 600;
    this.idx = 0;
    this.activeCount = 0;
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.geo.rotateX(-Math.PI / 2);
    this.tex = GooTrail.makeTexture();
    this.mat = new THREE.MeshBasicMaterial({
      color: 0x000000, map: this.tex, alphaMap: this.tex,
      transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, this.count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3();
    this.p = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    scene.add(this.mesh);
    this.clear();
  }
  static makeTexture() {
    const s = 256, c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, s, s);
    const blob = (x, y, r, a) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,255,255,${a})`);
      gr.addColorStop(.55, `rgba(255,255,255,${a * .85})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    };
    g.filter = 'blur(3px)';
    blob(s / 2, s / 2, s * .3, 1);
    for (let i = 0; i < 14; i++) {
      const a = rnd(0, Math.PI * 2), d = rnd(10, 58);
      blob(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, rnd(18, 44), rnd(.7, 1));
    }
    for (let i = 0; i < 9; i++) {
      const a = rnd(0, Math.PI * 2);
      let x = s / 2, y = s / 2, r = rnd(10, 16);
      for (let k = 0; k < 7; k++) {
        x += Math.cos(a) * r * .9;
        y += Math.sin(a) * r * .9;
        r *= .78;
        if (Math.hypot(x - s / 2, y - s / 2) > s * .44) break;
        blob(x, y, r, .95);
      }
    }
    for (let i = 0; i < 22; i++) {
      const a = rnd(0, Math.PI * 2), d = rnd(70, 108);
      blob(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, rnd(2, 7), rnd(.6, 1));
    }
    g.filter = 'none';
    const img = g.getImageData(0, 0, s, s), D = img.data;
    for (let i = 0; i < D.length; i += 4) {
      const v = D[i] / 255, e = clamp((v - .18) / .35, 0, 1), o = Math.pow(e, .7) * 255;
      D[i] = D[i + 1] = D[i + 2] = o;
      D[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  }
  // OPTIMIZATION: O(1) clear by setting mesh.count = 0 instead of uploading 600 zero-scale matrices
  clear() {
    this.idx = 0;
    this.activeCount = 0;
    this.mesh.count = 0;
  }
  drop(x, z, sx, sz, yaw = rnd(0, Math.PI * 2)) {
    this.q.setFromAxisAngle(this.up, yaw);
    this.p.set(x, .012, z);
    this.s.set(sx, 1, sz);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(this.idx, this.m);
    this.idx = (this.idx + 1) % this.count;
    if (this.activeCount < this.count) {
      this.activeCount++;
      this.mesh.count = this.activeCount;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  trail(x, z, dirX = 0, dirZ = 0, speedK = 1) {
    const yaw = Math.atan2(-dirZ, dirX) + rnd(-.25, .25);
    const len = rnd(.7, 1.2) * (1 + speedK * .8), wid = rnd(.45, .8);
    this.drop(x + rnd(-.25, .25), z + rnd(-.25, .25), len, wid, yaw);
    if (Math.random() < .3) this.drop(x + rnd(-.6, .6), z + rnd(-.6, .6), rnd(.25, .45), rnd(.25, .45));
  }
  pool(x, z, size = 1) {
    this.drop(x, z, rnd(2, 2.8) * size, rnd(1.7, 2.5) * size);
    const n = 2 + (Math.random() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), d = rnd(.8, 1.5) * size;
      this.drop(x + Math.cos(a) * d, z + Math.sin(a) * d, rnd(.6, 1.2) * size, rnd(.5, 1) * size);
    }
  }
}

/* ===================== LIGHTING SYSTEM ===================== */
class Lighting {
  constructor(scene) {
    this.pool = [];
    for (let i = 0; i < CFG.LIGHTS; i++) {
      const l = new THREE.PointLight(0xffe9a7, 0, CFG.LIGHT_RANGE, 1.7);
      l.userData.f = null;
      scene.add(l);
      this.pool.push(l);
    }
    this.amb = new THREE.AmbientLight(0x71673b, .32);
    this.hemi = new THREE.HemisphereLight(0xffefb0, 0x151208, .22);
    scene.add(this.amb, this.hemi);
    this.timer = 0;
    this.near = new Array(CFG.LIGHTS).fill(null);
    this.nearDist = new Float32Array(CFG.LIGHTS);
    this.maxStress = 0;
    this.dark = false;
  }
  setDark(on) {
    this.dark = on;
    this.amb.intensity = on ? 0 : .32;
    this.hemi.intensity = on ? 0 : .22;
    if (on) {
      for (const l of this.pool) l.intensity = 0;
      const w = this.world;
      if (w) {
        for (const f of w.fixtures) w.setTube(f, 0);
        w.tubes.instanceColor.needsUpdate = true;
        w.dirty = false;
      }
    }
  }
  setWorld(world) {
    this.world = world;
    this.timer = 0;
    for (const l of this.pool) { l.userData.f = null; l.intensity = 0; }
  }
  // OPTIMIZATION: Allocation-free top-K light selection & single-pass fixture update
  update(dt, pos, monster) {
    if (this.dark) { this.maxStress = 0; return; }
    const w = this.world, F = w.fixtures, len = F.length;
    const mp = (monster.active && monster.mode !== 'stalk') ? monster.pos : null;
    const px = pos.x, pz = pos.z;

    if ((this.timer -= dt) <= 0) {
      this.timer = .2;
      const K = this.pool.length;
      const near = this.near, nearDist = this.nearDist;
      for (let i = 0; i < K; i++) { near[i] = null; nearDist[i] = Infinity; }

      for (let i = 0; i < len; i++) {
        const f = F[i];
        if (f.dead) continue;
        const dx = f.pos.x - px, dz = f.pos.z - pz;
        if (dx > 30 || dx < -30 || dz > 30 || dz < -30) continue;
        const dSq = dx * dx + dz * dz;
        if (dSq >= nearDist[K - 1]) continue;
        let ins = K - 1;
        while (ins > 0 && dSq < nearDist[ins - 1]) {
          nearDist[ins] = nearDist[ins - 1];
          near[ins] = near[ins - 1];
          ins--;
        }
        nearDist[ins] = dSq;
        near[ins] = f;
      }
      for (let i = 0; i < K; i++) {
        const l = this.pool[i], f = near[i];
        l.userData.f = f;
        if (f) l.position.copy(f.pos);
        else l.intensity = 0;
      }
    }

    let maxS = 0;
    const mpx = mp ? mp.x : 0, mpz = mp ? mp.z : 0;

    for (let i = 0; i < len; i++) {
      const f = F[i];
      if (f.dead) continue;

      let target = 0;
      if (mp) {
        const dx = f.pos.x - mpx, dz = f.pos.z - mpz;
        if (dx < 11 && dx > -11 && dz < 11 && dz > -11) {
          const dSq = dx * dx + dz * dz;
          if (dSq < 121) target = clamp((11 - Math.sqrt(dSq)) * .125, 0, 1);
        }
      }

      if (target === 0 && f.stress === 0 && f.flick === 1) {
        // Fast path for undisturbed fixtures: only 0.15% chance per frame to micro-flicker
        if (Math.random() > .0015) continue;
      } else {
        f.stress += (target - f.stress) * Math.min(1, dt * (target > f.stress ? .8 : .3));
        if (f.stress < .001 && target === 0) f.stress = 0;
      }

      f.phase += dt;
      const s = f.stress;
      let b = 1;
      if (s < .3) b = Math.random() < .004 + s * .03 ? rnd(.55, .85) : 1;
      else if (s < .6) b = (Math.sin(f.phase * 47) > .6 ? .55 : 1) * (Math.random() < .06 ? .3 : 1);
      else if (s < .88) b = Math.random() < .35 ? rnd(0, .25) : rnd(.7, 1);
      else {
        f.dying += dt;
        b = Math.random() < .6 ? 0 : rnd(.2, .6);
        if (f.dying > 1.6) {
          f.dead = true;
          f.flick = 0;
          w.setTube(f, 0);
          monster.g.audio.pop(f.pos);
          continue;
        }
      }
      if (s < .88 && f.dying > 0) f.dying = Math.max(0, f.dying - dt);

      const oldFlick = f.flick;
      f.flick += (b - f.flick) * .6;
      if (Math.abs(f.flick - 1) < .02 && s < .02) f.flick = 1;
      if (Math.abs(oldFlick - f.flick) > .02) w.setTube(f, f.flick);

      if (s > maxS) {
        const pdx = f.pos.x - px, pdz = f.pos.z - pz;
        if (pdx * pdx + pdz * pdz < 144) maxS = s;
      }
    }

    for (let i = 0; i < this.pool.length; i++) {
      const l = this.pool[i], f = l.userData.f;
      l.intensity = f && !f.dead ? 3.9 * f.flick : 0;
    }
    if (w.dirty) {
      w.tubes.instanceColor.needsUpdate = true;
      w.dirty = false;
    }
    this.maxStress = maxS;
  }
}

/* ===================== PLAYER CONTROLLER ===================== */
class Player {
  constructor(g) {
    this.g = g;
    this.controls = new PointerLockControls(g.camera, document.body);
    this.keys = {};
    this.isMobileDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    this.bob = 0;
    this.moving = false;
    this.dir = new THREE.Vector3();
    this.right = new THREE.Vector3();

    addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'KeyF' && !e.repeat && this.controls.isLocked) g.flash.toggle();
      if (e.code === 'KeyR' && !this.controls.isLocked && !g.dead) g.mp?.coop ? g.mp.escape() : g.newLevel();
      if (e.code === 'KeyC' && !e.repeat && this.controls.isLocked && !g.dead) g.cameraBlast();
    });
    addEventListener('mousedown', e => {
      if (e.button === 0 && this.controls.isLocked && !g.dead && e.target.tagName === 'CANVAS') g.cameraBlast();
    });
    addEventListener('keyup', e => this.keys[e.code] = false);
    addEventListener('blur', () => this.keys = {});

    const bindBtn = (id, code) => {
      const btn = $(id);
      if (!btn) return;
      const release = () => { this.keys[code] = false; };
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        this.keys[code] = true;
        try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      });
      btn.addEventListener('pointerup', e => { e.preventDefault(); release(); });
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('touchstart', e => { e.preventDefault(); this.keys[code] = true; }, { passive: false });
      btn.addEventListener('touchend', e => { e.preventDefault(); release(); }, { passive: false });
      btn.addEventListener('touchcancel', release, { passive: false });
      btn.addEventListener('contextmenu', e => e.preventDefault());
    };
    bindBtn('btn-w', 'KeyW'); bindBtn('btn-a', 'KeyA'); bindBtn('btn-s', 'KeyS'); bindBtn('btn-d', 'KeyD');
    bindBtn('btn-shift', 'ShiftLeft'); bindBtn('btn-e', 'KeyE');

    const bindAction = (id, action) => {
      const btn = $(id);
      if (!btn) return;
      let lastTouch = 0;
      const run = e => {
        e.preventDefault();
        const now = Date.now();
        if (e.type === 'touchstart' && now - lastTouch < 350) return;
        lastTouch = now;
        action();
      };
      btn.addEventListener('pointerdown', run);
      btn.addEventListener('touchstart', run, { passive: false });
      btn.addEventListener('contextmenu', e => e.preventDefault());
    };
    bindAction('btn-f', () => g.flash.toggle());
    bindAction('btn-c', () => g.cameraBlast());
    bindAction('btn-restart', () => { if (!g.dead) g.mp?.coop ? g.mp.escape() : g.newLevel(); });

    let camTouchId = null, tX = 0, tY = 0;
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');

    document.addEventListener('touchstart', e => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.target.tagName === 'CANVAS' && camTouchId === null) {
          camTouchId = t.identifier;
          tX = t.pageX; tY = t.pageY;
        }
      }
    }, { passive: false });

    document.addEventListener('touchmove', e => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === camTouchId) {
          e.preventDefault();
          const dx = t.pageX - tX, dy = t.pageY - tY;
          tX = t.pageX; tY = t.pageY;
          euler.setFromQuaternion(g.camera.quaternion);
          euler.y -= dx * .005;
          euler.x = clamp(euler.x - dy * .005, -Math.PI / 2, Math.PI / 2);
          g.camera.quaternion.setFromEuler(euler);
        }
      }
    }, { passive: false });

    const endTouch = e => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === camTouchId) camTouchId = null;
      }
    };
    document.addEventListener('touchend', endTouch, { passive: false });
    document.addEventListener('touchcancel', endTouch, { passive: false });
  }

  get running() {
    const standoff = this.g.stressSystem && this.g.stressSystem.dlbState === 'standoff';
    return (this.keys.ShiftLeft || this.keys.ShiftRight) && !this.keys.KeyE && !standoff;
  }
  get winding() { return !!this.keys.KeyE; }

  update(dt) {
    if ((!this.controls.isLocked && !this.isMobileDevice) || this.g.dead) { this.moving = false; return; }

    const standoff = this.g.stressSystem && this.g.stressSystem.dlbState === 'standoff';
    const k = this.keys, wind = this.winding && !this.g.dark;

    let s = wind ? CFG.WALK * .4 : (this.running ? CFG.RUN : CFG.WALK);
    if (standoff) s = CFG.WALK * .25;

    const f = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), sd = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    const cam = this.g.camera;
    cam.getWorldDirection(this.dir);
    this.dir.y = 0;
    this.dir.normalize();
    this.right.crossVectors(this.dir, cam.up);
    const m = this.dir.multiplyScalar(f).add(this.right.multiplyScalar(sd));
    this.moving = m.lengthSq() > 0;
    if (this.moving) m.normalize().multiplyScalar(s * dt);

    const p = cam.position, r = CFG.R, w = this.g.world;
    if (!w.collides(p.x + m.x, p.z, r)) p.x += m.x;
    if (!w.collides(p.x, p.z + m.z, r)) p.z += m.z;
    this.bob = this.moving ? this.bob + dt * CFG.BOB_FREQ * (s / CFG.WALK) : this.bob * .9;

    if (standoff) this.bob += dt * 15;
    p.y = CFG.EYE + Math.sin(this.bob) * CFG.BOB_AMP * (this.moving ? 1 : Math.min(1, Math.abs(this.bob)));
  }
}

/* ===================== FLASHLIGHT ===================== */
class Flashlight {
  constructor(g) {
    this.g = g;
    this.on = true;
    this.battery = 1;
    this.sway = new THREE.Vector2();
    this.st = new THREE.Vector2();
    this.flk = 1;
    this.spot = new THREE.SpotLight(0xfff2d0, 0, CFG.BEAM_RANGE, Math.PI / 8, .55, 1.3);
    this.spot.position.set(.05, -.05, 0);
    this.target = new THREE.Object3D();
    this.target.position.set(0, 0, -1);
    this.spot.add(this.target);
    this.spot.target = this.target;
    this.fill = new THREE.PointLight(0xffe8bd, 0, 3, 2);
    g.camera.add(this.spot, this.fill);
    this.bar = $('bar').firstElementChild;
    this.pct = $('pct');
    this.dirW = new THREE.Vector3();
    this.tw = new THREE.Vector3();
    this.sw = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.msg = $('crank-msg');
    this._lastPct = -1;
    this._lastWinding = false;
  }
  toggle() {
    if (this.g.dark) return;
    if (!this.on && this.battery <= 0) { this.g.say('BATTERY DEAD'); return; }
    this.on = !this.on;
    this.g.say(this.on ? 'FLASHLIGHT ON' : 'FLASHLIGHT OFF');
    this.g.audio.click();
  }
  update(dt) {
    const winding = !!(this.g.player.keys.KeyE && !this.g.dark);
    if (winding) {
      this.battery = Math.min(1, this.battery + dt * CFG.CHARGE);
      this.g.audio.windTick();
    }
    if (winding !== this._lastWinding) {
      this.msg.style.display = winding ? 'inline-block' : 'none';
      this._lastWinding = winding;
    }
    if (this.on) {
      this.battery -= dt * CFG.DRAIN;
      if (this.battery <= 0) { this.battery = 0; this.on = false; this.g.blackout(); }
    }
    const p = this.g.player;
    this.st.set(p.moving ? Math.sin(p.bob) * .03 : 0, p.moving ? Math.cos(p.bob * 2) * .02 : 0);
    this.sway.lerp(this.st, Math.min(1, dt * 6));
    this.spot.rotation.set(this.sway.y, this.sway.x, 0);
    this.flk = this.battery < .18 && Math.random() < .08 ? rnd(.1, .6) : this.flk + (1 - this.flk) * .3;
    const k = this.on ? this.flk : 0;
    this.spot.intensity = k * (5 + this.battery * 4);
    this.fill.intensity = k * .5;

    // OPTIMIZATION: Avoid DOM layout updates unless rounded percentage changes
    const pctInt = Math.round(this.battery * 1000);
    if (pctInt !== this._lastPct) {
      this._lastPct = pctInt;
      this.bar.style.width = (pctInt * .1).toFixed(1) + '%';
      this.pct.textContent = Math.round(pctInt * .1) + '%';
    }
  }
  hits(p) {
    if (!this.on || this.spot.intensity < .5) return false;
    const c = this.g.camera.position;
    this.target.getWorldPosition(this.tw);
    this.spot.getWorldPosition(this.sw);
    this.dirW.subVectors(this.tw, this.sw).normalize();
    this.to.subVectors(p, c);
    const d = this.to.length();
    if (d > CFG.BEAM_RANGE || d < .01) return false;
    const ang = CFG.BEAM_ANGLE + Math.min(.35, .6 / d);
    return this.to.multiplyScalar(1 / d).dot(this.dirW) > Math.cos(ang) && this.g.world.los(c.x, c.z, p.x, p.z);
  }
}

/* ===================== MONSTER BASE ===================== */
class Monster {
  constructor(g) {
    this.g = g;
    this.group = new THREE.Group();
    g.scene.add(this.group);
    this.pos = this.group.position;
    this.active = false;
    this.mode = 'stalk';
    this.respawn = 7;
    this.path = [];
    this.t = Math.random() * 10;
    this.stride = 0;

    const N = CFG.SIZE * CFG.SIZE;
    this.prev = new Int32Array(N);
    this.q = new Int32Array(N);
    this.distMap = new Int32Array(N);
    this.dep = new Int32Array(N);

    this.dir = new THREE.Vector3(0, 0, 1);
    this.lastGoo = new THREE.Vector3();
    this.target = null;
    this.U = { uTime: { value: 0 }, uWarp: { value: 1 }, uShudder: { value: 0 } };

    this.body = new THREE.Group();
    this.group.add(this.body);

    this.buildBody();
    this.buildShroud();
    this.buildEyes();

    this.straightT = 0; this.straightLen = 0; this.lastYaw = 0;
    this.lureT = rnd(20, 40); this.freeze = 0; this.blood = 0; this.pathT = 0; this.spinT = 0;
    this._neckSnap = 0; this._neckTimer = 0;
    this.group.visible = false;
    this.reset();
  }

  voidMat(sway) {
    const m = new THREE.MeshStandardMaterial({
      color: 0x020202, roughness: .18, metalness: .45,
      transparent: true, opacity: 1, fog: true
    });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.U);
      sh.uniforms.uSway = { value: sway };
      sh.vertexShader = 'uniform float uTime;uniform float uWarp;uniform float uShudder;uniform float uSway;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        float h = position.y;
        // High-frequency organic skin ripple + spinal boiling
        float n = sin(h * 6.0 + uTime * 2.4) * 0.5 + sin(h * 13.0 - uTime * 4.1 + position.x * 5.0) * 0.25;
        float lean = uWarp * (0.025 + 0.06 * uSway) * n;
        transformed.x += lean + sin(uTime * 47.0 + h * 29.0) * 0.038 * uShudder * (0.4 + 0.6 * uSway);
        transformed.z += cos(h * 5.0 + uTime * 2.1 + position.x * 4.0) * 0.02 * uWarp + cos(uTime * 43.0 + h * 23.0) * 0.038 * uShudder * (0.4 + 0.6 * uSway);
        // Ribcage expansion breathing
        float breath = 0.085 * sin(uTime * 1.6) * smoothstep(0.0, 0.5, h) * smoothstep(1.2, 0.7, h);
        transformed.xz *= 1.0 + breath * (1.0 - uSway);
      `);
    };
    m.customProgramCacheKey = () => 'voidshadow_v3_' + sway;
    return m;
  }

  buildBody() {
    this.bodyMat = this.voidMat(0);
    this.limbMat = this.voidMat(1);

    // 1. PELVIS & HUNCHED RIBCAGE TORSO
    this.torsoPivot = new THREE.Group();
    this.torsoPivot.position.set(0, 1.15, 0);
    this.body.add(this.torsoPivot);

    // Asymmetric gaunt torso profile (narrow waist, wide ribcage, hunched neck)
    const prof = [
      [0, 0.0], [.12, .04], [.09, .28], [.08, .52], [.19, .78],
      [.25, 1.02], [.22, 1.22], [.11, 1.34], [0, 1.38]
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const torsoGeo = new THREE.LatheGeometry(prof, 12);
    torsoGeo.scale(1.05, 1, .58);
    const torsoMesh = new THREE.Mesh(torsoGeo, this.bodyMat);
    torsoMesh.rotation.x = 0.14; // Permanent predatory forward hunch
    this.torsoPivot.add(torsoMesh);

    // Protruding spinal vertebrae & dorsal spikes along the hunched back
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const spike = new THREE.ConeGeometry(.022 + Math.sin(t * Math.PI) * .018, .14 + Math.sin(t * Math.PI) * .12, 5);
      spike.rotateX(-Math.PI * 0.62);
      spike.translate((i % 2 ? .012 : -.012), 0.25 + t * 0.95, -0.11 - Math.sin(t * Math.PI) * 0.08);
      this.torsoPivot.add(new THREE.Mesh(spike, this.bodyMat));
    }

    // Floating rib-like tendrils dripping from the chest
    for (let i = 0; i < 6; i++) {
      const h = rnd(.9, 1.5);
      const t = new THREE.CylinderGeometry(.026, .003, h, 5, 10);
      t.translate(0, -h / 2, 0);
      t.rotateX(rnd(-.35, .25));
      t.rotateZ(rnd(-.35, .35));
      t.translate(rnd(-.16, .16), rnd(.75, 1.15), rnd(-.12, .08));
      this.torsoPivot.add(new THREE.Mesh(t, this.limbMat));
    }

    // 2. ARTICULATED HEAD & UNHINGING JAW (Exposes headBone for monster.js)
    this.headBone = new THREE.Group();
    this.headBone.position.set(0, 1.36, 0.16);
    this.torsoPivot.add(this.headBone);

    // Elongated, gaunt cranium
    const skullGeo = new THREE.SphereGeometry(.135, 10, 10);
    skullGeo.scale(.82, 1.35, 1.05);
    skullGeo.translate(0, .14, 0);
    this.headBone.add(new THREE.Mesh(skullGeo, this.bodyMat));

    // Hinged lower jaw that drops open during chases/screams
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, .05, .02);
    const jawGeo = new THREE.ConeGeometry(.095, .24, 7);
    jawGeo.scale(.78, 1, .9);
    jawGeo.rotateX(Math.PI * 0.88);
    jawGeo.translate(0, -.08, .05);
    this.jaw.add(new THREE.Mesh(jawGeo, this.bodyMat));
    this.headBone.add(this.jaw);

    // Compatibility shim so monster.js `this.body.skeleton.getBoneByName('Head')` works natively
    this.body.skeleton = {
      getBoneByName: () => this.headBone
    };

    // 3. ARTICULATED MULTI-JOINTED ARMS & CLAWS
    this.arms = [];
    for (const sx of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(sx * .26, 1.16, .12);
      this.torsoPivot.add(shoulder);

      const upperArmGeo = new THREE.CylinderGeometry(.05, .032, .95, 7, 8);
      upperArmGeo.translate(0, -.475, 0);
      shoulder.add(new THREE.Mesh(upperArmGeo, this.limbMat));

      const elbow = new THREE.Group();
      elbow.position.set(0, -.92, 0);
      shoulder.add(elbow);

      const forearmGeo = new THREE.CylinderGeometry(.032, .018, 1.05, 7, 10);
      forearmGeo.translate(0, -.525, 0);
      elbow.add(new THREE.Mesh(forearmGeo, this.limbMat));

      // 4 Long, crooked spider-like fingers per hand
      for (let f = 0; f < 4; f++) {
        const flen = f === 1 || f === 2 ? .58 : .42;
        const finger = new THREE.CylinderGeometry(.012, .002, flen, 5, 6);
        finger.translate(0, -flen / 2, 0);
        finger.rotateZ(sx * (.08 + (f - 1.5) * .11));
        finger.rotateX(.22 + (f % 2) * .14);
        finger.translate(sx * .02, -1.02, (f - 1.5) * .025);
        elbow.add(new THREE.Mesh(finger, this.limbMat));
      }

      this.arms.push({ shoulder, elbow, sx });
    }

    // 4. ARTICULATED LEGS (Thigh + Shin)
    this.legs = [];
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(sx * .12, 1.15, 0);
      this.body.add(hip);

      const thighGeo = new THREE.CylinderGeometry(.065, .042, .62, 7, 6);
      thighGeo.translate(0, -.31, 0);
      hip.add(new THREE.Mesh(thighGeo, this.bodyMat));

      const knee = new THREE.Group();
      knee.position.set(0, -.6, 0);
      hip.add(knee);

      const shinGeo = new THREE.CylinderGeometry(.042, .075, .62, 7, 8);
      shinGeo.translate(0, -.31, 0);
      knee.add(new THREE.Mesh(shinGeo, this.bodyMat));

      this.legs.push({ hip, knee, sx, lastStepSign: 0 });
    }
  }

  buildShroud() {
    this.puffs = [];
    for (let i = 0; i < 26; i++) {
      const m = new THREE.SpriteMaterial({
        map: MATS.smoke, transparent: true, opacity: 0,
        depthWrite: false, fog: true, rotation: rnd(0, 6)
      });
      const s = new THREE.Sprite(m);
      this.group.add(s);
      s.userData = {
        life: rnd(0, 1), dur: rnd(2.2, 4.2), a: rnd(0, Math.PI * 2),
        r: rnd(.05, .55), y0: rnd(0, 2.6), rise: rnd(.25, .7),
        size: rnd(.9, 2.1), spin: rnd(-.4, .4)
      };
      this.puffs.push(s);
    }
  }

  buildEyes() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d'), gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,245,230,1)');
    gr.addColorStop(.08, 'rgba(255,50,15,1)');
    gr.addColorStop(.3, 'rgba(190,5,0,.45)');
    gr.addColorStop(1, 'rgba(120,0,0,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 64, 64);

    this.eyeMat = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c), color: 0xff2a10,
      transparent: true, opacity: 0, depthWrite: false,
      fog: false, blending: THREE.AdditiveBlending
    });
    this.eyes = [];
    // Attach eyes to headBone so they move with head turns and neck tilts!
    for (const sx of [-1, 1]) {
      const e = new THREE.Sprite(this.eyeMat);
      e.position.set(sx * .052, .16, .11);
      this.headBone.add(e);
      this.eyes.push(e);
    }
  }

  reset() {
    this.active = false;
    this.group.visible = false;
    this.mode = 'stalk';
    this.respawn = rnd(6, 11);
    this.path.length = 0;
    this.lingerT = 0; this.lingerAcc = 0; this.pooled = false; this.travelling = false; this.peeking = false;
    this.seenT = 0; this.litT = 0; this.lostT = 0; this.agonyT = 0; this.pathT = 0; this.floodT = 0;
    this.dartCD = 4; this.peekCD = 15; this.speed = 0; this.freeze = 0; this.spinT = 0;
    this.straightLen = 0; this.straightT = 0;
    $('danger').style.opacity = 0;
  }

  dist() {
    const c = this.g.camera.position;
    return Math.hypot(this.pos.x - c.x, this.pos.z - c.z);
  }

  openCount(x, y) {
    const fg = this.g.world.flatGrid, n = this.g.world.n;
    let k = 0;
    for (let i = 0; i < 4; i++) {
      const X = x + DIRS[i][0], Y = y + DIRS[i][1];
      if (X >= 0 && Y >= 0 && X < n && Y < n && fg[X * n + Y] === T.FLOOR) k++;
    }
    return k;
  }

  flood(cx, cy) {
    const w = this.g.world, n = w.n, fg = w.flatGrid, D = this.distMap, q = this.q;
    D.fill(-1);
    let h = 0, t = 0;
    const s = cx * n + cy;
    D[s] = 0; q[t++] = s;
    while (h < t) {
      const id = q[h++], x = (id / n) | 0, y = id % n, nextD = D[id] + 1;
      for (let i = 0; i < 4; i++) {
        const X = x + DIRS[i][0], Y = y + DIRS[i][1];
        if (X < 0 || Y < 0 || X >= n || Y >= n) continue;
        const k = X * n + Y;
        if (D[k] === -1 && fg[k] === T.FLOOR) { D[k] = nextD; q[t++] = k; }
      }
    }
  }

  search(maxDepth, score, avoid = 0) {
    const w = this.g.world, n = w.n, fg = w.flatGrid, prev = this.prev, q = this.q, dep = this.dep, D = this.distMap;
    const mx = Math.round(this.pos.x / CFG.CELL), my = Math.round(this.pos.z / CFG.CELL);
    prev.fill(-1);
    const s = mx * n + my;
    let h = 0, t = 0, best = -1, bestS = -Infinity;
    q[t++] = s; prev[s] = s; dep[s] = 0;
    while (h < t) {
      const id = q[h++], x = (id / n) | 0, y = id % n, curDep = dep[id];
      if (id !== s) {
        const sc = score(id, curDep, x * CFG.CELL, y * CFG.CELL);
        if (sc > bestS) { bestS = sc; best = id; }
      }
      if (curDep >= maxDepth) continue;
      const nextDep = curDep + 1;
      for (let i = 0; i < 4; i++) {
        const X = x + DIRS[i][0], Y = y + DIRS[i][1];
        if (X < 0 || Y < 0 || X >= n || Y >= n) continue;
        const k = X * n + Y;
        if (prev[k] === -1 && fg[k] === T.FLOOR && !(avoid && D[k] >= 0 && D[k] < avoid)) {
          prev[k] = id; dep[k] = nextDep; q[t++] = k;
        }
      }
    }
    this.path.length = 0;
    if (best < 0 || bestS === -Infinity) return false;
    let cur = best;
    while (cur !== s) { this.path.push(cur); cur = prev[cur]; }
    this.path.reverse();
    return true;
  }

  stepBy(dx, dz) {
    const w = this.g.world, p = this.pos, l = Math.hypot(dx, dz);
    if (l < 1e-5) return;
    if (!w.collides(p.x + dx, p.z, .2)) p.x += dx;
    if (!w.collides(p.x, p.z + dz, .2)) p.z += dz;
    const invL = 1 / l;
    this.dir.x += (dx * invL - this.dir.x) * .25;
    this.dir.z += (dz * invL - this.dir.z) * .25;
    this.dir.normalize();
  }

  animate(dt, lit, d, eyesOnly = false) {
    const g = this.g, c = g.camera.position;
    this.t += dt;
    const m = this.mode, agony = (m === 'retreat' && this.agonyT > 0) || this.freeze > 0;
    const chasing = m === 'CHASE', fast = this.speed > 4;

    const yaw = Math.atan2(this.dir.x, this.dir.z);
    let dy = yaw - this.group.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.group.rotation.y += dy * Math.min(1, dt * (fast ? 12 : 4));

    let vis = chasing ? 1 : m === 'bloodlust' ? 0 : m === 'backStalk' ? 1 : m === 'dart' ? .85 : agony ? 1 : m === 'lure' ? 1 : m === 'retreat' ? .75 : this.peeking ? .75 : .6;
    vis *= clamp((36 - d) / 14, 0, 1);

    if (vis > .005) {
      this.U.uTime.value = this.t;
      this.U.uWarp.value += ((chasing ? 2.4 : fast ? 1.7 : 1) - this.U.uWarp.value) * Math.min(1, dt * 4);
      this.U.uShudder.value += ((agony ? 3.2 : lit ? 1.8 : chasing ? .9 : 0) - this.U.uShudder.value) * Math.min(1, dt * 10);

      // 1. PROCEDURAL SPIDER-GAIT LEG STEPPING + SYNCED AUDIO FOOTSTEPS
      const moveFactor = clamp(this.speed / CFG.WALK, 0, 2.2);
      if (this.speed > 0.08) {
        this.stride += dt * (2.6 + this.speed * 1.35);
      }
      const pelvisDrop = moveFactor > 0.05 ? Math.abs(Math.sin(this.stride)) * 0.06 * moveFactor : 0;
      this.torsoPivot.position.y = 1.15 - pelvisDrop;

      for (let i = 0; i < 2; i++) {
        const leg = this.legs[i];
        const phase = this.stride + i * Math.PI;
        const s = Math.sin(phase), cs = Math.cos(phase);
        const swing = s * 0.52 * Math.min(1.4, moveFactor);
        const lift = Math.max(0, cs) * 0.65 * Math.min(1.4, moveFactor);

        leg.hip.rotation.x += (swing - lift * 0.45 - leg.hip.rotation.x) * Math.min(1, dt * 14);
        leg.hip.rotation.z = leg.sx * (0.04 + 0.03 * Math.sin(this.t * 1.7));
        leg.knee.rotation.x += ((0.18 + lift * 1.15) - leg.knee.rotation.x) * Math.min(1, dt * 14);

        // Trigger heavy spatial footstep audio right as the foot plants!
        const sign = s >= 0 ? 1 : -1;
        if (this.speed > 0.4 && sign !== leg.lastStepSign && cs < 0 && d < 28) {
          leg.lastStepSign = sign;
          g.audio?.monsterStep?.(this.pos, d);
        }
      }

      // 2. PREDATORY ARM REACHING & WALL-DRAGGING
      const reach = chasing ? clamp((9 - d) / 7, 0.25, 1.15) : (this.peeking ? 0.45 : 0);
      for (let i = 0; i < 2; i++) {
        const arm = this.arms[i];
        const armPhase = this.stride + (1 - i) * Math.PI;
        const walkSwing = Math.sin(armPhase) * 0.28 * Math.min(1.2, moveFactor);
        const twitch = agony ? rnd(-.35, .35) : Math.sin(this.t * 2.3 + i * 2.1) * 0.06;

        // Raise arms forward to grab the player when chasing & close
        const targetPitch = -reach * 1.35 + walkSwing * (1 - reach * 0.6) + twitch;
        const targetRoll = arm.sx * (0.09 + reach * 0.22 + Math.sin(this.t * 1.4 + i) * 0.04);
        const targetElbow = -0.25 - reach * 0.65 - Math.max(0, -walkSwing) * 0.35;

        arm.shoulder.rotation.x += (targetPitch - arm.shoulder.rotation.x) * Math.min(1, dt * 10);
        arm.shoulder.rotation.z += (targetRoll - arm.shoulder.rotation.z) * Math.min(1, dt * 10);
        arm.elbow.rotation.x += (targetElbow - arm.elbow.rotation.x) * Math.min(1, dt * 12);
      }

      // 3. UNCANNY 90° COCKROACH HEAD TILTS & JAW UNHINGING
      if ((this._neckTimer -= dt) <= 0) {
        this._neckTimer = chasing ? rnd(.15, .45) : rnd(1.4, 3.8);
        // Sudden violent neck tilt when staring, lit, or chasing
        this._neckSnap = (Math.random() < (chasing || lit || this._staring ? 0.65 : 0.22))
          ? rnd(-0.85, 0.85) : 0;
      }
      this.headBone.rotation.z += (this._neckSnap - this.headBone.rotation.z) * Math.min(1, dt * 16);
      this.headBone.rotation.x = -0.1 + (lit ? 0.25 * Math.sin(this.t * 35) : Math.sin(this.t * 1.9) * 0.08);

      // Unhinge lower jaw during chase, fury, or agony
      const jawOpen = chasing ? 0.55 + 0.2 * Math.sin(this.t * 19) : (agony || lit ? 0.65 : 0.08 + 0.04 * Math.sin(this.t * 1.3));
      this.jaw.rotation.x += (jawOpen - this.jaw.rotation.x) * Math.min(1, dt * 12);

      // 4. TORSO HUNCH & AGONY JITTER
      const lean = fast ? .38 : chasing ? .28 : 0;
      this.torsoPivot.rotation.x += (lean - this.torsoPivot.rotation.x) * Math.min(1, dt * 6);
      if (agony) {
        this.body.position.set(rnd(-.09, .09), rnd(-.03, .03), rnd(-.09, .09));
        this.torsoPivot.rotation.z = rnd(-.18, .18);
      } else {
        this.body.position.multiplyScalar(.8);
        this.torsoPivot.rotation.z = Math.sin(this.stride) * 0.05 * Math.min(1, moveFactor);
      }
    }

    const flick = fast ? (Math.random() < .35 ? .35 : 1) : 1;
    const bodyOp = vis * flick * .96;
    this.bodyMat.opacity = this.limbMat.opacity = bodyOp;
    this.bodyMat.visible = this.limbMat.visible = bodyOp > .005;

    const perf = g.performanceMode;
    for (let i = 0; i < this.puffs.length; i++) {
      const s = this.puffs[i];
      if (vis <= .005 || (perf && (i & 1) === 1)) { s.visible = false; continue; }
      const u = s.userData;
      u.life += dt / u.dur;
      if (u.life >= 1) { u.life -= 1; u.a = rnd(0, Math.PI * 2); u.r = rnd(.05, .55); u.y0 = rnd(0, 2.6); }
      const L = u.life, op = Math.sin(L * Math.PI) * .62 * vis;
      if (op <= .01) { s.visible = false; continue; }
      s.visible = true;
      const trail = fast ? L * 1.4 : 0;
      s.position.set(Math.cos(u.a) * u.r * (1 + L * .6), u.y0 + L * u.rise, Math.sin(u.a) * u.r * (1 + L * .6) - trail);
      s.scale.setScalar(u.size * (.6 + L * .9) * (chasing ? 1.3 : 1));
      s.material.rotation += u.spin * dt;
      s.material.opacity = op;
    }

    V2.set(c.x - this.pos.x, 0, c.z - this.pos.z).normalize();
    const headWorldYaw = this.group.rotation.y + this.headBone.rotation.y;
    const facing = V2.x * Math.sin(headWorldYaw) + V2.z * Math.cos(headWorldYaw);
    let eye = 0;
    if (eyesOnly) eye = .95 + Math.random() * .05;
    else if (lit) eye = .9 + Math.random() * .1;
    else if (chasing) eye = .75 + Math.random() * .25;
    else if ((this.lingerT > 0 || this.peeking) && facing > .25) eye = .32 + .1 * Math.sin(this.t * 3.1);
    if (Math.sin(this.t * .9) > .985) eye *= .1;

    this.eyeMat.opacity += (eye * clamp((40 - d) / 18, 0, 1) - this.eyeMat.opacity) * Math.min(1, dt * (lit ? 20 : 5));
    const eyeVis = this.eyeMat.opacity > .005;
    // Pinprick pupil contraction when blinded by flashlight beam, dilated in the dark
    const es = (lit ? .085 : .13) + d * .0055;
    for (const e of this.eyes) {
      e.visible = eyeVis;
      if (eyeVis) e.scale.setScalar(es);
    }
  }
}

/* ===================== SPATIAL WEB AUDIO ===================== */
class Audio {
  constructor(g) {
    this.g = g;
    this.ctx = null;
    this.stepT = 0;
    this.R = new THREE.Vector3();
    this.F = new THREE.Vector3();
    this.ir = {};
    this.roomAmt = .3;
    this.powerOut = false;
    this._lastCellX = -1;
    this._lastCellY = -1;
    this._cachedOpen = 0;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const x = this.ctx = new (window.AudioContext || window.webkitAudioContext)(), now = x.currentTime;
    this.master = x.createGain(); this.master.gain.value = 0; this.master.connect(x.destination);
    this.master.gain.linearRampToValueAtTime(.9, now + 3);
    const filt = x.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 240; filt.Q.value = 6;
    this.hum = x.createGain(); this.hum.gain.value = .11; filt.connect(this.hum); this.hum.connect(this.master);
    const lfo = x.createOscillator(); lfo.frequency.value = .13;
    const lg = x.createGain(); lg.gain.value = 70; lfo.connect(lg); lg.connect(filt.frequency); lfo.start();
    [55, 110, 220.5].forEach((f, i) => {
      const o = x.createOscillator(); o.type = i ? 'triangle' : 'sawtooth'; o.frequency.value = f; o.detune.value = (i - 1) * 6;
      const gg = x.createGain(); gg.gain.value = .5 / (i + 1); o.connect(gg); gg.connect(filt); o.start();
    });
    const b = x.createOscillator(); b.type = 'square'; b.frequency.value = 120;
    this.buzz = x.createGain(); this.buzz.gain.value = .012; b.connect(this.buzz); this.buzz.connect(this.master); b.start();
    this.verbGain = x.createGain(); this.verbGain.gain.value = 1; this.verbGain.connect(this.master);
    this.verb = x.createConvolver(); this.verbSend = x.createGain(); this.verbSend.gain.value = .5;
    this.verb.connect(this.verbSend); this.verbSend.connect(this.master);
    this.ir.hall = this.impulse(2.6, 3.2); this.ir.room = this.impulse(1.1, 5.2); this.verb.buffer = this.ir.hall;
    const len = x.sampleRate * .5 | 0; this.noise = x.createBuffer(1, len, x.sampleRate);
    const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const sl = x.sampleRate * .18 | 0; this.stepBuf = x.createBuffer(1, sl, x.sampleRate);
    const s = this.stepBuf.getChannelData(0); for (let i = 0; i < sl; i++) s[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / sl, 3);
  }
  impulse(T, decay) {
    const x = this.ctx, N = x.sampleRate * T | 0, b = x.createBuffer(2, N, x.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < N; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / N, decay) * .6;
      for (let i = 0; i < Math.min(80, N); i++) d[i] = Math.random() * 2 - 1;
    }
    return b;
  }
  routeGain(node, useReverb, reverbGain = .4) {
    if (!useReverb || this.powerOut) { node.connect(this.master); return; }
    node.connect(this.master);
    const tap = this.ctx.createGain(); tap.gain.value = reverbGain; node.connect(tap); tap.connect(this.verb);
  }
  spatial(node, pos, gain, dist) {
    const x = this.ctx, c = this.g.camera;
    c.getWorldDirection(this.F);
    this.R.set(-this.F.z, 0, this.F.x).normalize();
    const dx = pos.x - c.position.x, dz = pos.z - c.position.z, d = dist ?? Math.hypot(dx, dz), inv = 1 / Math.max(d, .001);
    const pan = clamp((dx * this.R.x + dz * this.R.z) * inv, -1, 1) * .9, front = (dx * this.F.x + dz * this.F.z) * inv;
    const lp = x.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = clamp(2400 / (1 + d * .25), 180, 2400) * (front < -.3 ? .6 : 1);
    const gn = x.createGain(); gn.gain.value = gain / (1 + d * d * .02);
    const p = x.createStereoPanner(); p.pan.value = pan;
    node.connect(lp); lp.connect(gn); gn.connect(p);
    this.routeGain(p, !this.powerOut, clamp(this.roomAmt, .1, .6));
  }
  tone(f, dur, gain = .05, type = 'sine', pos = null) {
    if (!this.ctx) return null;
    const x = this.ctx, t = x.currentTime, o = x.createOscillator(), g = x.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g);
    pos ? this.spatial(g, pos, 1) : this.routeGain(g, !this.powerOut, .25);
    o.start(t); o.stop(t + dur + .05);
    return o;
  }
  click() { this.tone(950, .035, .03, 'square'); }
  windTick() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (t - (this.lastWind || 0) < .15) return;
    this.lastWind = t;
    this.tone(rnd(300, 400), .05, .02, 'square');
  }
  footstep() {
    if (!this.ctx) return;
    const x = this.ctx, t = x.currentTime, s = x.createBufferSource(), f = x.createBiquadFilter(), g = x.createGain();
    s.buffer = this.stepBuf; s.playbackRate.value = rnd(.85, 1.15);
    f.type = 'lowpass'; f.frequency.value = rnd(650, 950);
    g.gain.setValueAtTime(rnd(.2, .3), t);
    g.gain.exponentialRampToValueAtTime(.0001, t + .2);
    s.connect(f); f.connect(g);
    this.routeGain(g, !this.powerOut, clamp(this.roomAmt, .1, .55));
    s.start(t); s.stop(t + .22);
  }
  monsterStep(pos, d) {
    if (!this.ctx) return;
    const x = this.ctx, s = x.createBufferSource();
    s.buffer = this.stepBuf; s.playbackRate.value = rnd(.5, .75);
    this.spatial(s, pos, .9, d); s.start();
    const t = x.currentTime, o = x.createOscillator(), g = x.createGain();
    o.frequency.setValueAtTime(rnd(48, 62), t); o.frequency.exponentialRampToValueAtTime(30, t + .2);
    g.gain.setValueAtTime(.35, t); g.gain.exponentialRampToValueAtTime(.0001, t + .25);
    o.connect(g); this.spatial(g, pos, 1, d); o.start(t); o.stop(t + .3);
  }
  whisper(pos, d) {
    if (!this.ctx) return;
    const x = this.ctx, t = x.currentTime, s = x.createBufferSource(), bp = x.createBiquadFilter(), g = x.createGain(), dur = rnd(.9, 1.8);
    s.buffer = this.noise; s.loop = true;
    bp.type = 'bandpass'; bp.frequency.setValueAtTime(rnd(500, 900), t); bp.frequency.linearRampToValueAtTime(rnd(1200, 2000), t + dur); bp.Q.value = 4;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.18, t + dur * .4); g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(bp); bp.connect(g); this.spatial(g, pos, 1, d); s.start(t); s.stop(t + dur + .05);
  }
  shriek(pos) {
    if (!this.ctx) return;
    const o = this.tone(rnd(170, 230), .6, .12, 'sawtooth', pos);
    if (o) o.frequency.exponentialRampToValueAtTime(60, this.ctx.currentTime + .6);
  }
  screech(pos) {
    if (!this.ctx) return;
    const x = this.ctx, t = x.currentTime;
    for (const f of [rnd(900, 1200), rnd(1300, 1700)]) {
      const o = this.tone(f, .75, .07, 'sawtooth', pos);
      if (o) {
        o.frequency.linearRampToValueAtTime(f * .55, t + .7);
        const l = x.createOscillator(), lg = x.createGain();
        l.frequency.value = rnd(28, 40); lg.gain.value = f * .08;
        l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + .8);
      }
    }
    const s = x.createBufferSource(), bp = x.createBiquadFilter(), g = x.createGain();
    s.buffer = this.noise; bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 2;
    g.gain.setValueAtTime(.3, t); g.gain.exponentialRampToValueAtTime(.0001, t + .6);
    s.connect(bp); bp.connect(g); this.spatial(g, pos, 1); s.start(t); s.stop(t + .65);
  }
  roar(pos) {
    if (!this.ctx) return;
    const x = this.ctx, t = x.currentTime;
    const o = this.tone(rnd(85, 110), 1.3, .22, 'sawtooth', pos);
    if (o) { o.frequency.setValueAtTime(rnd(140, 170), t + .08); o.frequency.exponentialRampToValueAtTime(38, t + 1.25); }
    this.tone(rnd(55, 62), 1.3, .2, 'square', pos);
    const s = x.createBufferSource(), lp = x.createBiquadFilter(), g = x.createGain();
    s.buffer = this.noise; s.loop = true;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(200, t + 1.2);
    g.gain.setValueAtTime(.45, t); g.gain.exponentialRampToValueAtTime(.0001, t + 1.25);
    s.connect(lp); lp.connect(g); this.spatial(g, pos, 1); s.start(t); s.stop(t + 1.3);
  }
  whoosh(pos) {
    if (!this.ctx) return;
    const x = this.ctx, t = x.currentTime, s = x.createBufferSource(), bp = x.createBiquadFilter(), g = x.createGain();
    s.buffer = this.noise; s.loop = true;
    bp.type = 'bandpass'; bp.Q.value = 1.2; bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(1800, t + .25); bp.frequency.exponentialRampToValueAtTime(400, t + .5);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.35, t + .15); g.gain.exponentialRampToValueAtTime(.0001, t + .55);
    s.connect(bp); bp.connect(g); this.spatial(g, pos, 1); s.start(t); s.stop(t + .6);
  }
  pop(pos) {
    if (!this.ctx) return;
    const x = this.ctx, s = x.createBufferSource(), g = x.createGain(), t = x.currentTime;
    s.buffer = this.noise; g.gain.setValueAtTime(.5, t); g.gain.exponentialRampToValueAtTime(.0001, t + .12);
    s.connect(g); this.spatial(g, pos, 1); s.start(t); s.stop(t + .15);
  }
  distant() {
    if (!this.ctx) return;
    const a = rnd(0, Math.PI * 2), c = this.g.camera.position;
    V3.set(c.x + Math.cos(a) * 30, 0, c.z + Math.sin(a) * 30);
    Math.random() < .5 ? this.monsterStep(V3, 30) : this.tone(rnd(70, 110), 1.4, .06, 'triangle', V3);
  }
  setStress(s) {
    if (!this.ctx) return;
    this.buzz.gain.setTargetAtTime(.012 + s * .05, this.ctx.currentTime, .1);
  }
  silence(on) {
    if (!this.ctx) return;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(on ? 0 : .9, this.ctx.currentTime, on ? .05 : .8);
  }
  powerDown() {
    if (!this.ctx) return;
    this.powerOut = true;
    const x = this.ctx, t = x.currentTime;
    const o = x.createOscillator(), g = x.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(28, t + .9);
    g.gain.setValueAtTime(.28, t); g.gain.exponentialRampToValueAtTime(.0001, t + 1);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 1.05);
    const s = x.createBufferSource(), lp = x.createBiquadFilter(), sg = x.createGain();
    s.buffer = this.noise; lp.type = 'lowpass'; lp.frequency.setValueAtTime(2200, t); lp.frequency.exponentialRampToValueAtTime(60, t + 1.2);
    sg.gain.setValueAtTime(.5, t); sg.gain.exponentialRampToValueAtTime(.0001, t + 1.3);
    s.connect(lp); lp.connect(sg); sg.connect(this.master); s.start(t); s.stop(t + 1.35);
    this.tone(48, .35, .4, 'square');
    for (const node of [this.hum, this.buzz]) { node.gain.cancelScheduledValues(t); node.gain.setTargetAtTime(0, t, .05); }
    this.verbSend.gain.setTargetAtTime(0, t, .05);
  }
  restore() {
    if (!this.ctx) return;
    this.powerOut = false;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(.9, t, .2);
    this.hum.gain.setTargetAtTime(.11, t, .2);
    this.buzz.gain.setTargetAtTime(.012, t, .2);
    this.verbSend.gain.setTargetAtTime(.3, t, .2);
  }
  killScream() {
    if (!this.ctx) return;
    const x = this.ctx, t = x.currentTime;
    const bus = x.createGain(); bus.gain.value = .9;
    const ws = x.createWaveShaper(); ws.curve = this.clipCurve(); ws.oversample = '4x';
    bus.connect(ws); ws.connect(this.master);
    const sub = x.createOscillator(), sg = x.createGain();
    sub.type = 'sine'; sub.frequency.setValueAtTime(150, t); sub.frequency.exponentialRampToValueAtTime(20, t + 1.1);
    sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(1.4, t + .04); sg.gain.setValueAtTime(1.4, t + .5); sg.gain.exponentialRampToValueAtTime(.0001, t + 1.5);
    sub.connect(sg); sg.connect(bus); sub.start(t); sub.stop(t + 1.55);
    const sub2 = x.createOscillator(), sg2 = x.createGain();
    sub2.type = 'triangle'; sub2.frequency.setValueAtTime(74, t); sub2.frequency.exponentialRampToValueAtTime(19, t + 1.1);
    sg2.gain.setValueAtTime(.9, t); sg2.gain.exponentialRampToValueAtTime(.0001, t + 1.5);
    sub2.connect(sg2); sg2.connect(bus); sub2.start(t); sub2.stop(t + 1.55);
    for (const f of [2400, 3100, 4200, 5300]) {
      const o = x.createOscillator(), og = x.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f * rnd(.97, 1.03), t); o.frequency.exponentialRampToValueAtTime(f * .45, t + 1.1);
      og.gain.setValueAtTime(.16, t); og.gain.setValueAtTime(.2, t + .35); og.gain.exponentialRampToValueAtTime(.0001, t + 1.4);
      o.connect(og); og.connect(bus); o.start(t); o.stop(t + 1.45);
    }
    const n = x.createBufferSource(), nb = x.createBiquadFilter(), ng = x.createGain();
    n.buffer = this.noise; n.loop = true; nb.type = 'bandpass'; nb.frequency.value = 5200; nb.Q.value = .8;
    ng.gain.setValueAtTime(.3, t); ng.gain.exponentialRampToValueAtTime(.0001, t + 1.2);
    n.connect(nb); nb.connect(ng); ng.connect(bus); n.start(t); n.stop(t + 1.25);
    this.silence(true);
    setTimeout(() => { for (const nd of [bus, ws, sg, sg2, ng]) try { nd.disconnect(); } catch (e) {} }, 1700);
  }
  clipCurve() {
    if (this._clip) return this._clip;
    const N = 2048, c = new Float32Array(N);
    for (let i = 0; i < N; i++) { const v = i / (N - 1) * 2 - 1; c[i] = Math.tanh(v * 4.5); }
    return (this._clip = c);
  }
  shutter() {
    if (!this.ctx) return;
    const x = this.ctx, t = x.currentTime;
    const s = x.createBufferSource(), bp = x.createBiquadFilter(), g = x.createGain();
    s.buffer = this.noise; bp.type = 'bandpass'; bp.frequency.setValueAtTime(4200, t); bp.frequency.exponentialRampToValueAtTime(900, t + .09); bp.Q.value = 1.5;
    g.gain.setValueAtTime(.55, t); g.gain.exponentialRampToValueAtTime(.0001, t + .12);
    s.connect(bp); bp.connect(g); g.connect(this.master); s.start(t); s.stop(t + .14);
    this.tone(2200, .05, .18, 'square'); this.tone(340, .14, .12, 'square'); this.tone(90, .22, .1, 'sine');
  }
  hiss(pos) {
    if (!this.ctx) return;
    const x = this.ctx, t = x.currentTime, dur = rnd(.4, .9);
    const s = x.createBufferSource(), hp = x.createBiquadFilter(), g = x.createGain();
    s.buffer = this.noise; s.loop = true; hp.type = 'highpass'; hp.frequency.setValueAtTime(3000, t); hp.frequency.exponentialRampToValueAtTime(700, t + dur);
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.22, t + .05); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(hp); hp.connect(g); this.spatial(g, pos, 1); s.start(t); s.stop(t + dur + .05);
    const o = this.tone(rnd(1900, 2600), dur, .09, 'square', pos);
    if (o) o.frequency.exponentialRampToValueAtTime(rnd(200, 400), t + dur);
  }
  thud(pos, near = true) {
    if (!this.ctx) return;
    const x = this.ctx, t = x.currentTime;
    const o = x.createOscillator(), g = x.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(near ? 88 : 70, t); o.frequency.exponentialRampToValueAtTime(26, t + .22);
    g.gain.setValueAtTime(near ? .75 : .5, t); g.gain.exponentialRampToValueAtTime(.0001, t + .32); o.connect(g);
    if (near) g.connect(this.master); else this.spatial(g, pos, 1, 2);
    o.start(t); o.stop(t + .35);
    const s = x.createBufferSource(), lp = x.createBiquadFilter(), sg = x.createGain();
    s.buffer = this.stepBuf; lp.type = 'lowpass'; lp.frequency.value = 420;
    sg.gain.setValueAtTime(.4, t); sg.gain.exponentialRampToValueAtTime(.0001, t + .16);
    s.connect(lp); lp.connect(sg);
    if (near) sg.connect(this.master); else this.spatial(sg, pos, 1, 2);
    s.start(t); s.stop(t + .18);
  }
  jumpIntro() { this.tone(60, .5, .3, 'sine'); this.tone(1200, .1, .08, 'sawtooth'); }

  // OPTIMIZATION: Uses pre-baked World.getOpenness(cx, cy) instead of 49 grid checks per physics tick
  update(dt) {
    if (!this.ctx) return;
    const p = this.g.player;
    this.stepT -= dt;
    if (p.moving && this.stepT <= 0) {
      this.footstep();
      this.stepT = (p.running ? .34 : .5) * rnd(.85, 1.2);
    }
    if (!p.moving) this.stepT = Math.min(this.stepT, .05);

    const w = this.g.world;
    const cx = Math.round(this.g.camera.position.x / CFG.CELL);
    const cy = Math.round(this.g.camera.position.z / CFG.CELL);
    if (cx !== this._lastCellX || cy !== this._lastCellY) {
      this._lastCellX = cx;
      this._lastCellY = cy;
      this._cachedOpen = w.getOpenness(cx, cy);
    }
    const open = this._cachedOpen;
    const target = open > 34 ? .75 : open > 22 ? .45 : .12;
    this.roomAmt += (target - this.roomAmt) * Math.min(1, dt * 2);
    if (this.powerOut) return;
    const wantBuf = open > 22 ? this.ir.room : this.ir.hall;
    if (this.verb.buffer !== wantBuf) this.verb.buffer = wantBuf;
    this.verbSend.gain.value = open > 22 ? .8 : .28;
  }
}

/* ===================== MAIN GAME ENGINE ===================== */
class Game {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.performanceMode = false;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(CFG.FOG[0]);
    this.scene.fog = new THREE.Fog(...CFG.FOG);
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, .05, CFG.FOG[2] + 2);
    this.scene.add(this.camera);

    buildMaterialsAndGeometries();

    this.level = -1; this.dead = false; this.dark = false;
    this.camCD = 0; this.sayT = 0; this.recT = 0; this.distT = rnd(20, 40); this.trackY = -10;
    this.goo = new GooTrail(this.scene);
    this.audio = new Audio(this);
    this.lighting = new Lighting(this.scene);
    this.player = new Player(this);
    this.stressSystem = new StressSystem(this.player);
    this.flash = new Flashlight(this);
    this.monster = new (createMonsterAI(Monster, THREE, CFG))(this);
    this.newLevel();
    this.mp = new Multiplayer(this);
    this.share = this.mp.share;

    const start = $('start'), c = this.player.controls;
    if (this.player.isMobileDevice) {
      start.style.display = 'none';
      const startMobile = () => {
        this.audio.init();
        c.isLocked = true;
        document.removeEventListener('touchstart', startMobile);
      };
      document.addEventListener('touchstart', startMobile);
    } else {
      start.addEventListener('click', () => { this.audio.init(); c.lock(); });
    }
    c.addEventListener('lock', () => start.classList.add('hidden'));
    c.addEventListener('unlock', () => { if (!this.dead && !this.player.isMobileDevice) start.classList.remove('hidden'); });

    this.coords = $('coords');
    this.status = $('status');
    this.clockEl = $('clock');
    this.track = $('track');

    addEventListener('resize', () => this.resize());
    this.clock = new THREE.Clock();
    this.acc = 0;
    this.renderer.setAnimationLoop(() => this.loop());

    $('fullscreen-btn')?.addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen();
      else document.exitFullscreen();
    });

    const perfButton = $('performance-btn');
    perfButton?.addEventListener('click', () => {
      this.setPerformanceMode(!this.performanceMode);
    });
  }

  resize() {
    this.camera.aspect = innerWidth / Math.max(1, innerHeight);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  setPerformanceMode(enabled) {
    this.performanceMode = !!enabled;
    document.body.classList.toggle('performance-mode', this.performanceMode);

    if (this.performanceMode) {
      this.scene.fog.far = 13;
      this.camera.far = 15;
    } else {
      this.scene.fog.far = CFG.FOG[2];
      this.camera.far = CFG.FOG[2] + 2;
    }
    this.camera.updateProjectionMatrix();

    const ratio = this.performanceMode ? Math.min(window.devicePixelRatio || 1, .75) : 1;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(innerWidth, innerHeight, false);

    const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const anisotropy = this.performanceMode ? 1 : Math.min(4, maxAnisotropy);
    this.scene.traverse(obj => {
      const materials = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
      for (const material of materials) {
        if (material.map) material.map.anisotropy = anisotropy;
      }
    });

    const button = $('performance-btn');
    if (button) {
      button.textContent = this.performanceMode ? 'PERFORMANCE: ON' : 'PERFORMANCE: OFF';
      button.setAttribute('aria-pressed', String(this.performanceMode));
      button.title = this.performanceMode
        ? 'Performance mode enabled — click to restore graphics'
        : 'Reduce graphics for smoother performance';
    }
  }

  // OPTIMIZATION: O(1) lookup via pre-baked World.roomMask
  _isInsideLargeRoom(px, pz) {
    if (!this.world) return false;
    const cx = Math.round(px / CFG.CELL), cy = Math.round(pz / CFG.CELL);
    return this.world.isLargeRoomCell(cx, cy);
  }

  _setSpawnCameraFov() {
    this._inHallway = !this._isInsideLargeRoom(this.camera.position.x, this.camera.position.z);
    this.camera.fov = this._inHallway ? 52 : 75;
    this.camera.updateProjectionMatrix();
  }

  _updateCameraZoom(dt) {
    this._inHallway = !this._isInsideLargeRoom(this.camera.position.x, this.camera.position.z);
    const targetFOV = this._inHallway ? 52 : 75;
    const blend = 1 - Math.exp(-8 * Math.max(0, dt));
    if (Math.abs(this.camera.fov - targetFOV) > .02) {
      this.camera.fov += (targetFOV - this.camera.fov) * blend;
      this.camera.updateProjectionMatrix();
    } else if (this.camera.fov !== targetFOV) {
      this.camera.fov = targetFOV;
      this.camera.updateProjectionMatrix();
    }
  }

  newLevel(seed) {
    this.level++;
    this.world?.dispose();
    this.goo.clear();
    const mr = Math.random;
    if (seed != null) Math.random = mulberry32(seed);
    let data;
    try {
      data = new Maze(CFG.SIZE).generate();
      this.world = new World(this.scene, data);
    } finally {
      Math.random = mr;
    }
    this.lighting.setWorld(this.world);
    this.monster.reset();
    this.audio._lastCellX = -1; // Force audio room-openness refresh on new level
    this.camera.position.set(data.spawn.x * CFG.CELL, CFG.EYE, data.spawn.y * CFG.CELL);
    this._setSpawnCameraFov();
    this.flash.battery = Math.max(this.flash.battery, .6);
    this.dark = false; this.camCD = 0; this.flash.on = true;
    this.audio.restore();
    $('dark').style.opacity = 0;
    this.lighting.setDark(false);
    this.scene.background.set(CFG.FOG[0]);
    this.scene.fog.color.set(CFG.FOG[0]);
    $('level').textContent = this.level;
    $('danger').style.opacity = 0;
    this.say(this.level ? 'THE LEVEL CHANGED.' : 'NO SIGNAL.');
  }

  say(t, ms = 1600) {
    const m = $('msg');
    m.textContent = t;
    m.classList.add('show');
    clearTimeout(this.sayT);
    this.sayT = setTimeout(() => m.classList.remove('show'), ms);
  }
  warn(t, ms) {
    const w = $('warning');
    w.textContent = t;
    w.classList.add('show');
    clearTimeout(this.warnT);
    this.warnT = setTimeout(() => w.classList.remove('show'), ms);
  }
  glitch() {
    const v = $('vhs');
    v.classList.remove('glitch');
    void v.offsetWidth;
    v.classList.add('glitch');
  }
  cameraBlast() {
    if (this.dead || this.camCD > 0 || this.dark || (!this.player.controls.isLocked && !this.player.isMobileDevice)) return;
    this.camCD = 2;
    this.audio.shutter();
    this.glitch();
    const f = $('flash');
    f.style.transition = 'none';
    f.style.opacity = 1;
    requestAnimationFrame(() => { f.style.transition = 'opacity .45s'; f.style.opacity = 0; });
    this.monster.onFlash();
  }
  blackout(remote) {
    if (this.dark || this.dead) return;
    this.dark = true;
    if (!remote && this.share?.on) this.share.world('power');
    this.audio.click();
    this.audio.powerDown();
    for (const l of this.lighting.pool) l.intensity = 0;
    this.lighting.setDark(true);
    this.scene.background.set(0);
    this.scene.fog.color.set(0);
    this.flash.spot.intensity = 0;
    this.flash.fill.intensity = 0;
    $('dark').style.opacity = .35;
    this.warn('POWER FAILURE — RUN', 2500);
    this.glitch();
    if (!remote || !this.share?.on || this.share.host) this.monster.enterBloodlust();
  }
  killPlayer() {
    if (this.dead) return;
    this.dead = true;
    this.player.controls.unlock();
    if (!this.share?.on || this.share.host) { this.monster.active = false; this.monster.group.visible = false; }
    else this.share.hide();
    const j = $('jumpscare');
    j.classList.remove('active');
    void j.offsetWidth;
    j.classList.add('active');
    this.audio.jumpIntro();
    this.audio.killScream();
    this.glitch();
    this.warn('YOU WERE FOUND', 2000);
    if (this.mp.coop) { this.mp.die(); this.onPlayerDeath(this.mp.peer?.id || 'local'); }
    setTimeout(() => {
      j.classList.remove('active');
      if (!this.dead) return;
      if (this.mp.coop) this.mp.spectate();
      else this.respawn();
    }, 2000);
  }
  respawn(seed) {
    $('jumpscare').classList.remove('active');
    this.dead = false;
    this.dark = false;
    this.newLevel(seed);
    this.audio.restore();
    this.audio.silence(false);
    $('dark').style.opacity = 0;
    if (!this.player.isMobileDevice) $('start').classList.remove('hidden');
  }

  monsterEuler(m = this.monster) {
    return { x: m.body ? m.body.rotation.x : 0, y: m.group.rotation.y };
  }
  monsterFace(yaw, pitch, glide = yaw) {
    const m = this.monster;
    m.group.rotation.y = glide;
    if (m.body) m.body.rotation.x = pitch;
  }
  onPlayerDeath(id) {
    const mp = this.mp;
    if (!mp?.coop || !mp.isHost || !id || id === mp.peer?.id || id === 'local') return;
    mp.setAlive(id, false);
    mp.broadcast({ t: 'player-death', id });
  }

  hud(dt) {
    this.recT += dt;
    const s = this.recT | 0;
    if (this._lastS !== s) {
      this.clockEl.textContent = [s / 3600 | 0, (s / 60 | 0) % 60, s % 60].map(v => String(v).padStart(2, '0')).join(':');
      this._lastS = s;
    }
    const cx = Math.round(this.camera.position.x / CFG.CELL);
    const cy = Math.round(this.camera.position.z / CFG.CELL);
    if (this._lastCX !== cx || this._lastCY !== cy) {
      this.coords.textContent = String(cx).padStart(3, '0') + ',' + String(cy).padStart(3, '0');
      this._lastCX = cx;
      this._lastCY = cy;
    }
    const m = this.monster, d = m.active ? m.dist() : 99;
    const detected = m.active && m.mode === 'CHASE';

    let st = 'AUDIO: LOW HUM';
    if (detected) st = 'AUDIO: MOVEMENT DETECTED';
    else if (m.active && m.mode === 'dart' && d < 30) st = 'AUDIO: SIGNAL DISTORTION';
    else if (m.active && m.mode === 'retreat' && d < 30) st = 'AUDIO: ELECTRICAL INTERFERENCE';
    else if (this.lighting.maxStress > .3) st = 'AUDIO: ELECTRICAL INTERFERENCE';

    if (this._lastSt !== st) {
      this.status.textContent = st;
      this._lastSt = st;
    }
    this.trackY = (this.trackY + dt * (60 + (detected ? 240 : 0))) % (innerHeight + 20);
    this.track.style.transform = `translateY(${this.trackY}px)`;
  }

  update(dt) {
    if (this.dead) {
      if (this.share?.on && this.share.host) this.monster.update(dt);
      return;
    }
    this.player.update(dt);
    this.flash.update(dt);
    if (this.share?.on && !this.share.host) this.camCD = Math.max(0, this.camCD - dt);
    if (!this.share?.on || this.share.host) this.monster.update(dt);
    this.lighting.update(dt, this.camera.position, this.monster);
    this.audio.update(dt);
    if (!this.dark) this.audio.setStress(this.lighting.maxStress);
    if ((this.player.controls.isLocked || this.player.isMobileDevice) && (this.distT -= dt) <= 0 && !this.dark) {
      this.audio.distant();
      this.distT = rnd(25, 60);
    }
    this.stressSystem.update(dt);
    this._updateCameraZoom(dt);
  }

  loop() {
    const d = Math.min(this.clock.getDelta(), .1);
    this.acc = Math.min(this.acc + d, .25);

    while (this.acc >= CFG.STEP) {
      this.update(CFG.STEP);
      this.acc -= CFG.STEP;
    }

    this.mp.update(d);
    if (this.share.on) {
      if (this.share.host) this.share.tick(d);
      else this.share.update(d);
    }
    this.hud(d);
    this.renderer.render(this.scene, this.camera);
  }
}

window.game = new Game();
//generated by Ryual
