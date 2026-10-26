// The miniature world's layout: the camera, the land, and where every structure stands.
//
// The camera is framed on Sylva's 1600 x 880 artboard (the page's --u scale), so a
// landmark can be put where the copy was laid out around it: a world point at
// z = 0 lands 1:1 on artboard units, and the optic centre sits on the artboard
// centre. The camera never pitches: verticals stay vertical, like a shift lens on
// an architectural model, which is what makes the pylons read as engineered.
import { fbm, smoothstep } from "./noise";

export const FOCAL = 1400; // artboard units; also the camera's distance to z = 0
export const CAM_Z = 1400;
export const OPTIC_X = 800;
export const OPTIC_Y = 440;
export const GROUND = -520; // the valley floor, 520 units below the eye

export interface XZ { x: number; z: number }

/* ── the land ──────────────────────────────────────────────────────────── */

interface Bump { x: number; z: number; rx: number; rz: number; h: number }
// Composition (see spec, "3D scene"): a crest on the left behind the play button,
// the valley and its city in the middle, and a shoulder climbing to the right,
// where the big pylon stands against card 1.
const BUMPS: Bump[] = [
  { x: -1180, z: -1950, rx: 760, rz: 560, h: 300 }, // left crest
  { x: -2150, z: -3300, rx: 900, rz: 700, h: 280 }, // left, further back
  { x: -380, z: -2700, rx: 700, rz: 500, h: 170 }, // behind the city, low
  { x: 420, z: 20, rx: 460, rz: 460, h: 250 }, // right shoulder (the big pylon)
  { x: 980, z: -380, rx: 620, rz: 760, h: 290 }, // its ridge, running back behind card 2
  { x: 820, z: -2200, rx: 700, rz: 520, h: 210 }, // right, far
  { x: -620, z: 430, rx: 430, rz: 300, h: 215 }, // foreground mound, bottom left
  { x: -1500, z: -300, rx: 600, rz: 500, h: 200 }, // left edge
  { x: 1400, z: 600, rx: 520, rz: 400, h: 190 }, // foreground, bottom right
];

interface Flat { x: number; z: number; rx: number; rz: number; level: number }
export const CITY = { x: 40, z: -1010, rx: 330, rz: 250, rot: -0.2 };
export const SOLAR = { x: -720, z: -470, w: 430, d: 230 };
export const BATTERY = { x: -330, z: -650, w: 170, d: 70 };
export const SUBSTATION = { x: 360, z: -840 };

const FLATS: Flat[] = [
  { x: CITY.x, z: CITY.z, rx: CITY.rx + 90, rz: CITY.rz + 90, level: 4 },
  { x: SOLAR.x, z: SOLAR.z, rx: SOLAR.w * 0.62, rz: SOLAR.d * 0.72, level: 46 },
  { x: BATTERY.x, z: BATTERY.z, rx: 130, rz: 80, level: 26 },
  { x: SUBSTATION.x, z: SUBSTATION.z, rx: 120, rz: 100, level: 10 },
];

const bump = (x: number, z: number, b: Bump) => {
  const dx = (x - b.x) / b.rx, dz = (z - b.z) / b.rz;
  return b.h * Math.exp(-(dx * dx + dz * dz) * 1.6);
};

/** Terrain height (world y) at (x, z). */
export function heightAt(x: number, z: number): number {
  let h = 34 * fbm(x / 640, z / 640, 4) + 12 * fbm(x / 170, z / 170, 3);
  for (const b of BUMPS) h += bump(x, z, b);
  // the far ridge on the horizon, where the distant pylons come from
  const far = smoothstep(-3000, -4300, z);
  h += far * (230 + 140 * fbm(x / 1300, 3.7, 3));
  for (const f of FLATS) {
    const dx = (x - f.x) / f.rx, dz = (z - f.z) / f.rz;
    const m = 1 - smoothstep(0.7, 1.15, Math.sqrt(dx * dx + dz * dz));
    if (m > 0) h += (f.level + 4 * fbm(x / 90, z / 90, 2) - h) * m;
  }
  return GROUND + h;
}

/** Gravel roads, painted into the ground map: the land is lived in. */
export const ROADS: XZ[][] = [
  [{ x: 60, z: 760 }, { x: 10, z: 320 }, { x: -110, z: -90 }, { x: -170, z: -400 }, { x: -130, z: -640 }, { x: -60, z: -790 }],
  [{ x: -170, z: -400 }, { x: -260, z: -560 }, { x: -330, z: -610 }, { x: -470, z: -560 }, { x: -540, z: -480 }],
  [{ x: 290, z: -930 }, { x: 350, z: -860 }],
  [{ x: -270, z: -1120 }, { x: -520, z: -1330 }, { x: -760, z: -1460 }, { x: -1060, z: -1700 }, { x: -1500, z: -1850 }],
];

/* ── the network ───────────────────────────────────────────────────────── */

export type TowerKind = "lattice" | "pole" | "gantry";
export interface TowerSpec extends XZ { kind: TowerKind; scale?: number; noEarth?: boolean }

// Route ids are shared with the wire shader's per-route uniforms.
export const R_GRID_FAR = 0; // grid in from the distant pylons on the left
export const R_GRID_NEAR = 1; // grid over the right shoulder, past card 1
export const R_SOLAR = 2; // solar field -> battery
export const R_BATTERY = 3; // battery -> city
export const R_STREET_GRID = 4; // the substation feeding the streets
export const R_STREET_BATT = 5; // the battery feeding the streets
export const ROUTE_COUNT = 6;

export interface RouteSpec { id: number; towers: TowerSpec[] }

// Each route is listed source first; pulses travel in list order.
export const ROUTES: RouteSpec[] = [
  {
    id: R_GRID_FAR,
    towers: [
      { kind: "lattice", x: -3250, z: -5300 },
      { kind: "lattice", x: -2700, z: -4700 },
      { kind: "lattice", x: -2150, z: -4050 },
      { kind: "lattice", x: -1640, z: -3450 },
      { kind: "lattice", x: -1150, z: -2900 },
      { kind: "lattice", x: -680, z: -2380 },
      { kind: "lattice", x: -240, z: -1900 },
      { kind: "lattice", x: 150, z: -1420 },
      { kind: "gantry", x: SUBSTATION.x - 10, z: SUBSTATION.z - 70 },
    ],
  },
  {
    id: R_GRID_NEAR,
    towers: [
      // just off-frame on the right: its span drops behind card 2, below the stats
      { kind: "lattice", x: 720, z: 340, noEarth: true },
      { kind: "lattice", x: 380, z: 35 }, // the big one, at card 1's shoulder
      { kind: "lattice", x: 390, z: -420 },
      { kind: "gantry", x: SUBSTATION.x + 30, z: SUBSTATION.z + 60 },
    ],
  },
  {
    id: R_SOLAR,
    towers: [
      { kind: "pole", x: SOLAR.x + SOLAR.w * 0.5 + 20, z: SOLAR.z - 40 },
      { kind: "pole", x: -420, z: -560 },
      { kind: "pole", x: BATTERY.x - BATTERY.w * 0.5 - 10, z: BATTERY.z + 10 },
    ],
  },
  {
    id: R_BATTERY,
    towers: [
      { kind: "pole", x: BATTERY.x + BATTERY.w * 0.5 + 12, z: BATTERY.z - 10 },
      { kind: "pole", x: -190, z: -760 },
      { kind: "pole", x: -250, z: -880 },
    ],
  },
];
