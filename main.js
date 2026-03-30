import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Postprocessing (Bloom)
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

/* =========================
   CONFIG
========================= */
const CFG = {
  lanes: [-2.5, 0, 2.5],
  laneLerp: 0.18,

  startSpeed: 12.5,
  maxSpeed: 28,
  speedRamp: 0.06,

  jumpVelocity: 15.8,
  gravity: 28.5,

  // Slide
  slideDuration: 0.55,
  slideCooldown: 0.12,

  // Spawning (Balanced Density)
  spawnIntervalBase: 65,
  spawnIntervalVariance: 45,
  spawnZ: -110,

  // Fairness
  maxObstaclesPerWave: 2,
  obstacleY: 0.68,
  coinY: 1.12,

  // Pickup / collisions
  coinPickupRadius: 2.2,
  obstacleHitPadding: 0.08,

  // Near miss (juicy)
  nearMissDist: 1.1,
  nearMissScore: 35,
  nearMissCooldown: 0.45,

  // Magnet
  magnetChance: 0.14,
  magnetDuration: 7,
  magnetRadius: 5.8,
  magnetPullSpeed: 24,

  // World
  despawnZ: 20,

  // Look
  exposure: 1.55,
  cameraZ: 9.7,
  cameraY: 5.0,
  camLag: 0.10,
  camLookZ: -6.2,
  camLookY: 1.1,
  camBob: 0.08,

  // Cinematic camera
  baseFov: 72,
  fovAtMaxSpeed: 92,

  // Fog (default; themes will override dynamically)
  fogNear: 18,
  fogFar: 600,
  fogColor: 0x060b14,

  // Bloom
  bloomStrength: 0.95,
  bloomRadius: 0.35,
  bloomThreshold: 0.08,

  // Tunnel / Environment
  tunnelModelPath: "models/tunnel.glb",
  desertCityModelPath: "models/desertcity.glb",
  segmentLen: 18,
  segments: 14,
  zoneMin: 20,
  zoneMax: 35,

  // Environment Alignment Offsets
  envConfigs: {
    tunnel: { x: 0, y: 0, z: 0, scaleMult: 1.0, themeIdx: 0 },
    desertcity: { x: 13, y: -6.2, z: -0.5, scaleMult: 1.8, themeIdx: 3 },
  },

  // Props / Obstacles models (optional)
  barrierModelPath:
    "models/concrete_road_barrier_4k.gltf/concrete_road_barrier_4k.gltf",
  wetFloorModelPath: "models/wet_floor/WetFloorSign_01_4k.gltf",
  barrelModelPath: "models/Barrel_01_4k.gltf/Barrel_01_4k.gltf",
  wetFloorScale: 4.5,
  barrierScale: 3.2,
  barrelScale: 4.0,
  coinScale: 1.1,
  coinModelPath: "models/coin.glb",

  propsDespawnZ: 24,

  // Side props (procedural)
  sidePropsSpawnEveryDist: 28,
  sidePropsSpawnJitter: 12,
  sidePropsZ: -120,
  sidePropsYMin: 0.4,
  sidePropsYMax: 3.8,
  sidePropsX: 6.2, // approx wall distance
  sidePropsMaxAlive: 70,
};

/* =========================
   GLOBALS
========================= */
let scene, camera, renderer, clock, composer, bloomPass;
let playerRoot,
  playerVisual,
  mixer,
  actions = {},
  currentAction;

let speed = CFG.startSpeed;
let targetLane = 1;
let velY = 0;
let grounded = true;

let obstacles = [];
let coins = [];
let magnets = [];
let tunnelSegs = [];
let envTemplates = []; // Array of wrapper Groups
let tunnelReady = false;

// Zone & Theme transition state
let currentZoneType = 0;
let zoneSegmentsLeft = 0;
let lastThemeIndex = 0;
let targetThemeIndex = 0;
let themeLerpFactor = 1.0; // 1.0 means fully at targetThemeIndex

let envProps = [];
let particles = [];

let score = 0;
let best = Number(localStorage.getItem("best") || 0);
let coinCount = 0;

let magnetEndTime = 0;
let distMoved = 0;
let lastSpawnDist = -20;
let nextSpawnInterval = 70;

let gameOver = false;
let gameStarted = false;
let countingDown = false;
let countdownVal = 3;
let t = 0;

let shakeTime = 0;
let shakeIntensity = 0;

let speedLinesMesh = null;
let speedLinesMat = null;
let touchStartX = 0;
let touchStartY = 0;

let slideEndsAt = 0;
let slideCooldownUntil = 0;
let wasSliding = false;

let lastNearMissAt = -999;

let lastSidePropSpawnDist = 0;
let nextSidePropInterval = CFG.sidePropsSpawnEveryDist;

// Models (optional)
let barrierModel = null;
let wetFloorModel = null;
let barrelModel = null;
let coinModel = null;
let modelsReady = {
  barrier: false,
  wetFloor: false,
  barrel: false,
  coin: false,
};

// One loader instance
const gltfLoader = new GLTFLoader();

// UI
const ui = {
  score: document.getElementById("score"),
  coins: document.getElementById("coins"),
  best: document.getElementById("best"),
  go: document.getElementById("gameOver"),
  start: document.getElementById("startScreen"),
  startBtn: document.getElementById("startBtn"),
  countdown: document.getElementById("countdown"),
  hud: document.getElementById("hud"),
  finalScore: document.getElementById("finalScore"),
  finalBest: document.getElementById("finalBest"),
  restart: document.getElementById("restartBtn"),
  leftBtn: document.getElementById("leftBtn"),
  rightBtn: document.getElementById("rightBtn"),
  jumpBtn: document.getElementById("jumpBtn"),
  slideBtn: document.getElementById("slideBtn"),
  mobile: document.getElementById("mobileControls"),
  fxFlash: document.getElementById("fxFlash"),
  muteBtn: document.getElementById("muteBtn"),
};

/* Collision helpers */
const _playerBox = new THREE.Box3();
const _tmpBox = new THREE.Box3();
const _tmpV3 = new THREE.Vector3();

