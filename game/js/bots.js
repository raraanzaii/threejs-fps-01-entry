// EMBERLINE — bots.js: the seven AI fighters. Each bot runs a small state
// machine — route along the waypoint graph, hold an angle, engage what it
// sees, investigate what it hears — with a reaction delay and aim error so a
// human who stops to aim can outshoot it. Bots plant and defuse the charge.
import * as THREE from 'three';
import { createFighter, moveFighter } from './player.js';
import { fireShot, WEAPONS, newWeaponState } from './weapons.js';
import { clamp, lerp } from './state.js';

const EMBER_NAMES = ['Rook', 'Sable', 'Vex'];
const ASH_NAMES = ['Heron', 'Moss', 'Brine', 'Quill'];
const TEAM_COLOR = { ember: 0xff7a2f, ash: 0x3fc1c9 };

// Breadth-first path over the waypoint graph. Returns waypoint indices.
export function findPath(map, from, to) {
  if (from === to) return [to];
  const prev = new Array(map.waypoints.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const n of map.neighbours[cur]) {
      if (prev[n] !== -1) continue;
      prev[n] = cur;
      if (n === to) {
        const path = [to];
        let node = to;
        while (node !== from) { node = prev[node]; path.unshift(node); }
        return path;
      }
      queue.push(n);
    }
  }
  return [to];
}

function createBotMesh(team) {
  const color = TEAM_COLOR[team];
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.85 });
  const teamMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.76, 1.05, 0.42), bodyMat);
  body.position.y = 0.82;
  body.castShadow = true;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.46), teamMat);
  vest.position.y = 1.0;
  vest.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x3a2e22, roughness: 0.7 }));
  head.position.y = 1.52;
  head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.1), teamMat);
  visor.position.set(0, 1.54, -0.2);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.85),
    new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.4, metalness: 0.5 }));
  gun.position.set(0.3, 1.15, -0.35);
  group.add(body, vest, head, visor, gun);
  group.userData = { body, head };
  return group;
}

export function createBots(scene, map) {
  const bots = [];
  for (const name of EMBER_NAMES) {
    const f = createFighter('ember', name, false);
    f.mesh = createBotMesh('ember');
    scene.add(f.mesh);
    f.bot = newBotState();
    bots.push(f);
  }
  for (const name of ASH_NAMES) {
    const f = createFighter('ash', name, false);
    f.mesh = createBotMesh('ash');
    scene.add(f.mesh);
    f.bot = newBotState();
    bots.push(f);
  }
  return bots;
}

function newBotState() {
  return {
    mode: 'route', // route | hold | engage | plant | defuse
    path: [], pathIndex: 0,
    goalSite: null, goalWp: 0,
    holdTimer: 0, holdYaw: 0,
    target: null, react: 0, lostSight: 0,
    burstLeft: 0, burstPause: 0,
    aimError: 0.03,
    investigate: null,
    strafeDir: 1, strafeTimer: 0,
    actionTimer: 0, // plant / defuse progress
    thinkTimer: 0,
  };
}

