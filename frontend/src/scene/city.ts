// The places the current serves: a small city of pale model blocks with glowing
// streets, the battery bank, the solar field, and the trees that make it a land.
import {
  BoxGeometry,
  BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Mesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from "three";
import type { Polyline } from "./network";
import { fbm, makeRng, smoothstep } from "./noise";
import type { GroundMap } from "./terrain";
import {
  BATTERY,
  CAM_Z,
  CITY,
  heightAt,
  R_BATTERY,
  R_STREET_BATT,
  R_STREET_GRID,
  ROUTES,
  SOLAR,
  SUBSTATION,
  type XZ,
} from "./world";

interface Box { x: number; y: number; z: number; sx: number; sy: number; sz: number; yaw: number; pitch?: number; seed: number }

const Y = new Vector3(0, 1, 0), X = new Vector3(1, 0, 0);

function instancedBoxes(boxes: Box[], material: ShaderMaterial): InstancedMesh {
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, boxes.length);
  const m = new Matrix4(), q = new Quaternion(), qp = new Quaternion(), p = new Vector3(), s = new Vector3();
  const seeds = new Float32Array(boxes.length);
  boxes.forEach((b, i) => {
    q.setFromAxisAngle(Y, b.yaw);
    if (b.pitch) q.multiply(qp.setFromAxisAngle(X, b.pitch));
    m.compose(p.set(b.x, b.y, b.z), q, s.set(b.sx, b.sy, b.sz));
    mesh.setMatrixAt(i, m);
    seeds[i] = b.seed;
  });
  mesh.geometry.setAttribute("aSeed", new InstancedBufferAttribute(seeds, 1));
  mesh.frustumCulled = false;
  return mesh;
}

/** City-local (a, b) to world, on the city's rotated grid. */
function cityToWorld(a: number, b: number): XZ {
  const c = Math.cos(CITY.rot), s = Math.sin(CITY.rot);
  return { x: CITY.x + a * c + b * s, z: CITY.z - a * s + b * c };
}

const PITCH = 84, STREET = 22;
const insideCity = (a: number, b: number) => (a / CITY.rx) ** 2 + (b / CITY.rz) ** 2;

