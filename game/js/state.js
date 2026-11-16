// EMBERLINE — state.js: one place for every shared constant, the seeded random
// stream and the allocation-free geometry helpers the hot loop uses. No DOM, no
// three.js scene work here: pure data and math, so the simulation stays testable.
export const ROUND_TIME = 100; // seconds per round
export const BUY_TIME = 12; // seconds of freeze/buy time at a round's start
export const PLANT_TIME = 4; // seconds holding E to plant
export const DEFUSE_TIME = 5; // seconds holding E to defuse
export const BOMB_FUSE = 35; // seconds from plant to detonation
export const START_MONEY = 800;
export const WIN_MONEY = 3250;
export const LOSS_MONEY = 1900;
export const KILL_MONEY = 300;
export const PLAYER_SPEED = 5.4; // m/s walking
export const PLAYER_RADIUS = 0.38;
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.05;
export const GRAVITY = 16;

// mulberry32: small, fast, deterministic. One stream drives bot choices and
// spread so ?shot= modes reproduce the same frame every run.
export function mulberry32(initial) {
  let a = initial | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }

// Ray vs axis-aligned box (slab method). Writes nothing; returns the distance
// along the ray to the first face, or Infinity when there is no hit. Origin and
// direction are plain {x,y,z} objects so callers can reuse module-level temps.
export function rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ, maxDist) {
  let tmin = 0;
  let tmax = maxDist;
  let inv;
  inv = 1 / dx;
  let t1 = (minX - ox) * inv;
  let t2 = (maxX - ox) * inv;
  if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
  if (t1 > tmin) tmin = t1;
  if (t2 < tmax) tmax = t2;
  if (tmin > tmax) return Infinity;
  inv = 1 / dy;
  t1 = (minY - oy) * inv;
  t2 = (maxY - oy) * inv;
  if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
  if (t1 > tmin) tmin = t1;
  if (t2 < tmax) tmax = t2;
  if (tmin > tmax) return Infinity;
  inv = 1 / dz;
  t1 = (minZ - oz) * inv;
  t2 = (maxZ - oz) * inv;
  if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
  if (t1 > tmin) tmin = t1;
  if (t2 < tmax) tmax = t2;
  if (tmin > tmax) return Infinity;
  return tmin;
}

// Ray vs sphere, same contract as rayBox.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxDist) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  const t = tca - Math.sqrt(r2 - d2);
  return t <= maxDist ? t : Infinity;
}

// The one mutable match object. Everything the HUD, bots and main loop read
// about the round lives here; entities hold their own per-fighter fields.
export function createMatch() {
  return {
    round: 1,
    phase: 'menu', // menu | buy | live | end
    phaseTime: 0, // seconds spent in the current phase
    roundTime: ROUND_TIME,
    scoreEmber: 0,
    scoreAsh: 0,
    bomb: { state: 'carried', site: null, x: 0, y: 0, z: 0, timer: 0, planter: null },
    winner: null, // 'ember' | 'ash' | null
    winReason: '',
    kills: [], // feed entries {text, headshot, byPlayer}
    started: false,
  };
}
