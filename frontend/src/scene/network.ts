// Places the towers of every route on the land and hangs the conductors between
// them as catenaries. The wires carry a distance along their route (`s`), which is
// what the pulse shader runs along, source to sink.
import { Matrix4, Quaternion, Vector3 } from "three";
import type { Hardware } from "./geometry";
import { CAM_Z, heightAt, ROUTES, type TowerSpec } from "./world";

export interface Polyline {
  points: Vector3[];
  s: number[]; // distance along the route at each point
  route: number;
  width: number; // world units
  jit: number; // a per-conductor phase offset, so parallel wires don't march in lockstep
  powered: boolean; // the earth wire never carries current
  glow: number; // how wide its halo is: overhead lines glow, streets keep a tight one
}

export interface PlacedTower { spec: TowerSpec; matrix: Matrix4; pos: Vector3; dist: number; route: number }

export interface Network {
  towers: PlacedTower[];
  wires: Polyline[];
  /** total length of each route's centre line */
  routeLength: number[];
  /** where each route ends (its sink) */
  ends: Vector3[];
}

const Y = new Vector3(0, 1, 0);

export type HardwareSet = Record<"lattice" | "hero" | "pole" | "gantry", Hardware>;

const hardwareOf = (hw: HardwareSet, t: TowerSpec) => (t.hero ? hw.hero : hw[t.kind]);

export function buildNetwork(hw: HardwareSet): Network {
  const towers: PlacedTower[] = [];
  const wires: Polyline[] = [];
  const routeLength: number[] = [];
  const ends: Vector3[] = [];
  const q = new Quaternion();
  const tmp = new Vector3();

  for (const route of ROUTES) {
    const ts = route.towers;
    const placed: PlacedTower[] = [];
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      const prev = ts[Math.max(0, i - 1)], next = ts[Math.min(ts.length - 1, i + 1)];
      // arms square to the bisector of the incoming and outgoing spans
      const inX = t.x - prev.x, inZ = t.z - prev.z, outX = next.x - t.x, outZ = next.z - t.z;
      const li = Math.hypot(inX, inZ) || 1, lo = Math.hypot(outX, outZ) || 1;
      let dx = inX / li + outX / lo, dz = inZ / li + outZ / lo;
      if (i === 0) { dx = outX / lo; dz = outZ / lo; }
      if (i === ts.length - 1) { dx = inX / li; dz = inZ / li; }
      const yaw = Math.atan2(dx, dz);
      const pos = new Vector3(t.x, heightAt(t.x, t.z) - 3 - (t.drop ?? 0), t.z);
      const s = t.scale ?? 1;
      const m = new Matrix4().compose(pos, q.setFromAxisAngle(Y, yaw), tmp.set(s, s, s));
      const p: PlacedTower = { spec: t, matrix: m, pos, dist: CAM_Z - t.z, route: route.id };
      placed.push(p);
      towers.push(p);
    }

    let s0 = 0;
    for (let i = 0; i < placed.length - 1; i++) {
      const A = placed[i], B = placed[i + 1];
      const ha = hardwareOf(hw, A.spec), hb = hardwareOf(hw, B.spec);
      const span = Math.hypot(B.pos.x - A.pos.x, B.pos.z - A.pos.z);
      const heavy = A.spec.kind !== "pole";
      const sag = span * (heavy ? 0.05 : 0.035);
      const segs = Math.max(12, Math.min(40, Math.round(span / 22)));
      const n = Math.min(ha.attach.length, hb.attach.length);
      const pairs: [Vector3, Vector3, boolean][] = [];
      // attachment points are ordered left circuit then right circuit on every kind
      // of tower, so index c meets index c and the circuits never cross. A bundled
      // route hangs each phase as twin sub-conductors, side by side along the arm.
      const bundle = route.bundle ?? 1;
      for (let c = 0; c < n; c++) {
        for (let k = 0; k < bundle; k++) {
          const off = bundle > 1 ? (k - (bundle - 1) / 2) * 6.5 : 0;
          pairs.push([ha.attach[c].clone().setX(ha.attach[c].x + off), hb.attach[c].clone().setX(hb.attach[c].x + off), true]);
        }
      }
      if (ha.earth && hb.earth && !A.spec.noEarth && !B.spec.noEarth) pairs.push([ha.earth, hb.earth, false]);
      pairs.forEach(([la, lb, powered], c) => {
        const pa = la.clone().applyMatrix4(A.matrix), pb = lb.clone().applyMatrix4(B.matrix);
        const points: Vector3[] = [], ss: number[] = [];
        for (let k = 0; k <= segs; k++) {
          const t = k / segs;
          const p = new Vector3().lerpVectors(pa, pb, t);
          p.y -= sag * 4 * t * (1 - t);
          points.push(p);
          ss.push(s0 + t * span);
        }
        wires.push({
          points, s: ss, route: route.id,
          width: powered ? (heavy ? (bundle > 1 ? 1.3 : 1.8) : 1.5) : 0.9,
          jit: Math.floor(c / bundle) * 0.012,
          powered,
          glow: 1,
        });
      });
      s0 += span;
    }
    routeLength[route.id] = s0;
    ends[route.id] = placed[placed.length - 1].pos.clone();
  }
  return { towers, wires, routeLength, ends };
}
