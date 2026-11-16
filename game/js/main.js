// EMBERLINE — main.js: boot, the fixed-step loop, round orchestration, the
// bomb objective, the buy economy, grenades, the viewmodel gun and the
// deterministic ?shot= capture modes. The simulation runs at 60 Hz, apart
// from rendering; the DOM is touched only through hud.js.
import * as THREE from 'three';
import {
  createMatch, mulberry32, clamp, lerp, ROUND_TIME, BUY_TIME, PLANT_TIME,
  DEFUSE_TIME, BOMB_FUSE, START_MONEY, WIN_MONEY, LOSS_MONEY, KILL_MONEY,
} from './state.js';
import { createMap, SPAWNS, SITES } from './map.js';
import { createFighter, respawnFighter, moveFighter, createInput, wishFromKeys, clampPitch } from './player.js';
import { createBots, assignRound, stepBots, hearShot } from './bots.js';
import { WEAPONS, GRENADES, ARMOUR_PRICE, newWeaponState, fireShot, throwGrenade, stepGrenades, createTracers, spreadNow } from './weapons.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = shot ? mulberry32(seed) : mulberry32((Date.now() % 2147483647) | 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2b2f4d);
scene.fog = new THREE.Fog(0x2b2f4d, 30, 85);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const map = createMap(scene);
const audio = createAudio();
const hud = createHud();
const tracers = createTracers(scene);

const player = createFighter('ember', 'You', true);
player.money = START_MONEY;
const bots = createBots(scene, map);
const fighters = [player, ...bots];
const match = createMatch();
const grenades = [];
const smokes = []; // {x,y,z,r,life,mesh}
const input = createInput(renderer.domElement, {
  onKeyDown: (code) => {
    if (match.phase !== 'live' || !player.alive) return;
    if (code === 'KeyR') startReload();
    if (code === 'KeyB') toggleBuy();
    if (code === 'KeyG') throwPlayerGrenade();
    if (code === 'Digit1') switchWeapon(0);
    if (code === 'Digit2') switchWeapon(1);
    if (code === 'Digit3') buyItem('frag');
    if (code === 'Digit4') buyItem('smoke');
    if (code === 'Digit5') buyItem('armour');
  },
  onLockChange: (locked) => {
    if (shot) return;
    if (locked) {
      audio.unlock();
      hud.hideOverlay();
      if (match.phase === 'menu') startMatch();
    } else if (match.phase === 'live') {
      hud.showOverlay('paused');
    }
  },
});

// --- Viewmodel gun: boxes on the camera, kicked by recoil, centred on ADS.
const gun = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d24, roughness: 0.4, metalness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff7a2f, roughness: 0.5, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.5), dark);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.34), dark);
  barrel.position.set(0, 0.03, -0.38);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.09), dark);
  grip.position.set(0, -0.12, 0.12);
  grip.rotation.x = 0.3;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), accent);
  sight.position.set(0, 0.09, -0.05);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.1), dark);
  mag.position.set(0, -0.12, -0.05);
  gun.add(body, barrel, grip, sight, mag);
}
gun.position.set(0.28, -0.24, -0.5);
camera.add(gun);
const muzzle = new THREE.Mesh(
  new THREE.PlaneGeometry(0.22, 0.22),
  new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
);
muzzle.position.set(0, 0.03, -0.6);
gun.add(muzzle);
let gunKick = 0;
let muzzleTimer = 0;
let shake = 0;

// --- The planted charge: a small box with a blinking lamp.
const bombMesh = new THREE.Group();
{
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x2a2d38, roughness: 0.5, metalness: 0.4 }));
  box.castShadow = true;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2d2d }));
  lamp.position.set(0.18, 0.18, 0);
  bombMesh.add(box, lamp);
  bombMesh.userData.lamp = lamp;
}
bombMesh.visible = false;
scene.add(bombMesh);

// --- Explosion flash: an expanding sphere, reused.
const blastMesh = new THREE.Mesh(
  new THREE.SphereGeometry(1, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0xff8a2f, transparent: true, opacity: 0, depthWrite: false }),
);
scene.add(blastMesh);
const blastLight = new THREE.PointLight(0xff8a2f, 0, 26, 1.5);
scene.add(blastLight);
let blastTimer = 0;

