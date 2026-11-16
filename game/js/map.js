// EMBERLINE — map.js: the Duskport harbor. One data table of boxes builds the
// visible geometry, the colliders and the bullet stoppers; a waypoint graph on
// top of it is what the bots walk. All coordinates are metres, y up, north -z.
// Sites: A = Crane Yard (north-west), B = Fuel Depot (north-east).
import * as THREE from 'three';
import { rayBox } from './state.js';

// x, z are the box centre on the ground; y is its base height (0 = ground).
// shape 'cyl' renders a cylinder but collides as its bounding box.
const BOXES = [
  // Ground and perimeter (68 x 48 m arena).
  { w: 70, h: 0.4, d: 50, x: 0, y: -0.2, z: 0, mat: 'ground' },
  { w: 70, h: 5.0, d: 0.6, x: 0, y: 2.5, z: -25.3, mat: 'wall' },
  { w: 70, h: 5.0, d: 0.6, x: 0, y: 2.5, z: 25.3, mat: 'wall' },
  { w: 0.6, h: 5.0, d: 50, x: -35.3, y: 2.5, z: 0, mat: 'wall' },
  { w: 0.6, h: 5.0, d: 50, x: 35.3, y: 2.5, z: 0, mat: 'wall' },
  // West lane (Ember spawn -> A): containers and a low wall.
  { w: 6.0, h: 2.6, d: 2.4, x: -26, y: 1.3, z: 8, mat: 'rust' },
  { w: 2.4, h: 2.6, d: 6.0, x: -18, y: 1.3, z: 12, mat: 'teal' },
  { w: 4.8, h: 1.2, d: 1.2, x: -22, y: 0.6, z: -2, mat: 'crate' },
  { w: 1.2, h: 1.2, d: 4.8, x: -28, y: 0.6, z: -6, mat: 'crate' },
  { w: 6.0, h: 2.6, d: 2.4, x: -30, y: 1.3, z: -16, mat: 'rust' },
  // Crane Yard (site A): gantry legs, beam, stacked crates, a low platform.
  { w: 1.0, h: 7.0, d: 1.0, x: -28, y: 3.5, z: -18, mat: 'crane' },
  { w: 1.0, h: 7.0, d: 1.0, x: -20, y: 3.5, z: -18, mat: 'crane' },
  { w: 9.0, h: 1.0, d: 1.2, x: -24, y: 7.2, z: -18, mat: 'crane' },
  { w: 2.4, h: 2.6, d: 2.4, x: -20, y: 1.3, z: -10, mat: 'teal' },
  { w: 2.4, h: 1.2, d: 2.4, x: -28, y: 0.6, z: -11, mat: 'crate' },
  { w: 4.0, h: 0.5, d: 3.0, x: -24, y: 0.25, z: -20, mat: 'concrete' },
  // Mid: a container stack the lanes wrap around, plus a broken wall.
  { w: 6.0, h: 2.6, d: 2.4, x: -2, y: 1.3, z: 0, mat: 'rust' },
  { w: 6.0, h: 2.6, d: 2.4, x: 2, y: 3.9, z: 0, mat: 'teal' },
  { w: 1.2, h: 2.2, d: 7.0, x: -9, y: 1.1, z: -4, mat: 'concrete' },
  { w: 1.2, h: 2.2, d: 7.0, x: 9, y: 1.1, z: 4, mat: 'concrete' },
  { w: 3.6, h: 1.1, d: 1.2, x: 0, y: 0.55, z: 8, mat: 'crate' },
  // East lane (Ember spawn -> B) mirrors the west lane.
  { w: 6.0, h: 2.6, d: 2.4, x: 26, y: 1.3, z: 8, mat: 'teal' },
  { w: 2.4, h: 2.6, d: 6.0, x: 18, y: 1.3, z: 12, mat: 'rust' },
  { w: 4.8, h: 1.2, d: 1.2, x: 22, y: 0.6, z: -2, mat: 'crate' },
  { w: 1.2, h: 1.2, d: 4.8, x: 28, y: 0.6, z: -6, mat: 'crate' },
  { w: 6.0, h: 2.6, d: 2.4, x: 30, y: 1.3, z: -16, mat: 'teal' },
  // Fuel Depot (site B): two round tanks, a pipe rack, crates.
  { w: 4.0, h: 3.4, d: 4.0, x: 20, y: 1.7, z: -19, mat: 'tank', shape: 'cyl' },
  { w: 4.0, h: 3.4, d: 4.0, x: 28, y: 1.7, z: -19, mat: 'tank', shape: 'cyl' },
  { w: 1.0, h: 2.0, d: 8.0, x: 24, y: 1.0, z: -13, mat: 'pipe' },
  { w: 2.4, h: 1.2, d: 2.4, x: 20, y: 0.6, z: -10, mat: 'crate' },
  // Ember spawn cover and the south yard.
  { w: 3.0, h: 1.1, d: 1.2, x: -28, y: 0.55, z: 14, mat: 'crate' },
  { w: 3.0, h: 1.1, d: 1.2, x: 28, y: 0.55, z: 14, mat: 'crate' },
  { w: 2.4, h: 2.6, d: 2.4, x: 0, y: 1.3, z: 20, mat: 'rust' },
  { w: 2.4, h: 2.6, d: 2.4, x: -12, y: 1.3, z: 21, mat: 'teal' },
  { w: 2.4, h: 2.6, d: 2.4, x: 12, y: 1.3, z: 21, mat: 'teal' },
  // Ash spawn cover, north centre.
  { w: 4.8, h: 1.2, d: 1.2, x: -6, y: 0.6, z: -21, mat: 'crate' },
  { w: 4.8, h: 1.2, d: 1.2, x: 6, y: 0.6, z: -21, mat: 'crate' },
];

