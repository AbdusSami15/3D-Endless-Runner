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
  maxSpeed: 26,
  speedRamp: 0.055,

  jumpVelocity: 15.8,
  gravity: 28.5,

  // Spawning (Distance-based)
  spawnIntervalBase: 70,
  spawnIntervalVariance: 40,
  spawnZ: -100,

  // Fairness
  maxObstaclesPerWave: 2,
  obstacleY: 0.68,
  coinY: 1.12,

  // Pickup / collisions
  coinPickupRadius: 2.2,
  obstacleHitPadding: 0.08,

  // Magnet
  magnetChance: 0.14,
  magnetDuration: 7,
  magnetRadius: 5.5,
  magnetPullSpeed: 20,

  // World
  despawnZ: 18,

  // Look
  exposure: 1.6,
  cameraZ: 9.7,
  cameraY: 5.0,
  camLag: 0.10,
  camLookZ: -6.2,
  camLookY: 1.1,
  camBob: 0.07,

  // Cinematic camera
  baseFov: 70,
  fovAtMaxSpeed: 84,

  // Fog (subtle)
  fogNear: 18,
  fogFar: 600,
  fogColor: 0x060b14,

  // Bloom
  bloomStrength: 0.95,
  bloomRadius: 0.35,
  bloomThreshold: 0.08,

  // Tunnel
  tunnelModelPath: "models/tunnel.glb",
  tunnelHalfWidth: 5.8,
  tunnelHeight: 4.2,
  segmentLen: 18,
  segments: 14,

  // Props / Obstacles
  barrierModelPath: "models/concrete_road_barrier_4k.gltf/concrete_road_barrier_4k.gltf",
  wetFloorModelPath: "models/wet_floor/WetFloorSign_01_4k.gltf",
  barrelModelPath: "models/Barrel_01_4k.gltf/Barrel_01_4k.gltf",
  wetFloorScale: 4.5,
  barrierScale: 3.2,
  barrelScale: 4.0,
  coinScale: 1.1,
  coinModelPath: "models/coin.glb",
  propsDespawnZ: 22,
};

/* =========================
   GLOBALS
========================= */
let scene, camera, renderer, clock, composer, bloomPass;
let playerRoot, playerVisual, mixer, actions = {}, currentAction;

let speed = CFG.startSpeed;
let targetLane = 1;
let velY = 0;
let grounded = true;

let obstacles = [];
let coins = [];
let magnets = [];
let tunnelSegs = [];
let tunnelModel = null;
let tunnelReady = false;
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

// Speed lines
let speedLinesMesh = null;
let speedLinesMat = null;

// Obstacle/Item Models
let barrierModel = null;
let wetFloorModel = null;
let barrelModel = null;
let coinModel = null;
let modelsReady = { barrier: false, wetFloor: false, barrel: false, coin: false };
const envProps = [];

// Reuse one loader instance
const gltfLoader = new GLTFLoader();

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
  mobile: document.getElementById("mobileControls"),
};

/* Collision helpers */
const _playerBox = new THREE.Box3();
const _tmpBox = new THREE.Box3();

/* =========================
   CACHE (performance)
========================= */
const cache = {
  obstacleGeo: new THREE.BoxGeometry(1.4, 1.4, 1.4),
  trainGeo: new THREE.BoxGeometry(1.6, 2.5, 12),
  barrierGeo: new THREE.BoxGeometry(2.4, 0.8, 0.4),

  obstacleMat: new THREE.MeshStandardMaterial({
    color: 0xef4444,
    roughness: 0.4,
    metalness: 0.2,
    emissive: new THREE.Color(0x2a0505),
    emissiveIntensity: 0.35,
  }),
  trainMat: new THREE.MeshStandardMaterial({
    color: 0x3b82f6,
    roughness: 0.3,
    metalness: 0.5,
    emissive: new THREE.Color(0x06102a),
    emissiveIntensity: 0.35,
  }),

  coinGeo: new THREE.TorusGeometry(0.35, 0.1, 12, 24),
  coinMat: new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    metalness: 0.95,
    roughness: 0.05,
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
};