// Assign round roles: attackers pick a site and walk to it (the carrier
// plants); defenders split between the sites and mid, then hold angles.
export function assignRound(bots, player, map, random, match) {
  const siteKey = random() < 0.5 ? 'A' : 'B';
  const siteWp = siteKey === 'A' ? 8 : 19;
  const attackers = bots.filter((b) => b.team === 'ember');
  const defenders = bots.filter((b) => b.team === 'ash');
  // Bomb carrier: the player, unless the player is dead (never at round start).
  player.bombCarrier = true;
  let carrierAssigned = false;
  for (const b of attackers) {
    const st = b.bot;
    st.goalSite = siteKey;
    st.goalWp = siteWp;
    st.mode = 'route';
    st.path = findPath(map, map.nearestWaypoint(b.pos.x, b.pos.z), siteWp);
    st.pathIndex = 0;
    st.target = null;
    st.actionTimer = 0;
    // One attacker escorts the carrier; the carrier plants.
    if (!carrierAssigned && random() < 0.4) { st.goalWp = siteWp; carrierAssigned = true; }
    if (random() < 0.5) b.weapon = newWeaponState('smg');
    else b.weapon = newWeaponState('rifle');
    b.weaponsOwned = [b.weapon.id];
  }
  const guardSpots = siteKey === 'A' ? [8, 24, 12, 19] : [19, 25, 12, 8];
  defenders.forEach((b, i) => {
    const st = b.bot;
    st.goalSite = siteKey;
    st.goalWp = guardSpots[i % guardSpots.length];
    st.mode = 'route';
    st.path = findPath(map, map.nearestWaypoint(b.pos.x, b.pos.z), st.goalWp);
    st.pathIndex = 0;
    st.target = null;
    st.actionTimer = 0;
    b.weapon = random() < 0.6 ? newWeaponState('rifle') : newWeaponState('smg');
    b.weaponsOwned = [b.weapon.id];
  });
  match.bomb.state = 'carried';
  match.bomb.site = null;
  match.bomb.timer = 0;
}

const _wish = { x: 0, z: 0 };
const _to = { x: 0, z: 0 };

// Visible enemy check: within range, roughly in front, and a clear line from
// the bot's eyes to the target's chest. Smoke clouds blind it too.
function seeEnemy(bot, fighters, map, events) {
  let best = null;
  let bestD = 55;
  const eyeY = bot.pos.y + bot.eye;
  for (const f of fighters) {
    if (!f.alive || f.team === bot.team) continue;
    const dx = f.pos.x - bot.pos.x;
    const dz = f.pos.z - bot.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD) continue;
    const ang = Math.atan2(-dx, -dz);
    let diff = ang - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > 1.1 && d > 6) continue; // ~126 deg field of view
    if (!map.clearSight(bot.pos.x, eyeY, bot.pos.z, f.pos.x, f.pos.y + 1.0, f.pos.z)) continue;
    if (events.blocksSight && events.blocksSight(bot.pos.x, eyeY, bot.pos.z, f.pos.x, f.pos.y + 1.0, f.pos.z)) continue;
    best = f;
    bestD = d;
  }
  return best;
}

export function stepBots(bots, fighters, map, match, random, dt, events) {
  for (const bot of bots) {
    if (!bot.alive) continue;
    const st = bot.bot;
    st.thinkTimer -= dt;
    bot.weapon.cooldown = Math.max(0, bot.weapon.cooldown - dt);
    if (bot.weapon.reloading > 0) {
      bot.weapon.reloading -= dt;
      if (bot.weapon.reloading <= 0) {
        const def = WEAPONS[bot.weapon.id];
        const need = def.mag - bot.weapon.mag;
        const take = Math.min(need, bot.weapon.reserve);
        bot.weapon.mag += take;
        bot.weapon.reserve -= take;
      }
    }

    // --- Perception: see an enemy, or hear a shot worth investigating.
    const seen = seeEnemy(bot, fighters, map, events);
    if (seen) {
      if (st.target !== seen) {
        st.target = seen;
        st.react = 0.35 + random() * 0.45; // reaction time
        st.burstLeft = 0;
        st.lostSight = 0;
      }
      st.mode = 'engage';
    } else if (st.target) {
      st.lostSight += dt;
      if (st.lostSight > 2.0) {
        st.target = null;
        st.mode = st.goalSite ? 'route' : 'hold';
        if (st.mode === 'route' && st.path.length === 0) {
          st.path = findPath(map, map.nearestWaypoint(bot.pos.x, bot.pos.z), st.goalWp);
          st.pathIndex = 0;
        }
      }
    }

    // --- Bomb duties override movement when the moment is right.
    if (match.bomb.state === 'planted' && bot.team === 'ash' && !st.target) {
      st.mode = 'defuse';
    }
    if (bot.team === 'ember' && bot.bombCarrier && !st.target) {
      const site = map.siteAt(bot.pos.x, bot.pos.z);
      if (site && match.bomb.state === 'carried') st.mode = 'plant';
    }

    // --- Act by mode.
    if (st.mode === 'engage' && st.target) {
      engageStep(bot, st, map, random, dt, events);
    } else if (st.mode === 'plant') {
      plantStep(bot, st, map, match, dt, events);
    } else if (st.mode === 'defuse') {
      defuseStep(bot, st, map, match, random, dt, events);
    } else if (st.mode === 'hold') {
      st.holdTimer -= dt;
      bot.yaw += Math.sin(st.holdTimer * 0.4) * dt * 0.25;
      moveFighter(bot, dt, 0, 0, false, map);
      if (st.holdTimer <= 0) {
        st.mode = 'route';
        st.path = findPath(map, map.nearestWaypoint(bot.pos.x, bot.pos.z), st.goalWp);
        st.pathIndex = 0;
      }
    } else {
      routeStep(bot, st, map, dt);
    }

    // Footstep timing for audio (main.js listens to bot.stepTimer).
    if (bot.speed > 1) {
      bot.stepTimer -= dt * bot.speed;
      if (bot.stepTimer <= 0) { bot.stepTimer = 0.55; events.onStep(bot); }
    }
    syncBotMesh(bot);
  }
}