// --- Round setup -----------------------------------------------------------
function resetFighters() {
  respawnFighter(player, SPAWNS.ember[0]);
  bots.forEach((b, i) => {
    const spawn = b.team === 'ember' ? SPAWNS.ember[1 + (i % 3)] : SPAWNS.ash[i % 4];
    respawnFighter(b, spawn);
  });
  grenades.length = 0;
  for (const s of smokes) scene.remove(s.mesh);
  smokes.length = 0;
  bombMesh.visible = false;
  blastTimer = 0;
  match.bomb.state = 'carried';
  match.bomb.site = null;
  match.bomb.timer = 0;
}

function startMatch() {
  match.started = true;
  match.round = 1;
  match.scoreEmber = 0;
  match.scoreAsh = 0;
  player.money = START_MONEY;
  player.weaponsOwned = ['pistol'];
  player.grenades = { frag: 0, smoke: 0 };
  player.armour = 0;
  beginRound();
}

function beginRound() {
  resetFighters();
  assignRound(bots, player, map, random, match);
  match.phase = 'buy';
  match.phaseTime = 0;
  match.roundTime = ROUND_TIME;
  match.winner = null;
  match.winReason = '';
  hud.hideBanner();
  hud.setScore(match.scoreEmber, match.scoreAsh);
  hud.setMoney(player.money);
  hud.setHealth(player.hp);
  hud.setAmmo(player.weapon.mag, player.weapon.reserve, WEAPONS[player.weapon.id].name);
  // Free the mouse so the shop is clickable; Deploy (or B + click) locks it back.
  input.releaseLock();
  hud.showBuy(match.round, player.money, player.weaponsOwned, player.grenades, player.armour > 0);
  hud.setHint('Buy phase — press B for the shop, then the round starts');
  hud.setBomb('');
  hud.setBombPrompt(null);
}

function endRound(winner, reason) {
  if (match.phase === 'end') return;
  match.phase = 'end';
  match.phaseTime = 0;
  match.winner = winner;
  match.winReason = reason;
  if (winner === 'ember') match.scoreEmber += 1;
  else match.scoreAsh += 1;
  player.money += winner === 'ember' ? WIN_MONEY : LOSS_MONEY;
  hud.setScore(match.scoreEmber, match.scoreAsh);
  hud.setMoney(player.money);
  hud.hideBuy();
  hud.setBombPrompt(null);
  input.releaseLock();
  const won = winner === 'ember';
  hud.banner(won ? 'ROUND WON' : 'ROUND LOST', reason, won ? 'win' : 'lose');
  if (won) audio.roundWin(); else audio.roundLose();
  if (!player.alive) hud.setHint('You are down — next round starts soon');
}

function nextRound() {
  match.round += 1;
  beginRound();
  hud.setHint('Buy phase — press B for the shop, then the round starts');
}

// --- Combat ----------------------------------------------------------------
function applyDamage(victim, damage, attacker, headshot) {
  if (!victim.alive || match.phase !== 'live') return;
  let dmg = damage;
  if (victim.armour > 0) {
    const absorbed = Math.min(victim.armour, Math.round(dmg / 2));
    victim.armour -= absorbed;
    dmg -= absorbed;
  }
  victim.hp -= dmg;
  if (victim.isPlayer) audio.hurt();
  if (victim.hp > 0) return;
  victim.hp = 0;
  victim.alive = false;
  if (victim.mesh) victim.mesh.visible = false;
  const killer = attacker ? attacker.name : 'the blast';
  const text = `${killer} ⌖ ${victim.name}${headshot ? ' ☠' : ''}`;
  hud.killFeed(text, headshot);
  if (attacker && attacker.isPlayer) {
    player.money += KILL_MONEY;
    hud.setMoney(player.money);
    hud.hitMarker(true);
    audio.kill();
  }
  if (victim.isPlayer) {
    input.stopFiring();
    input.releaseLock();
    hud.setHint('You are down — spectating your team');
    transferBomb();
  }
  checkRoundEnd();
}

function transferBomb() {
  if (match.bomb.state !== 'carried') return;
  const alive = bots.filter((b) => b.team === 'ember' && b.alive);
  if (alive.length === 0) return;
  let best = alive[0];
  let bd = Infinity;
  for (const b of alive) {
    const d = (b.pos.x - player.pos.x) ** 2 + (b.pos.z - player.pos.z) ** 2;
    if (d < bd) { bd = d; best = b; }
  }
  best.bombCarrier = true;
  hud.killFeed('Charge passed to ' + best.name, false);
}