init();
start();

/* =========================
   INIT
========================= */
function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(CFG.fogColor);
  scene.fog = new THREE.Fog(new THREE.Color(CFG.fogColor), CFG.fogNear, CFG.fogFar);

  camera = new THREE.PerspectiveCamera(CFG.baseFov, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, CFG.cameraY, CFG.cameraZ);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
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

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.28));

  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x0b0f1a, 1.15);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(7, 10, 6);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x7fc8ff, 0.95);
  rim.position.set(-9, 4, 2);
  scene.add(rim);

  loadTunnelModel();
  buildPlayer();
  buildSpeedLines();
  loadObstacleModels();

  setupInput();
  setupUI();

  clock = new THREE.Clock();
  window.addEventListener("resize", onResize);

  if (ui.best) ui.best.textContent = String(best);
  syncHud();
}

function loadTunnelModel() {
  gltfLoader.load(
    CFG.tunnelModelPath,
    (gltf) => {
      tunnelModel = gltf.scene;

      const box = new THREE.Box3().setFromObject(tunnelModel);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);

      console.log("Tunnel Model Size:", size.x, size.y, size.z);
      console.log("Tunnel Model Center:", center.x, center.y, center.z);

      // Adjust CFG to match the real model size
      CFG.segmentLen = size.z;
      CFG.segments = 3;

      tunnelModel.traverse((o) => {
        if (o.isMesh) {
          o.receiveShadow = true;
          o.castShadow = false;
          if (o.material) {
            o.material.side = THREE.DoubleSide;
          }
        }
      });

      // Center the model horizontally/vertically, align Z
      // We want the tunnel to extend from its start (max Z in local space usually)
      tunnelModel.position.set(-center.x, -box.min.y, -center.z);

      const wrapper = new THREE.Group();
      wrapper.add(tunnelModel);
      tunnelModel = wrapper;

      tunnelReady = true;
      buildTunnel();
      console.log("Tunnel GLB loaded OK. Adjusted segmentLen to:", CFG.segmentLen);
    },
    undefined,
    (err) => {
      console.error("Error loading tunnel GLB", err);
    }
  );
}

function buildTunnel() {
  if (!tunnelReady || !tunnelModel) return;

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

        currentAction = actions.idle || actions.run || mixer.clipAction(gltf.animations[0]);
        if (currentAction) currentAction.play();
      }
    },
    undefined,
    (err) => console.error("Error loading player GLB", err)
  );
}

/* =========================
   OBSTACLE MODELS
========================= */
function loadObstacleModels() {
  // Load Barrier
  gltfLoader.load(CFG.barrierModelPath, (gltf) => {
    barrierModel = gltf.scene;
    barrierModel.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    modelsReady.barrier = true;
    console.log("Barrier Model loaded OK");
  });

  // Load Wet Floor (Hurdle)
  gltfLoader.load(CFG.wetFloorModelPath, (gltf) => {
    wetFloorModel = gltf.scene;
    wetFloorModel.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    modelsReady.wetFloor = true;
    console.log("Wet Floor Model loaded OK");
  });

  // Load Barrel (Hurdle)
  gltfLoader.load(CFG.barrelModelPath, (gltf) => {
    barrelModel = gltf.scene;
    barrelModel.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    modelsReady.barrel = true;
    console.log("Barrel Model loaded OK");
  });

  // Load Coin
  gltfLoader.load(CFG.coinModelPath, (gltf) => {
    coinModel = gltf.scene;
    coinModel.traverse(o => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = true;
        if (o.material) o.material.metalness = 0.8;
      }
    });
    modelsReady.coin = true;
    console.log("Coin Model loaded OK");
  });
}