/* =========================
   CACHE (performance)
========================= */
const cache = {
  obstacleGeo: new THREE.BoxGeometry(1.4, 1.4, 1.4),
  trainGeo: new THREE.BoxGeometry(1.6, 2.5, 12),
  barrierGeo: new THREE.BoxGeometry(2.4, 0.8, 0.4),

  obstacleMat: new THREE.MeshStandardMaterial({
    color: 0xef4444,
    roughness: 0.45,
    metalness: 0.18,
    emissive: new THREE.Color(0x2a0505),
    emissiveIntensity: 0.32,
  }),
  trainMat: new THREE.MeshStandardMaterial({
    color: 0x3b82f6,
    roughness: 0.28,
    metalness: 0.55,
    emissive: new THREE.Color(0x06102a),
    emissiveIntensity: 0.35,
  }),
  barrierMat: new THREE.MeshStandardMaterial({
    color: 0xa1a1aa,
    roughness: 0.75,
    metalness: 0.05,
  }),

  coinGeo: new THREE.TorusGeometry(0.35, 0.1, 12, 24),
  coinMat: new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    metalness: 0.95,
    roughness: 0.06,
    emissive: new THREE.Color(0x5a2b00),
    emissiveIntensity: 0.85,
  }),

  magnetGeo: new THREE.TorusGeometry(0.45, 0.16, 12, 20),
  magnetMat: new THREE.MeshStandardMaterial({
    color: 0xff5959,
    metalness: 0.5,
    roughness: 0.35,
    emissive: new THREE.Color(0x3a0707),
    emissiveIntensity: 0.55,
  }),

  // Side props
  propBoxGeo: new THREE.BoxGeometry(0.6, 1.6, 0.6),
  propPillarGeo: new THREE.CylinderGeometry(0.25, 0.35, 2.8, 10),
  propLightGeo: new THREE.BoxGeometry(0.5, 0.18, 1.4),
  propMat: new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.8,
    metalness: 0.05,
  }),
  propNeonMat: new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    roughness: 0.25,
    metalness: 0.35,
    emissive: new THREE.Color(0x22d3ee),
    emissiveIntensity: 1.8,
  }),

  particleGeo: new THREE.SphereGeometry(0.08, 4, 4),
  particleMat: new THREE.MeshBasicMaterial({
    color: 0xffd35a,
    transparent: true,
    opacity: 1,
  }),
  explosionGeo: new THREE.SphereGeometry(0.25, 4, 4),
};

/* =========================
   POOLS
========================= */
function makePool(createFn, initial) {
  const free = [];
  const used = new Set();
  for (let i = 0; i < initial; i++) free.push(createFn());

  return {
    acquire() {
      const o = free.length ? free.pop() : createFn();
      o.visible = true;
      used.add(o);
      return o;
    },
    release(o) {
      if (!o) return;
      o.visible = false;
      o.userData = {};
      used.delete(o);
      free.push(o);
    },
    releaseAll() {
      for (const o of used) {
        o.visible = false;
        o.userData = {};
        free.push(o);
      }
      used.clear();
    },
  };
}

const pools = {
  coin: null,
  obstacle: null,
  train: null,
  barrier: null,
  magnet: null,
  prop: null,
  particle: null,
  explosion: null,
};

/* =========================
   AUDIO (no files)
========================= */
let audioCtx = null;
let muted = false;

function ensureAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    audioCtx = null;
  }
}

function setMuted(v) {
  muted = !!v;
  if (ui.muteBtn) ui.muteBtn.textContent = muted ? "UNMUTE" : "MUTE";
}

function playTone(freq, dur, type = "sine", gain = 0.05) {
  if (muted) return;
  if (!audioCtx) return;

  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);

  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(g);
  g.connect(audioCtx.destination);

  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

const SFX = {
  coin() {
    playTone(880, 0.08, "square", 0.035);
    playTone(1320, 0.06, "square", 0.02);
  },
  jump() {
    playTone(420, 0.10, "sawtooth", 0.04);
  },
  slide() {
    playTone(220, 0.10, "triangle", 0.05);
  },
  hit() {
    playTone(90, 0.18, "sawtooth", 0.08);
  },
  power() {
    playTone(520, 0.10, "sine", 0.05);
    playTone(780, 0.12, "sine", 0.04);
  },
};

/* =========================
   THEMES (environment variation)
========================= */
const THEMES = [
  {
    name: "Neon Tunnel",
    fogColor: 0x060b14,
    fogNear: 16,
    fogFar: 560,
    exposure: 1.55,
    bloomStrength: 1.05,
    bloomThreshold: 0.07,
    bloomRadius: 0.38,
    rim: 0x7fc8ff,
    neon: 0x22d3ee,
  },
  {
    name: "Amber Station",
    fogColor: 0x0b0710,
    fogNear: 18,
    fogFar: 520,
    exposure: 1.7,
    bloomStrength: 0.85,
    bloomThreshold: 0.12,
    bloomRadius: 0.32,
    rim: 0xffb703,
    neon: 0xfacc15,
  },
  {
    name: "Cold Industrial",
    fogColor: 0x05090f,
    fogNear: 20,
    fogFar: 650,
    exposure: 1.45,
    bloomStrength: 0.9,
    bloomThreshold: 0.09,
    bloomRadius: 0.33,
    rim: 0x8ecae6,
    neon: 0x60a5fa,
  },
  {
    name: "Desert Sun",
    fogColor: 0x2c1b0e,
    fogNear: 15,
    fogFar: 480,
    exposure: 1.30,
    bloomStrength: 0.35,
    bloomThreshold: 0.15,
    bloomRadius: 0.28,
    rim: 0xffd166,
    neon: 0xfbbf24,
  },
];

let themeIndex = 0;
let themeDistNext = 0;
let ambientLight = null;
let hemiLight = null;
let keyLight = null;
let rimLight = null;

function applyTheme(idx) {
  const th = THEMES[idx % THEMES.length];
  themeIndex = idx;

  scene.background = new THREE.Color(th.fogColor);
  if (scene.fog) {
    scene.fog.color = new THREE.Color(th.fogColor);
    scene.fog.near = th.fogNear;
    scene.fog.far = th.fogFar;
  }

  renderer.toneMappingExposure = th.exposure;

  if (bloomPass) {
    bloomPass.strength = th.bloomStrength;
    bloomPass.threshold = th.bloomThreshold;
    bloomPass.radius = th.bloomRadius;
  }

  if (rimLight) rimLight.color = new THREE.Color(th.rim);

  // Update neon props material emissive
  cache.propNeonMat.color = new THREE.Color(th.neon);
  cache.propNeonMat.emissive = new THREE.Color(th.neon);
}

/** Smoothly interpolate between themes over time */
function tickTheme(dt) {
  if (themeLerpFactor >= 1.0) return;

  themeLerpFactor = Math.min(themeLerpFactor + dt * 0.8, 1.0);

  const t0 = THEMES[lastThemeIndex % THEMES.length];
  const t1 = THEMES[targetThemeIndex % THEMES.length];

  // Lerp Fog
  const c0 = new THREE.Color(t0.fogColor);
  const c1 = new THREE.Color(t1.fogColor);
  scene.background.copy(c0).lerp(c1, themeLerpFactor);
  if (scene.fog) {
    scene.fog.color.copy(c0).lerp(c1, themeLerpFactor);
    scene.fog.near = THREE.MathUtils.lerp(t0.fogNear, t1.fogNear, themeLerpFactor);
    scene.fog.far = THREE.MathUtils.lerp(t0.fogFar, t1.fogFar, themeLerpFactor);
  }

  // Lerp Exposure & Bloom
  renderer.toneMappingExposure = THREE.MathUtils.lerp(t0.exposure, t1.exposure, themeLerpFactor);
  if (bloomPass) {
    bloomPass.strength = THREE.MathUtils.lerp(t0.bloomStrength, t1.bloomStrength, themeLerpFactor);
  }

  // Lerp Rim Light
  if (rimLight) {
    const rc0 = new THREE.Color(t0.rim);
    const rc1 = new THREE.Color(t1.rim);
    rimLight.color.copy(rc0).lerp(rc1, themeLerpFactor);
  }
}

