import * as THREE from 'three';

const $ = id => document.getElementById(id);
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const mulberry32 = s => () => {
  s = s + 0x6D2B79F5 | 0;
  let t = Math.imul(s ^ s >>> 15, 1 | s);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

function trueChaosSeed() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (buf[0] ^ buf[1] ^ (Date.now() >>> 0)) >>> 0;
  }
  return ((Math.random() * 0xFFFFFFFF) ^ Date.now()) >>> 0;
}

// ============================================================================
// 1. CHAOTIC MONSTER TRAIT POOL (ANY 4–5 TRAITS CAN STACK PER ROUND!)
// ============================================================================
const BEHAVIOR_AXES = [
  // STROBE REACTIONS
  [
    {
      id: 'strobe_berserk',
      axis: 'OPTIC STROBE',
      clue: '<span>FLASH-AGITATED:</span> Close strobe (<8m) provokes a lunge instead of stun',
      cause: 'SKULL CRUSHED — CAMCORDER SHATTERED MID-FLASH',
      intel: 'Do NOT strobe it under eight meters! The camera flash doesn\'t blind this variant—it provokes an aggressive lunge!'
    },
    {
      id: 'strobe_repel',
      axis: 'OPTIC STROBE',
      clue: '<span>PHOTO-PHOBIC:</span> Strobe (<10m) burns retinas & forces retreat',
      cause: 'THROAT TORN — STROBE CAPACITOR LEFT UNFIRED',
      intel: 'Its eyes are hyper-sensitive to the camera strobe! Flashing it under ten meters sears its retinas and forces it to flee!'
    },
    {
      id: 'strobe_blink',
      axis: 'OPTIC STROBE',
      clue: '<span>PHASE-BLINKER:</span> Strobe causes entity to warp to a flanking corridor',
      cause: 'SPINE SNAPPED FROM BEHIND AFTER CAMERA FLASH',
      intel: 'When I flashed it with my camera, it didn\'t stay still—it used the light burst to sidestep into the adjacent corridor and watch me!'
    },
    {
      id: 'strobe_emp',
      axis: 'OPTIC STROBE',
      clue: '<span>CAPACITOR-LEECH:</span> Strobe (<11m) drains 25% of your battery',
      cause: 'MAULED IN PITCH BLACK — BATTERY DRAINED BY FLASH',
      intel: 'This variant feeds on capacitor discharge! Every time you photograph it up close, it leeches a quarter of your camcorder battery!'
    },
    {
      id: 'strobe_paralyze',
      axis: 'OPTIC STROBE',
      clue: '<span>CRYO-LOCKED:</span> Strobe freezes entity solid for 3.5s',
      cause: 'CORNERED IN DEAD END AFTER STUN EXPIRED',
      intel: 'A camera flash locks its joints solid for over three seconds—use that window to break line of sight before it wakes up!'
    },
    {
      id: 'strobe_range_aggro',
      axis: 'OPTIC STROBE',
      clue: '<span>SNIPER-STALKER:</span> Long-range strobe (>11m) draws it to your room',
      cause: 'TRACKED DOWN AFTER TAKING DISTANT PHOTOGRAPH',
      intel: 'Don\'t photograph it from far down the hall! Long-range flashes draw its attention straight to your corridor!'
    }
  ],
  // FLASHLIGHT BEAM REACTIONS
  [
    {
      id: 'beam_moth',
      axis: 'BEAM OPTICS',
      clue: '<span>PHOTOTROPIC:</span> Flashlight ON (>5s) slowly lures entity to watch you',
      cause: 'DISEMBOWELED — FLASHLIGHT STILL SWITCHED ON',
      intel: 'It is drawn to the flashlight beam like a moth! Keeping your light on for too long lures it to the edge of your light cone!'
    },
    {
      id: 'beam_averse',
      axis: 'BEAM OPTICS',
      clue: '<span>HELIOPHOBIC:</span> Direct flashlight beam slows entity & deters charges',
      cause: 'AMBUSHED WHEN FLASHLIGHT FLICKERED OUT',
      intel: 'It hates direct flashlight beams! Keeping your beam aimed at its chest slows its advance and stops it from rushing!'
    },
    {
      id: 'beam_dark_sprinter',
      axis: 'BEAM OPTICS',
      clue: '<span>NYCTOPHILIC:</span> Entity stalks closer whenever your light is OFF',
      cause: 'TORN APART WHILE WALKING IN THE DARK',
      intel: 'Don\'t walk in pitch darkness for too long! This variant closes the distance silently whenever your flashlight is switched off!'
    },
    {
      id: 'beam_toggle_aggro',
      axis: 'BEAM OPTICS',
      clue: '<span>SWITCH-TRACKER:</span> Clicking flashlight [F] within 20m alerts entity',
      cause: 'JAW RIPPED OFF — FINGER ON FLASHLIGHT SWITCH',
      intel: 'It listens for the click of the flashlight switch! Toggling [F] on and off when it\'s nearby gives away your exact room!'
    },
    {
      id: 'beam_parasite',
      axis: 'BEAM OPTICS',
      clue: '<span>AMP-SIPHON:</span> Shining beam on entity (<15m) drains battery 2x faster',
      cause: 'BATTERY AT 0% — DRAINED DURING HALLWAY STANDOFF',
      intel: 'Its skin absorbs electrical current—shining your flashlight directly on it drains your battery twice as fast!'
    },
    {
      id: 'beam_gaze_breaker',
      axis: 'BEAM OPTICS',
      clue: '<span>MIRROR-STALKER:</span> Staring at it with light ON (>3s) provokes bluff rush',
      cause: 'EYES GOUGED — LOCKED GAZE IN LIT CORRIDOR',
      intel: 'Never stare directly at its face while your flashlight is on! Hold eye contact for more than three seconds and it will rush you!'
    }
  ],
  // ACOUSTIC & MOVEMENT TRIGGERS
  [
    {
      id: 'sound_crank_hunter',
      axis: 'ACOUSTIC TRIGGER',
      clue: '<span>DYNAMO-LISTENER:</span> Winding battery [E] (>1.5s) draws entity to peek at you',
      cause: 'NECK BROKEN — HAND FROZEN ON DYNAMO CRANK',
      intel: 'It listens for the whine of the battery crank! Holding [E] for too long brings it creeping to the nearest corner to watch you!'
    },
    {
      id: 'sound_still_ambush',
      axis: 'ACOUSTIC TRIGGER',
      clue: '<span>STASIS-STALKER:</span> Standing still (>4s) triggers silent rear stalk',
      cause: 'DECAPITATED WHILE HIDING MOTIONLESS IN CORNER',
      intel: 'Never stand motionless for too long! When you freeze in one spot, it creeps up behind your back without making a sound!'
    },
    {
      id: 'sound_sprint_chaser',
      axis: 'ACOUSTIC TRIGGER',
      clue: '<span>TREMOR-TRACKER:</span> Sprinting [SHIFT] (>3s) alerts entity to your path',
      cause: 'ACHILLES TENDONS SEVERED MID-SPRINT',
      intel: 'It feels floor vibrations when you run! Continuous sprinting lets it shadow you from the adjacent hallway!'
    },
    {
      id: 'sound_low_batt_shark',
      axis: 'ACOUSTIC TRIGGER',
      clue: '<span>VOLTAGE-SHARK:</span> Battery dropping below 35% increases stalking frequency',
      cause: 'EXSANGUINATED — CAMCORDER AT 18% BATTERY',
      intel: 'It senses weak voltage! The moment your battery drops below thirty-five percent, it begins circling your position!'
    },
    {
      id: 'sound_proximity_hum',
      axis: 'ACOUSTIC TRIGGER',
      clue: '<span>RESONANCE-LURE:</span> Lingering within 14m causes it to mimic footsteps',
      cause: 'CORNERED WHILE CREEPING SLOWLY THROUGH HALL',
      intel: 'When it gets within fourteen meters, it starts echoing your footsteps from the next room over to trick you into turning around!'
    },
    {
      id: 'sound_panic_feeder',
      axis: 'ACOUSTIC TRIGGER',
      clue: '<span>ERRATIC-TRACKER:</span> Rapidly whipping camera view draws it to ambush',
      cause: 'CHEST CAVED IN AFTER FRANTICALLY LOOKING AROUND',
      intel: 'Keep your camera steady! Whipping your camcorder around in panic agitates it and draws it to the nearest doorway!'
    }
  ],
  // TERMINAL SABOTAGE & DISRUPTION DOCTRINE
  [
    {
      id: 'hunt_corpse_camper',
      axis: 'HUNT DOCTRINE',
      clue: '<span>CARRION-VOYEUR:</span> Watches from doorways when corpses are disturbed',
      cause: 'DRAGGED INTO BLOOD POOL BESIDE ANOTHER OPERATIVE',
      intel: 'It lingers near the dead operatives! When you extract a tape, look down the hallway—it will be standing there watching you!'
    },
    {
      id: 'hunt_terminal_rusher',
      axis: 'HUNT DOCTRINE',
      clue: '<span>BREAKER-SABOTEUR:</span> Frequently trips relays & junctions while you hold [SPACE]',
      cause: 'ELECTROCUTED & MAULED AT POWER JUNCTION',
      intel: 'It hates the hum of relays and junctions! It will surge the power to trip the switch and force you off the terminal!'
    },
    {
      id: 'hunt_relentless',
      axis: 'HUNT DOCTRINE',
      clue: '<span>LONG-STRIDE:</span> Moves 12% faster once escalated to late phases',
      cause: 'OVERRUN IN STRAIGHTAWAY CORRIDOR',
      intel: 'As more objectives come online, its stride lengthens—use sharp corners to break line of sight during late phases!'
    },
    {
      id: 'hunt_emp_aura',
      axis: 'HUNT DOCTRINE',
      clue: '<span>BLACKOUT-AURA:</span> Approaches within 14m violently flicker & dim lights',
      cause: 'DISMEMBERED DURING SUDDEN CORRIDOR BLACKOUT',
      intel: 'Watch the ceiling lights! This variant projects an electromagnetic aura that dims the room while it watches you from the dark!'
    },
    {
      id: 'hunt_fake_retreat',
      axis: 'HUNT DOCTRINE',
      clue: '<span>FEINT-STALKER:</span> Pretends to flee, then circles back to peek around corners',
      cause: 'AMBUSHED AFTER THINKING ENTITY HAD FLED',
      intel: 'When it turns and runs away, don\'t let your guard down—it circles right back to the nearest corner to spy on you!'
    },
    {
      id: 'hunt_siege_jammer',
      axis: 'HUNT DOCTRINE',
      clue: '<span>ACOUSTIC-DISRUPTOR:</span> Sends static shockwaves to interrupt [SPACE] actions',
      cause: 'EARDRUMS RUPTURED BY ACOUSTIC SURGE AT RELAY',
      intel: 'While you hold [SPACE] on an objective, it pulses static shockwaves to knock your hands off the controls!'
    }
  ]
];

const ALL_TRAITS = BEHAVIOR_AXES.flat();

const CONFLICT_PAIRS = [
  ['strobe_berserk', 'strobe_repel'],
  ['strobe_berserk', 'strobe_paralyze'],
  ['beam_moth', 'beam_averse']
];

const OPERATIVE_NAMES = [
  'VANCE, R.', 'CHEN, M.', 'MARCUS, D.', 'REYES, E.', 'KAEL, J.', 'TORRES, A.',
  'HALE, S.', 'LIN, K.', 'NOVAK, V.', 'MERCER, T.', 'SORENSON, P.', 'OKAFOR, C.',
  'GALLAGHER, B.', 'TAKAHASHI, R.', 'KOVACS, L.', 'MORENO, G.', 'LINDQVIST, H.', 'BECKETT, N.'
];

const SQUAD_TAGS = [
  'RECON-04', 'HAZMAT-09', 'SURVEY-12', 'ECHO-02', 'BIO-TEAM 7', 'VECTOR-01',
  'SECTOR-WATCH 3', 'AETHER-06', 'SIGNAL-CORPS 5', 'DEEP-PROBE 8'
];

// ============================================================================
// 2. SEAMLESS UNCUT BLOOD TEXTURES + WEATHERED 1980s BREAKER & CORPSE TEXTURES
// ============================================================================
let floorBloodTex = null;
let wallBloodTex = null;
let shadedSuitTex = null;
let rottingFleshTex = null;
let rustedMetalTex = null;
let junctionOffTex = null;
let junctionOnTex = null;

