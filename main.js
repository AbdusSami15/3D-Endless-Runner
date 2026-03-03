import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/* =========================
   CONFIG
========================= */
const CFG = {
  lanes: [-2.5, 0, 2.5],
  laneLerp: 0.18,

  startSpeed: 12.5,
  maxSpeed: 26,
  speedRamp: 0.055,

  jumpVelocity: 9.2,
  gravity: 26.5,

  // Spawning
  spawnBase: 0.85,
  spawnJitter: 0.28,
  spawnZBase: -80,
  spawnZJitter: 20,

  // Fairness
  maxObstaclesPerWave: 2,
  obstacleY: 0.68,
  coinY: 1.12,

  // Pickup / collisions
  coinPickupRadius: 1.35,
  obstacleHitPadding: 0.08, // smaller = more strict

  // Magnet
  magnetChance: 0.14,
  magnetDuration: 7,
  magnetRadius: 5.5,
  magnetPullSpeed: 20,

  // World
  despawnZ: 18,

  // Look
  exposure: 1.55,
  cameraZ: 9.7,
  cameraY: 5.0,
  camLag: 0.10,
  camLookZ: -6.2,
  camLookY: 1.1,
  camBob: 0.06,

  // Tunnel
  tunnelHalfWidth: 5.8,
  tunnelHeight: 4.2,
  segmentLen: 18,
  segments: 14,
};

/* =========================
   GLOBALS
========================= */
let scene, camera, renderer, clock;
let playerRoot, playerVisual, mixer;

let speed = CFG.startSpeed;
let targetLane = 1;
let velY = 0;
let grounded = true;

let obstacles = [];
let coins = [];
let magnets = [];
let tunnelSegs = [];

let score = 0;
let best = Number(localStorage.getItem("best") || 0);
let coinCount = 0;

let magnetEndTime = 0;
let spawnTimer = 0;

let gameOver = false;
let t = 0;

const ui = {
  score: document.getElementById("score"),
  coins: document.getElementById("coins"),
  best: document.getElementById("best"),
  go: document.getElementById("gameOver"),
  finalScore: document.getElementById("finalScore"),
  finalBest: document.getElementById("finalBest"),
  restart: document.getElementById("restartBtn"),
  leftBtn: document.getElementById("leftBtn"),
  rightBtn: document.getElementById("rightBtn"),
  jumpBtn: document.getElementById("jumpBtn"),
};

/* Collision helpers */
const _playerBox = new THREE.Box3();
const _tmpBox = new THREE.Box3();

/* =========================
   CACHE (performance)
========================= */
const cache = {
  obstacleGeo: new THREE.BoxGeometry(1.35, 1.35, 1.35),
  obstacleMat: new THREE.MeshStandardMaterial({
    color: 0xe8f0ff,
    roughness: 0.55,
    metalness: 0.08,
    emissive: new THREE.Color(0x0a1222),
    emissiveIntensity: 0.35,
  }),

  coinGeo: new THREE.TorusGeometry(0.33, 0.12, 12, 20),
  coinMat: new THREE.MeshStandardMaterial({
    color: 0xffd35a,
    metalness: 0.78,
    roughness: 0.22,
    emissive: new THREE.Color(0x2c1f00),
    emissiveIntensity: 0.20,
  }),

  magnetGeo: new THREE.TorusGeometry(0.45, 0.16, 12, 20),
  magnetMat: new THREE.MeshStandardMaterial({
    color: 0xff5959,
    metalness: 0.5,
    roughness: 0.35,
    emissive: new THREE.Color(0x2a0606),
    emissiveIntensity: 0.30,
  }),
};

init();
start();

/* =========================
   INIT
========================= */
function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060b14);

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(0, CFG.cameraY, CFG.cameraZ);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = CFG.exposure;
  document.body.appendChild(renderer.domElement);

  // Lighting (no fog)
  scene.add(new THREE.AmbientLight(0xffffff, 0.38));

  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x0b0f1a, 1.25);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(7, 10, 6);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x7fc8ff, 0.85);
  rim.position.set(-9, 4, 2);
  scene.add(rim);

  buildTunnel();
  buildPlayer();
  setupInput();
  setupUI();

  clock = new THREE.Clock();
  window.addEventListener("resize", onResize);

  if (ui.best) ui.best.textContent = String(best);
  syncHud();
}