/* =========================
   INIT
========================= */
init();
start();

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(CFG.fogColor);
  scene.fog = new THREE.Fog(
    new THREE.Color(CFG.fogColor),
    CFG.fogNear,
    CFG.fogFar
  );

  camera = new THREE.PerspectiveCamera(
    CFG.baseFov,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, CFG.cameraY, CFG.cameraZ);

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = CFG.exposure;
  renderer.useLegacyLights = false;
  document.body.appendChild(renderer.domElement);

  // Post FX composer
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    CFG.bloomStrength,
    CFG.bloomRadius,
    CFG.bloomThreshold
  );
  composer.addPass(bloomPass);

  // Lighting (store refs for theme changes)
  ambientLight = new THREE.AmbientLight(0xffffff, 0.28);
  scene.add(ambientLight);

  hemiLight = new THREE.HemisphereLight(0xbfd9ff, 0x0b0f1a, 1.15);
  scene.add(hemiLight);

  keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
  keyLight.position.set(7, 10, 6);
  scene.add(keyLight);

  rimLight = new THREE.DirectionalLight(0x7fc8ff, 0.95);
  rimLight.position.set(-9, 4, 2);
  scene.add(rimLight);

  // Pools (procedural)
  pools.coin = makePool(() => {
    const c = new THREE.Mesh(cache.coinGeo, cache.coinMat);
    c.visible = false;
    scene.add(c);
    return c;
  }, 90);

  pools.magnet = makePool(() => {
    const m = new THREE.Mesh(cache.magnetGeo, cache.magnetMat);
    m.rotation.x = Math.PI * 0.5;
    m.visible = false;
    scene.add(m);
    return m;
  }, 12);

  pools.obstacle = makePool(() => {
    const o = new THREE.Mesh(cache.obstacleGeo, cache.obstacleMat);
    o.visible = false;
    scene.add(o);
    return o;
  }, 28);

  pools.train = makePool(() => {
    const o = new THREE.Mesh(cache.trainGeo, cache.trainMat);
    o.visible = false;
    scene.add(o);
    return o;
  }, 10);

  pools.barrier = makePool(() => {
    const o = new THREE.Mesh(cache.barrierGeo, cache.barrierMat);
    o.visible = false;
    scene.add(o);
    return o;
  }, 12);

  pools.prop = makePool(() => {
    const pick = Math.random();
    let mesh;
    // Removed cylindrical propPillarGeo as requested by user
    if (pick < 0.6) {
      mesh = new THREE.Mesh(cache.propBoxGeo, cache.propMat);
    } else {
      mesh = new THREE.Mesh(cache.propLightGeo, cache.propNeonMat);
    }
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  }, 60);

  pools.particle = makePool(() => {
    const p = new THREE.Mesh(cache.particleGeo, cache.particleMat.clone());
    p.visible = false;
    scene.add(p);
    return p;
  }, 140);

  pools.explosion = makePool(() => {
    const p = new THREE.Mesh(cache.explosionGeo, cache.particleMat.clone());
    p.visible = false;
    scene.add(p);
    return p;
  }, 80);

  loadTunnelModel();
  buildPlayer();
  loadObstacleModels(); // optional models

  setupInput();
  setupUI();

  clock = new THREE.Clock();
  window.addEventListener("resize", onResize);

  if (ui.best) ui.best.textContent = String(best);
  syncHud();

  applyTheme(0);
}

function loadTunnelModel() {
  // Load tunnel first as the "Master" for size
  gltfLoader.load(CFG.tunnelModelPath, (gltf) => {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);

    // Set master segment length
    CFG.segmentLen = size.z;
    console.log("Master Segment Length (from Tunnel):", CFG.segmentLen);

    // Process Tunnel material/alignment
    const tunnelProcessed = processEnvModel(model, 1.0, CFG.envConfigs.tunnel);
    tunnelProcessed.key = "tunnel";
    envTemplates.push(tunnelProcessed);

    // Now load Desert City and scale it to match
    gltfLoader.load(CFG.desertCityModelPath, (cityGltf) => {
      const cityModel = cityGltf.scene;
      const cityBox = new THREE.Box3().setFromObject(cityModel);
      const citySize = new THREE.Vector3();
      cityBox.getSize(citySize);

      // Scale city relative to tunnel's MASTER length
      const cityBaseScale = CFG.segmentLen / citySize.z;
      const cityProcessed = processEnvModel(cityModel, cityBaseScale, CFG.envConfigs.desertcity);
      cityProcessed.key = "desertcity";
      envTemplates.push(cityProcessed);

      console.log("Desert City processed with config-based scaleMult and alignment");

      tunnelReady = true;
      console.log("Both environments ready. Templates count:", envTemplates.length);
      buildTunnel();
    }, undefined, (err) => {
      console.warn("Desert City failed, using Tunnel only", err);
      tunnelReady = true;
      buildTunnel();
    });

  }, undefined, (err) => {
    console.error("Tunnel failed to load!", err);
    // Absolute fallback
    tunnelReady = true;
    buildProceduralTunnel();
  });
}

/** Helper to standardize env models */
function processEnvModel(model, baseScale, config) {
  const finalScale = baseScale * (config.scaleMult || 1.0);
  model.scale.setScalar(finalScale);

  model.traverse((o) => {
    if (o.isMesh) {
      o.receiveShadow = true;
      o.castShadow = false;
      if (o.material) {
        o.material.side = THREE.DoubleSide;
        if (o.material.metalness !== undefined)
          o.material.metalness = Math.min(o.material.metalness, 0.4);
      }
    }
  });

  // Re-calculate dimensions after scale
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  // Manual Nudge + Auto-Alignment: Center X, Ground Y, Center Z
  model.position.set(
    -center.x + (config.x || 0),
    -box.min.y + (config.y || 0),
    -center.z + (config.z || 0)
  );

  const wrapper = new THREE.Group();
  wrapper.add(model);

  // Use manual lenZ override if provided, else use calculated sizeZ
  const sizeZ = (config.lenZ !== undefined) ? config.lenZ : size.z;

  return { group: wrapper, sizeZ: sizeZ };
}

function buildTunnel() {
  if (!tunnelReady || envTemplates.length === 0) return;

  // Clear existing
  for (const s of tunnelSegs) scene.remove(s);
  tunnelSegs.length = 0;

  // Initial Zone Selection
  currentZoneType = Math.floor(Math.random() * envTemplates.length);
  // Total zone length (in segments)
  zoneSegmentsLeft = Math.floor(Math.random() * (CFG.zoneMax - CFG.zoneMin + 1)) + CFG.zoneMin;

  // Set initial theme based on this zone
  const template = envTemplates[currentZoneType];
  const config = CFG.envConfigs[template.key] || {};
  targetThemeIndex = config.themeIdx || 0;
  lastThemeIndex = targetThemeIndex;
  themeLerpFactor = 1.0;
  applyTheme(targetThemeIndex);

  console.log("Initial Zone State Set:", template.key, "Segments to spawn:", zoneSegmentsLeft);

  let currentZ = 0;
  for (let i = 0; i < CFG.segments; i++) {
    const seg = template.group.clone(true);
    seg.position.set(0, 0, currentZ);
    seg.userData.templateIdx = currentZoneType;
    seg.userData.sizeZ = template.sizeZ;
    scene.add(seg);
    tunnelSegs.push(seg);

    currentZ -= template.sizeZ;
    // We DON'T decrement zoneSegmentsLeft here; these are the starting segments.
  }
}