function updateEnvProps(dz) {
  for (let i = envProps.length - 1; i >= 0; i--) {
    const p = envProps[i];
    p.position.z += dz;

    if (p.position.z > CFG.propsDespawnZ) {
      scene.remove(p);
      envProps.splice(i, 1);
    }
  }
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
  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 120; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const w = 2 + Math.random() * 6;
    const h = 18 + Math.random() * 140;
    const a = 0.06 + Math.random() * 0.20;
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
  if (ui.startBtn) ui.startBtn.addEventListener("click", startCountdown);
  if (ui.restart) ui.restart.addEventListener("click", restartGame);

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

  tap(ui.leftBtn, () => changeLane(-1));
  tap(ui.rightBtn, () => changeLane(1));
  tap(ui.jumpBtn, jump);
}

function startCountdown() {
  ui.start.classList.add("hidden");
  ui.countdown.classList.remove("hidden");
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
      ui.countdown.classList.add("hidden");
      ui.hud.classList.remove("hidden");
      if (window.innerWidth < 900) ui.mobile.classList.remove("hidden");
      countingDown = false;
      gameStarted = true;

      if (playerVisual) playerVisual.rotation.y = Math.PI;
    }, 800);
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
    if (e.key === " " || e.key === "ArrowUp") jump();
  });
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

  if (gameStarted && !gameOver) {
    speed = Math.min(speed + CFG.speedRamp * dt, CFG.maxSpeed);
    const dz = speed * dt;
    distMoved += dz;

    updatePlayer(dt);
    updateAnimations();
    updateCamera(dt);
    updateTunnel(dz);

    _playerBox.setFromObject(playerRoot).expandByScalar(-CFG.obstacleHitPadding);

    updateSpawning();
    updateObstacles(dz);
    updateCoins(dz, dt);
    updateEnvProps(dz);

    score += dt * 7;
    syncHud();
  } else if (!gameStarted && !countingDown && !gameOver) {
    updateTunnel(dt * 0.2);
    updateAnimations();
  }

  if (shakeTime > 0) {
    shakeTime -= dt;
    const s = shakeIntensity;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
  }

  if (mixer) mixer.update(dt);

  // Particles animate always (even in game over)
  updateParticles(dt);

  composer.render();
}

/* =========================
   UPDATES
========================= */
function updatePlayer(dt) {
  const tx = CFG.lanes[targetLane];
  playerRoot.position.x = THREE.MathUtils.lerp(playerRoot.position.x, tx, CFG.laneLerp);

  if (!grounded) {
    velY -= CFG.gravity * dt;
    playerRoot.position.y += velY * dt;
    if (playerRoot.position.y <= 0) {
      playerRoot.position.y = 0;
      velY = 0;
      grounded = true;
    }
  }
}

function updateAnimations() {
  if (!mixer) return;

  let next;
  if (!gameStarted || gameOver) next = actions.idle;
  else if (!grounded) next = actions.jump;
  else if (speed > 0) next = actions.run;

  if (next && next !== currentAction) {
    const prev = currentAction;
    currentAction = next;
    if (prev) prev.fadeOut(0.15);
    currentAction.reset().fadeIn(0.15).play();
  }
}

function updateCamera(dt) {
  const s01 = THREE.MathUtils.clamp((speed - CFG.startSpeed) / (CFG.maxSpeed - CFG.startSpeed), 0, 1);
  const targetFov = THREE.MathUtils.lerp(CFG.baseFov, CFG.fovAtMaxSpeed, s01);
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.08);
  camera.updateProjectionMatrix();

  const bob = Math.sin(t * (speed * 0.15)) * CFG.camBob;

  const targetX = playerRoot.position.x * 0.25;
  const targetY = CFG.cameraY + bob;
  const targetZ = CFG.cameraZ;

  camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, CFG.camLag);
  camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, CFG.camLag);
  camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, CFG.camLag);

  const tilt = -(camera.position.x - targetX) * 0.15;
  camera.rotation.z = THREE.MathUtils.lerp(camera.rotation.z, tilt, 0.1);

  camera.lookAt(playerRoot.position.x * 0.18, CFG.camLookY, CFG.camLookZ);

  if (speedLinesMat) {
    const base = THREE.MathUtils.lerp(0.0, 0.55, s01);
    speedLinesMat.opacity = gameStarted && !gameOver ? base : 0.0;
    if (speedLinesMat.map) speedLinesMat.map.offset.y -= dt * (0.35 + s01 * 1.8);
  }

  if (bloomPass) bloomPass.strength = CFG.bloomStrength + s01 * 0.25;
}

