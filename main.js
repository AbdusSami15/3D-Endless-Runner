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
  laneLerp: 0.22,

  startSpeed: 14.0,
  maxSpeed: 38,
  speedRamp: 0.16,

  jumpVelocity: 16.5,
  gravity: 34.0,

  // Slide
  slideDuration: 0.52,
  slideCooldown: 0.10,

  // Spawning (Professional Flow)
  spawnIntervalBase: 22,
  spawnIntervalVariance: 8,
  spawnZ: -45,

  // Fairness
  maxObstaclesPerWave: 2,
  maxObstaclesPerCluster: 4,
  clusterChanceAtMaxSpeed: 0.65,
  clusterRowSpacingMin: 6.5,
  clusterRowSpacingMax: 10.5,
  obstacleY: 0.68,
  coinY: 1.12,

  // Pickup / collisions
  coinPickupRadius: 2.4,
  obstacleHitPadding: 0.12,

  // Near miss (juicy)
  nearMissDist: 1.2,
  nearMissScore: 50,
  nearMissCooldown: 0.40,

  // Magnet
  magnetChance: 0.16,
  magnetDuration: 8,
  magnetRadius: 6.5,
  magnetPullSpeed: 26,

  // World
  despawnZ: 25,

  // Audio mix
  bgmVolume: 0.28,
  jumpSfxVolume: 0.95,
  toneGainMult: 1.85,
  bgmDuckTo: 0.12,
  bgmDuckMs: 180,

  // Look
  exposure: 1.3,
  cameraZ: 10.5,
  cameraY: 5.5,
  camLag: 0.08,
  camLookZ: -8.0,
  camLookY: 1.2,
  camBob: 0.07,

  // Cinematic camera
  baseFov: 72,
  fovAtMaxSpeed: 92,

  // Fog (default; themes will override dynamically)
  fogNear: 18,
  fogFar: 600,
  fogColor: 0x060b14,

  // Bloom
  bloomStrength: 0.4,
  bloomRadius: 0.35,
  bloomThreshold: 0.3,

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

  coinScale: 1.1,
  coinModelPath: "models/coin.glb",
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

let particles = [];

let score = 0;
let best = Number(localStorage.getItem("best") || 0);
let coinCount = 0;

let magnetEndTime = 0;
let distMoved = 0;
let lastSpawnDist = -65;
let nextSpawnInterval = 35;

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
let laneHistory = [0, 1, 2]; // Shuffle Bag
let lastLane = 1;

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
  loading: document.getElementById("loadingOverlay"),
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

/* =========================
   ASSET LOADING UI
========================= */
let pendingAssets = 0;
let assetsReady = false;

function setAssetsLoading(isLoading) {
  if (ui.loading) ui.loading.classList.toggle("hidden", !isLoading);
  if (ui.startBtn) ui.startBtn.disabled = isLoading;
}

function beginAsset() {
  pendingAssets++;
  assetsReady = false;
  setAssetsLoading(true);
}

function endAsset() {
  pendingAssets = Math.max(0, pendingAssets - 1);
  if (pendingAssets === 0) {
    assetsReady = true;
    setAssetsLoading(false);
  }
}

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
  particle: null,
  explosion: null,
};

/* =========================
   AUDIO (no files)
========================= */
let audioCtx = null;
let muted = false;
let bgm = null;
let bgmReady = false;
let jumpSfx = null;
let jumpSfxReady = false;
let blastSfx = null;
let blastSfxReady = false;
let bgmDuckUntil = 0;

function ensureAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    audioCtx = null;
  }
}

function ensureBgm() {
  if (bgmReady) return;
  try {
    bgm = new Audio("sounds/gameplaySound.mp3");
    bgm.loop = true;
    bgm.preload = "auto";
    bgm.volume = CFG.bgmVolume;
    bgm.muted = muted;
    bgmReady = true;
  } catch {
    bgm = null;
    bgmReady = false;
  }
}

function ensureJumpSfx() {
  if (jumpSfxReady) return;
  try {
    jumpSfx = new Audio("sounds/jump.mp3");
    jumpSfx.preload = "auto";
    jumpSfx.volume = CFG.jumpSfxVolume;
    jumpSfx.muted = muted;
    jumpSfxReady = true;
  } catch {
    jumpSfx = null;
    jumpSfxReady = false;
  }
}