function getFloorBloodTexture() {
  if (floorBloodTex) return floorBloodTex;
  const s = 512, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.clearRect(0, 0, s, s);

  const cx = s * 0.5, cy = s * 0.5;

  const drawLobe = (ox, oy, rx, ry, rot, dark) => {
    g.save();
    g.translate(ox, oy);
    g.rotate(rot);
    const gr = g.createRadialGradient(0, 0, 2, 0, 0, Math.max(rx, ry));
    gr.addColorStop(0, dark ? 'rgba(32, 2, 2, 0.96)' : 'rgba(115, 6, 6, 0.94)');
    gr.addColorStop(0.55, 'rgba(78, 4, 4, 0.88)');
    gr.addColorStop(0.85, 'rgba(42, 1, 1, 0.35)');
    gr.addColorStop(1, 'rgba(20, 0, 0, 0)');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };

  drawLobe(cx, cy, 135, 110, 0.3, true);
  drawLobe(cx - 22, cy + 16, 110, 92, -0.5, false);
  drawLobe(cx + 26, cy - 18, 95, 118, 0.8, false);

  for (let i = 0; i < 40; i++) {
    const a = (i * 2.39996) % (Math.PI * 2);
    const dist = 55 + ((i * 23) % 115);
    const r = 6 + (i % 16);
    drawLobe(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist, r * 1.2, r * 0.85, a, i % 3 === 0);
  }

  floorBloodTex = new THREE.CanvasTexture(c);
  floorBloodTex.colorSpace = THREE.SRGBColorSpace;
  return floorBloodTex;
}

function getWallBloodTexture() {
  if (wallBloodTex) return wallBloodTex;
  const s = 512, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.clearRect(0, 0, s, s);

  const cx = s * 0.5, cy = s * 0.38;
  const gr = g.createRadialGradient(cx, cy, 8, cx, cy, 145);
  gr.addColorStop(0, 'rgba(35, 2, 2, 0.96)');
  gr.addColorStop(0.5, 'rgba(98, 5, 5, 0.88)');
  gr.addColorStop(0.85, 'rgba(55, 2, 2, 0.35)');
  gr.addColorStop(1, 'rgba(20, 0, 0, 0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(cx, cy, 145, 0, Math.PI * 2);
  g.fill();

  for (let i = 0; i < 28; i++) {
    const x = 145 + (i / 28) * 222 + Math.sin(i * 2.7) * 5;
    const startY = cy - 20 + (i % 4) * 14;
    const len = 80 + ((i * 37) % 165);
    const dg = g.createLinearGradient(0, startY, 0, startY + len);
    dg.addColorStop(0, 'rgba(88, 4, 4, 0.92)');
    dg.addColorStop(0.7, 'rgba(60, 2, 2, 0.75)');
    dg.addColorStop(1, 'rgba(30, 0, 0, 0)');
    g.fillStyle = dg;
    g.beginPath();
    g.roundRect(x, startY, 3 + (i % 3) * 2, len, 3);
    g.fill();
  }

  wallBloodTex = new THREE.CanvasTexture(c);
  wallBloodTex.colorSpace = THREE.SRGBColorSpace;
  return wallBloodTex;
}

function getShadedSuitTexture() {
  if (shadedSuitTex) return shadedSuitTex;
  const s = 256, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');

  const gr = g.createLinearGradient(0, 0, s, 0);
  gr.addColorStop(0, '#3a3014');
  gr.addColorStop(0.3, '#7d692c');
  gr.addColorStop(0.5, '#967f36');
  gr.addColorStop(0.7, '#756228');
  gr.addColorStop(1, '#332a11');
  g.fillStyle = gr;
  g.fillRect(0, 0, s, s);

  for (let i = 0; i < 45; i++) {
    const y = (i * 19) % s;
    g.strokeStyle = i % 2 === 0 ? 'rgba(20, 15, 5, 0.35)' : 'rgba(180, 155, 75, 0.18)';
    g.lineWidth = 2 + (i % 3);
    g.beginPath();
    g.moveTo(0, y);
    g.quadraticCurveTo(s * 0.5, y + ((i % 5) - 2) * 8, s, y);
    g.stroke();
  }
  for (let i = 0; i < 12; i++) {
    const bx = (i * 67) % s, by = (i * 97) % s, br = 12 + (i % 22);
    const bg = g.createRadialGradient(bx, by, 2, bx, by, br);
    bg.addColorStop(0, 'rgba(75, 4, 4, 0.85)');
    bg.addColorStop(1, 'rgba(40, 0, 0, 0)');
    g.fillStyle = bg;
    g.beginPath();
    g.arc(bx, by, br, 0, Math.PI * 2);
    g.fill();
  }

  shadedSuitTex = new THREE.CanvasTexture(c);
  shadedSuitTex.colorSpace = THREE.SRGBColorSpace;
  return shadedSuitTex;
}

function getRottingFleshTexture() {
  if (rottingFleshTex) return rottingFleshTex;
  const s = 256, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');

  const gr = g.createLinearGradient(0, 0, s, s);
  gr.addColorStop(0, '#2b0404');
  gr.addColorStop(0.5, '#5e0a0a');
  gr.addColorStop(1, '#240303');
  g.fillStyle = gr;
  g.fillRect(0, 0, s, s);

  for (let i = 0; i < 90; i++) {
    g.strokeStyle = i % 5 === 0 ? 'rgba(165, 95, 85, 0.35)' : i % 2 === 0 ? 'rgba(110, 12, 12, 0.55)' : 'rgba(25, 2, 2, 0.6)';
    g.lineWidth = 1.5 + (i % 4);
    const y = (i * 11) % s;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(s * 0.33, y + 14, s * 0.66, y - 14, s, y);
    g.stroke();
  }

  rottingFleshTex = new THREE.CanvasTexture(c);
  rottingFleshTex.colorSpace = THREE.SRGBColorSpace;
  return rottingFleshTex;
}

function getRustedMetalTexture() {
  if (rustedMetalTex) return rustedMetalTex;
  const s = 256, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');

  const gr = g.createLinearGradient(0, 0, s, 0);
  gr.addColorStop(0, '#26251f');
  gr.addColorStop(0.4, '#424036');
  gr.addColorStop(0.7, '#38362d');
  gr.addColorStop(1, '#211f1a');
  g.fillStyle = gr;
  g.fillRect(0, 0, s, s);

  for (let i = 0; i < 55; i++) {
    const rx = (i * 53) % s, ry = (i * 89) % s, rr = 8 + (i % 24);
    const rg = g.createRadialGradient(rx, ry, 1, rx, ry, rr);
    rg.addColorStop(0, i % 2 === 0 ? 'rgba(82, 36, 16, 0.65)' : 'rgba(28, 24, 18, 0.7)');
    rg.addColorStop(1, 'rgba(40, 20, 10, 0)');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(rx, ry, rr, 0, Math.PI * 2);
    g.fill();
  }

  rustedMetalTex = new THREE.CanvasTexture(c);
  rustedMetalTex.colorSpace = THREE.SRGBColorSpace;
  return rustedMetalTex;
}

function getPowerJunctionTexture(isOnline = false) {
  if (!isOnline && junctionOffTex) return junctionOffTex;
  if (isOnline && junctionOnTex) return junctionOnTex;

  const w = 256, h = 512, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');

  const base = g.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, '#3d3c33');
  base.addColorStop(0.5, '#4a483d');
  base.addColorStop(1, '#2e2c25');
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);

  const addRust = (x, y, r, a = 0.75) => {
    const rg = g.createRadialGradient(x, y, 2, x, y, r);
    rg.addColorStop(0, `rgba(74, 30, 12, ${a})`);
    rg.addColorStop(0.5, `rgba(92, 42, 18, ${a * 0.65})`);
    rg.addColorStop(1, 'rgba(45, 20, 10, 0)');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  for (let i = 0; i < 36; i++) {
    addRust((i * 73) % w, (i * 131) % h, 18 + (i % 35), 0.68);
  }

  for (let i = 0; i < 24; i++) {
    const x = 16 + (i * 10);
    const len = 80 + ((i * 57) % 320);
    const dg = g.createLinearGradient(0, 10, 0, 10 + len);
    dg.addColorStop(0, 'rgba(24, 16, 10, 0.65)');
    dg.addColorStop(1, 'rgba(24, 16, 10, 0)');
    g.fillStyle = dg;
    g.fillRect(x, 10, 3 + (i % 3), len);
  }

  g.strokeStyle = '#1b1814';
  g.lineWidth = 6;
  g.strokeRect(12, 12, w - 24, h - 24);
  g.strokeStyle = 'rgba(120, 112, 92, 0.25)';
  g.lineWidth = 2;
  g.strokeRect(16, 16, w - 32, h - 32);

  g.fillStyle = '#24211c';
  g.fillRect(28, 28, w - 56, 42);
  g.strokeStyle = '#5c5346';
  g.lineWidth = 1.5;
  g.strokeRect(28, 28, w - 56, 42);
  g.fillStyle = '#b5a88b';
  g.font = 'bold 14px monospace';
  g.fillText('SUB-STATION // B-04', 42, 47);
  g.fillStyle = '#8c7f65';
  g.font = '11px monospace';
  g.fillText('480V THREE-PHASE BUS', 42, 63);

  const drawAnalogGauge = (cx, cy, rad, label, valRatio) => {
    addRust(cx, cy + 8, rad + 12, 0.55);
    g.fillStyle = '#211d18';
    g.beginPath();
    g.arc(cx, cy, rad + 5, 0, Math.PI * 2);
    g.fill();

    const dialGr = g.createRadialGradient(cx, cy, 2, cx, cy, rad);
    if (isOnline) {
      dialGr.addColorStop(0, '#e3cfa1');
      dialGr.addColorStop(0.75, '#b89f6d');
      dialGr.addColorStop(1, '#6e5a36');
    } else {
      dialGr.addColorStop(0, '#8f8268');
      dialGr.addColorStop(0.75, '#6b604b');
      dialGr.addColorStop(1, '#3d3629');
    }
    g.fillStyle = dialGr;
    g.beginPath();
    g.arc(cx, cy, rad, 0, Math.PI * 2);
    g.fill();

    g.strokeStyle = '#241e18';
    g.lineWidth = 1.5;
    for (let t = 0; t <= 8; t++) {
      const a = Math.PI * 1.15 + (t / 8) * (Math.PI * 0.7);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (rad - 11), cy + Math.sin(a) * (rad - 11));
      g.lineTo(cx + Math.cos(a) * (rad - 3), cy + Math.sin(a) * (rad - 3));
      g.stroke();
    }

    const needleAngle = Math.PI * 1.15 + valRatio * (Math.PI * 0.7);
    g.strokeStyle = '#4a120e';
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(cx, cy + 6);
    g.lineTo(cx + Math.cos(needleAngle) * (rad - 8), cy + Math.sin(needleAngle) * (rad - 8));
    g.stroke();

    g.strokeStyle = 'rgba(255, 250, 230, 0.22)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx - rad * 0.6, cy - rad * 0.5);
    g.lineTo(cx + rad * 0.1, cy + rad * 0.1);
    g.lineTo(cx + rad * 0.7, cy - rad * 0.2);
    g.stroke();

    g.fillStyle = '#241e18';
    g.font = 'bold 10px monospace';
    g.fillText(label, cx - 14, cy + 20);
  };

  drawAnalogGauge(76, 134, 40, 'VOLTS', isOnline ? 0.82 : 0.08);
  drawAnalogGauge(180, 134, 40, 'AMPS', isOnline ? 0.74 : 0.04);

  g.fillStyle = '#1b1815';
  g.fillRect(28, 198, w - 56, 185);
  g.strokeStyle = '#38322a';
  g.lineWidth = 2;
  g.strokeRect(28, 198, w - 56, 185);

  for (let r = 0; r < 3; r++) {
    const ry = 212 + r * 56;
    for (let col = 0; col < 2; col++) {
      const fx = col === 0 ? 40 : 136;
      g.fillStyle = '#2b2620';
      g.fillRect(fx, ry, 80, 42);
      g.strokeStyle = '#12100d';
      g.lineWidth = 2;
      g.strokeRect(fx, ry, 80, 42);

      g.fillStyle = '#6e472b';
      g.fillRect(fx + 10, ry + 8, 16, 26);
      g.fillRect(fx + 54, ry + 8, 16, 26);

      const px = fx + 40, py = ry + 21;
      const bulbGr = g.createRadialGradient(px, py, 1, px, py, 9);
      if (isOnline) {
        bulbGr.addColorStop(0, '#ffe399');
        bulbGr.addColorStop(0.5, '#c48d33');
        bulbGr.addColorStop(1, 'rgba(80, 50, 10, 0)');
      } else {
        bulbGr.addColorStop(0, '#cc4422');
        bulbGr.addColorStop(0.5, '#6e1c0c');
        bulbGr.addColorStop(1, 'rgba(40, 5, 0, 0)');
      }
      g.fillStyle = bulbGr;
      g.beginPath();
      g.arc(px, py, 9, 0, Math.PI * 2);
      g.fill();
    }
  }

  g.fillStyle = 'rgba(168, 130, 48, 0.55)';
  g.fillRect(36, 398, w - 72, 28);
  g.fillStyle = '#1f1b16';
  g.font = 'bold 13px monospace';
  g.fillText('CAUTION: HIGH VOLTAGE', 46, 417);

  for (let v = 0; v < 5; v++) {
    const vy = 440 + v * 10;
    g.fillStyle = '#14120f';
    g.fillRect(42, vy, w - 84, 4);
    g.fillStyle = 'rgba(140, 130, 110, 0.2)';
    g.fillRect(42, vy + 4, w - 84, 2);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (isOnline) junctionOnTex = tex;
  else junctionOffTex = tex;
  return tex;
}

