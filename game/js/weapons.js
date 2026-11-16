// EMBERLINE — weapons.js: the arsenal, the shot resolver and the grenades.
// Firing is a ray from the shooter's eye: map boxes stop it, a fighter's body
// box and head sphere take damage (headshots pay more). All hot-loop math reuses
// module-level temps — no object is created per shot or per frame.
import * as THREE from 'three';
import { rayBox, raySphere, clamp } from './state.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 SIDEARM', price: 0, auto: false,
    damage: 26, headMult: 3.0, interval: 0.16, mag: 12, reserve: 36,
    spread: 0.011, moveSpread: 0.05, adsSpread: 0.004, recoil: 0.011,
    reloadTime: 1.1, range: 70, tracer: 0xffd27a,
  },
  rifle: {
    id: 'rifle', name: 'VK-7 REPEATER', price: 2700, auto: true,
    damage: 34, headMult: 3.2, interval: 0.105, mag: 30, reserve: 90,
    spread: 0.012, moveSpread: 0.055, adsSpread: 0.004, recoil: 0.016,
    reloadTime: 2.4, range: 90, tracer: 0xffc46b,
  },
  smg: {
    id: 'smg', name: 'TALON SMG', price: 1500, auto: true,
    damage: 22, headMult: 3.0, interval: 0.075, mag: 28, reserve: 84,
    spread: 0.02, moveSpread: 0.06, adsSpread: 0.008, recoil: 0.01,
    reloadTime: 1.8, range: 55, tracer: 0x9be8ff,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'FRAG GRENADE', price: 300, radius: 7, damage: 110, fuse: 1.4 },
  smoke: { id: 'smoke', name: 'SMOKE GRENADE', price: 400, radius: 5, damage: 0, fuse: 1.2 },
};

export const ARMOUR_PRICE = 650;

export function newWeaponState(id) {
  const def = WEAPONS[id];
  return { id, mag: def.mag, reserve: def.reserve, cooldown: 0, reloading: 0, ads: false };
}

// One live shot. `shooter` is a fighter {pos, yaw, pitch, eye, crouch, speed,
// weapon}; `fighters` are all fighters (shooter excluded by identity); `map`
// supplies colliders and clearSight. Returns {hit, victim, headshot, point,
// damage} or null when the gun could not fire. `random` is the seeded stream.
const _dir = { x: 0, y: 0, z: 0 };
const _hit = { x: 0, y: 0, z: 0 };

export function fireShot(shooter, fighters, map, random) {
  const def = WEAPONS[shooter.weapon.id];
  const w = shooter.weapon;
  if (w.cooldown > 0 || w.reloading > 0 || w.mag <= 0) return null;
  w.mag -= 1;
  w.cooldown = def.interval;

  // Spread: standing still and aiming pays; moving, jumping and crouching
  // change it a lot. ADS tightens it hard.
  let spread = def.spread;
  const moving = Math.min(1, shooter.speed / 5);
  spread += def.moveSpread * moving;
  if (!shooter.onGround) spread += 0.05;
  if (shooter.crouch) spread *= 0.55;
  if (w.ads) spread = def.adsSpread + spread * 0.15;

  const eyeY = shooter.pos.y + shooter.eye;
  const cy = Math.cos(shooter.pitch);
  _dir.x = -Math.sin(shooter.yaw) * cy;
  _dir.y = Math.sin(shooter.pitch);
  _dir.z = -Math.cos(shooter.yaw) * cy;
  _dir.x += (random() * 2 - 1) * spread;
  _dir.y += (random() * 2 - 1) * spread;
  _dir.z += (random() * 2 - 1) * spread;
  const len = Math.hypot(_dir.x, _dir.y, _dir.z) || 1;
  _dir.x /= len; _dir.y /= len; _dir.z /= len;

  // Nearest wall first: nothing behind it can be hit.
  let wallDist = def.range;
  for (const c of map.colliders) {
    const t = rayBox(shooter.pos.x, eyeY, shooter.pos.z, _dir.x, _dir.y, _dir.z,
      c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ, wallDist);
    if (t < wallDist) wallDist = t;
  }

  let best = null;
  let bestDist = wallDist;
  for (const f of fighters) {
    if (f === shooter || !f.alive) continue;
    // Body box: 0.76 wide, 1.35 tall above the feet; head sphere on top.
    const headY = f.pos.y + (f.crouch ? 0.95 : 1.5);
    const th = raySphere(shooter.pos.x, eyeY, shooter.pos.z, _dir.x, _dir.y, _dir.z,
      f.pos.x, headY, f.pos.z, 0.26, bestDist);
    if (th < bestDist) {
      bestDist = th;
      best = { victim: f, headshot: true, dist: th };
      continue;
    }
    const bodyTop = f.pos.y + (f.crouch ? 1.05 : 1.45);
    const tb = rayBox(shooter.pos.x, eyeY, shooter.pos.z, _dir.x, _dir.y, _dir.z,
      f.pos.x - 0.38, f.pos.y, f.pos.z - 0.38,
      f.pos.x + 0.38, bodyTop, f.pos.z + 0.38, bestDist);
    if (tb < bestDist) { bestDist = tb; best = { victim: f, headshot: false, dist: tb }; }
  }

  _hit.x = shooter.pos.x + _dir.x * bestDist;
  _hit.y = eyeY + _dir.y * bestDist;
  _hit.z = shooter.pos.z + _dir.z * bestDist;
  const out = {
    hit: best !== null, victim: best ? best.victim : null,
    headshot: best ? best.headshot : false,
    damage: best ? Math.round(def.damage * (best.headshot ? def.headMult : 1)) : 0,
    point: { x: _hit.x, y: _hit.y, z: _hit.z },
    wallDist, tracer: def.tracer,
  };
  return out;
}