function buildProceduralTunnel() {
  // simple repeating “tunnel” made of planes/frames
  const group = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.95,
    metalness: 0.0,
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x1f2937,
    roughness: 0.8,
    metalness: 0.05,
  });

  const w = 14;
  const h = 7;
  const len = CFG.segmentLen;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, len), wallMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.position.z = -len / 2;
  group.add(floor);

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, len), wallMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = h;
  ceil.position.z = -len / 2;
  group.add(ceil);

  const left = new THREE.Mesh(new THREE.PlaneGeometry(h, len), wallMat);
  left.rotation.y = Math.PI / 2;
  left.position.x = -w / 2;
  left.position.y = h / 2;
  left.position.z = -len / 2;
  group.add(left);

  const right = new THREE.Mesh(new THREE.PlaneGeometry(h, len), wallMat);
  right.rotation.y = -Math.PI / 2;
  right.position.x = w / 2;
  right.position.y = h / 2;
  right.position.z = -len / 2;
  group.add(right);

  const frame = new THREE.Mesh(
    new THREE.TorusGeometry(4.8, 0.08, 10, 32),
    frameMat
  );
  frame.rotation.x = Math.PI / 2;
  frame.position.y = 3.2;
  frame.position.z = -len + 0.5;
  group.add(frame);

  tunnelModel = group;

  tunnelSegs.length = 0;
  for (let i = 0; i < CFG.segments; i++) {
    const z = -i * CFG.segmentLen;
    const seg = tunnelModel.clone(true);
    seg.position.set(0, 0, z);
    scene.add(seg);
    tunnelSegs.push(seg);
  }
}

function buildPlayer() {
  playerRoot = new THREE.Group();
  playerRoot.position.set(0, 0, 0);
  scene.add(playerRoot);

  // fallback visual
  const mat = new THREE.MeshStandardMaterial({
    color: 0x7dd3fc,
    roughness: 0.35,
    metalness: 0.12,
    emissive: new THREE.Color(0x061019),
    emissiveIntensity: 0.55,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.35, 0.95), mat);
  body.position.y = 0.68;

  playerVisual = new THREE.Group();
  playerVisual.add(body);
  playerRoot.add(playerVisual);

  // optional GLB
  gltfLoader.load(
    "models/player.glb",
    (gltf) => {
      playerRoot.remove(playerVisual);
      playerVisual = gltf.scene;
      playerVisual.position.set(0, 0, 0);
      playerVisual.rotation.y = 0;
      playerRoot.add(playerVisual);

      if (gltf.animations && gltf.animations.length) {
        mixer = new THREE.AnimationMixer(playerVisual);
        gltf.animations.forEach((clip) => {
          const name = clip.name.toLowerCase();
          actions[name] = mixer.clipAction(clip);
        });

        currentAction =
          actions.idle || actions.run || mixer.clipAction(gltf.animations[0]);
        if (currentAction) currentAction.play();
      }
    },
    undefined,
    () => {
      // keep fallback visual
    }
  );
}

/* =========================
   OPTIONAL OBSTACLE MODELS
========================= */
function loadObstacleModels() {
  gltfLoader.load(
    CFG.barrierModelPath,
    (gltf) => {
      barrierModel = gltf.scene;
      barrierModel.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      modelsReady.barrier = true;
    },
    undefined,
    () => { }
  );

  gltfLoader.load(
    CFG.wetFloorModelPath,
    (gltf) => {
      wetFloorModel = gltf.scene;
      wetFloorModel.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      modelsReady.wetFloor = true;
    },
    undefined,
    () => { }
  );

  gltfLoader.load(
    CFG.barrelModelPath,
    (gltf) => {
      barrelModel = gltf.scene;
      barrelModel.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      modelsReady.barrel = true;
    },
    undefined,
    () => { }
  );

  gltfLoader.load(
    CFG.coinModelPath,
    (gltf) => {
      coinModel = gltf.scene;
      coinModel.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false;
          o.receiveShadow = true;
        }
      });
      modelsReady.coin = true;
    },
    undefined,
    () => { }
  );
}

/* =========================
   SPEED LINES
========================= */
function buildSpeedLines() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const w = 2 + Math.random() * 6;
    const h = 18 + Math.random() * 160;
    const a = 0.05 + Math.random() * 0.22;
    ctx.fillStyle = `rgba(250,204,21,${a})`;
    ctx.fillRect(x, y, w, h);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;

  speedLinesMat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.0,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const geo = new THREE.PlaneGeometry(2, 2);
  speedLinesMesh = new THREE.Mesh(geo, speedLinesMat);
  speedLinesMesh.position.set(0, 0, -1.2);
  camera.add(speedLinesMesh);
  scene.add(camera);
}

/* =========================
   UI + INPUT
========================= */
function setupUI() {
  const tap = (el, fn) => {
    if (!el) return;
    el.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        fn();
      },
      { passive: false }
    );
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      fn();
    });
  };

  if (ui.startBtn)
    ui.startBtn.addEventListener("click", () => {
      ensureAudio();
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
      startCountdown();
    });

  if (ui.restart)
    ui.restart.addEventListener("click", () => {
      ensureAudio();
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
      restartGame();
    });

  if (ui.muteBtn) ui.muteBtn.addEventListener("click", () => setMuted(!muted));

  // Legacy button controls removed in favor of swipe detection in setupInput()
}

function startCountdown() {
  if (ui.start) ui.start.classList.add("hidden");
  if (ui.countdown) ui.countdown.classList.remove("hidden");
  countingDown = true;
  countdownVal = 3;
  updateCountdown();
}

function updateCountdown() {
  if (countdownVal > 0) {
    ui.countdown.textContent = countdownVal;
    countdownVal--;
    setTimeout(updateCountdown, 1000);
  } else {
    ui.countdown.textContent = "GO!";
    setTimeout(() => {
      if (ui.countdown) ui.countdown.classList.add("hidden");
      if (ui.hud) ui.hud.classList.remove("hidden");
      // mobile buttons hidden in favor of swipes
      countingDown = false;
      gameStarted = true;

      if (playerVisual) playerVisual.rotation.y = Math.PI;
    }, 650);
  }
}