function buildTunnel() {
  const floorGeo = new THREE.PlaneGeometry(CFG.tunnelHalfWidth * 2, CFG.segmentLen);
  floorGeo.rotateX(-Math.PI / 2);

  const wallGeo = new THREE.PlaneGeometry(CFG.segmentLen, CFG.tunnelHeight);
  wallGeo.rotateY(Math.PI / 2);

  const ceilGeo = new THREE.PlaneGeometry(CFG.tunnelHalfWidth * 2, CFG.segmentLen);
  ceilGeo.rotateX(Math.PI / 2);

  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x121d34,
    roughness: 0.92,
    metalness: 0.05,
    emissive: new THREE.Color(0x070a12),
    emissiveIntensity: 0.7,
  });

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x0e1a32,
    roughness: 0.98,
    metalness: 0.02,
    emissive: new THREE.Color(0x05070d),
    emissiveIntensity: 0.9,
  });

  const ceilMat = new THREE.MeshStandardMaterial({
    color: 0x0a1020,
    roughness: 1.0,
    metalness: 0.0,
    emissive: new THREE.Color(0x03050a),
    emissiveIntensity: 0.8,
  });

  // neon strips (cheap, looks pro)
  const stripGeo = new THREE.PlaneGeometry(0.07, CFG.segmentLen);
  stripGeo.rotateX(-Math.PI / 2);
  const stripMat = new THREE.MeshBasicMaterial({ color: 0x39a8ff, transparent: true, opacity: 0.26 });

  const edgeGeo = new THREE.PlaneGeometry(0.06, CFG.segmentLen);
  edgeGeo.rotateY(Math.PI / 2);
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0xffd35a, transparent: true, opacity: 0.09 });

  for (let i = 0; i < CFG.segments; i++) {
    const z = -i * CFG.segmentLen;

    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(0, 0, z);

    const ceil = new THREE.Mesh(ceilGeo, ceilMat);
    ceil.position.set(0, CFG.tunnelHeight, z);

    const leftWall = new THREE.Mesh(wallGeo, wallMat);
    leftWall.position.set(-CFG.tunnelHalfWidth, CFG.tunnelHeight * 0.5, z);

    const rightWall = new THREE.Mesh(wallGeo, wallMat);
    rightWall.position.set(CFG.tunnelHalfWidth, CFG.tunnelHeight * 0.5, z);
    rightWall.scale.x = -1;

    const centerStrip = new THREE.Mesh(stripGeo, stripMat);
    centerStrip.position.set(0, 0.01, z);

    const leftEdge = new THREE.Mesh(edgeGeo, edgeMat);
    leftEdge.position.set(-CFG.tunnelHalfWidth + 0.03, 1.2, z);

    const rightEdge = new THREE.Mesh(edgeGeo, edgeMat);
    rightEdge.position.set(CFG.tunnelHalfWidth - 0.03, 1.2, z);
    rightEdge.scale.x = -1;

    scene.add(floor, ceil, leftWall, rightWall, centerStrip, leftEdge, rightEdge);

    tunnelSegs.push(floor, ceil, leftWall, rightWall, centerStrip, leftEdge, rightEdge);
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
  const loader = new GLTFLoader();
  loader.load(
    "models/player.glb",
    (gltf) => {
      playerRoot.remove(playerVisual);
      playerVisual = gltf.scene;
      playerVisual.position.set(0, 0, 0);
      playerRoot.add(playerVisual);

      if (gltf.animations && gltf.animations.length) {
        mixer = new THREE.AnimationMixer(playerVisual);
        mixer.clipAction(gltf.animations[0]).play();
      }
    },
    undefined,
    () => {}
  );
}