export const SITES = {
  A: { name: 'Crane Yard', minX: -29, maxX: -19, minZ: -22, maxZ: -11, cx: -24, cz: -16.5 },
  B: { name: 'Fuel Depot', minX: 19, maxX: 29, minZ: -22, maxZ: -11, cx: 24, cz: -16.5 },
};

export const SPAWNS = {
  ember: [
    { x: -28, z: 19, yaw: 0 }, { x: -22, z: 21, yaw: 0 },
    { x: -30, z: 15, yaw: 0.4 }, { x: -16, z: 19, yaw: -0.3 },
  ],
  ash: [
    { x: -8, z: -19, yaw: Math.PI }, { x: 0, z: -21, yaw: Math.PI },
    { x: 8, z: -19, yaw: Math.PI }, { x: 0, z: -16, yaw: Math.PI },
  ],
};

// Waypoint graph: [x, z, ...neighbour indices]. Bots BFS through it.
const WAYPOINTS = [
  [-28, 19], [-22, 21], [-16, 19], [-28, 14], // 0-3 Ember spawn yard
  [-24, 8], [-18, 10], [-22, 0], [-26, -6], // 4-7 west lane
  [-24, -13], [-24, -19], // 8-9 site A
  [-12, 14], [-6, 8], [0, 2], [6, -4], [0, -10], // 10-14 mid
  [12, 14], [18, 10], [22, 0], [26, -6], // 15-18 east lane
  [24, -13], [24, -19], // 19-20 site B
  [-8, -18], [0, -20], [8, -18], // 21-23 Ash spawn
  [-12, -12], [12, -12], // 24-25 north connectors
];
const EDGES = [
  [0, 1], [1, 2], [0, 3], [3, 4], [2, 10], [4, 5], [5, 6], [6, 7], [7, 8],
  [8, 9], [10, 11], [11, 12], [12, 13], [13, 14], [14, 24], [14, 25],
  [24, 21], [25, 23], [21, 22], [22, 23], [24, 8], [25, 19], [8, 24],
  [9, 21], [20, 23], [19, 20], [17, 18], [18, 19], [16, 17], [15, 16],
  [15, 10], [2, 15], [12, 6], [13, 18], [7, 24], [18, 25],
];