function updateTunnel(dz) {
  for (const s of tunnelSegs) {
    s.position.z += dz;
    if (s.position.z > CFG.segmentLen) {
      s.position.z -= CFG.segmentLen * CFG.segments;
    }
  }
}

/* =========================
   SPAWNING
========================= */
function updateSpawning() {
  if (distMoved - lastSpawnDist < nextSpawnInterval) return;
  lastSpawnDist = distMoved;

  // Randomize distance to next wave for a natural feel
  nextSpawnInterval = CFG.spawnIntervalBase + Math.random() * CFG.spawnIntervalVariance;

  const z = CFG.spawnZ;
  const rand = Math.random();

  // Pick a challenge pattern
  if (rand < 0.20) spawnSingleHurdle(z);
  else if (rand < 0.40) spawnSegmentGate(z);
  else if (rand < 0.60) spawnSegmentZigZag(z);
  else if (rand < 0.80) spawnSegmentVault(z);
  else spawnSegmentString(z);

  if (Math.random() < CFG.magnetChance) {
    const lane = (Math.random() * 3) | 0;
    spawnMagnet(lane, z - 18);
  }
}

function spawnSingleHurdle(z) {
  const lane = (Math.random() * 3) | 0;
  spawnObstacle(lane, z);
  // Add some coins in other lanes or same lane
  for (let i = 0; i < 3; i++) {
    if (i === lane) continue;
    if (Math.random() > 0.5) {
      for (let j = 0; j < 4; j++) spawnCoin(i, z - j * 4);
    }
  }
}

function spawnSegmentGate(z) {
  const openLane = (Math.random() * 3) | 0;
  for (let i = 0; i < 3; i++) {
    if (i !== openLane) spawnObstacle(i, z);
    else for (let j = 0; j < 5; j++) spawnCoin(i, z - j * 3);
  }
}

function spawnSegmentZigZag(z) {
  let lane = (Math.random() * 3) | 0;
  for (let i = 0; i < 6; i++) {
    spawnCoin(lane, z - i * 6);
    spawnObstacle((lane + 1) % 3, z - i * 6 - 3);
    lane = (lane + 1) % 3;
  }
}

function spawnSegmentVault(z) {
  const lane = (Math.random() * 3) | 0;
  spawnObstacle(lane, z, true);
  for (let i = 0; i < 7; i++) {
    const r = i / 6;
    const y = Math.sin(r * Math.PI) * 3.5 + CFG.coinY;
    spawnCoin(lane, z - i * 2, y);
  }
}

function spawnSegmentString(z) {
  const lane = (Math.random() * 3) | 0;
  for (let i = 0; i < 12; i++) spawnCoin(lane, z - i * 2.5);
  spawnObstacle((lane + 1) % 3, z - 10, false, true);
  spawnObstacle((lane + 2) % 3, z - 20, true);
}