function checkRoundEnd() {
  if (match.phase !== 'live') return;
  const emberAlive = fighters.filter((f) => f.team === 'ember' && f.alive).length;
  const ashAlive = fighters.filter((f) => f.team === 'ash' && f.alive).length;
  if (ashAlive === 0) endRound('ember', 'Ash team eliminated');
  else if (emberAlive === 0) endRound('ash', 'Ember team eliminated');
}

function playerShoot() {
  const w = player.weapon;
  if (w.cooldown > 0 || w.reloading > 0) return;
  if (w.mag <= 0) { audio.dryClick(); startReload(); return; }
  const shotResult = fireShot(player, bots, map, random);
  if (!shotResult) return;
  gunKick = 1;
  muzzleTimer = 0.05;
  muzzle.material.opacity = 0.9;
  audio.shot(player.weapon.id);
  const from = camera.position.clone();
  from.y -= 0.12;
  tracers.spawn(from, shotResult.point, shotResult.tracer);
  if (shotResult.hit) {
    hud.hitMarker(false);
    audio.hit(shotResult.headshot);
    applyDamage(shotResult.victim, shotResult.damage, player, shotResult.headshot);
  }
  // Recoil: pitch up, a whisper of yaw.
  player.pitch += WEAPONS[player.weapon.id].recoil * (player.weapon.ads ? 0.6 : 1);
  player.yaw += (random() * 2 - 1) * WEAPONS[player.weapon.id].recoil * 0.35;
  clampPitch(player);
  hearShot(bots, player.pos.x, player.pos.z, 'ember', map);
  hud.setAmmo(w.mag, w.reserve, WEAPONS[w.id].name);
}

function startReload() {
  const w = player.weapon;
  const def = WEAPONS[w.id];
  if (w.reloading > 0 || w.mag >= def.mag || w.reserve <= 0) return;
  w.reloading = def.reloadTime;
  audio.reload();
}

function switchWeapon(index) {
  const id = player.weaponsOwned[index];
  if (!id || player.weapon.id === id) return;
  player.weapon = newWeaponState(id);
  hud.setAmmo(player.weapon.mag, player.weapon.reserve, WEAPONS[id].name);
}

function buyItem(id) {
  if (match.phase !== 'buy') return;
  if (id === 'rifle' || id === 'smg') {
    const def = WEAPONS[id];
    if (player.weaponsOwned.includes(id) || player.money < def.price) return;
    player.money -= def.price;
    player.weaponsOwned.push(id);
    player.weapon = newWeaponState(id);
  } else if (id === 'frag' || id === 'smoke') {
    const def = GRENADES[id];
    if (player.money < def.price) return;
    player.money -= def.price;
    player.grenades[id] += 1;
  } else if (id === 'armour') {
    if (player.armour > 0 || player.money < ARMOUR_PRICE) return;
    player.money -= ARMOUR_PRICE;
    player.armour = 100;
  }
  hud.setMoney(player.money);
  hud.setAmmo(player.weapon.mag, player.weapon.reserve, WEAPONS[player.weapon.id].name);
  hud.showBuy(match.round, player.money, player.weaponsOwned, player.grenades, player.armour > 0);
  audio.beep(false);
}

function toggleBuy() {
  if (match.phase !== 'buy') return;
  if (hud.els.buy.hidden) hud.showBuy(match.round, player.money, player.weaponsOwned, player.grenades, player.armour > 0);
  else hud.hideBuy();
}

function throwPlayerGrenade() {
  if (match.phase !== 'live' || !player.alive) return;
  const kind = player.grenades.frag > 0 ? 'frag' : player.grenades.smoke > 0 ? 'smoke' : null;
  if (!kind) return;
  player.grenades[kind] -= 1;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x1c1e26, roughness: 0.4, metalness: 0.6 }));
  mesh.position.copy(player.pos).y += 1.4;
  scene.add(mesh);
  throwGrenade(kind, player.pos, player.yaw, player.pitch, grenades);
  grenades[grenades.length - 1].mesh = mesh;
}