function setupUI() {
  if (ui.restart) ui.restart.addEventListener("click", restartGame);

  const tap = (el, fn) => {
    if (!el) return;
    el.addEventListener("touchstart", (e) => { e.preventDefault(); fn(); }, { passive: false });
    el.addEventListener("mousedown", (e) => { e.preventDefault(); fn(); });
  };

  tap(ui.leftBtn, () => changeLane(-1));
  tap(ui.rightBtn, () => changeLane(1));
  tap(ui.jumpBtn, jump);
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

  if (!gameOver) {
    speed = Math.min(speed + CFG.speedRamp * dt, CFG.maxSpeed);

    updatePlayer(dt);
    updateCamera(dt);
    updateTunnel(dt);

    // Player bounds once per frame
    _playerBox.setFromObject(playerRoot).expandByScalar(-CFG.obstacleHitPadding);

    updateSpawning(dt);
    updateObstacles(dt);
    updateCoins(dt);

    score += dt * 7;
    syncHud();
  }

  if (mixer) mixer.update(dt);
  renderer.render(scene, camera);
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

function updateCamera(dt) {
  const bob = Math.sin(t * (speed * 0.12)) * CFG.camBob;

  const desiredX = playerRoot.position.x * 0.22;
  const desiredY = CFG.cameraY + bob;
  const desiredZ = CFG.cameraZ;

  camera.position.x = THREE.MathUtils.lerp(camera.position.x, desiredX, CFG.camLag);
  camera.position.y = THREE.MathUtils.lerp(camera.position.y, desiredY, CFG.camLag);
  camera.position.z = THREE.MathUtils.lerp(camera.position.z, desiredZ, CFG.camLag);

  camera.lookAt(playerRoot.position.x * 0.16, CFG.camLookY, CFG.camLookZ);
}

function updateTunnel(dt) {
  const dz = speed * dt;
  for (const s of tunnelSegs) {
    s.position.z += dz;
    if (s.position.z > CFG.segmentLen) {
      s.position.z -= CFG.segmentLen * CFG.segments;
    }
  }
}

/* =========================
   SPAWNING (FIXED!)
   Problem before: baseZ constant -> gaps blocked
   Now: spawnZ random each wave -> spacing works
========================= */
function updateSpawning(dt) {
  spawnTimer += dt;
  const interval = CFG.spawnBase + Math.random() * CFG.spawnJitter;
  if (spawnTimer < interval) return;
  spawnTimer = 0;

  const spawnZ = CFG.spawnZBase - Math.random() * CFG.spawnZJitter;

  // Obstacles (1 or 2 max, never full wall)
  const lanes = [0, 1, 2];
  shuffleInPlace(lanes);

  const count = 1 + (Math.random() < 0.28 ? 1 : 0);
  const spawnCount = Math.min(count, CFG.maxObstaclesPerWave);

  for (let i = 0; i < spawnCount; i++) {
    spawnObstacle(lanes[i], spawnZ);
  }

  // Coins patterns (spread; no overlap)
  const pattern = (Math.random() * 3) | 0;

  if (pattern === 0) {
    const li = (Math.random() * 3) | 0;
    for (let i = 0; i < 9; i++) spawnCoin(li, spawnZ - i * 2.4);
  } else if (pattern === 1) {
    const start = (Math.random() * 3) | 0;
    for (let i = 0; i < 9; i++) spawnCoin((start + i) % 3, spawnZ - i * 2.35);
  } else {
    for (let i = 0; i < 9; i++) spawnCoin(i % 3, spawnZ - i * 2.45);
  }

  // Magnet (rare)
  if (Math.random() < CFG.magnetChance) {
    const li = (Math.random() * 3) | 0;
    spawnMagnet(li, spawnZ - 6);
  }
}

function spawnObstacle(laneIndex, z) {
  const o = new THREE.Mesh(cache.obstacleGeo, cache.obstacleMat);
  o.position.set(CFG.lanes[laneIndex], CFG.obstacleY, z);
  scene.add(o);
  obstacles.push(o);
}

function spawnCoin(laneIndex, z) {
  const c = new THREE.Mesh(cache.coinGeo, cache.coinMat);
  c.position.set(
    CFG.lanes[laneIndex] + (Math.random() - 0.5) * 0.12,
    CFG.coinY + (Math.random() - 0.5) * 0.05,
    z
  );
  c.rotation.x = Math.PI * 0.5;
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
function updateObstacles(dt) {
  const dz = speed * dt;

  obstacles = obstacles.filter((o) => {
    o.position.z += dz;

    _tmpBox.setFromObject(o);
    if (_playerBox.intersectsBox(_tmpBox)) {
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

function updateCoins(dt) {
  const dz = speed * dt;
  const now = performance.now() / 1000;
  const magnetActive = now < magnetEndTime;

  coins = coins.filter((c) => {
    c.position.z += dz;
    c.rotation.z += dt * 5;

    if (magnetActive) {
      const dir = playerRoot.position.clone().sub(c.position);
      const d = dir.length();
      if (d < CFG.magnetRadius) {
        dir.normalize();
        c.position.add(dir.multiplyScalar(CFG.magnetPullSpeed * dt));
      }
    }

    // Pickup (radius bigger => guaranteed)
    if (c.position.distanceTo(playerRoot.position) < CFG.coinPickupRadius) {
      coinCount++;
      score += 10;
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

  const final = Math.floor(score);
  if (final > best) {
    best = final;
    localStorage.setItem("best", String(best));
  }

  if (ui.finalScore) ui.finalScore.textContent = String(final);
  if (ui.finalBest) ui.finalBest.textContent = String(best);
  if (ui.best) ui.best.textContent = String(best);

  if (ui.go) ui.go.classList.remove("hidden");
}

function restartGame() {
  gameOver = false;
  if (ui.go) ui.go.classList.add("hidden");

  speed = CFG.startSpeed;
  targetLane = 1;
  velY = 0;
  grounded = true;

  score = 0;
  coinCount = 0;
  magnetEndTime = 0;
  spawnTimer = 0;

  playerRoot.position.set(0, 0, 0);

  for (const o of obstacles) scene.remove(o);
  for (const c of coins) scene.remove(c);
  for (const m of magnets) scene.remove(m);

  obstacles.length = 0;
  coins.length = 0;
  magnets.length = 0;

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
}

/* =========================
   UTILS
========================= */
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
}