function spawnObstacle(laneIndex, z, isBarrier = false, isTrain = false) {
  let model = null;
  let scale = 1.0;
  let y = 0;

  if (isBarrier && modelsReady.barrier) {
    model = barrierModel.clone();
    scale = CFG.barrierScale;
    y = 0.02;
  } else if (!isTrain) {
    // Randomly pick between Wet Floor and Barrel for standard hurdles
    const useBarrel = Math.random() > 0.5;
    if (useBarrel && modelsReady.barrel) {
      model = barrelModel.clone();
      model.userData.isBarrel = true;
      scale = CFG.barrelScale;
      y = 0.02;
    } else if (modelsReady.wetFloor) {
      model = wetFloorModel.clone();
      scale = CFG.wetFloorScale;
      y = 0.02;
    }
  }

  // Fallback to procedural if models aren't ready or it's a train
  if (!model) {
    let geo = cache.obstacleGeo;
    let mat = cache.obstacleMat;
    y = CFG.obstacleY;

    if (isTrain) {
      geo = cache.trainGeo;
      mat = cache.trainMat;
      y = 1.25;
    } else if (isBarrier) {
      geo = cache.barrierGeo;
      y = 0.4;
    }
    model = new THREE.Mesh(geo, mat);
  } else {
    model.scale.setScalar(scale);
  }

  model.position.set(CFG.lanes[laneIndex], y, z);
  scene.add(model);
  obstacles.push(model);
}

function spawnCoin(laneIndex, z, y = CFG.coinY) {
  let c;
  if (modelsReady.coin) {
    c = coinModel.clone();
    c.scale.setScalar(CFG.coinScale);
  } else {
    c = new THREE.Mesh(cache.coinGeo, cache.coinMat);
  }
  c.position.set(CFG.lanes[laneIndex], y, z);
  c.userData.startY = y; // For floating animation
  scene.add(c);
  coins.push(c);
}

function spawnMagnet(laneIndex, z) {
  const m = new THREE.Mesh(cache.magnetGeo, cache.magnetMat);
  m.position.set(CFG.lanes[laneIndex], 1.25, z);
  m.rotation.x = Math.PI * 0.5;
  scene.add(m);
  magnets.push(m);
}

/* =========================
   MOVE + COLLISION
========================= */
function updateObstacles(dz) {
  obstacles = obstacles.filter((o) => {
    o.position.z += dz;

    _tmpBox.setFromObject(o);
    if (_playerBox.intersectsBox(_tmpBox)) {
      if (o.userData.isBarrel) {
        spawnExplosion(o.position.clone());
        scene.remove(o); // Remove the barrel so it "explodes"
      }
      endGame();
      return true;
    }

    if (o.position.z > CFG.despawnZ) {
      scene.remove(o);
      return false;
    }
    return true;
  });
}

function updateCoins(dz, dt) {
  const now = performance.now() / 1000;
  const magnetActive = now < magnetEndTime;

  coins = coins.filter((c) => {
    c.position.z += dz;
    c.rotation.y += dt * 3; // Standard rotation

    // Floating animation
    if (c.userData.startY !== undefined) {
      c.position.y = c.userData.startY + Math.sin(now * 4) * 0.2;
    }

    if (magnetActive) {
      const dir = playerRoot.position.clone().sub(c.position);
      const d = dir.length();
      if (d < CFG.magnetRadius) {
        dir.normalize();
        c.position.add(dir.multiplyScalar(CFG.magnetPullSpeed * dt));
      }
    }

    if (c.position.distanceTo(playerRoot.position) < CFG.coinPickupRadius) {
      coinCount++;
      score += 10;
      spawnParticles(c.position, 0xffd35a);
      scene.remove(c);
      return false;
    }

    if (c.position.z > CFG.despawnZ) {
      scene.remove(c);
      return false;
    }
    return true;
  });

  magnets = magnets.filter((m) => {
    m.position.z += dz;
    m.rotation.z += dt * 2.6;

    if (m.position.distanceTo(playerRoot.position) < 1.2) {
      magnetEndTime = now + CFG.magnetDuration;
      scene.remove(m);
      return false;
    }

    if (m.position.z > CFG.despawnZ) {
      scene.remove(m);
      return false;
    }
    return true;
  });
}