function setupInput() {
  window.addEventListener("keydown", (e) => {
    if (gameOver && (e.key === "Enter" || e.key === " ")) {
      restartGame();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "a") changeLane(-1);
    if (e.key === "ArrowRight" || e.key === "d") changeLane(1);
    if (e.key === " " || e.key === "ArrowUp" || e.key === "w") jump();
    if (
      e.key === "ArrowDown" ||
      e.key === "s" ||
      e.key === "Shift" ||
      e.key === "Control"
    )
      slide();
  });

  // SWIPE DETECTION
  window.addEventListener("touchstart", (e) => {
    if (gameOver) {
      restartGame();
      return;
    }
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  window.addEventListener("touchend", (e) => {
    if (!gameStarted || gameOver) return;

    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    // Minimum swipe threshold
    if (Math.max(absX, absY) > 30) {
      if (absX > absY) {
        // Horizontal
        if (dx > 0) changeLane(1);
        else changeLane(-1);
      } else {
        // Vertical
        if (dy < 0) jump();
        else slide();
      }
    }
  }, { passive: true });

  // Prevent scrolling/zooming during play
  window.addEventListener("touchmove", (e) => {
    if (gameStarted && !gameOver) e.preventDefault();
  }, { passive: false });
}

/* =========================
   LOOP
========================= */
function start() {
  animate();
}

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.033);
  t += dt;

  tickTheme(dt);

  if (gameStarted && !gameOver) {
    speed = Math.min(speed + CFG.speedRamp * dt, CFG.maxSpeed);
    const dz = speed * dt;
    distMoved += dz;

    updatePlayer(dt);
    updateAnimations(dt);
    updateCamera(dt);
    updateTunnel(dz);

    // Player collider changes when sliding
    const isSlidingNow = isSliding();
    _playerBox.setFromObject(playerRoot).expandByScalar(-CFG.obstacleHitPadding);
    if (isSlidingNow) {
      // shrink top half
      _playerBox.max.y = _playerBox.min.y + (_playerBox.max.y - _playerBox.min.y) * 0.55;
    }

    updateSpawning();
    updateSidePropsSpawning();
    updateObstacles(dz, dt);
    updateCoins(dz, dt);
    updateMagnets(dz, dt);
    updateEnvProps(dz);

    score += dt * 7;
    syncHud();
    updateTunnel(dt * 0.2);
    updateAnimations(dt);
    updateCamera(dt);
  }

  if (shakeTime > 0) {
    shakeTime -= dt;
    const s = shakeIntensity;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
  }

  if (mixer) mixer.update(dt);
  updateParticles(dt);

  composer.render();
}

/* =========================
   UPDATES
========================= */
function updatePlayer(dt) {
  const tx = CFG.lanes[targetLane];
  playerRoot.position.x = THREE.MathUtils.lerp(
    playerRoot.position.x,
    tx,
    CFG.laneLerp
  );

  // slide squash (visual only)
  if (isSliding()) {
    playerVisual.scale.y = THREE.MathUtils.lerp(playerVisual.scale.y, 0.72, 0.22);
    playerVisual.position.y = THREE.MathUtils.lerp(playerVisual.position.y, -0.15, 0.22);
  } else {
    playerVisual.scale.y = THREE.MathUtils.lerp(playerVisual.scale.y, 1.0, 0.22);
    playerVisual.position.y = THREE.MathUtils.lerp(playerVisual.position.y, 0.0, 0.22);
  }

  if (!grounded) {
    velY -= CFG.gravity * dt;
    playerRoot.position.y += velY * dt;
    if (playerRoot.position.y <= 0) {
      playerRoot.position.y = 0;
      velY = 0;
      grounded = true;
      // landing juice
      shakeTime = Math.max(shakeTime, 0.08);
      shakeIntensity = Math.max(shakeIntensity, 0.22);
      spawnLandingDust(playerRoot.position);
    }
  }
}

function updateAnimations(dt) {
  if (!mixer) return;

  let next;
  if (!gameStarted || gameOver) next = actions.idle;
  else if (!grounded) next = actions.jump;
  else if (isSliding()) next = actions.slide || actions.run;
  else if (speed > 0) next = actions.run;

  if (next && next !== currentAction) {
    const prev = currentAction;
    currentAction = next;
    if (prev) prev.fadeOut(0.12);
    currentAction.reset().fadeIn(0.12).play();
  }
}

function updateCamera(dt) {
  const s01 = THREE.MathUtils.clamp(
    (speed - CFG.startSpeed) / (CFG.maxSpeed - CFG.startSpeed),
    0,
    1
  );
  const targetFov = THREE.MathUtils.lerp(CFG.baseFov, CFG.fovAtMaxSpeed, s01);
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.09);
  camera.updateProjectionMatrix();

  const bob = Math.sin(t * (speed * 0.16)) * CFG.camBob;

  const targetX = playerRoot.position.x * 0.28;
  const targetY = CFG.cameraY + bob + (isSliding() ? -0.25 : 0);
  const targetZ = CFG.cameraZ;

  camera.position.x = THREE.MathUtils.lerp(
    camera.position.x,
    targetX,
    CFG.camLag
  );
  camera.position.y = THREE.MathUtils.lerp(
    camera.position.y,
    targetY,
    CFG.camLag
  );
  camera.position.z = THREE.MathUtils.lerp(
    camera.position.z,
    targetZ,
    CFG.camLag
  );

  // Lane tilt for better feel
  const tilt = -(camera.position.x - targetX) * 0.20;
  camera.rotation.z = THREE.MathUtils.lerp(camera.rotation.z, tilt, 0.12);

  camera.lookAt(
    playerRoot.position.x * 0.22,
    CFG.camLookY + (isSliding() ? -0.2 : 0),
    CFG.camLookZ
  );

  if (speedLinesMat) {
    const base = THREE.MathUtils.lerp(0.0, 0.62, s01);
    speedLinesMat.opacity = gameStarted && !gameOver ? base : 0.0;
    if (speedLinesMat.map)
      speedLinesMat.map.offset.y -= dt * (0.35 + s01 * 2.1);
  }

  // keep bloom stable; do NOT accumulate
  const th = THEMES[themeIndex % THEMES.length];
  if (bloomPass) bloomPass.strength = th.bloomStrength + s01 * 0.18;
}

function updateTunnel(dz) {
  // Move all segments
  for (const s of tunnelSegs) {
    s.position.z += dz;
  }

  // Wrap segments that go off-screen
  for (let i = 0; i < tunnelSegs.length; i++) {
    const s = tunnelSegs[i];
    const sSizeZ = s.userData.sizeZ || CFG.segmentLen;

    // Despawn when the BACK edge of the segment passes the camera (with buffer)
    if (s.position.z - sSizeZ > 20) {
      scene.remove(s);

      // --- ZONE SWITCH LOGIC ---
      zoneSegmentsLeft--;
      if (zoneSegmentsLeft <= 0) {
        // We've finished spawning this zone! Switch to a new one.
        const lastZone = currentZoneType;
        while (currentZoneType === lastZone) {
          currentZoneType = Math.floor(Math.random() * envTemplates.length);
        }
        zoneSegmentsLeft = Math.floor(Math.random() * (CFG.zoneMax - CFG.zoneMin + 1)) + CFG.zoneMin;

        // Trigger Theme Lerp
        const template = envTemplates[currentZoneType];
        const config = CFG.envConfigs[template.key] || {};
        lastThemeIndex = targetThemeIndex;
        targetThemeIndex = config.themeIdx || 0;
        themeLerpFactor = 0.0; // Starts the tickTheme lerp

        console.log("--- ZONE TRANSITION START ---");
        console.log("Switching to Zone:", template.key);
        console.log("Selected Theme Index:", targetThemeIndex);
        console.log("Segments in new zone:", zoneSegmentsLeft);
      } else {
        if (zoneSegmentsLeft % 5 === 0) {
          console.log("Zone segments remaining until swap:", zoneSegmentsLeft);
        }
      }

      const template = envTemplates[currentZoneType];
      const newSeg = template.group.clone(true);
      newSeg.userData.templateIdx = currentZoneType;
      newSeg.userData.sizeZ = template.sizeZ;

      // Find the furthest segment currently alive to attach to
      let furthestBackZ = 0;
      for (let j = 0; j < tunnelSegs.length; j++) {
        if (i === j) continue;
        const other = tunnelSegs[j];
        const otherSizeZ = other.userData.sizeZ || CFG.segmentLen;
        const backZ = other.position.z - otherSizeZ;
        if (backZ < furthestBackZ) furthestBackZ = backZ;
      }

      // Attach new segment exactly at the end of the furthest one
      newSeg.position.set(0, 0, furthestBackZ);
      scene.add(newSeg);
      tunnelSegs[i] = newSeg;
    }
  }
}