function ensureBlastSfx() {
  if (blastSfxReady) return;
  try {
    blastSfx = new Audio("sounds/blast.mp3");
    blastSfx.preload = "auto";
    blastSfx.volume = 0.95;
    blastSfx.muted = muted;
    blastSfxReady = true;
  } catch {
    blastSfx = null;
    blastSfxReady = false;
  }
}

function duckBgm() {
  if (muted) return;
  if (!bgmReady || !bgm) return;
  const now = performance.now();
  bgmDuckUntil = Math.max(bgmDuckUntil, now + CFG.bgmDuckMs);
  bgm.volume = Math.min(bgm.volume, CFG.bgmDuckTo);
}

function tickBgmDuck() {
  if (!bgmReady || !bgm) return;
  if (muted) return;
  const now = performance.now();
  if (now < bgmDuckUntil) return;
  // Smooth return to normal volume
  bgm.volume = Math.min(CFG.bgmVolume, bgm.volume + 0.02);
}

function playBgm() {
  if (muted) return;
  if (!bgmReady || !bgm) return;
  // Autoplay policies: this should be called from a user gesture (start/restart)
  const p = bgm.play();
  if (p && typeof p.catch === "function") p.catch(() => { });
}

function playJumpSfx() {
  if (muted) return;
  duckBgm();
  if (!jumpSfxReady || !jumpSfx) {
    // fallback (original synth)
    playTone(420, 0.10, "sawtooth", 0.065);
    return;
  }

  // allow rapid re-trigger
  try {
    jumpSfx.currentTime = 0;
  } catch { }
  const p = jumpSfx.play();
  if (p && typeof p.catch === "function") p.catch(() => { });
}

function playBlastSfx() {
  if (muted) return;
  duckBgm();
  if (!blastSfxReady || !blastSfx) return;
  try {
    blastSfx.currentTime = 0;
  } catch { }
  const p = blastSfx.play();
  if (p && typeof p.catch === "function") p.catch(() => { });
}

function stopBgm() {
  if (!bgm) return;
  bgm.pause();
  // keep currentTime so restart feels continuous; comment out next line if you prefer rewind
  // bgm.currentTime = 0;
}

function setMuted(v) {
  muted = !!v;
  if (ui.muteBtn) ui.muteBtn.textContent = muted ? "UNMUTE" : "MUTE";
  if (bgm) bgm.muted = muted;
  if (jumpSfx) jumpSfx.muted = muted;
  if (blastSfx) blastSfx.muted = muted;
  if (muted) stopBgm();
  else playBgm();
}