function explodeGrenade(g) {
  if (g.mesh) scene.remove(g.mesh);
  if (g.kind === 'frag') {
    audio.explosion();
    blastMesh.position.set(g.x, g.y + 0.4, g.z);
    blastMesh.material.opacity = 0.55;
    blastLight.position.set(g.x, g.y + 1, g.z);
    blastLight.intensity = 60;
    blastTimer = 0.45;
    if (Math.hypot(player.pos.x - g.x, player.pos.z - g.z) < 14) shake = 0.35;
  } else {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0x9aa3b5, transparent: true, opacity: 0.42, depthWrite: false }));
    mesh.position.set(g.x, 1.6, g.z);
    mesh.scale.setScalar(0.5);
    scene.add(mesh);
    smokes.push({ x: g.x, y: 1.6, z: g.z, r: 5, life: 10, mesh });
  }
}

function explodeBomb() {
  const b = match.bomb;
  audio.explosion();
  blastMesh.position.set(b.x, b.y + 0.5, b.z);
  blastMesh.material.opacity = 0.8;
  blastLight.position.set(b.x, b.y + 1, b.z);
  blastLight.intensity = 120;
  blastTimer = 0.7;
  shake = 0.6;
  bombMesh.visible = false;
  for (const f of fighters) {
    if (!f.alive) continue;
    const d = Math.hypot(f.pos.x - b.x, (f.pos.y + 0.9) - b.y, f.pos.z - b.z);
    if (d < 13) f.pendingDamage = (f.pendingDamage || 0) + Math.round(160 * (1 - (d / 13) * 0.6));
  }
  match.bomb.state = 'detonated';
  endRound('ember', `Charge detonated at Site ${b.site}`);
}

// Smoke blocks bot sight: a segment through a live smoke cloud is blind.
function smokeBlocks(x1, y1, z1, x2, y2, z2) {
  for (const s of smokes) {
    if (s.life <= 0) continue;
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    const len2 = dx * dx + dy * dy + dz * dz;
    const t = len2 > 0 ? clamp(((s.x - x1) * dx + (s.y - y1) * dy + (s.z - z1) * dz) / len2, 0, 1) : 0;
    const px = x1 + dx * t, py = y1 + dy * t, pz = z1 + dz * t;
    if (Math.hypot(px - s.x, py - s.y, pz - s.z) < s.r) return true;
  }
  return false;
}

// --- Bot event wiring --------------------------------------------------------
const botEvents = {
  onShot(bot, shotResult) {
    audio.distantShot();
    const from = { x: bot.pos.x, y: bot.pos.y + bot.eye, z: bot.pos.z };
    tracers.spawn(from, shotResult.point, shotResult.tracer);
    if (shotResult.hit) applyDamage(shotResult.victim, shotResult.damage, bot, shotResult.headshot);
    hearShot(bots, bot.pos.x, bot.pos.z, bot.team, map);
  },
  onStep(bot) {
    if (Math.hypot(bot.pos.x - player.pos.x, bot.pos.z - player.pos.z) < 12) audio.step();
  },
  onPlantProgress(bot, frac) {
    if (bot.isPlayer) return;
    hud.setBomb(`PLANTING — ${bot.name} at Site ${map.siteAt(bot.pos.x, bot.pos.z)}`);
  },
  onPlanted(bot, site) {
    hud.killFeed(`${bot.name} planted the charge — Site ${site}`, false);
    hud.setBomb(`BOMB PLANTED — SITE ${site}`);
    bombMesh.visible = true;
    bombMesh.position.set(match.bomb.x, match.bomb.y + 0.15, match.bomb.z);
    audio.plant();
  },
  onDefuseProgress(bot, frac) {
    hud.setBomb(`DEFUSING — ${bot.name}…`);
  },
  onDefused(bot) {
    hud.killFeed(`${bot.name} defused the charge`, false);
    match.bomb.state = 'defused';
    bombMesh.visible = false;
    endRound('ash', 'Charge defused');
  },
  blocksSight: smokeBlocks,
};

// --- Simulation step ---------------------------------------------------------
const _wish = { x: 0, z: 0 };
let prevFiring = false;
let plantProgress = 0;
let plantTick = 0;
let lastBeep = 0;