// ============================================================================
// 3. SLOW-BURN ESCALATION & NON-LETHAL OBJECTIVE DISRUPTION CONTROLLER
// ============================================================================
function initInvestigationSystem(g) {
  if (!g || g._investigationReady) return;
  g._investigationReady = true;

  const vfFrame = $('vf-frame');
  const vfLabel = $('vf-label');
  const objPhase = $('obj-phase');
  const objList = $('obj-list');
  const compassEl = $('uplink-compass');
  const clueTitle = $('clue-title');
  const clueList = $('clue-list');
  const tapeSub = $('tape-sub');
  const lobbyEl = $('lobby');
  const levelEl = $('level');
  const flashEl = $('flash');
  const statusEl = $('status');
  const camDir = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const eeriePos = new THREE.Vector3();
  let subTimer = 0;

  // 1. CO-OP BACK BUTTON
  $('lb-back')?.addEventListener('click', () => {
    if (g.mp && !g.mp.coop) g.mp.fail('');
    $('lb-panel').style.display = 'none';
    $('lb-modes').style.display = 'block';
    $('lb-status').textContent = '';
  });

  // 2. START WITH FLASHLIGHT OFF
  function enforceFlashlightStartOff() {
    if (!g.flash) return;
    g.flash.on = false;
    g.flash.spot.intensity = 0;
    g.flash.fill.intensity = 0;
  }
  enforceFlashlightStartOff();

  const lockAndStart = () => {
    g.audio?.init();
    enforceFlashlightStartOff();
    if (!g.player?.isMobileDevice) {
      try { g.player?.controls?.lock(); } catch (_) {}
    }
  };
  $('lb-solo')?.addEventListener('click', lockAndStart);
  $('lb-enter')?.addEventListener('click', lockAndStart);

  // 3. BLOCK SECTOR CHANGING IN MULTIPLAYER & TRACK FLASHLIGHT SWITCH [F]
  addEventListener('keydown', e => {
    if (e.code === 'KeyR' && g.mp?.coop) {
      e.stopImmediatePropagation();
      g.say('SECTOR LOCKED IN CO-OP MODE', 1800);
    }
    if (e.code === 'KeyF' && !e.repeat && hasMutation('beam_toggle_aggro')) {
      const m = g.monster;
      if (m && m.active && !g.dead && m.dist() < 20) {
        const c = g.camera.position;
        m.known = { x: c.x, z: c.z, cell: m.cellId(c.x, c.z), time: m.age };
        if (m.mode === 'PATROL') m.change('STALK');
      }
    }
  }, true);

  function updateSectorLabel() {
    const sNum = Math.max(1, (g.level || 0) + 1);
    if (levelEl) levelEl.textContent = String(sNum).padStart(2, '0');
    if (g.mp && !g.mp._sectorLocked) {
      g.mp._sectorLocked = true;
      g.mp.escape = function() {
        if (!this.isHost) return;
        const sameSeed = this.seed, sameSector = Math.max(0, this.g.level);
        this.share.world('level', { seed: sameSeed, level: sameSector });
        this.startLevel(sameSeed, sameSector);
      };
    }
  }

  let spaceHeld = false;
  addEventListener('keydown', e => {
    if (e.code === 'Space') spaceHeld = true;
  });
  addEventListener('keyup', e => {
    if (e.code === 'Space') spaceHeld = false;
  });

  const btnC = $('btn-c');
  if (btnC) {
    btnC.addEventListener('pointerdown', () => { spaceHeld = true; });
    btnC.addEventListener('pointerup', () => { spaceHeld = false; });
    btnC.addEventListener('pointercancel', () => { spaceHeld = false; });
  }

  let state = {
    seed: 1,
    phase: 1,
    tasks: [],
    mutations: [],
    profileCode: '',
    discoveredClues: [],
    propsGroup: null,
    props: [],
    beaconPos: null,
    beaconCell: -1,
    beaconDistMap: null,
    beaconGroup: null,
    uploadPct: 0,
    uploadJammed: false,
    jamTimer: 0,
    jam30Done: false,
    jam65Done: false,
    jam90Done: false,
    missionComplete: false,
    emfAccum: 0,
    pingTimer: 0,
    sabotageTimer: 0,
    disruptCooldown: 0,
    propLockoutTimer: 0, // Brief lockout when the monster trips/disrupts your terminal!
    bluffChargeActive: false,
    holdNoiseAccum: 0,
    eerieTimer: 9,
    lastCamYaw: 0,
    feintTimer: 0,
    traitTimers: { beamOn: 0, still: 0, sprint: 0, crank: 0, gaze: 0, spin: 0 },
    usedPuddles: new Set(),
    t: 0,
    menuYawBase: null
  };

  function pulseScreenTint(hexColor, alpha = 0.35, ms = 450) {
    if (!flashEl) return;
    flashEl.style.background = hexColor;
    flashEl.style.opacity = String(alpha);
    setTimeout(() => {
      flashEl.style.opacity = '0';
      setTimeout(() => { flashEl.style.background = '#fff'; }, 300);
    }, ms);
  }

  function showTranscript(header, body, ms = 9500) {
    if (!tapeSub) return;
    tapeSub.innerHTML = `<b>${header}</b>${body}`;
    tapeSub.classList.add('show');
    clearTimeout(subTimer);
    subTimer = setTimeout(() => tapeSub.classList.remove('show'), ms);
  }

  function renderCluesHUD() {
    if (!state.discoveredClues.length) {
      clueTitle.style.display = 'none';
      clueList.innerHTML = '';
      return;
    }
    clueTitle.style.display = 'block';
    clueTitle.textContent = `ENTITY STRAIN #${state.profileCode} // TRAITS`;
    clueList.innerHTML = state.discoveredClues
      .map(idx => `<div class="clue-item">· ${state.mutations[idx]?.clue || ''}</div>`)
      .join('');
  }

  function rollMutationsForSector(seedInput) {
    const chaosSeed = g.mp?.coop ? ((seedInput ^ 0xA5A5F00D) >>> 0) : trueChaosSeed();
    const rng = mulberry32(chaosSeed);

    const pool = [...ALL_TRAITS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const wantCount = rng() < 0.45 ? 5 : 4;
    const picked = [];
    for (const candidate of pool) {
      if (picked.length >= wantCount) break;
      const conflicts = CONFLICT_PAIRS.some(
        ([a, b]) => (candidate.id === a && picked.some(p => p.id === b)) ||
                    (candidate.id === b && picked.some(p => p.id === a))
      );
      if (!conflicts) picked.push(candidate);
    }

    state.profileCode = picked.map(t => t.id.slice(0, 2).toUpperCase()).join('-') + '-' + (10 + Math.floor(rng() * 89));
    state.mutations = picked;
    state.discoveredClues = [];
    renderCluesHUD();
  }

  function hasMutation(id) {
    return state.mutations.some(m => m.id === id);
  }

  // Co-op Network Bridge
  if (g.share && !g.share._invHooked) {
    g.share._invHooked = true;
    const origApplyWorld = g.share.applyWorld.bind(g.share);
    g.share.applyWorld = function(d) {
      if (d.e === 'inv-event') {
        handleNetworkInvestigationEvent(d, true);
        return;
      }
      origApplyWorld(d);
    };
  }

  function broadcastInvEvent(payload) {
    if (g.share?.on) {
      g.share.world('inv-event', payload);
    } else {
      handleNetworkInvestigationEvent(payload, false);
    }
  }

  function handleNetworkInvestigationEvent(d) {
    if (d.act === 'tape') {
      const p = state.props.find(x => x.type === 'tape' && x.idx === d.idx);
      if (p && !p.done) {
        p.done = true;
        p.progress = p.needTime;
        if (p.tapeMesh) p.tapeMesh.visible = false;
        if (p.ledLight) p.ledLight.intensity = 0.25;
        const clueIdx = d.idx % state.mutations.length;
        if (!state.discoveredClues.includes(clueIdx)) {
          state.discoveredClues.push(clueIdx);
          renderCluesHUD();
        }
        if (p.tapeData) {
          showTranscript(p.tapeData.header, p.tapeData.transcript, 9500);
        }
        pulseScreenTint('#7a0000', 0.3, 350);
        g.audio?.tone?.(1040, 0.16, 0.07, 'sine');
        advanceTask('tape', 1, true);
      }
    } else if (d.act === 'prop-done') {
      const p = state.props.find(x => x.type === d.pType && x.idx === d.idx);
      if (p && !p.done) {
        p.done = true;
        p.progress = p.needTime;
        const u = p.mesh?.userData;
        if (u?.light) {
          u.light.color.setHex(0xd9b36c);
          u.light.intensity = 2.6;
        }
        if (u?.frontPlate) u.frontPlate.material.map = getPowerJunctionTexture(true);
        if (u?.bulbMat) u.bulbMat.color.setHex(0xffd480);
        if (u?.leverPivot) u.leverPivot.rotation.x = 0.85;
        g.audio?.tone?.(1120, 0.3, 0.08, 'triangle', p.pos);
        g.say(p.type === 'relay' ? 'SEISMIC RELAY LOCKED AT 100%' : 'BREAKER JUNCTION ENERGIZED (100%)', 2200);
        advanceTask(p.type, 1, true);
      }
    } else if (d.act === 'task') {
      advanceTask(d.taskId, d.amt || 1, true);
    } else if (d.act === 'uplink-state') {
      state.uploadJammed = !!d.jammed;
      if (typeof d.pct === 'number') state.uploadPct = Math.max(state.uploadPct, d.pct);
      if (d.jamTimer) state.jamTimer = d.jamTimer;
      renderObjectivesHUD();
    }
  }

  function isFloor(w, x, z) {
    if (x < 0 || z < 0 || x >= w.n || z >= w.n) return false;
    return w.flatGrid ? w.flatGrid[x * w.n + z] === 0 : w.grid[x]?.[z] === 0;
  }

  function buildDistanceMap(w, bx, bz) {
    const n = w.n, N = n * n;
    const dist = new Int32Array(N).fill(-1);
    const q = new Int32Array(N);
    let head = 0, tail = 0;
    const start = bx * n + bz;
    if (start < 0 || start >= N) return dist;
    dist[start] = 0;
    q[tail++] = start;

    while (head < tail) {
      const cur = q[head++];
      const cx = (cur / n) | 0, cz = cur % n, nextD = dist[cur] + 1;
      for (let i = 0; i < 4; i++) {
        const nx = cx + DIRS[i][0], nz = cz + DIRS[i][1];
        if (!isFloor(w, nx, nz)) continue;
        const k = nx * n + nz;
        if (dist[k] === -1) {
          dist[k] = nextD;
          q[tail++] = k;
        }
      }
    }
    return dist;
  }

  function pickSpreadCells(count, minSteps, salt = 1, requireWall = false) {
    const w = g.world, n = w.n;
    let sx = Math.round(g.camera.position.x / 4);
    let sz = Math.round(g.camera.position.z / 4);
    if (!isFloor(w, sx, sz)) {
      sx = n >> 1; sz = n >> 1;
    }
    const spawnDist = buildDistanceMap(w, sx, sz);
    const chosen = [];
    const occupied = new Set(state.props.map(p => p.cell));

    for (let k = 0; k < count; k++) {
      let bestCell = -1, bestScore = -Infinity;
      for (let id = 0; id < n * n; id++) {
        if (occupied.has(id)) continue;
        const d0 = spawnDist[id];
        if (d0 < minSteps || d0 > 22) continue;
        const cx = (id / n) | 0, cz = id % n;

        let wallNeighbors = 0;
        for (const [dx, dz] of DIRS) {
          if (!isFloor(w, cx + dx, cz + dz)) wallNeighbors++;
        }
        if (requireWall && wallNeighbors === 0) continue;

        let minOther = 999;
        for (const c of chosen) {
          const ox = (c / n) | 0, oz = c % n;
          minOther = Math.min(minOther, Math.hypot(cx - ox, cz - oz));
        }
        if (minOther < 6) continue;

        const hash = Math.sin(id * 12.9898 + (k + salt) * 78.233 + state.seed) * 43758.5453;
        const frac = hash - Math.floor(hash);
        const wallBonus = wallNeighbors > 0 ? 12 : 0;
        const score = Math.min(minOther, 16) * 1.4 - d0 * 0.25 + wallBonus + frac * 5;
        if (score > bestScore) {
          bestScore = score;
          bestCell = id;
        }
      }
      if (bestCell >= 0) {
        chosen.push(bestCell);
        occupied.add(bestCell);
      }
    }
    return chosen;
  }

  // ============================================================================
  // 4. ANATOMICAL SHADED CORPSES, UNCUT BLOOD DECALS & VINTAGE WALL JUNCTIONS
  // ============================================================================
  function buildGoreSceneMesh(seedVal, cx, cz, archetype) {
    const grp = new THREE.Group();
    const rng = mulberry32(seedVal);
    const w = g.world;

    const suitMat = new THREE.MeshBasicMaterial({ map: getShadedSuitTexture() });
    const darkGearMat = new THREE.MeshBasicMaterial({ color: 0x262218 });
    const bootMat = new THREE.MeshBasicMaterial({ color: 0x161513 });
    const fleshMat = new THREE.MeshBasicMaterial({ map: getRottingFleshTexture() });
    const boneMat = new THREE.MeshBasicMaterial({ color: 0xc8bca0 });
    const visorMat = new THREE.MeshBasicMaterial({ color: 0x111318 });

    const floorDecalMat = new THREE.MeshBasicMaterial({
      map: getFloorBloodTexture(), transparent: true, opacity: 0.95,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3
    });
    const wallDecalMat = new THREE.MeshBasicMaterial({
      map: getWallBloodTexture(), transparent: true, opacity: 0.94,
      side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4
    });

    const wallDirs = [];
    if (w) {
      for (const [dx, dz] of DIRS) {
        if (!isFloor(w, cx + dx, cz + dz)) {
          wallDirs.push([dx, dz]);
        }
      }
    }
    const primaryWall = wallDirs[0] || null;

    function makeArticulatedLimb(r1, r2, len1, len2, matUpper, matLower, matEnd, bendAngle = 0.35) {
      const root = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(r1, len1, 6, 10), matUpper);
      upper.position.y = -len1 * 0.5;
      root.add(upper);

      const joint = new THREE.Group();
      joint.position.y = -len1;
      joint.rotation.x = bendAngle;
      root.add(joint);

      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(r2, len2, 6, 10), matLower);
      lower.position.y = -len2 * 0.5;
      joint.add(lower);

      if (matEnd) {
        const endMesh = new THREE.Mesh(new THREE.BoxGeometry(r2 * 2.1, r2 * 1.6, r2 * 3.0), matEnd);
        endMesh.position.set(0, -len2 - r2 * 0.5, r2 * 0.6);
        joint.add(endMesh);
      }
      return { root, joint };
    }

    function makeHazmatHead() {
      const hGrp = new THREE.Group();
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.165, 12, 12), suitMat);
      hood.scale.set(0.95, 1.08, 1.02);
      const visorRim = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.13, 0.12), darkGearMat);
      visorRim.position.set(0, 0.01, 0.11);
      const visorGlass = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.10, 0.13), visorMat);
      visorGlass.position.set(0, 0.01, 0.115);
      const respirator = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.09, 8), darkGearMat);
      respirator.rotation.x = Math.PI / 2 + 0.3;
      respirator.position.set(0, -0.08, 0.14);
      hGrp.add(hood, visorRim, visorGlass, respirator);
      return hGrp;
    }

    let tapePos = new THREE.Vector3(0.45, 0.05, -0.45);

    if (archetype === 0 && primaryWall) {
      const [wx, wz] = primaryWall;

      const wallSplat = new THREE.Mesh(new THREE.PlaneGeometry(1.95, 1.95), wallDecalMat);
      wallSplat.position.set(wx * 1.985, 0.95, wz * 1.985);
      wallSplat.lookAt(0, 0.95, 0);
      grp.add(wallSplat);

      const sitPool = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0), floorDecalMat);
      sitPool.rotation.x = -Math.PI / 2;
      sitPool.position.set(wx * 1.25, 0.018, wz * 1.25);
      grp.add(sitPool);

      const bodyGrp = new THREE.Group();
      bodyGrp.position.set(wx * 1.82, 0, wz * 1.82);
      bodyGrp.lookAt(0, 0, 0);
      grp.add(bodyGrp);

      const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.18, 6, 10), suitMat);
      pelvis.rotation.z = Math.PI / 2;
      pelvis.position.set(0, 0.13, 0.14);
      bodyGrp.add(pelvis);

      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.34, 8, 12), suitMat);
      torso.position.set(0, 0.42, 0.02);
      torso.rotation.x = -0.26;
      bodyGrp.add(torso);

      const wound = new THREE.Mesh(new THREE.CapsuleGeometry(0.125, 0.2, 6, 8), fleshMat);
      wound.position.set(0, 0.40, 0.11);
      wound.rotation.x = -0.26;
      bodyGrp.add(wound);

      for (let r = -1; r <= 1; r++) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.014, 5, 10, Math.PI * 0.85), boneMat);
        rib.position.set(0, 0.41 + r * 0.065, 0.09);
        rib.rotation.x = Math.PI / 2 - 0.26;
        bodyGrp.add(rib);
      }

      const head = makeHazmatHead();
      head.position.set(0.02, 0.74, -0.02);
      head.rotation.set(0.48, 0.18, -0.15);
      bodyGrp.add(head);

      const legL = makeArticulatedLimb(0.082, 0.068, 0.36, 0.36, suitMat, suitMat, bootMat, 0.35);
      legL.root.position.set(-0.13, 0.13, 0.18);
      legL.root.rotation.set(Math.PI / 2 - 0.18, 0.25, 0);

      const legR = makeArticulatedLimb(0.082, 0.068, 0.36, 0.36, suitMat, fleshMat, bootMat, 0.55);
      legR.root.position.set(0.13, 0.13, 0.18);
      legR.root.rotation.set(Math.PI / 2 - 0.25, -0.3, 0);
      bodyGrp.add(legL.root, legR.root);

      const armL = makeArticulatedLimb(0.058, 0.048, 0.3, 0.28, suitMat, suitMat, darkGearMat, -0.55);
      armL.root.position.set(-0.22, 0.56, 0.02);
      armL.root.rotation.set(0.25, 0, 0.28);

      const armR = makeArticulatedLimb(0.058, 0.048, 0.3, 0.28, suitMat, fleshMat, null, -0.7);
      armR.root.position.set(0.22, 0.56, 0.02);
      armR.root.rotation.set(0.45, 0, -0.25);
      bodyGrp.add(armR.root, armL.root);

      tapePos.set(wx * 0.85 - wz * 0.45, 0.05, wz * 0.85 + wx * 0.45);

    } else if (archetype === 1) {
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), floorDecalMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = 0.018;
      pool.rotation.z = rng() * Math.PI * 2;
      grp.add(pool);

      const bodyGrp = new THREE.Group();
      const yaw = rng() * Math.PI * 2;
      bodyGrp.rotation.y = yaw;
      grp.add(bodyGrp);

      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.165, 0.36, 8, 12), suitMat);
      torso.rotation.x = Math.PI / 2 - 0.1;
      torso.position.set(0, 0.16, 0);
      bodyGrp.add(torso);

      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.36, 10), darkGearMat);
      tank.rotation.x = Math.PI / 2 - 0.1;
      tank.position.set(0, 0.31, -0.02);
      bodyGrp.add(tank);

      const severedWaist = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.16, 6, 8), fleshMat);
      severedWaist.rotation.x = Math.PI / 2;
      severedWaist.position.set(0, 0.11, -0.26);
      bodyGrp.add(severedWaist);

      for (let v = 0; v < 5; v++) {
        const vert = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.045, 8), boneMat);
        vert.rotation.x = Math.PI / 2;
        vert.position.set(Math.sin(v) * 0.015, 0.07, -0.34 - v * 0.065);
        bodyGrp.add(vert);
      }

      const head = makeHazmatHead();
      head.position.set(0, 0.21, 0.32);
      head.rotation.set(-0.35, 0.15, 0);
      bodyGrp.add(head);

      const armR = makeArticulatedLimb(0.058, 0.048, 0.3, 0.3, suitMat, suitMat, darkGearMat, -0.25);
      armR.root.position.set(0.21, 0.14, 0.18);
      armR.root.rotation.set(Math.PI / 2 - 0.08, -0.15, 0);

      const armL = makeArticulatedLimb(0.058, 0.048, 0.3, 0.28, suitMat, fleshMat, null, -1.0);
      armL.root.position.set(-0.21, 0.14, 0.14);
      armL.root.rotation.set(Math.PI / 2, 0.55, 0);
      bodyGrp.add(armR.root, armL.root);

      tapePos.set(Math.sin(yaw) * 0.82, 0.05, Math.cos(yaw) * 0.82);

    } else if (archetype === 2) {
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), floorDecalMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = 0.018;
      pool.rotation.z = rng() * Math.PI * 2;
      grp.add(pool);

      const remainsGrp = new THREE.Group();
      remainsGrp.rotation.y = rng() * Math.PI * 2;
      grp.add(remainsGrp);

      const meatCore = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.42, 8, 12), fleshMat);
      meatCore.rotation.x = Math.PI / 2;
      meatCore.scale.set(1.15, 1.0, 0.55);
      meatCore.position.set(0, 0.09, 0);
      remainsGrp.add(meatCore);

      for (let r = 0; r < 6; r++) {
        const zOff = (r - 2.5) * 0.075;
        const ribArch = new THREE.Mesh(
          new THREE.TorusGeometry(0.145 - r * 0.008, 0.015, 6, 12, Math.PI * 1.4),
          boneMat
        );
        ribArch.position.set(0, 0.08, zOff);
        ribArch.rotation.z = -Math.PI * 0.2;
        remainsGrp.add(ribArch);
      }

      const skullGrp = new THREE.Group();
      skullGrp.position.set(-0.28, 0.12, 0.34);
      skullGrp.rotation.set(-0.2, 0.5, 0.35);
      const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), boneMat);
      cranium.scale.set(0.92, 1.05, 1.12);
      const maxilla = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.09, 8), boneMat);
      maxilla.position.set(0, -0.06, 0.06);
      const socketL = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), visorMat);
      socketL.position.set(-0.04, 0.01, 0.10);
      const socketR = socketL.clone();
      socketR.position.x = 0.04;
      skullGrp.add(cranium, maxilla, socketL, socketR);
      remainsGrp.add(skullGrp);

      const femur = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.36, 5, 8), boneMat);
      femur.rotation.set(Math.PI / 2, 0.4, 0.7);
      femur.position.set(0.35, 0.03, -0.28);
      remainsGrp.add(femur);

      tapePos.set(0.45, 0.05, 0.38);

    } else {
      const pool1 = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), floorDecalMat);
      pool1.rotation.x = -Math.PI / 2;
      pool1.position.set(-0.15, 0.018, 0.1);
      pool1.rotation.z = rng() * Math.PI * 2;
      grp.add(pool1);

      const pool2 = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), floorDecalMat);
      pool2.rotation.x = -Math.PI / 2;
      pool2.position.set(0.35, 0.019, -0.3);
      pool2.rotation.z = rng() * Math.PI * 2;
      grp.add(pool2);

      if (primaryWall) {
        const [wx, wz] = primaryWall;
        const wallSplat = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), wallDecalMat);
        wallSplat.position.set(wx * 1.985, 1.0, wz * 1.985);
        wallSplat.lookAt(0, 1.0, 0);
        grp.add(wallSplat);
      }

      const head = makeHazmatHead();
      head.position.set(-0.35, 0.14, 0.22);
      head.rotation.set(0.4, rng() * Math.PI, 1.15);
      grp.add(head);

      const forearm = makeArticulatedLimb(0.055, 0.046, 0.22, 0.26, fleshMat, suitMat, darkGearMat, -0.3);
      forearm.root.position.set(0.12, 0.055, -0.12);
      forearm.root.rotation.set(Math.PI / 2, -0.6, 0);
      grp.add(forearm.root);

      tapePos.set(0.42, 0.05, -0.38);
    }

    const tapeGrp = new THREE.Group();
    tapeGrp.position.copy(tapePos);

    const cassette = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.06, 0.22),
      new THREE.MeshBasicMaterial({ color: 0x181414 })
    );
    const bloodLabel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.24, 0.12),
      new THREE.MeshBasicMaterial({ color: 0xff3b22, side: THREE.DoubleSide })
    );
    bloodLabel.rotation.x = -Math.PI / 2;
    bloodLabel.position.y = 0.032;

    const brokenCam = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.15, 0.32),
      new THREE.MeshBasicMaterial({ color: 0x262420 })
    );
    brokenCam.position.set(-0.3, 0.035, 0.16);
    brokenCam.rotation.set(0.18, 0.55, 0.35);

    tapeGrp.add(cassette, bloodLabel, brokenCam);
    grp.add(tapeGrp);

    const led = new THREE.PointLight(0xff2211, 3.0, 9.0, 1.4);
    led.position.set(tapePos.x, 0.45, tapePos.z);
    grp.add(led);

    grp.userData = { tapeMesh: tapeGrp, ledLight: led, spinner: bloodLabel };
    return grp;
  }

  function buildPowerJunctionMesh(cx, cz) {
    const grp = new THREE.Group();
    const w = g.world;

    let wallDir = null;
    if (w) {
      for (const [dx, dz] of DIRS) {
        if (!isFloor(w, cx + dx, cz + dz)) {
          wallDir = [dx, dz];
          break;
        }
      }
    }

    const rig = new THREE.Group();
    if (wallDir) {
      const [wx, wz] = wallDir;
      rig.position.set(wx * 1.88, 0, wz * 1.88);
      rig.lookAt(0, 0, 0);
    }
    grp.add(rig);

    const rustMat = new THREE.MeshBasicMaterial({ map: getRustedMetalTexture() });
    const darkIronMat = new THREE.MeshBasicMaterial({ color: 0x1e1c18 });
    const copperMat = new THREE.MeshBasicMaterial({ color: 0x593a22 });

    const backFlange = new THREE.Mesh(new THREE.BoxGeometry(0.84, 1.48, 0.03), darkIronMat);
    backFlange.position.set(0, 1.15, -0.105);
    rig.add(backFlange);

    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.36, 0.22), rustMat);
    cabinet.position.set(0, 1.15, 0.01);
    rig.add(cabinet);

    const topLip = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.04, 0.25), darkIronMat);
    topLip.position.set(0, 1.84, 0.015);
    const botLip = topLip.clone();
    botLip.position.y = 0.46;
    rig.add(topLip, botLip);

    const frontPlate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.68, 1.32),
      new THREE.MeshBasicMaterial({ map: getPowerJunctionTexture(false) })
    );
    frontPlate.position.set(0, 1.15, 0.122);
    rig.add(frontPlate);

    for (const px of [-0.22, 0.22]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 1.45, 10), rustMat);
      pipe.position.set(px, 2.54, -0.075);
      rig.add(pipe);

      const elbowBox = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.14), darkIronMat);
      elbowBox.position.set(px, 1.86, -0.04);
      rig.add(elbowBox);

      for (const cy of [2.15, 2.75]) {
        const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.045, 0.06), darkIronMat);
        clamp.position.set(px, cy, -0.09);
        rig.add(clamp);
      }
    }

    const floorPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.48, 8), darkIronMat);
    floorPipe.position.set(-0.18, 0.24, -0.08);
    rig.add(floorPipe);

    const switchBox = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.28, 0.16), darkIronMat);
    switchBox.position.set(0.40, 1.18, 0.01);
    rig.add(switchBox);

    const leverPivot = new THREE.Group();
    leverPivot.position.set(0.44, 1.18, 0.02);
    leverPivot.rotation.x = -0.75;
    const ironRod = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.34, 0.035), rustMat);
    ironRod.position.y = 0.15;
    const bakeliteGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.14, 10), copperMat);
    bakeliteGrip.rotation.z = Math.PI / 2;
    bakeliteGrip.position.set(0.045, 0.31, 0);
    leverPivot.add(ironRod, bakeliteGrip);
    rig.add(leverPivot);

    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.06, 10), darkIronMat);
    lampBase.rotation.x = Math.PI / 2;
    lampBase.position.set(0, 2.04, -0.09);
    rig.add(lampBase);

    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xb83b1a });
    const glassGlobe = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 10), bulbMat);
    glassGlobe.scale.set(0.85, 1.15, 0.85);
    glassGlobe.position.set(0, 2.04, -0.03);
    rig.add(glassGlobe);

    const wireCage = new THREE.Mesh(
      new THREE.SphereGeometry(0.082, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0x24201a, wireframe: true })
    );
    wireCage.scale.set(0.9, 1.2, 0.9);
    wireCage.position.set(0, 2.04, -0.03);
    rig.add(wireCage);

    const light = new THREE.PointLight(0xc44722, 2.4, 9.5, 1.5);
    light.position.set(0, 1.95, 0.38);
    rig.add(light);

    grp.userData = { spinner: wireCage, light, frontPlate, leverPivot, bulbMat };
    return grp;
  }

  function clearAllSectorProps() {
    if (state.propsGroup) {
      state.propsGroup.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (
          o.material &&
          o.material.map !== floorBloodTex &&
          o.material.map !== wallBloodTex &&
          o.material.map !== shadedSuitTex &&
          o.material.map !== rottingFleshTex &&
          o.material.map !== rustedMetalTex &&
          o.material.map !== junctionOffTex &&
          o.material.map !== junctionOnTex
        ) {
          o.material.dispose();
        }
      });
      g.scene.remove(state.propsGroup);
      state.propsGroup = null;
    }
    state.props = [];
    if (state.beaconGroup) {
      state.beaconGroup.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      g.scene.remove(state.beaconGroup);
      state.beaconGroup = null;
    }
    state.beaconPos = null;
    state.beaconCell = -1;
    state.beaconDistMap = null;
    compassEl.style.display = 'none';
  }

  function buildTapeTranscriptForCorpse(seedVal, idx, mut) {
    const rng = mulberry32((seedVal ^ ((idx + 1) * 0x85EBCA6B)) >>> 0);
    const pick = arr => arr[Math.floor(rng() * arr.length)];
    const logNum = 100 + Math.floor(rng() * 899);
    const op = pick(OPERATIVE_NAMES);
    const sq = pick(SQUAD_TAGS);
    return {
      cause: mut.cause,
      header: `TAPE #${logNum} // ${op} [${sq}] — ${mut.axis} LOG`,
      transcript: `*static hiss, ragged breathing* <b>"${mut.intel}"</b> *wet crunch, signal lost*`
    };
  }

  function spawnPhaseProps(type, count, minSteps, salt, needTime = 3.0) {
    if (!state.propsGroup) {
      state.propsGroup = new THREE.Group();
      g.scene.add(state.propsGroup);
    }
    if (state.props.some(p => p.type === type)) return;

    const cells = pickSpreadCells(count, minSteps, salt, type === 'tape' || type === 'junction');
    const n = g.world.n, CELL = 4;

    cells.forEach((cellId, idx) => {
      const cx = (cellId / n) | 0, cz = cellId % n;
      const pos = new THREE.Vector3(cx * CELL, 0, cz * CELL);
      let grp;
      let tapeData = null;

      if (type === 'tape') {
        const mut = state.mutations[idx % state.mutations.length];
        tapeData = buildTapeTranscriptForCorpse(state.seed + cellId * 31, idx, mut);
        const arch = (idx + (state.seed & 3)) % 4;
        grp = buildGoreSceneMesh(cellId + idx * 137 + state.seed, cx, cz, arch);
        grp.position.copy(pos);
      } else if (type === 'relay') {
        grp = new THREE.Group();
        grp.position.copy(pos);
        const relayBlood = new THREE.Mesh(
          new THREE.PlaneGeometry(1.9, 1.9),
          new THREE.MeshBasicMaterial({
            map: getFloorBloodTexture(), transparent: true, opacity: 0.85,
            depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2
          })
        );
        relayBlood.rotation.x = -Math.PI / 2;
        relayBlood.position.y = 0.015;
        const stand = new THREE.Mesh(
          new THREE.ConeGeometry(0.38, 1.3, 4, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xffaa22, wireframe: true })
        );
        stand.position.y = 0.65;
        const head = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.22, 0),
          new THREE.MeshBasicMaterial({ color: 0xffcc33 })
        );
        head.position.y = 1.35;
        const light = new THREE.PointLight(0xffaa00, 3.2, 10, 1.4);
        light.position.y = 1.45;
        grp.add(relayBlood, stand, head, light);
        grp.userData = { spinner: head, light };
      } else if (type === 'junction') {
        grp = buildPowerJunctionMesh(cx, cz);
        grp.position.copy(pos);
      }

      state.propsGroup.add(grp);
      state.props.push({
        type, idx, cell: cellId,
        pos: new THREE.Vector3(pos.x, 1.0, pos.z),
        mesh: grp,
        tapeMesh: grp.userData.tapeMesh,
        ledLight: grp.userData.ledLight,
        tapeData,
        done: false,
        beingHeld: false,
        progress: 0,
        needTime,
        sabotageMilestone: 0,
        distMap: buildDistanceMap(g.world, cx, cz)
      });
    });
  }

  function spawnUplinkTerminal() {
    if (state.beaconGroup) return;
    const cells = pickSpreadCells(1, 8, 99, false);
    const bestCell = cells[0] || 0;
    const n = g.world.n, CELL = 4;
    const bx = (bestCell / n) | 0, bz = bestCell % n;

    state.beaconCell = bestCell;
    state.beaconPos = new THREE.Vector3(bx * CELL, 1.35, bz * CELL);
    state.beaconDistMap = buildDistanceMap(g.world, bx, bz);

    const grp = new THREE.Group();
    grp.position.copy(state.beaconPos);

    const cage = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.75, 0),
      new THREE.MeshBasicMaterial({ color: 0x7aff66, wireframe: true, transparent: true, opacity: 0.92 })
    );
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.35, 1),
      new THREE.MeshBasicMaterial({ color: 0xefffa8 })
    );
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.6, 3.1, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x7aff66, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.position.y = 0.1;

    const ptLight = new THREE.PointLight(0x7aff66, 5.5, 20, 1.3);
    grp.add(cage, core, ring, ptLight);
    grp.userData = { cage, core, ptLight };
    g.scene.add(grp);
    state.beaconGroup = grp;

    pulseScreenTint('#44ff66', 0.3, 450);
    g.warn('PHASE 5 // GREENLIGHT UPLINK ONLINE — HOLD [SPACE] TO TRANSMIT', 3600);
    g.audio?.tone?.(880, 0.4, 0.09, 'sine', state.beaconPos);
  }

  function startPhase(p) {
    state.phase = p;
    state.uploadJammed = false;
    state.jamTimer = 0;
    state.bluffChargeActive = false;

    const phaseColors = ['', '#fff0a8', '#ffbb55', '#ff6655', '#66ccff', '#9eff7a'];
    if (objPhase) objPhase.style.color = phaseColors[p] || '#fff0a8';

    if (p === 1) {
      state.tasks = [
        { id: 'tape', label: 'EXTRACT DYING TAPES FROM CORPSES [HOLD SPACE]', cur: 0, need: 4 },
        { id: 'residue', label: 'PHOTOGRAPH VOID RESIDUE', cur: 0, need: 2 },
        { id: 'entity1', label: 'CAPTURE INITIAL ENTITY FOOTAGE', cur: 0, need: 1 }
      ];
      spawnPhaseProps('tape', 5, 5, 11, 3.2);
    } else if (p === 2) {
      state.tasks = [
        { id: 'relay', label: 'CALIBRATE SEISMIC RELAYS [HOLD SPACE]', cur: 0, need: 3 },
        { id: 'stalk', label: 'PHOTOGRAPH STALK / PEEK POSE', cur: 0, need: 2 }
      ];
      spawnPhaseProps('relay', 4, 6, 22, 11.0);
      pulseScreenTint('#ffaa22', 0.28, 400);
      g.glitch?.();
      g.warn('PHASE 2 // SEISMIC TRIANGULATION — HOLD [SPACE] ON RELAYS', 3400);
    } else if (p === 3) {
      state.emfAccum = 0;
      state.tasks = [
        { id: 'emf', label: 'RECORD EMF INTERFERENCE NEAR ENTITY (SEC)', cur: 0, need: 25 },
        { id: 'close', label: 'CAPTURE CLOSE-RANGE STROBE (< 9M)', cur: 0, need: 2 },
        { id: 'entity3', label: 'DOCUMENT ACTIVE HUNT FOOTAGE', cur: 0, need: 2 }
      ];
      pulseScreenTint('#ff2211', 0.34, 450);
      g.glitch?.();
      g.warn('PHASE 3 // BIOMETRIC TELEMETRY — CLOSE-PROXIMITY SURVIVAL', 3400);
    } else if (p === 4) {
      state.tasks = [
        { id: 'junction', label: 'BOOT HIGH-VOLTAGE JUNCTIONS [HOLD SPACE]', cur: 0, need: 3 },
        { id: 'entity4', label: 'PHOTOGRAPH ENTITY DURING POWER SURGE', cur: 0, need: 2 }
      ];
      spawnPhaseProps('junction', 4, 6, 33, 13.0);
      pulseScreenTint('#d99b4e', 0.28, 450);
      g.glitch?.();
      g.warn('PHASE 4 // POWER ROUTING — HOLD [SPACE] ON BREAKER PANELS', 3400);
    } else if (p === 5) {
      state.tasks = [];
      spawnUplinkTerminal();
    }
    renderObjectivesHUD();
  }

  function setupSectorCampaign(seedOverride) {
    clearAllSectorProps();
    state.seed = (seedOverride ?? g.mp?.seed ?? trueChaosSeed()) | 0;
    updateSectorLabel();
    enforceFlashlightStartOff();
    rollMutationsForSector(state.seed);
    state.usedPuddles.clear();
    state.uploadPct = 0;
    state.jam30Done = false;
    state.jam65Done = false;
    state.jam90Done = false;
    state.missionComplete = false;
    state.propLockoutTimer = 0;
    startPhase(1);
  }

  function renderObjectivesHUD() {
    const titles = [
      '',
      'PHASE 1/5 // CORPSE & TAPE RECOVERY',
      'PHASE 2/5 // SEISMIC TRIANGULATION',
      'PHASE 3/5 // BIOMETRIC TELEMETRY',
      'PHASE 4/5 // POWER ROUTING',
      'PHASE 5/5 // GREENLIGHT DATA UPLINK'
    ];
    objPhase.textContent = state.missionComplete ? 'SECTOR ARCHIVE // TRANSMITTED' : titles[state.phase];

    if (state.phase < 5) {
      let allDone = true, html = '';
      for (const t of state.tasks) {
        const c = Math.floor(Math.min(t.cur, t.need));
        const done = c >= t.need;
        if (!done) allDone = false;
        html += `<div class="obj-item ${done ? 'done' : ''}">${done ? '✓' : '·'} ${t.label} (${c}/${t.need})</div>`;
      }
      objList.innerHTML = html;
      if (allDone) startPhase(state.phase + 1);
      return;
    }

    const pctStr = state.uploadPct.toFixed(1) + '%';
    let html = '';
    if (state.missionComplete) {
      html = `<div class="obj-item done">✓ SECTOR ARCHIVE UPLOADED (100%)</div>`;
    } else if (state.uploadJammed) {
      html = `<div class="obj-item jammed">⚠ SIGNAL JAMMED (${pctStr}) — FLASH ENTITY OR SURVIVE (${Math.ceil(state.jamTimer)}S)</div>`;
    } else if (spaceHeld && getNearbyInteractable()?.kind === 'uplink') {
      html = `<div class="obj-item extract">▸ TRANSMITTING ARCHIVE: ${pctStr} (KEEP HOLDING [SPACE])</div>`;
    } else {
      html = `<div class="obj-item extract">· HOLD [SPACE] AT GREEN UPLINK TO TRANSMIT (${pctStr} SAVED)</div>`;
    }
    objList.innerHTML = html;
  }

  function advanceTask(id, amount = 1, fromNet = false) {
    let changed = false;
    for (const t of state.tasks) {
      if (t.id === id && t.cur < t.need) {
        t.cur = Math.min(t.need, t.cur + amount);
        changed = true;
      }
    }
    if (changed) {
      if (!fromNet && g.share?.on) {
        g.share.world('inv-event', { act: 'task', taskId: id, amt: amount });
      }
      renderObjectivesHUD();
    }
    return changed;
  }

  function getEntityBehaviorTag(m) {
    if (m._fury) return 'APEX FURY';
    if (m._staring) return 'HALLWAY STARE';
    if (m.peeking || m._peeking) return 'CORNER PEEK';
    if (m.mode === 'CHASE') return 'HOSTILE HUNT';
    if (m.mode === 'AMBUSH') return 'AMBUSH LURE';
    if (m.mode === 'STALK') return m.retreat ? 'EVADING' : 'STALKING';
    return 'ROAMING';
  }

  function getNearbyInteractable() {
    const c = g.camera.position;
    if (state.phase === 5 && state.beaconPos && !state.missionComplete) {
      const d = Math.hypot(state.beaconPos.x - c.x, state.beaconPos.z - c.z);
      if (d <= 3.8) return { kind: 'uplink', dist: d };
    }
    let bestProp = null, bestD = 3.5;
    for (const p of state.props) {
      if (p.done) continue;
      const d = Math.hypot(p.pos.x - c.x, p.pos.z - c.z);
      if (d <= bestD) {
        bestD = d;
        bestProp = p;
      }
    }
    if (bestProp) return { kind: 'prop', prop: bestProp, dist: bestD };
    return null;
  }

  // ==========================================================================
  // PHASE-SCALED PSYCHOLOGICAL STALKING & NON-LETHAL OBJECTIVE DISRUPTIONS
  // ==========================================================================
  function triggerDisruptionShock(prop, reasonText) {
    const m = g.monster;
    state.propLockoutTimer = 2.4; // Knocks the player off [SPACE] for 2.4 seconds!
    if (prop) {
      // Knock progress back slightly (8%) instead of killing the player
      prop.progress = Math.max(0, prop.progress - prop.needTime * 0.08);
    }
    g.glitch?.();
    pulseScreenTint('#661100', 0.28, 300);
    g.audio?.pop?.(prop ? prop.pos : g.camera.position);
    if (m?.active) {
      g.audio?.shriek?.(m.pos);
      m.startFlickerWarning?.();
    }
    g.warn(reasonText, 2800);
  }

  function triggerMonsterObjectiveSabotage(targetPos, targetCell, prop, dt = 0.016) {
    const m = g.monster;
    if (!m || !m.active || g.dead || (g.mp?.coop && !g.mp.isHost)) return;

    const rushBonus = hasMutation('hunt_terminal_rusher') ? 1.35 : 1.0;
    state.holdNoiseAccum += dt * rushBonus;
    const d = m.dist();

    // PHASE 1: THE WATCHER (Never chases or kills you on [SPACE]! Only stalks & stares from doorways!)
    if (state.phase === 1) {
      // Prevent any accidental chase while extracting early corpse tapes
      if (m.mode === 'CHASE') {
        m.change('STALK');
        m.retreat = false;
      }
      if ((state.sabotageTimer -= dt) <= 0) {
        state.sabotageTimer = 1.6;
        m.known = { x: targetPos.x, z: targetPos.z, cell: targetCell, time: m.age };

        if (d > 17) {
          // Quietly walk toward a nearby corridor so it can watch the player
          if (m.mode === 'PATROL' || m.mode === 'SEARCH') m.change('INVESTIGATE');
        } else if (d >= 7.5 && d <= 17) {
          // Stand at the end of the hall or peek around a corner watching the player extract the tape!
          m.change('STALK');
          m.retreat = false;
          m._staring = true;
          m.lingerT = 1;
          m._stareUntil = m.age + 3.5;
          m.dir.set(g.camera.position.x - m.pos.x, 0, g.camera.position.z - m.pos.z).normalize();
          if (Math.random() < 0.35) g.audio?.whisper?.(m.pos, d);
        } else if (d < 7.5) {
          // If the player walks too close to it in Phase 1, it backs away into the shadows instead of killing!
          m.change('STALK');
          m.retreat = true;
          m._stalkT = m.age + 2.5;
        }
      }
      return;
    }

    // PHASE 2: THE SABOTEUR (Approaches to stalk/peek, then disrupts the relay with an EMP/acoustic pop!)
    if (state.phase === 2) {
      if ((state.sabotageTimer -= dt) <= 0) {
        state.sabotageTimer = 1.3;
        m.known = { x: targetPos.x, z: targetPos.z, cell: targetCell, time: m.age };
        if (d > 15 && (m.mode === 'PATROL' || m.mode === 'SEARCH')) {
          m.change('STALK');
          m.retreat = false;
        }
      }
      // If you hold [SPACE] for >4.2s continuously while the monster is within 20m, it disrupts the relay!
      if (state.holdNoiseAccum > 4.2 && d < 20 && state.disruptCooldown <= 0) {
        state.holdNoiseAccum = 0;
        state.disruptCooldown = 7.5;
        triggerDisruptionShock(prop, '⚠ ENTITY DISRUPTED RELAY SIGNAL — LOOK AROUND!');
        // Monster steps out to stare or ambush-lure you instead of sprinting
        m.change(Math.random() < 0.5 ? 'AMBUSH' : 'STALK');
        m.retreat = false;
      }
      return;
    }

    // PHASE 3 & 4: BLUFF CHARGES & BREAKER TRIPPING (Disrupts progress & bluff-rushes to scare you off!)
    if (state.phase === 3 || state.phase === 4) {
      if ((state.sabotageTimer -= dt) <= 0) {
        state.sabotageTimer = 1.1;
        m.known = { x: targetPos.x, z: targetPos.z, cell: targetCell, time: m.age };
        if (d > 16 && m.mode === 'PATROL') m.change('STALK');
      }

      const tripThreshold = hasMutation('hunt_terminal_rusher') ? 3.4 : 4.6;
      if (state.holdNoiseAccum > tripThreshold && state.disruptCooldown <= 0) {
        state.holdNoiseAccum = 0;
        state.disruptCooldown = 8.0;
        triggerDisruptionShock(prop, '⚠ BREAKER TRIPPED BY ENTITY — RELEASE [SPACE] & HIDE!');

        // Launch a BLUFF CHARGE: it roars and runs toward your doorway, but if you let go of [SPACE]
        // and back up, it stops at ~5.5m, stares at you, and slips back into the shadows!
        state.bluffChargeActive = true;
        m.change('CHASE');
        m.retreat = false;
      }
      return;
    }

    // PHASE 5: FINAL GREENLIGHT UPLINK SIEGE (High tension, real hunts & EMP signal jams)
    if ((state.sabotageTimer -= dt) <= 0) {
      state.sabotageTimer = 1.0;
      m.known = { x: targetPos.x, z: targetPos.z, cell: targetCell, time: m.age };
      if (d > 15 && m.mode !== 'CHASE') {
        m.change('STALK');
        m.retreat = false;
      } else if (d <= 15 && state.holdNoiseAccum > 4.0 && m.mode !== 'CHASE') {
        state.holdNoiseAccum = 0;
        m.change('CHASE');
        g.warn('⚠ UPLINK TRANSMISSION DREW THE ENTITY — EVADE OR FLASH!', 2600);
      }
    }
  }

  // Eerie Slow-Burn Atmospheric Director (Sightings, Whispers, Sub-Bass Drops, Bluff-Charge Abort)
  function updateEerieAtmosphere(dt) {
    if (g.dead) return;
    const m = g.monster;
    const c = g.camera.position;
    const d = m && m.active ? m.dist() : 99;

    // 1. Handle Bluff-Charge Abort: if the monster is bluff-charging from a terminal disruption
    // and gets within 5.8m while the player is NOT holding [SPACE], it aborts the kill and stalks/stares!
    if (state.bluffChargeActive && m && m.active) {
      if (m.mode !== 'CHASE') {
        state.bluffChargeActive = false;
      } else if (!spaceHeld && d < 5.8) {
        state.bluffChargeActive = false;
        m.change('STALK');
        m.retreat = true;
        m._stalkT = m.age + 3.0;
        m.startFlickerWarning?.();
        g.audio?.hiss?.(m.pos);
        g.say('IT STOPPED AT THE DOORWAY...', 2000);
      }
    }

    // 2. Keep Phase 1 strictly non-lethal unless the player literally walks inside the monster (< 1.2m)
    if (state.phase === 1 && m && m.active && m.mode === 'CHASE' && d > 2.2) {
      m.change('STALK');
      m.retreat = d < 7.0;
    }

    // 3. Unscripted Eerie Events (Every 9–16 seconds)
    if ((state.eerieTimer -= dt) > 0) return;
    state.eerieTimer = 9 + Math.random() * 8;

    const roll = Math.random();
    if (roll < 0.30) {
      g.camera.getWorldDirection(camDir);
      eeriePos.set(c.x - camDir.x * 1.8, 1.5, c.z - camDir.z * 1.8);
      g.audio?.whisper?.(eeriePos, 1.6);
      if (statusEl) {
        const eerieTexts = [
          'AUDIO: BREATHING BEHIND YOU',
          'SIGNAL: IT IS WATCHING FROM THE HALL',
          'AUDIO: FAINT FOOTSTEPS MATCHING YOURS',
          'TAPE ERROR: SHADOW FIGURE IN PERIPHERY',
          'AUDIO: DO NOT STARE TOO LONG'
        ];
        statusEl.textContent = eerieTexts[(Math.random() * eerieTexts.length) | 0];
        g._lastSt = '';
      }
    } else if (roll < 0.60) {
      g.audio?.tone?.(38, 2.2, 0.14, 'sine', c);
      m?.startFlickerWarning?.();
    } else if (roll < 0.85) {
      const corpse = state.props.find(p => p.type === 'tape' && !p.done);
      if (corpse) {
        g.audio?.monsterStep?.(corpse.pos, Math.hypot(corpse.pos.x - c.x, corpse.pos.z - c.z));
      }
    } else {
      pulseScreenTint('#440000', 0.18, 90);
      g.audio?.hiss?.(m?.pos || c);
    }
  }

  function inspectViewfinder() {
    const cam = g.camera, c = cam.position, m = g.monster, w = g.world;
    if (!w || g.dead) return { type: null };

    const inter = getNearbyInteractable();
    if (inter) return { type: 'interact', inter };

    cam.getWorldDirection(camDir);

    if (m && m.active && m.group.visible) {
      toTarget.set(m.pos.x - c.x, (m.pos.y + 1.65) - c.y, m.pos.z - c.z);
      const d = toTarget.length();
      if (d <= 26 && d > 0.2) {
        const dot = toTarget.divideScalar(d).dot(camDir);
        if (dot > 0.78 && w.los(c.x, c.z, m.pos.x, m.pos.z)) {
          return { type: 'monster', dist: d, tag: getEntityBehaviorTag(m) };
        }
      }
    }

    if (m?.trail?.length) {
      for (let i = m.trail.length - 1; i >= Math.max(0, m.trail.length - 45); i--) {
        const p = m.trail[i];
        if (state.usedPuddles.has(p.seq)) continue;
        toTarget.set(p.x - c.x, 0.05 - c.y, p.z - c.z);
        const d = toTarget.length();
        if (d <= 8.0 && d > 0.4) {
          const dot = toTarget.divideScalar(d).dot(camDir);
          if (dot > 0.84 && w.los(c.x, c.z, p.x, p.z)) {
            return { type: 'residue', dist: d, puddle: p };
          }
        }
      }
    }
    return { type: null };
  }

  function applyMonsterMutationsTick(dt) {
    const m = g.monster, p = g.player;
    if (!m || !m.active || g.dead || (g.mp?.coop && !g.mp.isHost)) return;

    const d = m.dist();
    const c = g.camera.position;

    if (hasMutation('beam_moth') && g.flash?.on && !g.dark && d < 26) {
      state.traitTimers.beamOn += dt;
      if (state.traitTimers.beamOn > 5.0) {
        state.traitTimers.beamOn = 1.5;
        m.known = { x: c.x, z: c.z, cell: m.cellId(c.x, c.z), time: m.age };
        if (m.mode === 'PATROL' || m.mode === 'SEARCH') m.change('STALK');
      }
    } else {
      state.traitTimers.beamOn = Math.max(0, state.traitTimers.beamOn - dt);
    }

    if (hasMutation('beam_averse') && g.flash?.on && !g.dark && d < 14 && m.seenT > 0.1) {
      m.stepBy?.(-m.dir.x * dt * 1.1, -m.dir.z * dt * 1.1);
    }

    if (hasMutation('beam_dark_sprinter') && (!g.flash?.on || g.dark) && d < 28 && d > 9 && m.freeze <= 0) {
      if (m.mode === 'PATROL') m.change('STALK');
    }

    if (hasMutation('beam_parasite') && g.flash?.on && !g.dark && d < 15 && m.seenT > 0.1) {
      g.flash.battery = Math.max(0, g.flash.battery - dt * 0.018);
    }

    if (hasMutation('beam_gaze_breaker') && g.flash?.on && !g.dark && d < 18 && m.seenT > 0.2) {
      state.traitTimers.gaze += dt;
      if (state.traitTimers.gaze > 3.0 && m.mode !== 'CHASE' && state.phase >= 2) {
        state.traitTimers.gaze = 0;
        state.bluffChargeActive = state.phase < 4;
        m.change('CHASE');
      }
    } else {
      state.traitTimers.gaze = Math.max(0, state.traitTimers.gaze - dt);
    }

    if (hasMutation('sound_crank_hunter') && p.winding && !g.dark && d < 26) {
      state.traitTimers.crank += dt;
      if (state.traitTimers.crank > 1.5) {
        state.traitTimers.crank = 0;
        m.known = { x: c.x, z: c.z, cell: m.cellId(c.x, c.z), time: m.age };
        if (m.mode === 'PATROL' || m.mode === 'SEARCH') m.change('STALK');
      }
    } else {
      state.traitTimers.crank = Math.max(0, state.traitTimers.crank - dt * 0.5);
    }

    if (hasMutation('sound_still_ambush') && !p.moving && !p.winding && d < 24) {
      state.traitTimers.still += dt;
      if (state.traitTimers.still > 4.0) {
        state.traitTimers.still = 1.0;
        m.known = { x: c.x, z: c.z, cell: m.cellId(c.x, c.z), time: m.age };
        if (m.mode === 'PATROL' || m.mode === 'SEARCH') {
          m.change('STALK');
          m.retreat = false;
        }
      }
    } else {
      state.traitTimers.still = 0;
    }

    if (hasMutation('sound_sprint_chaser') && p.running && p.moving && d < 25) {
      state.traitTimers.sprint += dt;
      if (state.traitTimers.sprint > 3.0) {
        state.traitTimers.sprint = 0;
        m.known = { x: c.x, z: c.z, cell: m.cellId(c.x, c.z), time: m.age };
        if (m.mode === 'PATROL' || m.mode === 'SEARCH') m.change('STALK');
      }
    } else {
      state.traitTimers.sprint = Math.max(0, state.traitTimers.sprint - dt);
    }

    if (hasMutation('sound_low_batt_shark') && (g.flash?.battery || 1) < 0.35 && d < 30) {
      if (m.mode === 'PATROL') {
        m.known = { x: c.x, z: c.z, cell: m.cellId(c.x, c.z), time: m.age };
        m.change('STALK');
      }
    }

    if (hasMutation('sound_proximity_hum') && d < 14 && !p.running && m.mode === 'PATROL') {
      m.known = { x: c.x, z: c.z, cell: m.cellId(c.x, c.z), time: m.age };
      m.change('STALK');
    }

    const yawDelta = Math.abs(g.camera.rotation.y - state.lastCamYaw);
    state.lastCamYaw = g.camera.rotation.y;
    if (hasMutation('sound_panic_feeder') && yawDelta > 0.08 && d < 20) {
      state.traitTimers.spin += dt * 3;
      if (state.traitTimers.spin > 1.6 && m.mode === 'PATROL') {
        state.traitTimers.spin = 0;
        m.change('AMBUSH');
      }
    } else {
      state.traitTimers.spin = Math.max(0, state.traitTimers.spin - dt);
    }

    // Only apply extra speed in late phases (Phase 4 & 5)
    if (hasMutation('hunt_relentless') && m.mode === 'CHASE' && m.freeze <= 0 && state.phase >= 4) {
      m.move?.(dt, 0.55);
    }

    if (hasMutation('hunt_emp_aura') && d < 14 && Math.random() < dt * 2.5) {
      m.startFlickerWarning?.();
    }

    if (hasMutation('hunt_fake_retreat') && m.retreat) {
      state.feintTimer += dt;
      if (state.feintTimer > 2.4) {
        state.feintTimer = 0;
        m.retreat = false;
        m.change('AMBUSH');
      }
    } else {
      state.feintTimer = 0;
    }
  }

  const origBlast = g.cameraBlast.bind(g);
  g.cameraBlast = function() {
    const ready = !this.dead && !this.dark && (this.player.controls.isLocked || this.player.isMobileDevice);
    if (!ready) return;

    const vf = inspectViewfinder();
    if (vf.type === 'interact' && !spaceHeld) {
      this.say('HOLD [SPACE] TO WORK ON OBJECTIVE (PROGRESS SAVES WHEN RELEASED)', 2000);
      return;
    }

    if (this.camCD > 0) return;
    origBlast();

    if (vf.type === 'monster') {
      const m = this.monster;
      const distStr = vf.dist.toFixed(1) + 'M';
      let grade = `CLASS-B FOOTAGE: ${vf.tag} [${distStr}]`;

      advanceTask('entity1', 1);
      advanceTask('stalk', 1);
      advanceTask('entity3', 1);
      advanceTask('entity4', 1);

      if (hasMutation('strobe_emp') && vf.dist < 11.5 && this.flash) {
        this.flash.battery = Math.max(0, this.flash.battery - 0.25);
        this.warn('⚠ CAPACITOR-LEECH: STROBE DRAINED 25% BATTERY!', 2400);
      }
      if (hasMutation('strobe_range_aggro') && vf.dist >= 11.0) {
        m.known = { x: this.camera.position.x, z: this.camera.position.z, cell: m.cellId(this.camera.position.x, this.camera.position.z), time: m.age };
        if (m.mode !== 'CHASE') m.change('STALK');
        this.warn('⚠ SNIPER-STALKER: LONG-RANGE FLASH DREW ITS ATTENTION!', 2500);
      }

      if (vf.dist < 9.5) {
        advanceTask('close', 1);
        grade = `CLASS-S FOOTAGE: CLOSE-RANGE SHOT [${distStr}]`;

        if (hasMutation('strobe_berserk') && state.phase >= 2) {
          m.freeze = 0;
          m._flashResponse = null;
          m.retreat = false;
          state.bluffChargeActive = state.phase < 4;
          m.change('CHASE');
          this.warn('⚠ FLASH-AGITATED: ENTITY PROVOKED BY CLOSE STROBE!', 2600);
        } else if (hasMutation('strobe_repel')) {
          m.freeze = 1.6;
          state.bluffChargeActive = false;
          m.change('STALK');
          m.retreat = true;
        } else if (hasMutation('strobe_paralyze')) {
          m.freeze = 3.5;
          state.bluffChargeActive = false;
          this.say('CRYO-LOCKED: ENTITY FROZEN FOR 3.5S — REPOSITION!', 2400);
        } else if (hasMutation('strobe_blink')) {
          const cx = Math.round(m.pos.x / 4), cz = Math.round(m.pos.z / 4);
          for (const [dx, dz] of DIRS) {
            if (isFloor(this.world, cx + dx, cz + dz)) {
              m.pos.x = (cx + dx) * 4;
              m.pos.z = (cz + dz) * 4;
              break;
            }
          }
          m.change('AMBUSH');
          this.warn('⚠ PHASE-BLINKER: ENTITY STEPPED INTO FLANKING CORRIDOR!', 2500);
        }
      }

      if (state.uploadJammed) {
        broadcastInvEvent({ act: 'uplink-state', jammed: false, pct: state.uploadPct });
        grade = 'EMP INTERFERENCE CLEARED — HOLD [SPACE] TO RESUME UPLOAD!';
      }

      this.say(grade, 2400);
      this.audio?.tone?.(1320, 0.12, 0.06, 'sine');
    } else if (vf.type === 'residue' && vf.puddle) {
      state.usedPuddles.add(vf.puddle.seq);
      const scored = advanceTask('residue', 1);
      this.say(scored ? 'EVIDENCE LOGGED: VOID RESIDUE SAMPLE' : 'RESIDUE SAMPLE ARCHIVED', 2000);
      this.audio?.tone?.(980, 0.1, 0.05, 'sine');
    }
  };

  function updateObjectiveCompass() {
    const cam = g.camera.position, w = g.world, n = w.n, CELL = 4;
    let targetPos = null, distMap = null, labelPrefix = 'SIGNAL';

    const phasePropType = { 1: 'tape', 2: 'relay', 4: 'junction' }[state.phase];

    if (state.phase === 5 && state.beaconPos && !state.missionComplete) {
      targetPos = state.beaconPos;
      distMap = state.beaconDistMap;
      labelPrefix = 'GREEN UPLINK';
    } else if (phasePropType) {
      let bestD = Infinity;
      for (const p of state.props) {
        if (p.done || p.type !== phasePropType) continue;
        const d = Math.hypot(p.pos.x - cam.x, p.pos.z - cam.z);
        if (d < bestD) {
          bestD = d;
          targetPos = p.pos;
          distMap = p.distMap;
          const pct = Math.round((p.progress / p.needTime) * 100);
          const pctTag = pct > 0 ? ` (${pct}%)` : '';
          labelPrefix = (p.type === 'tape' ? 'CORPSE TAPE' : p.type === 'relay' ? 'SEISMIC RELAY' : 'POWER JUNCTION') + pctTag;
        }
      }
    }

    if (!targetPos) {
      compassEl.style.display = 'none';
      return;
    }

    const directDist = Math.hypot(targetPos.x - cam.x, targetPos.z - cam.z);
    let aimX = targetPos.x, aimZ = targetPos.z, pathMeters = directDist;

    if (distMap && !w.los(cam.x, cam.z, targetPos.x, targetPos.z)) {
      let cx = Math.round(cam.x / CELL), cz = Math.round(cam.z / CELL);
      let curId = cx * n + cz;
      const stepsLeft = distMap[curId];
      if (stepsLeft > 0) {
        pathMeters = stepsLeft * CELL;
        for (let step = 0; step < 2; step++) {
          const curD = distMap[curId];
          if (curD <= 0) break;
          const x = (curId / n) | 0, z = curId % n;
          for (let i = 0; i < 4; i++) {
            const nx = x + DIRS[i][0], nz = z + DIRS[i][1];
            if (!isFloor(w, nx, nz)) continue;
            const nid = nx * n + nz;
            if (distMap[nid] >= 0 && distMap[nid] < curD) {
              curId = nid;
              break;
            }
          }
        }
        aimX = ((curId / n) | 0) * CELL;
        aimZ = (curId % n) * CELL;
      }
    }

    g.camera.getWorldDirection(camDir);
    const fLen = Math.hypot(camDir.x, camDir.z) || 1;
    const fx = camDir.x / fLen, fz = camDir.z / fLen;
    const rx = -fz, rz = fx;

    const tdx = aimX - cam.x, tdz = aimZ - cam.z;
    const tLen = Math.hypot(tdx, tdz) || 1;
    const tx = tdx / tLen, tz = tdz / tLen;

    const fwdDot = tx * fx + tz * fz;
    const rightDot = tx * rx + tz * rz;
    const deg = Math.atan2(rightDot, fwdDot) * (180 / Math.PI);

    let dirText;
    if (Math.abs(deg) <= 28) dirText = '▲ AHEAD';
    else if (deg > 28 && deg <= 70) dirText = '↗ SLIGHT RIGHT';
    else if (deg > 70 && deg <= 125) dirText = '▶ TURN RIGHT';
    else if (deg < -28 && deg >= -70) dirText = '↖ SLIGHT LEFT';
    else if (deg < -70 && deg >= -125) dirText = '◀ TURN LEFT';
    else dirText = '▼ BEHIND';

    compassEl.style.display = 'block';
    compassEl.textContent = `${labelPrefix}: ${Math.round(pathMeters)}M [${dirText}]`;
  }

  const origNewLevel = g.newLevel.bind(g);
  g.newLevel = function(seed) {
    origNewLevel(seed);
    state.menuYawBase = null;
    setupSectorCampaign(seed);
  };

  const origUpdate = g.update.bind(g);
  g.update = function(dt) {
    origUpdate(dt);
    state.t += dt;
    state.disruptCooldown = Math.max(0, state.disruptCooldown - dt);
    state.propLockoutTimer = Math.max(0, state.propLockoutTimer - dt);

    if (lobbyEl && !lobbyEl.classList.contains('hidden')) {
      if (state.menuYawBase === null) state.menuYawBase = this.camera.rotation.y;
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = state.menuYawBase + Math.sin(state.t * 0.35) * 0.45;
      this.camera.rotation.x = Math.sin(state.t * 0.5) * 0.04;
      return;
    }

    applyMonsterMutationsTick(dt);
    updateEerieAtmosphere(dt);

    const nearInter = getNearbyInteractable();
    let activelyHoldingSomething = false;

    for (const p of state.props) {
      const u = p.mesh.userData;
      const isTarget = !p.done && state.propLockoutTimer <= 0 && nearInter?.kind === 'prop' && nearInter.prop === p && spaceHeld && !this.dead;
      p.beingHeld = isTarget;

      if (!p.done) {
        if (p.type === 'tape' && p.ledLight) {
          p.ledLight.intensity = isTarget ? 4.2 : ((Math.sin(state.t * 7 + p.idx) > 0.1) ? 3.0 : 0.25);
        } else if (p.type === 'relay' && u.spinner) {
          u.spinner.rotation.y += dt * (isTarget ? 8.0 : 1.2);
        } else if (p.type === 'junction') {
          if (u.leverPivot) {
            const ratio = p.progress / p.needTime;
            u.leverPivot.rotation.x = -0.75 + ratio * 1.6;
          }
          if (u.light) {
            u.light.intensity = isTarget
              ? (1.8 + Math.sin(state.t * 35) * 1.1)
              : (1.9 + Math.sin(state.t * 3 + p.idx) * 0.3);
          }
        }
      }

      if (isTarget) {
        activelyHoldingSomething = true;
        p.progress = Math.min(p.needTime, p.progress + dt);
        const pct = Math.round((p.progress / p.needTime) * 100);

        if ((state.pingTimer -= dt) <= 0) {
          state.pingTimer = p.type === 'tape' ? 0.55 : 0.85;
          const freq = p.type === 'tape' ? 620 + pct * 4 : (p.type === 'relay' ? 820 + pct * 3 : 140 + pct * 1.8);
          this.audio?.tone?.(freq, 0.09, 0.05, p.type === 'tape' ? 'triangle' : 'sawtooth', p.pos);
        }

        triggerMonsterObjectiveSabotage(p.pos, p.cell, p, dt);

        if (p.type !== 'tape' && pct >= 50 && p.sabotageMilestone < 1) {
          p.sabotageMilestone = 1;
          this.glitch?.();
          this.audio?.pop?.(p.pos);
          this.warn('⚠ ACOUSTIC SPIKE — SOMETHING IS WATCHING YOUR CORRIDOR!', 2600);
          if (this.monster?.active) {
            this.monster.known = { x: p.pos.x, z: p.pos.z, cell: p.cell, time: this.monster.age };
            if (this.monster.mode === 'PATROL' || this.monster.mode === 'SEARCH') {
              this.monster.change('STALK');
              this.monster.retreat = false;
            }
          }
        }

        if (p.progress >= p.needTime) {
          if (p.type === 'tape') {
            broadcastInvEvent({ act: 'tape', idx: p.idx });
          } else {
            broadcastInvEvent({ act: 'prop-done', pType: p.type, idx: p.idx });
          }
        }
      }
    }

    if (state.phase === 3 && !this.dead && this.monster?.active && this.monster.dist() < 23) {
      const prevSec = Math.floor(state.emfAccum);
      state.emfAccum += dt;
      if (Math.floor(state.emfAccum) > prevSec) {
        advanceTask('emf', 1);
      }
    }

    if (state.phase === 5 && state.beaconPos && state.beaconGroup && !state.missionComplete) {
      const u = state.beaconGroup.userData;
      const holdingUplink = !state.uploadJammed && state.propLockoutTimer <= 0 && nearInter?.kind === 'uplink' && spaceHeld && !this.dead;

      const speedMult = holdingUplink ? 6.5 : 1.2;
      u.cage.rotation.y += dt * speedMult;
      u.cage.rotation.x += dt * (speedMult * 0.5);
      u.core.scale.setScalar(1 + 0.22 * Math.sin(state.t * (holdingUplink ? 14 : 4)));

      if (state.uploadJammed) {
        u.ptLight.color.setHex(0xff3322);
        state.jamTimer -= dt;
        if (state.jamTimer <= 0) {
          state.uploadJammed = false;
          u.ptLight.color.setHex(0x7aff66);
          this.say('SIGNAL LOCK CLEARED — HOLD [SPACE] AT UPLINK TO RESUME', 2400);
        }
        renderObjectivesHUD();
      } else if (holdingUplink) {
        activelyHoldingSomething = true;
        u.ptLight.color.setHex(0x7aff66);
        state.uploadPct = Math.min(100, state.uploadPct + dt * 3.0);

        triggerMonsterObjectiveSabotage(state.beaconPos, state.beaconCell, null, dt);

        if ((state.pingTimer -= dt) <= 0) {
          state.pingTimer = 0.6;
          this.audio?.tone?.(1100 + state.uploadPct * 6, 0.07, 0.05, 'square', state.beaconPos);
        }

        if (
          (state.uploadPct >= 30 && !state.jam30Done) ||
          (state.uploadPct >= 65 && !state.jam65Done) ||
          (state.uploadPct >= 90 && !state.jam90Done)
        ) {
          if (state.uploadPct >= 90) state.jam90Done = true;
          else if (state.uploadPct >= 65) state.jam65Done = true;
          else state.jam30Done = true;

          broadcastInvEvent({ act: 'uplink-state', jammed: true, pct: state.uploadPct, jamTimer: 12 });
          this.glitch?.();
          this.warn('⚠ ENTITY JAMMED UPLINK — FLASH ENTITY OR SURVIVE 12S!', 3400);
          this.audio?.pop?.(state.beaconPos);
          if (this.monster?.active) {
            this.monster.known = { x: state.beaconPos.x, z: state.beaconPos.z, cell: state.beaconCell, time: this.monster.age };
            this.monster.change('STALK');
            this.monster.retreat = false;
          }
        }

        if (state.uploadPct >= 100) {
          state.missionComplete = true;
          this.audio?.tone?.(1046, 0.6, 0.12, 'triangle');
          renderObjectivesHUD();
          if (this.mp?.coop) {
            this.warn('SECTOR ARCHIVE TRANSMITTED — CO-OP MANDATE COMPLETE', 6000);
            this.say('100% DATA UPLOADED — SURVIVE IN SECTOR', 4500);
          } else {
            this.warn('SECTOR DATA TRANSMITTED — ADVANCING TO NEXT SECTOR', 3200);
            setTimeout(() => { if (!this.dead) this.newLevel(); }, 2600);
          }
        } else {
          renderObjectivesHUD();
        }
      } else {
        u.ptLight.color.setHex(0x7aff66);
        renderObjectivesHUD();
      }
    }

    if (!activelyHoldingSomething) {
      state.holdNoiseAccum = Math.max(0, state.holdNoiseAccum - dt * 1.6);
    }

    const vf = inspectViewfinder();
    vfFrame.classList.remove('locked', 'interact');
    if (vf.type === 'interact') {
      vfFrame.classList.add('interact');
      const it = vf.inter;
      if (state.propLockoutTimer > 0) {
        vfLabel.textContent = `⚠ SURGE LOCKOUT (${state.propLockoutTimer.toFixed(1)}S) — STEP BACK & CHECK CORRIDORS!`;
      } else if (it.kind === 'uplink') {
        vfLabel.textContent = state.uploadJammed
          ? `⚠ UPLINK JAMMED (${Math.ceil(state.jamTimer)}S) — FLASH ENTITY TO CLEAR`
          : spaceHeld
            ? `▸ TRANSMITTING ARCHIVE: ${state.uploadPct.toFixed(1)}% [RELEASE SPACE TO PAUSE]`
            : `GREEN UPLINK [${state.uploadPct.toFixed(1)}% SAVED] — HOLD [SPACE] TO TRANSMIT`;
      } else {
        const p = it.prop;
        const pct = Math.min(100, Math.round((p.progress / p.needTime) * 100));
        if (p.type === 'tape') {
          const cause = p.tapeData ? p.tapeData.cause : 'MUTILATED REMAINS';
          vfLabel.textContent = spaceHeld
            ? `▸ EXTRACTING BLOODIED TAPE: ${pct}% [${cause}]`
            : `REMAINS [${cause}] — HOLD [SPACE] TO EXTRACT TAPE (${pct}%)`;
        } else {
          const name = p.type === 'relay' ? 'SEISMIC RELAY' : 'BREAKER JUNCTION';
          vfLabel.textContent = spaceHeld
            ? `▸ ${p.type === 'relay' ? 'CALIBRATING' : 'ENGAGING'} ${name}: ${pct}% [RELEASE SPACE TO HIDE]`
            : `${name} [${pct}% SAVED] — HOLD [SPACE] TO ${p.type === 'relay' ? 'CALIBRATE' : 'PULL SWITCH'}`;
        }
      }
    } else if (vf.type === 'monster') {
      vfFrame.classList.add('locked');
      vfLabel.textContent = `ID: ENTITY STRAIN #${state.profileCode} [${vf.tag} · ${vf.dist.toFixed(1)}M]`;
    } else if (vf.type === 'residue') {
      vfFrame.classList.add('locked');
      vfLabel.textContent = `ID: VOID RESIDUE [${vf.dist.toFixed(1)}M] — [C / CLICK]`;
    }

    updateObjectiveCompass();
  };

  setupSectorCampaign();
}