/* =========================
   SPAWNING
========================= */
function updateSpawning() {
  if (distMoved - lastSpawnDist < nextSpawnInterval) return;
  lastSpawnDist = distMoved;

  // Scale interval with speed to keep a consistent rhythmic "beat"
  // As speed increases, we need slightly more distance between waves to keep them humanly Reactable
  const speedFactor = THREE.MathUtils.clamp((speed - CFG.startSpeed) / (CFG.maxSpeed - CFG.startSpeed), 0, 1);
  nextSpawnInterval =
    CFG.spawnIntervalBase + (speedFactor * 15) + Math.random() * CFG.spawnIntervalVariance;

  const z = CFG.spawnZ;
  const rand = Math.random();

  // Patterns
  if (rand < 0.15) spawnSingleHurdle(z);
  else if (rand < 0.30) spawnSegmentGate(z);
  else if (rand < 0.45) spawnSegmentZigZag(z);
  else if (rand < 0.60) spawnSegmentVault(z);
  else if (rand < 0.80) spawnSegmentBarrierRush(z);
  else spawnSegmentString(z);

  // Powerups (Magnet)
  if (Math.random() < CFG.magnetChance) {
    const lane = (Math.random() * 3) | 0;
    spawnMagnet(lane, z - 25);
  }
}

function spawnSegmentBarrierRush(z) {
  // Use a random "open lane" across all 3 possibilities
  const openLane = (Math.random() * 3) | 0;

  // Create obstacles in both OTHER lanes
  for (let i = 0; i < 3; i++) {
    const lane1 = (openLane + 1) % 3;
    const lane2 = (openLane + 2) % 3;

    // Offset hazards slightly for rhythm
    spawnObstacle(lane1, z - i * 22, { type: "barrier" });
    spawnObstacle(lane2, z - i * 22 - 11, { type: "hurdle" });

    // Always provide coins in the open lane to guide the player
    spawnCoin(openLane, z - i * 22);
    spawnCoin(openLane, z - i * 22 - 11);
  }
}

function spawnSingleHurdle(z) {
  const lane = (Math.random() * 3) | 0;
  spawnObstacle(lane, z, { type: "hurdle" });
  for (let i = 0; i < 3; i++) {
    if (i === lane) continue;
    if (Math.random() > 0.5) for (let j = 0; j < 4; j++) spawnCoin(i, z - j * 4);
  }
}

function spawnSegmentGate(z) {
  const openLane = (Math.random() * 3) | 0;
  // A "Gate" now has a double-stack or more hazards in the blocked lanes
  for (let i = 0; i < 3; i++) {
    if (i !== openLane) {
      spawnObstacle(i, z, { type: "barrier" });
      // Add a barrel behind the barrier for depth
      spawnObstacle(i, z - 10, { type: "hurdle" });
    } else {
      for (let j = 0; j < 8; j++) spawnCoin(i, z - j * 3);
    }
  }
}

function spawnSegmentZigZag(z) {
  let lane = (Math.random() * 3) | 0;
  // A true 3-lane zig-zag
  for (let i = 0; i < 6; i++) {
    spawnCoin(lane, z - i * 15);
    // Place hurdles in the other two lanes at different offsets
    spawnObstacle((lane + 1) % 3, z - i * 15 - 5, { type: "hurdle" });
    spawnObstacle((lane + 2) % 3, z - i * 15 - 10, { type: "hurdle" });
    lane = (lane + (Math.random() > 0.5 ? 1 : 2)) % 3;
  }
}

function spawnSegmentVault(z) {
  const lane = (Math.random() * 3) | 0;
  // vault obstacle sometimes low -> slide
  spawnObstacle(lane, z, { type: Math.random() < 0.55 ? "lowGate" : "hurdle" });

  for (let i = 0; i < 7; i++) {
    const r = i / 6;
    const y = Math.sin(r * Math.PI) * 3.5 + CFG.coinY;
    spawnCoin(lane, z - i * 3, y);
  }
}

function spawnSegmentString(z) {
  const lane = (Math.random() * 3) | 0;
  const obsLane1 = (lane + 1) % 3;
  const obsLane2 = (lane + 2) % 3;

  for (let i = 0; i < 12; i++) spawnCoin(lane, z - i * 2.5);

  // Add more hazards to the side lanes during the coin run
  spawnObstacle(obsLane1, z - 8, { type: "mover" });
  spawnObstacle(obsLane2, z - 18, { type: "barrier" });
  spawnObstacle(obsLane1, z - 28, { type: "hurdle" });
}

function spawnObstacle(laneIndex, z, opt) {
  const type = opt?.type || "hurdle";

  let obj = null;
  let y = 0;
  let scale = 1;

  // Optional model choices (only if loaded)
  if (type === "barrier" && modelsReady.barrier) {
    obj = barrierModel.clone(true);
    obj.scale.setScalar(CFG.barrierScale);
    y = 0.02;
  } else if (type === "hurdle" && (modelsReady.wetFloor || modelsReady.barrel)) {
    const useBarrel = Math.random() > 0.5;
    if (useBarrel && modelsReady.barrel) {
      obj = barrelModel.clone(true);
      obj.userData.isBarrel = true;
      obj.scale.setScalar(CFG.barrelScale);
      y = 0.02;
    } else if (modelsReady.wetFloor) {
      obj = wetFloorModel.clone(true);
      obj.scale.setScalar(CFG.wetFloorScale);
      y = 0.02;
    }
  } else if (type === "coin" && modelsReady.coin) {
    // not used; coins are separate
  }

  // Procedural fallback (pooled) - ONLY for types with no specialized models
  if (!obj) {
    if (type === "barrier") {
      obj = pools.barrier.acquire();
      y = 0.4;
    } else if (type === "lowGate") {
      obj = pools.barrier.acquire();
      y = 0.9;
      obj.scale.set(1.0, 0.55, 1.0);
      obj.userData.lowGate = true;
    } else {
      // Default hurdle fallback using a grey barrier look instead of a red/blue box
      obj = pools.barrier.acquire();
      y = 0.4;
    }
  } else {
    // if it's a clone model, we need to add to scene and later remove manually
    scene.add(obj);
  }

  obj.position.set(CFG.lanes[laneIndex], y, z);

  obj.userData.type = type;
  obj.userData._isModelClone = !!obj.userData._isModelClone;

  if (type === "mover") {
    obj.userData.moveAmp = 1.0 + Math.random() * 0.7;
    obj.userData.moveSpeed = 1.2 + Math.random() * 1.2;
    obj.userData.baseX = obj.position.x;
  }

  obstacles.push(obj);
}