export function buildCity(material: ShaderMaterial, ground: GroundMap) {
  const rng = makeRng(20261026);
  const boxes: Box[] = [];
  const na = 8, nb = 6;
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < nb; j++) {
      const a0 = (i - (na - 1) / 2) * PITCH, b0 = (j - (nb - 1) / 2) * PITCH;
      const r2 = insideCity(a0, b0);
      if (r2 > 0.92 + rng() * 0.25) continue;
      const block = PITCH - STREET;
      const split = rng() < 0.35 ? 1 : 2;
      for (let li = 0; li < split; li++) {
        for (let lj = 0; lj < 2; lj++) {
          if (rng() < 0.1) continue; // a gap: yard or square
          const lw = block / split, ld = block / 2;
          const a = a0 - block / 2 + lw * (li + 0.5), b = b0 - block / 2 + ld * (lj + 0.5);
          const r = Math.sqrt(insideCity(a, b));
          let h = 16 + 92 * Math.exp(-r * r * 3.0) * (0.4 + 0.6 * rng()) + 10 * rng();
          if (r < 0.45 && rng() < 0.07) h = 140 + 60 * rng(); // a few towers downtown
          const w = lw - 5 - rng() * 8, d = ld - 5 - rng() * 8;
          const { x, z } = cityToWorld(a, b);
          const base = heightAt(x, z) - 3;
          boxes.push({ x, y: base + h / 2, z, sx: w, sy: h, sz: d, yaw: CITY.rot + (rng() - 0.5) * 0.04, seed: rng() });
          ground.shadowRect(x, z, w, d, -CITY.rot, 0.5);
        }
      }
    }
  }
  ground.glow(CITY.x, CITY.z, 560, 0.85);
  ground.glow(CITY.x + 40, CITY.z - 40, 260, 0.6);
  const mesh = instancedBoxes(boxes, material);

  // the street network, fed from the substation (east) and from the battery (west)
  const bEdge = (a: number) => CITY.rz * Math.sqrt(Math.max(0, 1 - (a / CITY.rx) ** 2)) * 0.96;
  const aMax = CITY.rx * 0.96;
  const crossAt: number[] = [];
  for (let k = -3; k <= 3; k++) crossAt.push(k * PITCH);
  const streetsFrom = (entry: XZ, fromEast: boolean, route: number): Polyline[] => {
    const lines: Polyline[] = [];
    const startA = fromEast ? aMax : -aMax;
    const startW = cityToWorld(startA, 0);
    const lead = Math.hypot(startW.x - entry.x, startW.z - entry.z);
    lines.push(groundLine([entry, startW], 0, route));
    const avenue: XZ[] = [];
    for (let t = 0; t <= 1.0001; t += 1 / 40) avenue.push(cityToWorld(startA + (fromEast ? -1 : 1) * t * 2 * aMax, 0));
    lines.push(groundLine(avenue, lead, route));
    for (const a of crossAt) {
      const sAt = lead + Math.abs(a - startA);
      const e = bEdge(a);
      if (e < 30) continue;
      for (const dir of [-1, 1]) {
        const pts: XZ[] = [];
        for (let t = 0; t <= 1.0001; t += 1 / 12) pts.push(cityToWorld(a, dir * t * e));
        lines.push(groundLine(pts, sAt, route));
      }
    }
    return lines;
  };
  const battRoute = ROUTES.find((r) => r.id === R_BATTERY)!;
  const battEnd = battRoute.towers[battRoute.towers.length - 1];
  const streets = [
    ...streetsFrom(SUBSTATION, true, R_STREET_GRID),
    ...streetsFrom(battEnd, false, R_STREET_BATT),
  ];
  return { mesh, streets };
}

/** A polyline laid on the ground, with its distance along the network. */
function groundLine(pts: XZ[], s0: number, route: number): Polyline {
  const points: Vector3[] = [], s: number[] = [];
  let acc = s0;
  // resample so the line hugs the ground
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / 16));
    for (let k = 0; k < n; k++) {
      const t = k / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      points.push(new Vector3(x, heightAt(x, z) + 1.8, z));
      s.push(acc + len * t);
    }
    acc += len;
  }
  const last = pts[pts.length - 1];
  points.push(new Vector3(last.x, heightAt(last.x, last.z) + 1.8, last.z));
  s.push(acc);
  return { points, s, route, width: 3.2, jit: 0, powered: true };
}

export function buildBattery(material: ShaderMaterial, ground: GroundMap) {
  const rng = makeRng(77);
  const boxes: Box[] = [];
  for (const row of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const x = BATTERY.x + (i - 2) * 38, z = BATTERY.z + row * 23;
      const base = heightAt(x, z) - 2;
      boxes.push({ x, y: base + 10.5, z, sx: 34, sy: 21, sz: 16, yaw: 0, seed: rng() });
      ground.shadowRect(x, z, 34, 16, 0, 0.6);
    }
  }
  ground.glow(BATTERY.x, BATTERY.z, 150, 0.5);
  return instancedBoxes(boxes, material);
}

export function buildSolar(material: ShaderMaterial, ground: GroundMap) {
  const boxes: Box[] = [];
  const rows = 7, cols = 4, len = 96, gap = 9;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = SOLAR.x + (c - (cols - 1) / 2) * (len + gap);
      const z = SOLAR.z + (r - (rows - 1) / 2) * 33;
      const base = heightAt(x, z);
      boxes.push({ x, y: base + 11, z, sx: len, sy: 1.4, sz: 21, yaw: 0.04, pitch: 0.5, seed: 0 });
      ground.shadowRect(x + 4, z - 6, len, 18, -0.04, 0.55);
    }
  }
  return instancedBoxes(boxes, material);
}

