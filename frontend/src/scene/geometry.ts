// Procedural geometry for the network's hardware: lattice pylons, distribution
// poles and substation gantries, each merged into one BufferGeometry so it can be
// instanced in a single draw.
import { BufferAttribute, BufferGeometry, Vector3 } from "three";

/** Accumulates square-section beams between two points into one geometry. */
class Beams {
  private pos: number[] = [];
  private nrm: number[] = [];
  private idx: number[] = [];
  private d = new Vector3();
  private u = new Vector3();
  private v = new Vector3();
  private n = new Vector3();

  beam(a: Vector3, b: Vector3, t: number) {
    const { d, u, v, n } = this;
    d.subVectors(b, a).normalize();
    const ref = Math.abs(d.y) < 0.95 ? UP : SIDE;
    u.crossVectors(d, ref).normalize().multiplyScalar(t / 2);
    v.crossVectors(u, d).normalize().multiplyScalar(t / 2);
    // four faces, each with its own normal; the ends are never seen
    const corners = [
      [1, 1], [-1, 1], [-1, -1], [1, -1],
    ];
    for (let f = 0; f < 4; f++) {
      const c0 = corners[f], c1 = corners[(f + 1) % 4];
      n.set(0, 0, 0).addScaledVector(u, c0[0] + c1[0]).addScaledVector(v, c0[1] + c1[1]).normalize();
      const base = this.pos.length / 3;
      for (const [p, c] of [[a, c0], [a, c1], [b, c1], [b, c0]] as const) {
        this.pos.push(p.x + u.x * c[0] + v.x * c[1], p.y + u.y * c[0] + v.y * c[1], p.z + u.z * c[0] + v.z * c[1]);
        this.nrm.push(n.x, n.y, n.z);
      }
      this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }

  /** A closed box (for transformers and the like), axis-aligned at centre c. */
  box(c: Vector3, sx: number, sy: number, sz: number) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const faces: [number[], number[][]][] = [
      [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
      [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
      [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
      [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
      [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
    ];
    for (const [nn, vs] of faces) {
      const base = this.pos.length / 3;
      for (const p of vs) {
        this.pos.push(c.x + p[0] * hx, c.y + p[1] * hy, c.z + p[2] * hz);
        this.nrm.push(nn[0], nn[1], nn[2]);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const UP = new Vector3(0, 1, 0);
const SIDE = new Vector3(1, 0, 0);
const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

export interface Hardware {
  geometry: BufferGeometry;
  /** conductor attachment points in local space (line runs along local z) */
  attach: Vector3[];
  /** the earth wire's attachment point, if any */
  earth?: Vector3;
  height: number;
}

/**
 * A double-circuit lattice pylon, 300 units tall (about 50 m at the world's scale).
 * `lod` 1 is the far version: fewer panels and thicker members, so it does not
 * shimmer when it is a few pixels tall in the haze. `weight` thickens every member,
 * for the hero towers near the camera, so they hold a bold silhouette.
 */
export function latticePylon(lod: 0 | 1, weight = 1): Hardware {
  const b = new Beams();
  const k = (lod ? 1.9 : 1) * weight;
  const tLeg = 2.6 * k, tBrace = 1.15 * k, tArm = 1.7 * k;
  // half-width of the body at height y
  const w = (y: number) => {
    if (y <= 150) return 30 + (13.5 - 30) * (y / 150);
    if (y <= 200) return 13.5 + (9 - 13.5) * ((y - 150) / 50);
    return 9 + (4.2 - 9) * ((y - 200) / 100);
  };
  const levels = lod
    ? [0, 50, 92, 126, 152, 178, 205, 238, 270, 300]
    : [0, 24, 46, 66, 84, 100, 114, 127, 139, 150, 162, 174, 186, 196, 205, 216, 228, 238, 250, 262, 270, 284, 300];
  const C = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (let i = 0; i < levels.length - 1; i++) {
    const y0 = levels[i], y1 = levels[i + 1], w0 = w(y0), w1 = w(y1);
    for (let c = 0; c < 4; c++) {
      const [sx, sz] = C[c], [tx, tz] = C[(c + 1) % 4];
      b.beam(V(sx * w0, y0, sz * w0), V(sx * w1, y1, sz * w1), tLeg); // leg
      if (i > 0 || lod === 0) b.beam(V(sx * w1, y1, sz * w1), V(tx * w1, y1, tz * w1), tBrace); // ring
      // the X on each face
      b.beam(V(sx * w0, y0, sz * w0), V(tx * w1, y1, tz * w1), tBrace);
      b.beam(V(tx * w0, y0, tz * w0), V(sx * w1, y1, sz * w1), tBrace);
    }
  }
  // the legs run on below 0 so the tower stands into a slope instead of floating on it
  for (const [sx, sz] of C) b.beam(V(sx * 32, -30, sz * 32), V(sx * w(0), 0, sz * w(0)), tLeg);
  // three cross-arms a side: the middle one longest, as on a double-circuit tower
  const arms: [number, number][] = [[205, 56], [238, 64], [270, 48]];
  const attach: Vector3[] = [];
  for (const side of [-1, 1]) {
    for (const [ya, L] of arms) {
      const wa = w(ya), wt = w(ya + 12);
      const tip = V(side * L, ya, 0);
      b.beam(V(side * wa, ya, wa), tip, tArm);
      b.beam(V(side * wa, ya, -wa), tip, tArm);
      b.beam(V(side * wt, ya + 12, wt), tip, tBrace);
      b.beam(V(side * wt, ya + 12, -wt), tip, tBrace);
      if (lod === 0) {
        const mid = V(side * (wa + (L - wa) * 0.5), ya, 0);
        b.beam(V(side * wt, ya + 12, 0), mid, tBrace);
      }
      // the insulator string, and the conductor hung from it
      b.beam(tip, V(side * L, ya - 17, 0), 2.4 * k);
      attach.push(V(side * L, ya - 17, 0));
    }
  }
  // the earth-wire peak
  b.beam(V(-4.2, 300, 0), V(0, 312, 0), tArm);
  b.beam(V(4.2, 300, 0), V(0, 312, 0), tArm);
  return { geometry: b.build(), attach, earth: V(0, 312, 0), height: 312 };
}

/** A distribution pole with one cross-arm and three conductors. */
export function distributionPole(): Hardware {
  const b = new Beams();
  b.beam(V(0, -4, 0), V(0, 96, 0), 3.6);
  b.beam(V(-24, 86, 0), V(24, 86, 0), 2.6);
  b.beam(V(-14, 86, 0), V(0, 74, 0), 1.4);
  b.beam(V(14, 86, 0), V(0, 74, 0), 1.4);
  const attach = [V(-20, 91, 0), V(0, 100, 0), V(20, 91, 0)];
  b.beam(V(-20, 86, 0), attach[0], 2.2);
  b.beam(V(0, 96, 0), attach[1], 2.2);
  b.beam(V(20, 86, 0), attach[2], 2.2);
  return { geometry: b.build(), attach, height: 100 };
}

/** A substation gantry: a portal frame the incoming circuits terminate on. */
export function gantry(): Hardware {
  const b = new Beams();
  for (const x of [-66, 66]) {
    // each column is a narrow lattice
    for (const dz of [-5, 5]) b.beam(V(x, 0, dz), V(x, 118, dz), 2.6);
    for (let y = 0; y < 118; y += 20) {
      b.beam(V(x, y, -5), V(x, y + 20, 5), 1.1);
      b.beam(V(x, y, 5), V(x, y + 20, -5), 1.1);
    }
  }
  for (const dz of [-5, 5]) {
    b.beam(V(-68, 112, dz), V(68, 112, dz), 2.4);
    b.beam(V(-68, 100, dz), V(68, 100, dz), 1.6);
  }
  for (let x = -66; x < 66; x += 22) b.beam(V(x, 100, 0), V(x + 22, 112, 0), 1.1);
  const attach: Vector3[] = [];
  for (let i = 0; i < 6; i++) {
    const x = -55 + i * 22;
    b.beam(V(x, 100, 0), V(x, 88, 0), 2.2);
    attach.push(V(x, 88, 0));
  }
  return { geometry: b.build(), attach, earth: V(0, 112, 0), height: 118 };
}

/** The substation's transformers and switchgear: a few closed boxes. */
export function substationKit(): BufferGeometry {
  const b = new Beams();
  const boxes: [number, number, number, number, number, number][] = [
    [-60, 15, -70, 40, 30, 28],
    [-10, 15, -70, 40, 30, 28],
    [40, 13, -72, 34, 26, 26],
    [-36, 9, 60, 60, 18, 24],
    [36, 9, 60, 46, 18, 24],
  ];
  for (const [x, y, z, sx, sy, sz] of boxes) b.box(V(x, y, z), sx, sy, sz);
  // bus bars between the gantries
  for (const x of [-44, 0, 44]) {
    b.beam(V(x, 0, -34), V(x, 54, -34), 2.2);
    b.beam(V(x, 0, 24), V(x, 54, 24), 2.2);
    b.beam(V(x, 54, -34), V(x, 54, 24), 1.6);
  }
  return b.build();
}