function bootWhenReady() {
  if (window.game && window.game.world) {
    initInvestigationSystem(window.game);
  } else {
    requestAnimationFrame(bootWhenReady);
  }
}
bootWhenReady();

// Virtual Joystick to Keyboard Event Bridge for Mobile
window.addEventListener('DOMContentLoaded', () => {
  if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) return;
  const zone = document.getElementById('joystick-zone');
  if (!zone || typeof nipplejs === 'undefined') return;

  const manager = nipplejs.create({
    zone,
    mode: 'static',
    position: { left: '50%', top: '50%' },
    color: 'white',
    size: 110
  });

  let activeKeys = [];
  manager.on('move', (e, data) => {
    const deg = data.angle.degree;
    const newKeys = [];
    if (deg >= 22.5 && deg <= 157.5) newKeys.push('KeyW');
    if (deg >= 202.5 && deg <= 337.5) newKeys.push('KeyS');
    if (deg > 112.5 && deg < 247.5) newKeys.push('KeyA');
    if (deg < 67.5 || deg > 292.5) newKeys.push('KeyD');

    activeKeys.forEach(k => {
      if (!newKeys.includes(k)) window.dispatchEvent(new KeyboardEvent('keyup', { code: k }));
    });
    newKeys.forEach(k => {
      if (!activeKeys.includes(k)) window.dispatchEvent(new KeyboardEvent('keydown', { code: k }));
    });
    activeKeys = newKeys;
  });

  manager.on('end', () => {
    activeKeys.forEach(k => window.dispatchEvent(new KeyboardEvent('keyup', { code: k })));
    activeKeys = [];
  });
});