function spawnCoin(laneIndex, z, y = CFG.coinY) {
  let c = null;

  if (modelsReady.coin && coinModel) {
    c = coinModel.clone(true);
    c.scale.setScalar(CFG.coinScale);
    scene.add(c);
    c.userData._isModelClone = true;
  } else {
    c = pools.coin.acquire();
  }

  c.position.set(CFG.lanes[laneIndex], y, z);
  c.userData.startY = y;
  coins.push(c);
}

function spawnMagnet(laneIndex, z) {
  const m = pools.magnet.acquire();
  m.position.set(CFG.lanes[laneIndex], 1.25, z);
  magnets.push(m);
}

/* =========================
   SIDE PROPS (procedural)
========================= */
function updateSidePropsSpawning() {
  if (envProps.length > CFG.sidePropsMaxAlive) return;
  if (distMoved - lastSidePropSpawnDist < nextSidePropInterval) return;

  lastSidePropSpawnDist = distMoved;
  nextSidePropInterval =
    CFG.sidePropsSpawnEveryDist + (Math.random() * 2 - 1) * CFG.sidePropsSpawnJitter;

  const z = CFG.sidePropsZ;

  // spawn 2-4 props: left/right and sometimes ceiling neon
  const count = 2 + ((Math.random() * 3) | 0);
  for (let i = 0; i < count; i++) {
    const p = pools.prop.acquire();

    const side = Math.random() < 0.5 ? -1 : 1;
    const x = side * (CFG.sidePropsX + Math.random() * 0.8);
    const y = THREE.MathUtils.lerp(CFG.sidePropsYMin, CFG.sidePropsYMax, Math.random());
    p.position.set(x, y, z - i * (6 + Math.random() * 10));

    // rotate props to face inward sometimes
    p.rotation.set(0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0);

    // make neon “lights” more likely on ceiling
    if (p.geometry === cache.propLightGeo) {
      p.position.y = 5.6;
      p.position.x = (Math.random() * 8 - 4);
      p.rotation.set(0, 0, 0);
    }

    envProps.push(p);
  }
}

function updateEnvProps(dz) {
  for (let i = envProps.length - 1; i >= 0; i--) {
    const p = envProps[i];
    p.position.z += dz;

    if (p.position.z > CFG.propsDespawnZ) {
      pools.prop.release(p);
      envProps.splice(i, 1);
    }
  }
}

/* =========================
   MOVE + COLLISION
========================= */
function updateObstacles(dz, dt) {
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.position.z += dz;

    // moving obstacle
    if (o.userData.type === "mover") {
      const ox = o.userData.baseX + Math.sin(t * o.userData.moveSpeed) * o.userData.moveAmp;
      o.position.x = ox;
    }

    _tmpBox.setFromObject(o);

    // Near miss: close but not hit
    if (!gameOver && (performance.now() / 1000 - lastNearMissAt) > CFG.nearMissCooldown) {
      const d = distanceBoxToBox(_playerBox, _tmpBox);
      if (d > 0 && d < CFG.nearMissDist) {
        lastNearMissAt = performance.now() / 1000;
        score += CFG.nearMissScore;
        flashFx(0.25);
      }
    }

    if (_playerBox.intersectsBox(_tmpBox)) {
      if (o.userData.isBarrel) spawnExplosion(o.position.clone());
      hitFlash();
      endGame();
      // do not early remove to keep consistent
    }

    if (o.position.z > CFG.despawnZ) {
      // release
      if (o.parent && (o === pools.obstacle || o === pools.train || o === pools.barrier)) {
        // nothing
      }
      if (o.geometry && (o.geometry === cache.obstacleGeo || o.geometry === cache.trainGeo || o.geometry === cache.barrierGeo)) {
        // pooled mesh
        if (o.geometry === cache.trainGeo) pools.train.release(o);
        else if (o.geometry === cache.barrierGeo) pools.barrier.release(o);
        else pools.obstacle.release(o);
      } else {
        // model clone
        scene.remove(o);
      }

      obstacles.splice(i, 1);
    }
  }
}

function updateCoins(dz, dt) {
  const now = performance.now() / 1000;
  const magnetActive = now < magnetEndTime;

  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    c.position.z += dz;
    c.rotation.y += dt * 3;

    if (c.userData.startY !== undefined) {
      c.position.y = c.userData.startY + Math.sin(now * 4) * 0.2;
    }

    // Coin shine pulse
    if (c.material && c.material.emissive) {
      const pulse = 0.6 + Math.sin(now * 6.5) * 0.35;
      c.material.emissiveIntensity = pulse;
    }

    if (magnetActive) {
      _tmpV3.copy(playerRoot.position).sub(c.position);
      const d = _tmpV3.length();
      if (d < CFG.magnetRadius) {
        _tmpV3.normalize();
        c.position.add(_tmpV3.multiplyScalar(CFG.magnetPullSpeed * dt));
      }
    }

    if (c.position.distanceTo(playerRoot.position) < CFG.coinPickupRadius) {
      coinCount++;
      score += 10;
      SFX.coin();
      spawnParticles(c.position, 0xffd35a, 12);
      releaseCoin(c);
      coins.splice(i, 1);
      continue;
    }

    if (c.position.z > CFG.despawnZ) {
      releaseCoin(c);
      coins.splice(i, 1);
    }
  }
}

function releaseCoin(c) {
  if (c.userData && c.userData._isModelClone) scene.remove(c);
  else pools.coin.release(c);
}

function updateMagnets(dz, dt) {
  const now = performance.now() / 1000;

  for (let i = magnets.length - 1; i >= 0; i--) {
    const m = magnets[i];
    m.position.z += dz;
    m.rotation.z += dt * 2.6;

    if (m.position.distanceTo(playerRoot.position) < 1.2) {
      magnetEndTime = now + CFG.magnetDuration;
      SFX.power();
      pools.magnet.release(m);
      magnets.splice(i, 1);
      continue;
    }

    if (m.position.z > CFG.despawnZ) {
      pools.magnet.release(m);
      magnets.splice(i, 1);
    }
  }
}

/* =========================
   SLIDE / INPUT HELPERS
========================= */
function isSliding() {
  return performance.now() / 1000 < slideEndsAt;
}

function slide() {
  if (gameOver) return;
  if (!gameStarted) return;

  const now = performance.now() / 1000;
  if (now < slideCooldownUntil) return;

  slideEndsAt = now + CFG.slideDuration;
  slideCooldownUntil = now + CFG.slideCooldown;

  SFX.slide();
}