// Grenades: thrown on a fixed arc, bounce once off the ground, then go off.
// A live list lives in main.js; this module owns the step and the blast.
export function throwGrenade(kind, from, yaw, pitch, list) {
  const def = GRENADES[kind];
  const cy = Math.cos(pitch);
  list.push({
    kind, fuse: def.fuse,
    x: from.x, y: from.y + 1.4, z: from.z,
    vx: -Math.sin(yaw) * cy * 13, vy: Math.sin(pitch) * 13 + 4.5, vz: -Math.cos(yaw) * cy * 13,
    mesh: null, smoked: false,
  });
}

export function stepGrenades(list, dt, map, fighters, onBlast) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const g = list[i];
    g.fuse -= dt;
    g.vy -= 16 * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;
    if (g.y < 0.15) { g.y = 0.15; g.vy = Math.abs(g.vy) * 0.35; g.vx *= 0.6; g.vz *= 0.6; }
    if (g.mesh) g.mesh.position.set(g.x, g.y, g.z);
    if (g.fuse <= 0) {
      const def = GRENADES[g.kind];
      if (def.damage > 0) {
        for (const f of fighters) {
          if (!f.alive) continue;
          const d = Math.hypot(f.pos.x - g.x, (f.pos.y + 0.9) - g.y, f.pos.z - g.z);
          if (d < def.radius) {
            const fall = 1 - (d / def.radius) * 0.7;
            const blocked = !map.clearSight(g.x, g.y, g.z, f.pos.x, f.pos.y + 0.9, f.pos.z);
            if (!blocked) f.pendingDamage = (f.pendingDamage || 0) + Math.round(def.damage * fall);
          }
        }
      }
      onBlast(g);
      list.splice(i, 1);
    }
  }
}

// Tracers: a small pool of lines, reused, never allocated in the hot loop.
export function createTracers(scene, poolSize = 10) {
  const pool = [];
  for (let i = 0; i < poolSize; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    scene.add(line);
    pool.push({ line, life: 0 });
  }
  let next = 0;
  return {
    spawn(from, to, color) {
      const t = pool[next];
      next = (next + 1) % pool.length;
      const a = t.line.geometry.attributes.position.array;
      a[0] = from.x; a[1] = from.y; a[2] = from.z;
      a[3] = to.x; a[4] = to.y; a[5] = to.z;
      t.line.geometry.attributes.position.needsUpdate = true;
      t.line.material.color.setHex(color);
      t.line.material.opacity = 0.9;
      t.life = 0.07;
    },
    step(dt) {
      for (const t of pool) {
        if (t.life > 0) {
          t.life -= dt;
          t.line.material.opacity = clamp(t.life / 0.07, 0, 1) * 0.9;
        }
      }
    },
  };
}

export function spreadNow(shooter) {
  const def = WEAPONS[shooter.weapon.id];
  let spread = def.spread + def.moveSpread * Math.min(1, shooter.speed / 5);
  if (!shooter.onGround) spread += 0.05;
  if (shooter.crouch) spread *= 0.55;
  if (shooter.weapon.ads) spread = def.adsSpread + spread * 0.15;
  return spread;
}