function playTone(freq, dur, type = "sine", gain = 0.05) {
  if (muted) return;
  if (!audioCtx) return;
  duckBgm();

  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);

  const finalGain = Math.min(0.25, gain * CFG.toneGainMult);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(finalGain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(g);
  g.connect(audioCtx.destination);

  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

const SFX = {
  coin() {
    playTone(880, 0.085, "square", 0.065);
    playTone(1320, 0.06, "square", 0.045);
  },
  jump() {
    playJumpSfx();
  },
  slide() {
    playTone(220, 0.11, "triangle", 0.075);
  },
  hit() {
    playTone(90, 0.20, "sawtooth", 0.11);
  },
  power() {
    playTone(520, 0.10, "sine", 0.07);
    playTone(780, 0.12, "sine", 0.06);
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
    exposure: 1.25,
    bloomStrength: 0.5,
    bloomThreshold: 0.25,
    bloomRadius: 0.38,
    rim: 0x7fc8ff,
    neon: 0x22d3ee,
  },
  {
    name: "Amber Station",
    fogColor: 0x0b0710,
    fogNear: 18,
    fogFar: 520,
    exposure: 1.30,
    bloomStrength: 0.45,
    bloomThreshold: 0.28,
    bloomRadius: 0.32,
    rim: 0xffb703,
    neon: 0xfacc15,
  },
  {
    name: "Cold Industrial",
    fogColor: 0x05090f,
    fogNear: 20,
    fogFar: 650,
    exposure: 1.2,
    bloomStrength: 0.42,
    bloomThreshold: 0.3,
    bloomRadius: 0.33,
    rim: 0x8ecae6,
    neon: 0x60a5fa,
  },
  {
    name: "Desert Sun",
    fogColor: 0x2c1b0e,
    fogNear: 15,
    fogFar: 480,
    exposure: 1.22,
    bloomStrength: 0.3,
    bloomThreshold: 0.32,
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

  rimLight = new THREE.DirectionalLight(0x7fc8ff, 0.85);
  rimLight.position.set(-9, 4, 2);
  scene.add(rimLight);

  // Lighting (store refs for theme changes)
  ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
  scene.add(ambientLight);

  hemiLight = new THREE.HemisphereLight(0xbfd9ff, 0x0b0f1a, 0.9);
  scene.add(hemiLight);

  keyLight = new THREE.DirectionalLight(0xffffff, 1.65);
  keyLight.position.set(7, 10, 6);
  scene.add(keyLight);

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

  // Start in loading state until initial GLTFs settle
  setAssetsLoading(true);
}

function loadTunnelModel() {
  // Load tunnel first as the "Master" for size
  beginAsset();
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
    beginAsset();
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
      endAsset();
    }, undefined, (err) => {
      console.warn("Desert City failed, using Tunnel only", err);
      tunnelReady = true;
      buildTunnel();
      endAsset();
    });

    endAsset();
  }, undefined, (err) => {
    console.error("Tunnel failed to load!", err);
    // Absolute fallback
    tunnelReady = true;
    buildProceduralTunnel();
    endAsset();
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
  beginAsset();
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
      endAsset();
    },
    undefined,
    () => {
      // keep fallback visual
      endAsset();
    }
  );
}

/* =========================
   OPTIONAL OBSTACLE MODELS
========================= */
function loadObstacleModels() {
  beginAsset();
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
      endAsset();
    },
    undefined,
    () => {
      endAsset();
    }
  );

  beginAsset();
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
      endAsset();
    },
    undefined,
    () => {
      endAsset();
    }
  );

  beginAsset();
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
      endAsset();
    },
    undefined,
    () => {
      endAsset();
    }
  );

  beginAsset();
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
      endAsset();
    },
    undefined,
    () => {
      endAsset();
    }
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
      startCountdown();
    });

  if (ui.restart)
    ui.restart.addEventListener("click", () => {
      restartGame();
    });

  if (ui.muteBtn) ui.muteBtn.addEventListener("click", () => setMuted(!muted));

  // Legacy button controls removed in favor of swipe detection in setupInput()
}

function startCountdown() {
  // Ensure audio is unlocked via user gesture (click / keydown)
  ensureAudio();
  ensureBgm();
  ensureJumpSfx();
  ensureBlastSfx();
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();

  // Requirement: countdown SFX first, then gameplay music starts on GO
  stopBgm();

  if (ui.start) ui.start.classList.add("hidden");
  if (ui.countdown) ui.countdown.classList.remove("hidden");
  countingDown = true;
  countdownVal = 3;
  updateCountdown();
}