function step(dt) {
  match.phaseTime += dt;
  if (match.phase === 'buy') {
    match.roundTime = BUY_TIME - match.phaseTime;
    hud.setTimer(Math.max(0, match.roundTime), false);
    if (match.phaseTime >= BUY_TIME) {
      match.phase = 'live';
      match.phaseTime = 0;
      match.roundTime = ROUND_TIME;
      hud.hideBuy();
      // If the player never deployed, offer the pause screen to click back in.
      if (!input.locked) hud.showOverlay('paused');
      hud.setHint(player.bombCarrier ? 'You carry the charge — plant at Site A or B' : 'Defend the sites — do not let them plant');
    }
    return;
  }
  if (match.phase !== 'live') {
    if (match.phase === 'end' && match.phaseTime >= 5) nextRound();
    return;
  }

  match.roundTime -= dt;
  hud.setTimer(match.roundTime, match.roundTime <= 15);
  if (match.roundTime <= 0) {
    if (match.bomb.state === 'planted') {
      // Fuse outlives the clock: the bomb still decides the round.
    } else {
      endRound('ash', 'Time expired — Ash holds the harbor');
      return;
    }
  }

  // Bomb fuse.
  if (match.bomb.state === 'planted') {
    match.bomb.timer -= dt;
    const left = Math.max(0, match.bomb.timer);
    hud.setBomb(`BOMB ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')} — SITE ${match.bomb.site}`);
    const interval = left > 20 ? 1.0 : left > 10 ? 0.6 : 0.35;
    if (match.phaseTime - lastBeep >= interval) {
      lastBeep = match.phaseTime;
      audio.beep(left <= 10);
    }
    if (bombMesh.visible) bombMesh.userData.lamp.material.color.setHex(Math.sin(match.phaseTime * 10) > 0 ? 0xff2d2d : 0x550000);
    if (match.bomb.timer <= 0) { explodeBomb(); return; }
  }

  // --- Player.
  if (player.alive) {
    const look = input.takeLook();
    player.yaw -= look.x * 0.0022;
    player.pitch -= look.y * 0.0022;
    clampPitch(player);
    wishFromKeys(input.keys, player.yaw, _wish);
    player.crouch = input.keys.has('ControlLeft') || input.keys.has('ControlRight');
    const wantJump = input.keys.has('Space');
    moveFighter(player, dt, _wish.x, _wish.z, wantJump, map);
    player.weapon.ads = input.aiming && player.weapon.reloading <= 0;

    // Firing: auto weapons hold, semi weapons fire on the press edge.
    const def = WEAPONS[player.weapon.id];
    if (input.firing && (def.auto || !prevFiring)) playerShoot();
    prevFiring = input.firing;

    // Reload timing.
    if (player.weapon.reloading > 0) {
      player.weapon.reloading -= dt;
      if (player.weapon.reloading <= 0) {
        const need = def.mag - player.weapon.mag;
        const take = Math.min(need, player.weapon.reserve);
        player.weapon.mag += take;
        player.weapon.reserve -= take;
        hud.setAmmo(player.weapon.mag, player.weapon.reserve, def.name);
      }
    }
    player.weapon.cooldown = Math.max(0, player.weapon.cooldown - dt);

    // Planting: hold E on a site while carrying the charge.
    const site = map.siteAt(player.pos.x, player.pos.z);
    if (player.bombCarrier && site && match.bomb.state === 'carried') {
      hud.setBombPrompt(plantProgress > 0 ? 'planting' : 'plant');
      if (input.keys.has('KeyE')) {
        plantProgress += dt;
        plantTick += dt;
        if (plantTick >= 0.5) { plantTick = 0; audio.beep(false); }
        hud.setPlantProgress(plantProgress / PLANT_TIME);
        if (plantProgress >= PLANT_TIME) {
          match.bomb.state = 'planted';
          match.bomb.site = site;
          match.bomb.timer = BOMB_FUSE;
          match.bomb.x = player.pos.x; match.bomb.y = player.pos.y; match.bomb.z = player.pos.z;
          player.bombCarrier = false;
          plantProgress = 0;
          hud.setBombPrompt(null);
          botEvents.onPlanted(player, site);
        }
      } else {
        plantProgress = Math.max(0, plantProgress - dt * 2);
        hud.setPlantProgress(plantProgress / PLANT_TIME);
      }
    } else {
      plantProgress = 0;
      if (match.bomb.state !== 'planted') hud.setBombPrompt(null);
    }

    // Footsteps.
    if (player.speed > 1.5) {
      player.stepTimer -= dt * player.speed;
      if (player.stepTimer <= 0) { player.stepTimer = 0.6; audio.step(); }
    }
    hud.setHealth(player.hp);
    hud.setSpread(spreadNow(player));
  } else {
    prevFiring = false;
  }

  // --- Bots, grenades, blast damage.
  stepBots(bots, fighters, map, match, random, dt, botEvents);
  stepGrenades(grenades, dt, map, fighters, explodeGrenade);
  for (const f of fighters) {
    if (f.pendingDamage > 0 && f.alive) {
      const dmg = f.pendingDamage;
      f.pendingDamage = 0;
      applyDamage(f, dmg, null, false);
    }
  }
  for (let i = smokes.length - 1; i >= 0; i -= 1) {
    const s = smokes[i];
    s.life -= dt;
    s.mesh.scale.setScalar(Math.min(5, s.mesh.scale.x + dt * 2.5));
    s.mesh.material.opacity = clamp(s.life / 3, 0, 1) * 0.42;
    if (s.life <= 0) { scene.remove(s.mesh); smokes.splice(i, 1); }
  }
  if (blastTimer > 0) {
    blastTimer -= dt;
    const k = Math.max(0, blastTimer / 0.7);
    blastMesh.scale.setScalar(1 + (1 - k) * 9);
    blastMesh.material.opacity = 0.55 * k;
    blastLight.intensity = 90 * k;
    if (blastTimer <= 0) { blastMesh.material.opacity = 0; blastLight.intensity = 0; }
  }

  // HUD: alive counts, ammo, money.
  const emberAlive = fighters.filter((f) => f.team === 'ember' && f.alive).length;
  const ashAlive = fighters.filter((f) => f.team === 'ash' && f.alive).length;
  hud.setAlive(emberAlive, ashAlive);
  hud.setAmmo(player.weapon.mag, player.weapon.reserve, WEAPONS[player.weapon.id].name);
  if (match.bomb.state === 'carried' && player.bombCarrier) hud.setBomb('YOU CARRY THE CHARGE');
}