/* =========================
   GAME STATE
========================= */
function endGame() {
  gameOver = true;
  shakeTime = 0.4;
  shakeIntensity = 0.5;

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
    ui.hud.classList.add("hidden");
    ui.mobile.classList.add("hidden");
  }, 500);
}

function restartGame() {
  gameOver = false;
  gameStarted = false;
  if (ui.go) ui.go.classList.add("hidden");
  ui.start.classList.remove("hidden");

  speed = CFG.startSpeed;
  targetLane = 1;
  velY = 0;
  grounded = true;

  score = 0;
  coinCount = 0;
  magnetEndTime = 0;
  distMoved = 0;
  lastSpawnDist = -20;

  playerRoot.position.set(0, 0, 0);
  if (playerVisual) playerVisual.rotation.y = 0;

  for (const o of obstacles) scene.remove(o);
  for (const c of coins) scene.remove(c);
  for (const m of magnets) scene.remove(m);
  for (const p of particles) scene.remove(p);
  for (const ep of envProps) scene.remove(ep);

  obstacles.length = 0;
  coins.length = 0;
  magnets.length = 0;
  particles.length = 0;
  envProps.length = 0;

  syncHud();
}

function syncHud() {
  if (ui.score) ui.score.textContent = String(Math.floor(score));
  if (ui.coins) ui.coins.textContent = String(coinCount);
  if (ui.best) ui.best.textContent = String(best);
}

/* =========================
   INPUT HELPERS
========================= */
function changeLane(dir) {
  if (gameOver) return;
  targetLane = THREE.MathUtils.clamp(targetLane + dir, 0, CFG.lanes.length - 1);
}

function jump() {
  if (gameOver) return;
  if (!grounded) return;
  velY = CFG.jumpVelocity;
  grounded = false;
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
   PARTICLES
========================= */
function spawnParticles(pos, color) {
  const count = 14;
  for (let i = 0; i < count; i++) {
    const p = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 4, 4),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
    );
    p.position.copy(pos);
    const angle = Math.random() * Math.PI * 2;
    const force = 2 + Math.random() * 4;
    p.userData = {
      vel: new THREE.Vector3(
        Math.cos(angle) * force,
        (Math.random() * 2 + 1) * force * 0.5,
        Math.sin(angle) * force
      ),
      life: 1.0,
    };
    scene.add(p);
    particles.push(p);
  }
}

function spawnExplosion(pos) {
  const colors = [0xff4400, 0xffaa00, 0xffcc00, 0xffffff];
  const count = 60; // Increased count
  for (let i = 0; i < count; i++) {
    const color = colors[Math.floor(Math.random() * colors.length)];
    const p = new THREE.Mesh(
      new THREE.SphereGeometry(0.2 + Math.random() * 0.4, 4, 4), // Larger particles
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
    );
    p.position.copy(pos);

    // Spread in all directions
    const phi = Math.random() * Math.PI * 2;
    const theta = Math.random() * Math.PI;
    const force = 6 + Math.random() * 12; // Higher force

    p.userData = {
      vel: new THREE.Vector3(
        Math.sin(theta) * Math.cos(phi) * force,
        Math.sin(theta) * Math.sin(phi) * force,
        Math.cos(theta) * force
      ),
      life: 1.2 + Math.random() * 0.8, // Slightly longer life
    };
    scene.add(p);
    particles.push(p);
  }

  // Add a stronger flash
  const flash = new THREE.PointLight(0xffaa00, 20, 30);
  flash.position.copy(pos);
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 150);
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.userData.life -= dt * 2;
    if (p.userData.life <= 0) {
      scene.remove(p);
      particles.splice(i, 1);
      continue;
    }
    p.position.add(p.userData.vel.clone().multiplyScalar(dt));
    p.userData.vel.y -= 15 * dt;
    p.material.opacity = p.userData.life;
    p.scale.setScalar(p.userData.life);
  }
}