/**
 * Trees: lumpy foam clumps, as on a model railway, packed into forest patches so
 * they read as canopy. Each is a camera-facing impostor (two triangles) whose
 * outline, relief and shading are drawn in the shader, so thousands cost little.
 */
export function buildTrees(material: ShaderMaterial, ground: GroundMap, count: number) {
  const rng = makeRng(4242);
  const corridors: [XZ, XZ][] = [];
  for (const r of ROUTES) for (let i = 0; i < r.towers.length - 1; i++) corridors.push([r.towers[i], r.towers[i + 1]]);
  const nearSeg = (x: number, z: number, a: XZ, b: XZ) => {
    const vx = b.x - a.x, vz = b.z - a.z, wx = x - a.x, wz = z - a.z;
    const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / (vx * vx + vz * vz)));
    return Math.hypot(wx - vx * t, wz - vz * t);
  };
  const blocked = (x: number, z: number) => {
    if (insideCityWorld(x, z) < 1.4) return true;
    if (Math.abs(x - SOLAR.x) < SOLAR.w * 0.64 && Math.abs(z - SOLAR.z) < SOLAR.d * 0.72) return true;
    if (Math.abs(x - BATTERY.x) < 140 && Math.abs(z - BATTERY.z) < 80) return true;
    if (Math.hypot(x - SUBSTATION.x, z - SUBSTATION.z) < 200) return true;
    for (const [a, b] of corridors) if (nearSeg(x, z, a, b) < 62) return true;
    return false;
  };
  const pos = new Float32Array(count * 3), size = new Float32Array(count * 2), seed = new Float32Array(count);
  let n = 0;
  for (let tries = 0; tries < count * 30 && n < count; tries++) {
    // sample evenly in depth on screen, not in area, so the far land is not overfilled
    const d = 950 + Math.pow(rng(), 1.35) * 4200;
    const x = (rng() * 2 - 1) * d * 1.02, z = CAM_Z - d;
    const patch = smoothstep(0.02, 0.32, fbm(x / 560 + 3.1, z / 560 - 1.7, 3));
    if (rng() > patch) continue;
    if (blocked(x, z)) continue;
    const r = (4.5 + 4 * rng()) * Math.pow(d / 1000, 0.85);
    const h = r * (1.05 + 0.4 * rng());
    pos.set([x, heightAt(x, z) + h * 0.78, z], n * 3);
    size.set([r, h], n * 2);
    seed[n] = rng();
    if (d < 4200) ground.shadow(x, z, r, 0.4);
    n++;
  }
  // shuffle, so lowering the quality thins every forest evenly
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    for (let k = 0; k < 3; k++) [pos[i * 3 + k], pos[j * 3 + k]] = [pos[j * 3 + k], pos[i * 3 + k]];
    [size[i * 2], size[j * 2]] = [size[j * 2], size[i * 2]];
    [size[i * 2 + 1], size[j * 2 + 1]] = [size[j * 2 + 1], size[i * 2 + 1]];
    [seed[i], seed[j]] = [seed[j], seed[i]];
  }
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute("iPos", new InstancedBufferAttribute(pos.subarray(0, n * 3), 3));
  g.setAttribute("iSize", new InstancedBufferAttribute(size.subarray(0, n * 2), 2));
  g.setAttribute("iSeed", new InstancedBufferAttribute(seed.subarray(0, n), 1));
  g.instanceCount = n;
  const mesh = new Mesh(g, material);
  mesh.frustumCulled = false;
  return { mesh, geometry: g, count: n };
}

function insideCityWorld(x: number, z: number) {
  const c = Math.cos(CITY.rot), s = Math.sin(CITY.rot);
  const dx = x - CITY.x, dz = z - CITY.z;
  const a = dx * c - dz * s, b = dx * s + dz * c;
  return insideCity(a, b);
}