const PALETTE = {
  ground: 0x343947, wall: 0x3a3f4d, rust: 0x8a4a26, teal: 0x2e6f73,
  crate: 0x6b5a34, crane: 0xd8a020, concrete: 0x555b66, tank: 0xb8b0a0, pipe: 0x4a4f5c,
};

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const key of Object.keys(PALETTE)) {
    materials[key] = new THREE.MeshStandardMaterial({ color: PALETTE[key], roughness: 0.9, metalness: 0.08 });
  }
  materials.crane = new THREE.MeshStandardMaterial({ color: PALETTE.crane, roughness: 0.55, metalness: 0.45 });
  materials.tank = new THREE.MeshStandardMaterial({ color: PALETTE.tank, roughness: 0.4, metalness: 0.6 });
  materials.pipe = new THREE.MeshStandardMaterial({ color: PALETTE.pipe, roughness: 0.5, metalness: 0.5 });

  const colliders = [];
  const shootables = [];
  for (const b of BOXES) {
    let mesh;
    if (b.shape === 'cyl') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(b.w / 2, b.w / 2, b.h, 20), materials[b.mat]);
      mesh.position.set(b.x, b.y, b.z);
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), materials[b.mat]);
      mesh.position.set(b.x, b.y, b.z);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push({
      minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
      minY: b.y - b.h / 2, maxY: b.y + b.h / 2,
      minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
    });
    shootables.push(mesh);
  }

  // Site markers: glowing ground ring + a light beam so each site reads at a glance.
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 3.0, 32),
      new THREE.MeshBasicMaterial({ color: key === 'A' ? 0xff7a2f : 0x3fc1c9, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.cx, 0.03, s.cz);
    group.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 9, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: key === 'A' ? 0xff7a2f : 0x3fc1c9, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
    );
    beam.position.set(s.cx, 4.5, s.cz);
    group.add(beam);
  }

  // Dusk lighting: low warm sun from the west, cool sky fill, harbour lamps.
  const hemi = new THREE.HemisphereLight(0x8a7fd0, 0x1a1410, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xff9a4d, 2.6);
  sun.position.set(-28, 12, 14);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 90; sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x5a6fb0, 0.5);
  fill.position.set(20, 16, -10);
  scene.add(fill);
  for (const s of Object.values(SITES)) {
    const lamp = new THREE.PointLight(0xffb36b, 14, 18, 1.6);
    lamp.position.set(s.cx, 5.5, s.cz);
    scene.add(lamp);
  }

  // Waypoint adjacency, built once.
  const neighbours = WAYPOINTS.map(() => []);
  for (const [a, b] of EDGES) { neighbours[a].push(b); neighbours[b].push(a); }

  return {
    colliders, shootables, group,
    waypoints: WAYPOINTS, neighbours,
    siteAt(x, z) {
      for (const key of ['A', 'B']) {
        const s = SITES[key];
        if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return key;
      }
      return null;
    },
    // Circle-vs-boxes collision: move x, then z, clamping against any box the
    // fighter's vertical span overlaps. Returns nothing; writes into out.
    moveCircle(pos, radius, height, dx, dz, out) {
      let nx = pos.x + dx;
      let nz = pos.z + dz;
      const y0 = pos.y;
      const y1 = pos.y + height;
      for (const c of colliders) {
        if (c.maxY <= y0 + 0.05 || c.minY >= y1) continue;
        if (nz + radius > c.minZ && nz - radius < c.maxZ) {
          if (nx + radius > c.minX && pos.x + radius <= c.minX) nx = c.minX - radius;
          else if (nx - radius < c.maxX && pos.x - radius >= c.maxX) nx = c.maxX + radius;
        }
      }
      for (const c of colliders) {
        if (c.maxY <= y0 + 0.05 || c.minY >= y1) continue;
        if (nx + radius > c.minX && nx - radius < c.maxX) {
          if (nz + radius > c.minZ && pos.z + radius <= c.minZ) nz = c.minZ - radius;
          else if (nz - radius < c.maxZ && pos.z - radius >= c.maxZ) nz = c.maxZ + radius;
        }
      }
      out.x = nx; out.z = nz;
    },
    // True when no collider blocks the segment between two points.
    clearSight(x1, y1, z1, x2, y2, z2) {
      const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 0.001) return true;
      const inv = 1 / dist;
      for (const c of colliders) {
        if (rayBox(x1, y1, z1, dx * inv, dy * inv, dz * inv,
          c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ, dist - 0.05) !== Infinity) return false;
      }
      return true;
    },
    nearestWaypoint(x, z) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < WAYPOINTS.length; i += 1) {
        const d = (WAYPOINTS[i][0] - x) ** 2 + (WAYPOINTS[i][1] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    },
  };
}