function changeLane(dir) {
  if (gameOver) return;
  if (!gameStarted) return;
  targetLane = THREE.MathUtils.clamp(
    targetLane + dir,
    0,
    CFG.lanes.length - 1
  );
}

function jump() {
  if (gameOver) return;
  if (!gameStarted) return;
  if (!grounded) return;

  // cancel slide if jumping
  slideEndsAt = 0;

  velY = CFG.jumpVelocity;
  grounded = false;
  SFX.jump();
}

/* =========================
   GAME STATE
========================= */
function endGame() {
  if (gameOver) return;
  gameOver = true;

  SFX.hit();
  shakeTime = 0.45;
  shakeIntensity = 0.55;

  const final = Math.floor(score);
  if (final > best) {
    best = final;
    localStorage.setItem("best", String(best));
  }

  setTimeout(() => {
    if (ui.finalScore) ui.finalScore.textContent = String(final);
    if (ui.finalBest) ui.finalBest.textContent = String(best);
    if (ui.best) ui.best.textContent = String(best);
    if (ui.go) ui.go.classList.remove("hidden");
    if (ui.hud) ui.hud.classList.add("hidden");
    if (ui.mobile) ui.mobile.classList.add("hidden");
  }, 500);
}

function restartGame() {
  gameOver = false;
  gameStarted = false;
  countingDown = false;

  if (ui.go) ui.go.classList.add("hidden");
  if (ui.start) ui.start.classList.add("hidden");
  if (ui.countdown) ui.countdown.classList.add("hidden");
  if (ui.hud) ui.hud.classList.add("hidden");
  if (ui.mobile) ui.mobile.classList.add("hidden");

  speed = CFG.startSpeed;
  targetLane = 1;
  velY = 0;
  grounded = true;

  slideEndsAt = 0;
  slideCooldownUntil = 0;

  score = 0;
  coinCount = 0;
  magnetEndTime = 0;
  distMoved = 0;
  lastSpawnDist = -20;

  lastNearMissAt = -999;

  lastSidePropSpawnDist = 0;
  nextSidePropInterval = CFG.sidePropsSpawnEveryDist;

  playerRoot.position.set(0, 0, 0);
  if (playerVisual) playerVisual.rotation.y = 0;

  // Reset Camera
  camera.position.set(0, CFG.cameraY, CFG.cameraZ);
  camera.lookAt(0, CFG.camLookY, CFG.camLookZ);

  // clear arrays (pooled release)
  for (const o of obstacles) {
    if (o.geometry === cache.trainGeo) pools.train.release(o);
    else if (o.geometry === cache.barrierGeo) pools.barrier.release(o);
    else if (o.geometry === cache.obstacleGeo) pools.obstacle.release(o);
    else scene.remove(o);
  }
  obstacles.length = 0;

  for (const c of coins) releaseCoin(c);
  coins.length = 0;

  // Clear tunnel segments and rebuild
  for (const s of tunnelSegs) scene.remove(s);
  tunnelSegs.length = 0;

  // Reset Zone/Theme State
  currentZoneType = 0;
  zoneSegmentsLeft = 0;
  lastThemeIndex = 0;
  targetThemeIndex = 0;
  themeLerpFactor = 1.0;

  buildTunnel();

  for (const m of magnets) pools.magnet.release(m);
  magnets.length = 0;

  for (const p of envProps) pools.prop.release(p);
  envProps.length = 0;

  for (const p of particles) {
    if (p.userData && p.userData._isExplosion) pools.explosion.release(p);
    else pools.particle.release(p);
  }
  particles.length = 0;

  applyTheme(0);
  syncHud();

  // Start new game immediately
  startCountdown();
}

function syncHud() {
  if (ui.score) ui.score.textContent = String(Math.floor(score));
  if (ui.coins) ui.coins.textContent = String(coinCount);
  if (ui.best) ui.best.textContent = String(best);
}

/* =========================
   FX
========================= */
function flashFx(intensity = 0.35) {
  if (!ui.fxFlash) return;
  ui.fxFlash.style.opacity = String(intensity);
  ui.fxFlash.classList.remove("fxPop");
  // force reflow
  void ui.fxFlash.offsetWidth;
  ui.fxFlash.classList.add("fxPop");
  setTimeout(() => {
    ui.fxFlash.style.opacity = "0";
  }, 120);
}

function hitFlash() {
  flashFx(0.6);
}

function spawnLandingDust(pos) {
  spawnParticles(new THREE.Vector3(pos.x, 0.2, pos.z), 0xffffff, 10, 1.0);
}

function spawnParticles(pos, color, count = 14, spread = 1.0) {
  for (let i = 0; i < count; i++) {
    const p = pools.particle.acquire();
    p.material.color.setHex(color);
    p.material.opacity = 1;
    p.position.copy(pos);

    const angle = Math.random() * Math.PI * 2;
    const force = (2 + Math.random() * 4) * spread;

    p.userData.vel = new THREE.Vector3(
      Math.cos(angle) * force,
      (Math.random() * 2 + 1) * force * 0.5,
      Math.sin(angle) * force
    );
    p.userData.life = 1.0;
    p.userData._isExplosion = false;

    particles.push(p);
  }
}

function spawnExplosion(pos) {
  hitFlash();

  const colors = [0xff4400, 0xffaa00, 0xffcc00, 0xffffff];
  const count = 50;

  for (let i = 0; i < count; i++) {
    const p = pools.explosion.acquire();
    p.material.color.setHex(colors[(Math.random() * colors.length) | 0]);
    p.material.opacity = 1;
    p.position.copy(pos);

    const phi = Math.random() * Math.PI * 2;
    const theta = Math.random() * Math.PI;
    const force = 6 + Math.random() * 12;

    p.userData.vel = new THREE.Vector3(
      Math.sin(theta) * Math.cos(phi) * force,
      Math.sin(theta) * Math.sin(phi) * force,
      Math.cos(theta) * force
    );
    p.userData.life = 1.35 + Math.random() * 0.7;
    p.userData._isExplosion = true;

    particles.push(p);
  }

  const flash = new THREE.PointLight(0xffaa00, 18, 30);
  flash.position.copy(pos);
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 140);
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.userData.life -= dt * 2;
    if (p.userData.life <= 0) {
      if (p.userData._isExplosion) pools.explosion.release(p);
      else pools.particle.release(p);
      particles.splice(i, 1);
      continue;
    }
    p.position.addScaledVector(p.userData.vel, dt);
    p.userData.vel.y -= 15 * dt;
    p.material.opacity = p.userData.life;
    p.scale.setScalar(p.userData.life);
  }
}

/* =========================
   RESIZE
========================= */
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  if (bloomPass) bloomPass.setSize(window.innerWidth, window.innerHeight);
}

/* =========================
   UTIL
========================= */
function distanceBoxToBox(a, b) {
  // distance between AABBs (0 if intersecting)
  const dx = Math.max(0, Math.max(a.min.x - b.max.x, b.min.x - a.max.x));
  const dy = Math.max(0, Math.max(a.min.y - b.max.y, b.min.y - a.max.y));
  const dz = Math.max(0, Math.max(a.min.z - b.max.z, b.min.z - a.max.z));
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}