function routeStep(bot, st, map, dt) {
  if (st.pathIndex >= st.path.length) {
    // Arrived: hold this angle for a while, then drift to another spot.
    st.mode = 'hold';
    st.holdTimer = 4 + Math.random() * 4;
    st.holdYaw = bot.yaw;
    return;
  }
  const wp = map.waypoints[st.path[st.pathIndex]];
  const dx = wp[0] - bot.pos.x;
  const dz = wp[1] - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.9) { st.pathIndex += 1; return; }
  const wantYaw = Math.atan2(-dx, -dz);
  turnToward(bot, wantYaw, dt, 6);
  _wish.x = dx / dist;
  _wish.z = dz / dist;
  moveFighter(bot, dt, _wish.x, _wish.z, false, map);
}

function engageStep(bot, st, map, random, dt, events) {
  const t = st.target;
  if (!t.alive) { st.target = null; st.mode = 'route'; return; }
  const dx = t.pos.x - bot.pos.x;
  const dz = t.pos.z - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  const wantYaw = Math.atan2(-dx, -dz);
  turnToward(bot, wantYaw, dt, 10);
  // Aim at the chest with a decaying error; headshots happen by luck.
  const aimY = t.pos.y + (t.crouch ? 0.9 : 1.25);
  const eyeY = bot.pos.y + bot.eye;
  const wantPitch = Math.atan2(aimY - eyeY, dist);
  bot.pitch = lerp(bot.pitch, clamp(wantPitch, -1.2, 1.2), Math.min(1, 8 * dt));
  // Strafe to stay a hard target; close in if far, back off if point-blank.
  st.strafeTimer -= dt;
  if (st.strafeTimer <= 0) { st.strafeDir *= -1; st.strafeTimer = 0.7 + random() * 0.9; }
  const radial = dist > 14 ? -1 : dist < 4 ? 1 : 0;
  const fx = -Math.sin(bot.yaw), fz = -Math.cos(bot.yaw);
  const rx = Math.cos(bot.yaw), rz = -Math.sin(bot.yaw);
  _wish.x = fx * -radial + rx * st.strafeDir * 0.7;
  _wish.z = fz * -radial + rz * st.strafeDir * 0.7;
  const wl = Math.hypot(_wish.x, _wish.z) || 1;
  moveFighter(bot, dt, _wish.x / wl, _wish.z / wl, false, map);

  st.react -= dt;
  if (st.react > 0) return;
  if (bot.weapon.mag === 0) {
    if (bot.weapon.reloading <= 0 && bot.weapon.reserve > 0) bot.weapon.reloading = WEAPONS[bot.weapon.id].reloadTime;
    return;
  }
  if (st.burstPause > 0) { st.burstPause -= dt; return; }
  if (st.burstLeft <= 0) st.burstLeft = 3 + Math.floor(random() * 4);
  // Aim error shrinks the longer the bot has held the angle.
  const err = 0.02 + random() * 0.045;
  const savedYaw = bot.yaw;
  const savedPitch = bot.pitch;
  bot.yaw += (random() * 2 - 1) * err;
  bot.pitch += (random() * 2 - 1) * err * 0.6;
  const shot = fireShot(bot, [t], map, random);
  bot.yaw = savedYaw;
  bot.pitch = savedPitch;
  st.burstLeft -= 1;
  if (st.burstLeft <= 0) st.burstPause = 0.45 + random() * 0.5;
  if (shot) events.onShot(bot, shot);
}