function updateCountdown() {
  if (countdownVal > 0) {
    ui.countdown.textContent = countdownVal;
    ui.countdown.classList.remove("counting-anim");
    void ui.countdown.offsetWidth;
    ui.countdown.classList.add("counting-anim");
    // 3-2-1 tick
    const freq = countdownVal === 3 ? 440 : countdownVal === 2 ? 494 : 523;
    playTone(freq, 0.09, "square", 0.05);
    countdownVal--;
    setTimeout(updateCountdown, 1000);
  } else {
    ui.countdown.textContent = "GO!";
    ui.countdown.classList.remove("counting-anim");
    void ui.countdown.offsetWidth;
    ui.countdown.classList.add("counting-anim");
    // GO cue (little chord)
    playTone(659, 0.12, "sawtooth", 0.06);
    playTone(880, 0.14, "sawtooth", 0.05);

    setTimeout(() => {
      if (ui.countdown) ui.countdown.classList.add("hidden");
      if (ui.hud) ui.hud.classList.remove("hidden");
      // mobile buttons hidden in favor of swipes
      countingDown = false;
      gameStarted = true;

      if (playerVisual) playerVisual.rotation.y = Math.PI;

      // Start BGM after countdown finishes
      playBgm();
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
  tickBgmDuck();

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
    updateObstacles(dz, dt);
    updateCoins(dz, dt);
    updateMagnets(dz, dt);

    score += dt * 7;
    syncHud();
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
      shakeTime = 0.12;
      shakeIntensity = 0.28;
      spawnLandingDust(playerRoot.position);
      SFX.slide(); // subtle thump sound? actually slide tone is okay for thud
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

  // Scale interval slightly with speed (rhythmic beat)
  const speedFactor = THREE.MathUtils.clamp(
    (speed - CFG.startSpeed) / (CFG.maxSpeed - CFG.startSpeed),
    0,
    1
  );
  nextSpawnInterval =
    CFG.spawnIntervalBase +
    speedFactor * 8 +
    Math.random() * CFG.spawnIntervalVariance;

  const z = CFG.spawnZ;

  // Difficulty: speed increases AND clusters appear more often.
  // Cluster = multiple rows close together; total obstacles in a cluster never exceeds CFG.maxObstaclesPerCluster.
  const wantCluster =
    Math.random() <
    THREE.MathUtils.lerp(
      0.12,
      CFG.clusterChanceAtMaxSpeed,
      speedFactor
    );

  if (wantCluster) spawnObstacleCluster(z, speedFactor);
  else spawnSingleWave(z, speedFactor);

  // Powerups (Magnet)
  if (Math.random() < CFG.magnetChance) {
    const lane = (Math.random() * 3) | 0;
    spawnMagnet(lane, z - 15);
  }
}

function pickHazardType(speedFactor) {
  // Keep early game gentle, add tougher types later.
  let type = "hurdle";
  if (score > 350 && Math.random() < 0.25 + speedFactor * 0.15) type = "barrier";
  if (score > 1200 && Math.random() < 0.12 + speedFactor * 0.10) type = "lowGate";
  return type;
}

function spawnSingleWave(z, speedFactor) {
  // Always leave one lane open (and seed coins there).
  const openLane = pickBalancedLane();
  spawnCoinTrail(openLane, z);

  // How many hazards this wave: 1-2 early, up to 2 at high speed (3 lanes total so keep solvable).
  const maxHazards = score > 700 ? 2 : score > 120 ? 2 : 1;
  const hazardCount = 1 + ((Math.random() * maxHazards) | 0);

  const lanes = [0, 1, 2];
  shuffle(lanes);

  let placed = 0;
  for (let i = 0; i < 3; i++) {
    const lane = lanes[i];
    if (lane === openLane) continue;
    if (placed >= hazardCount) break;
    const jitter = (Math.random() - 0.5) * 5.5;
    spawnObstacle(lane, z + jitter, { type: pickHazardType(speedFactor) });
    placed++;
  }
}

function spawnObstacleCluster(baseZ, speedFactor) {
  // Total obstacles across rows is capped at 4.
  let remaining = CFG.maxObstaclesPerCluster;
  let row = 0;
  let z = baseZ;

  // Keep the first row generous: coins + 1-2 hazards.
  while (remaining > 0 && row < 4) {
    const openLane = pickBalancedLane();
    if (row === 0) spawnCoinTrail(openLane, z);

    // Later rows can be tighter, but still leave an escape lane.
    const maxThisRow = row === 0 ? 2 : 2;
    const minThisRow = 1;
    const hazardsThisRow = Math.min(
      remaining,
      minThisRow + ((Math.random() * (maxThisRow - minThisRow + 1)) | 0)
    );

    const lanes = [0, 1, 2];
    shuffle(lanes);
    let placed = 0;
    for (let i = 0; i < 3; i++) {
      const lane = lanes[i];
      if (lane === openLane) continue;
      if (placed >= hazardsThisRow) break;
      const jitter = (Math.random() - 0.5) * 3.0;
      spawnObstacle(lane, z + jitter, { type: pickHazardType(speedFactor) });
      placed++;
      remaining--;
      if (remaining <= 0) break;
    }

    // Step back for next row in the cluster (spacing shrinks as speed rises)
    row++;
    const spacing = THREE.MathUtils.lerp(
      CFG.clusterRowSpacingMax,
      CFG.clusterRowSpacingMin,
      speedFactor
    );
    z -= spacing;
  }
}

/** Professional Lane Balancing (Shuffle Bag style) */
function pickBalancedLane() {
  if (laneHistory.length === 0) {
    const lastDrawn = lastLane;
    laneHistory = [0, 1, 2];
    shuffle(laneHistory);
    // Anti-repeat: ensure the first of new bag isn't the last of old bag
    if (laneHistory[laneHistory.length - 1] === lastDrawn) {
      // Swap the last element with another
      [laneHistory[laneHistory.length - 1], laneHistory[0]] = [
        laneHistory[0],
        laneHistory[laneHistory.length - 1],
      ];
    }
  }
  const lane = laneHistory.pop();
  lastLane = lane;
  return lane;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[arr[j]]] = [arr[j], arr[i]];
  }
}

function spawnCoinTrail(laneIndex, z) {
  const count = 3 + ((Math.random() * 4) | 0);
  let currentLane = laneIndex;

  for (let i = 0; i < count; i++) {
    // Professional Weaving Trail (20% chance to jump lanes mid-trail)
    if (i > 1 && Math.random() < 0.2 && count > 4) {
      const dir = Math.random() > 0.5 ? 1 : -1;
      const nextLane = (currentLane + dir + 3) % 3;
      // ensure we don't jump into a blockade next turn (rough heuristic)
      currentLane = nextLane;
    }
    spawnCoin(currentLane, z - i * 4);
  }
}

/* Removed old multi-obstacle segment functions as they caused clumping */

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

  // Procedural fallback (pooled)
  if (!obj) {
    if (type === "lowGate") {
      obj = pools.barrier.acquire();
      y = 1.0;
      obj.scale.set(1.0, 0.45, 1.0);
      obj.userData.lowGate = true;
    } else if (type === "barrier") {
      obj = pools.barrier.acquire();
      y = 0.4;
    } else {
      // Default hurdle
      obj = pools.obstacle.acquire();
      y = CFG.obstacleY;
    }
  } else {
    scene.add(obj);
  }

  obj.position.set(CFG.lanes[laneIndex], y, z);
  obj.userData.type = type;
  obj.userData._isModelClone = !!obj.userData._isModelClone;

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
   MOVE + COLLISION
========================= */
function updateObstacles(dz, dt) {
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.position.z += dz;

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
  stopBgm();
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
  lastSpawnDist = -65;
  nextSpawnInterval = 35;
  laneHistory = [0, 1, 2];
  shuffle(laneHistory);
  lastLane = 1;

  lastNearMissAt = -999;

  playerRoot.position.set(0, 0, 0);
  if (playerVisual) playerVisual.rotation.y = 0;
  if (playerVisual) {
    playerVisual.scale.set(1, 1, 1);
    playerVisual.position.set(0, 0, 0);
  }

  // Force player into idle on restart (regardless of death state)
  if (mixer) {
    try {
      mixer.stopAllAction();
    } catch { }
  }
  currentAction = actions.idle || actions.run || currentAction;
  if (currentAction) {
    try {
      currentAction.reset().play();
    } catch { }
  }

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
  // Dust moves outward
  spawnParticles(new THREE.Vector3(pos.x, 0.1, pos.z), 0xffffff, 14, 1.2, true);
}

function spawnParticles(pos, color, count = 14, spread = 1.0, horizontal = false) {
  for (let i = 0; i < count; i++) {
    const p = pools.particle.acquire();
    p.material.color.setHex(color);
    p.material.opacity = 1;
    p.position.copy(pos);

    const angle = Math.random() * Math.PI * 2;
    const force = (1.5 + Math.random() * 3.5) * spread;

    const vx = Math.cos(angle) * force;
    const vy = horizontal ? (Math.random() * 0.5) : (Math.random() * 2 + 1) * force * 0.5;
    const vz = Math.sin(angle) * force;

    p.userData.vel = new THREE.Vector3(vx, vy, vz);
    p.userData.life = 1.0 + Math.random() * 0.5;
    p.userData._isExplosion = false;

    particles.push(p);
  }
}

function spawnExplosion(pos) {
  playBlastSfx();
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