// --- Render ------------------------------------------------------------------
const _shake = { x: 0, y: 0 };
function syncCamera() {
  camera.position.set(player.pos.x, player.pos.y + player.eye, player.pos.z);
  if (shake > 0) {
    _shake.x = (random() * 2 - 1) * shake * 0.08;
    _shake.y = (random() * 2 - 1) * shake * 0.08;
  } else { _shake.x = 0; _shake.y = 0; }
  camera.rotation.set(player.pitch + _shake.y, player.yaw + _shake.x, 0, 'YXZ');
  // Viewmodel: recoil kick, ADS centring, walk sway.
  gunKick = lerp(gunKick, 0, 0.25);
  muzzleTimer = Math.max(0, muzzleTimer - 0.016);
  if (muzzleTimer <= 0) muzzle.material.opacity = 0;
  const ads = player.weapon.ads ? 1 : 0;
  gun.position.x = lerp(0.28, 0, ads);
  gun.position.y = lerp(-0.24, -0.185, ads) + Math.sin(performance.now() * 0.004) * 0.003 * Math.min(1, player.speed / 5);
  gun.position.z = -0.5 + gunKick * 0.09;
  gun.rotation.x = gunKick * 0.14;
  const targetFov = player.weapon.ads ? 55 : 74;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov = lerp(camera.fov, targetFov, 0.2);
    camera.updateProjectionMatrix();
  }
}

