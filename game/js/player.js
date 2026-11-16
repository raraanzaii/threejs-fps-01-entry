// EMBERLINE — player.js: the human fighter. One factory makes every fighter
// (player and bots share the shape); this module owns the player's movement —
// acceleration-based, so stopping to aim pays — plus keyboard/mouse input.
// Bots reuse the fighter shape but move through bots.js.
import * as THREE from 'three';
import { PLAYER_RADIUS, EYE_STAND, EYE_CROUCH, GRAVITY, PLAYER_SPEED, clamp, lerp } from './state.js';
import { newWeaponState } from './weapons.js';

let fighterSeq = 0;

export function createFighter(team, name, isPlayer) {
  fighterSeq += 1;
  return {
    id: fighterSeq,
    name, team, isPlayer,
    pos: new THREE.Vector3(0, 0, 0),
    yaw: 0, pitch: 0,
    eye: EYE_STAND,
    hp: 100, armour: 0,
    alive: true,
    crouch: false, onGround: true,
    vy: 0, speed: 0,
    weapon: newWeaponState('pistol'),
    weaponsOwned: ['pistol'],
    grenades: { frag: 0, smoke: 0 },
    money: 0,
    bombCarrier: false,
    pendingDamage: 0,
    // Bot-only fields, harmless on the player.
    bot: null,
    mesh: null, bodyMesh: null, headMesh: null,
    stepTimer: 0,
  };
}

export function respawnFighter(f, spawn) {
  f.pos.set(spawn.x, 0, spawn.z);
  f.yaw = spawn.yaw;
  f.pitch = 0;
  f.eye = EYE_STAND;
  f.hp = 100;
  f.alive = true;
  f.crouch = false;
  f.onGround = true;
  f.vy = 0;
  f.speed = 0;
  f.weapon = newWeaponState(f.weaponsOwned[f.weaponsOwned.length - 1]);
  f.pendingDamage = 0;
  f.bombCarrier = false;
  if (f.mesh) f.mesh.visible = true;
}

// Move one fighter with acceleration and map collision. `wish` is a unit
// {x, z} wish direction in world space (already yaw-rotated) or null.
const _moveOut = { x: 0, z: 0 };
export function moveFighter(f, dt, wishX, wishZ, wantJump, map) {
  const targetSpeed = (f.crouch ? PLAYER_SPEED * 0.45 : PLAYER_SPEED) * (f.weapon.ads ? 0.55 : 1);
  const accel = f.onGround ? 14 : 4;
  const vx = wishX * targetSpeed;
  const vz = wishZ * targetSpeed;
  // Current horizontal velocity is derived from the last frame's displacement;
  // keep it on the fighter to stay allocation-free.
  f.vx = lerp(f.vx || 0, vx, Math.min(1, accel * dt));
  f.vz = lerp(f.vz || 0, vz, Math.min(1, accel * dt));
  const dx = f.vx * dt;
  const dz = f.vz * dt;
  map.moveCircle(f.pos, PLAYER_RADIUS, 1.8, dx, dz, _moveOut);
  f.pos.x = _moveOut.x;
  f.pos.z = _moveOut.z;
  f.speed = Math.hypot(f.vx, f.vz);
  if (wantJump && f.onGround) {
    f.vy = 6.2;
    f.onGround = false;
  }
  if (!f.onGround || f.vy !== 0) {
    f.vy -= GRAVITY * dt;
    f.pos.y += f.vy * dt;
    if (f.pos.y <= 0) { f.pos.y = 0; f.vy = 0; f.onGround = true; }
  }
  const wantEye = f.crouch ? EYE_CROUCH : EYE_STAND;
  f.eye = lerp(f.eye, wantEye, Math.min(1, 12 * dt));
}

// Keyboard + mouse + pointer lock. Callbacks keep main.js in charge of meaning.
export function createInput(canvas, hooks) {
  const keys = new Set();
  const look = { x: 0, y: 0 };
  let firing = false;
  let aiming = false;
  let locked = false;

  function onKey(e, down) {
    if (e.repeat) return;
    if (down) keys.add(e.code);
    else keys.delete(e.code);
    if (down) hooks.onKeyDown(e.code);
    if (e.code === 'Space') e.preventDefault();
  }
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    look.x += e.movementX;
    look.y += e.movementY;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (!locked) return;
    if (e.button === 0) firing = true;
    if (e.button === 2) aiming = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) firing = false;
    if (e.button === 2) aiming = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    hooks.onLockChange(locked);
  });

  return {
    keys,
    takeLook() { const l = { x: look.x, y: look.y }; look.x = 0; look.y = 0; return l; },
    get firing() { return firing; },
    get aiming() { return aiming; },
    get locked() { return locked; },
    requestLock() { canvas.requestPointerLock(); },
    releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); },
    stopFiring() { firing = false; aiming = false; },
    clearKeys() { keys.clear(); },
  };
}

// Wish direction from held keys, rotated by yaw. Writes into out {x, z}.
export function wishFromKeys(keys, yaw, out) {
  let fx = 0, fz = 0;
  if (keys.has('KeyW')) fz -= 1;
  if (keys.has('KeyS')) fz += 1;
  if (keys.has('KeyA')) fx -= 1;
  if (keys.has('KeyD')) fx += 1;
  const len = Math.hypot(fx, fz);
  if (len < 0.01) { out.x = 0; out.z = 0; return out; }
  fx /= len; fz /= len;
  const s = Math.sin(yaw), c = Math.cos(yaw);
  // forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw); W is fz = -1.
  out.x = fx * c + fz * s;
  out.z = -fx * s + fz * c;
  return out;
}

export function clampPitch(f) { f.pitch = clamp(f.pitch, -1.53, 1.53); }