function plantStep(bot, st, map, match, dt, events) {
  // Stand still on the site, channel the plant.
  moveFighter(bot, dt, 0, 0, false, map);
  st.actionTimer += dt;
  events.onPlantProgress(bot, st.actionTimer / 4);
  if (st.actionTimer >= 4) {
    match.bomb.state = 'planted';
    match.bomb.site = map.siteAt(bot.pos.x, bot.pos.z);
    match.bomb.timer = 35;
    match.bomb.x = bot.pos.x; match.bomb.y = bot.pos.y; match.bomb.z = bot.pos.z;
    bot.bombCarrier = false;
    st.actionTimer = 0;
    st.mode = 'route';
    st.goalWp = map.nearestWaypoint(bot.pos.x, bot.pos.z);
    st.path = [];
    events.onPlanted(bot, match.bomb.site);
  }
}

function defuseStep(bot, st, map, match, random, dt, events) {
  const dx = match.bomb.x - bot.pos.x;
  const dz = match.bomb.z - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 1.6) {
    const goal = map.nearestWaypoint(match.bomb.x, match.bomb.z);
    if (st.path.length === 0 || st.goalWp !== goal) {
      st.goalWp = goal;
      st.path = findPath(map, map.nearestWaypoint(bot.pos.x, bot.pos.z), goal);
      st.pathIndex = 0;
    }
    routeStep(bot, st, map, dt);
    st.actionTimer = 0;
    return;
  }
  moveFighter(bot, dt, 0, 0, false, map);
  st.actionTimer += dt;
  events.onDefuseProgress(bot, st.actionTimer / 5);
  if (st.actionTimer >= 5) {
    events.onDefused(bot);
  }
}

// A gunshot within earshot pulls nearby enemies toward the sound.
export function hearShot(bots, x, z, shooterTeam, map) {
  for (const b of bots) {
    if (!b.alive || b.team === shooterTeam || b.bot.mode === 'engage') continue;
    const d = Math.hypot(b.pos.x - x, b.pos.z - z);
    if (d > 26) continue;
    const st = b.bot;
    if (st.mode === 'plant' || st.mode === 'defuse') continue;
    st.investigate = { x, z };
    st.mode = 'route';
    st.goalWp = map.nearestWaypoint(x, z);
    st.path = findPath(map, map.nearestWaypoint(b.pos.x, b.pos.z), st.goalWp);
    st.pathIndex = 0;
  }
}

function turnToward(bot, wantYaw, dt, rate) {
  let diff = wantYaw - bot.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  bot.yaw += clamp(diff, -rate * dt, rate * dt);
}

function syncBotMesh(bot) {
  if (!bot.mesh) return;
  bot.mesh.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
  bot.mesh.rotation.y = bot.yaw + Math.PI;
  bot.mesh.visible = bot.alive;
  if (!bot.alive) {
    bot.mesh.rotation.z = Math.PI / 2;
    bot.mesh.position.y = 0.25;
  } else {
    bot.mesh.rotation.z = 0;
  }
  // Crouching bots hunker down.
  const targetScaleY = bot.crouch ? 0.72 : 1;
  bot.mesh.scale.y = lerp(bot.mesh.scale.y, targetScaleY, 0.2);
}