let frozen = false;
let accumulator = 0;
let lastTime = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    shake = Math.max(0, shake - dt * 1.4);
    if (match.phase === 'live' || match.phase === 'buy' || match.phase === 'end') {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 5) {
        step(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (accumulator > FIXED_STEP * 5) accumulator = 0;
    }
    tracers.step(dt);
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function aimAt(x, y, z) {
  const dx = x - player.pos.x;
  const dy = y - (player.pos.y + player.eye);
  const dz = z - player.pos.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = Math.asin(clamp(dy / len, -1, 1));
  syncCamera();
}

// --- Deterministic capture modes ---------------------------------------------
function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  resetFighters();
  assignRound(bots, player, map, random, match);
  match.started = true;
  match.round = 1;
  if (name === 'start') {
    // South yard at dusk, looking north across the mid container stack.
    player.pos.set(-6, 0, 19);
    player.yaw = -0.2;
    player.pitch = 0.02;
    match.phase = 'buy';
    match.phaseTime = 0;
    match.roundTime = BUY_TIME;
    hud.showOverlay('start');
    hud.setScore(0, 0);
    hud.setAlive(4, 4);
    hud.setHealth(100);
    hud.setMoney(START_MONEY);
    hud.setAmmo(12, 36, 'P9 SIDEARM');
    hud.setTimer(BUY_TIME, false);
    hud.setHint('');
    settle(30);
  } else if (name === 'play') {
    // Mid-round firefight: two Ash bots in the open mid lane, one down already.
    match.phase = 'live';
    match.phaseTime = 0;
    match.roundTime = 62;
    player.pos.set(-6, 0, 8);
    player.yaw = 0;
    player.pitch = 0;
    player.weapon = newWeaponState('rifle');
    player.hp = 82;
    const ash = bots.filter((b) => b.team === 'ash');
    ash[0].pos.set(2, 0, -2); ash[0].yaw = Math.PI; ash[0].bot.mode = 'hold'; ash[0].bot.holdTimer = 30;
    ash[1].pos.set(5, 0, 3); ash[1].yaw = Math.PI * 0.8; ash[1].bot.mode = 'hold'; ash[1].bot.holdTimer = 30;
    ash[2].pos.set(-2, 0, -8); ash[2].yaw = Math.PI; ash[2].bot.mode = 'hold'; ash[2].bot.holdTimer = 30;
    ash[3].pos.set(8, 0, -6); ash[3].alive = false; ash[3].mesh.visible = false;
    const ember = bots.filter((b) => b.team === 'ember');
    ember[0].pos.set(-10, 0, 4); ember[0].bot.mode = 'hold'; ember[0].bot.holdTimer = 30;
    ember[1].pos.set(-4, 0, 12); ember[1].bot.mode = 'hold'; ember[1].bot.holdTimer = 30;
    ember[2].pos.set(-12, 0, 10); ember[2].bot.mode = 'hold'; ember[2].bot.holdTimer = 30;
    hud.setScore(1, 0);
    hud.setHealth(82);
    hud.setMoney(1400);
    hud.setTimer(62, false);
    settle(20);
    // Fire a short burst at the mid bot, tracer in the air.
    aimAt(ash[0].pos.x, ash[0].pos.y + 1.2, ash[0].pos.z);
    for (let i = 0; i < 2; i += 1) {
      playerShoot();
      settle(6);
    }
    aimAt(ash[1].pos.x, ash[1].pos.y + 1.2, ash[1].pos.z);
    settle(4);
  } else {
    // End of round: charge blown at Crane Yard, scoreboard mood.
    match.phase = 'end';
    match.phaseTime = 0;
    match.scoreEmber = 5;
    match.scoreAsh = 3;
    player.pos.set(-16, 0, -6);
    player.yaw = 0.65;
    player.pitch = 0.02;
    match.bomb.state = 'detonated';
    match.bomb.site = 'A';
    const ash = bots.filter((b) => b.team === 'ash');
    ash[0].pos.set(-22, 0, -14); ash[0].alive = false; ash[0].mesh.visible = false;
    ash[1].pos.set(-26, 0, -18); ash[1].alive = false; ash[1].mesh.visible = false;
    ash[2].pos.set(-20, 0, -12); ash[2].alive = false; ash[2].mesh.visible = false;
    ash[3].pos.set(-24, 0, -20); ash[3].alive = false; ash[3].mesh.visible = false;
    hud.setScore(5, 3);
    hud.setAlive(3, 0);
    hud.setHealth(64);
    hud.setMoney(4050);
    hud.setTimer(0, false);
    hud.setBomb('BOMB DETONATED — SITE A');
    hud.banner('ROUND WON', 'Charge detonated at Crane Yard', 'win');
    settle(30);
  }
  hud.setAmmo(player.weapon.mag, player.weapon.reserve, WEAPONS[player.weapon.id].name);
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

hud.onPlay(() => {
  if (shot) return;
  if (match.phase === 'end') nextRound();
  input.requestLock();
});
hud.onDeploy(() => {
  if (shot) return;
  hud.hideBuy();
  input.requestLock();
});
hud.onBuyRow((id) => buyItem(id));

// Idle menu scene: camera at the spawn yard, world settled.
player.pos.set(-6, 0, 19);
player.yaw = -0.2;
player.pitch = 0.02;
hud.showOverlay('start');
hud.setScore(0, 0);
hud.setAlive(4, 4);
hud.setHealth(100);
hud.setMoney(START_MONEY);
hud.setAmmo(12, 36, 'P9 SIDEARM');
hud.setTimer(ROUND_TIME, false);
syncCamera();

if (shot) runShot(shot);
else requestAnimationFrame(frame);
