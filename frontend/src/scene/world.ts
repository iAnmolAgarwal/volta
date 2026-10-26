// The miniature world's layout: the camera, the land, and where every structure stands.
//
// The camera is framed on Sylva's 1600 x 880 artboard (the page's --u scale), so a
// landmark can be put where the copy was laid out around it: a world point at
// z = 0 lands 1:1 on artboard units, and the optic centre sits on the artboard
// centre. The camera never pitches: verticals stay vertical, like a shift lens on
// an architectural model, which is what makes the pylons read as engineered.
//
// Composition (spec, "3D scene"; Sylva's root arc): one hero transmission line is
// the structure. It rises out of the bottom edge, between the cards, to a big
// pylon at card 1's shoulder, then arcs down to the left through a second pylon
// standing in the valley mist and into the city's substation. The city sits on a
// terrace above the mist, in the middle of the lower half. The low valley floor is
// mist (the page shows through it, with the ghost word), and the far land
// dissolves into the page.
import { fbm, smoothstep } from "./noise";

export const FOCAL = 1400; // artboard units; also the camera's distance to z = 0
export const CAM_Z = 1400;
export const OPTIC_X = 800;
export const OPTIC_Y = 440;
export const GROUND = -520; // the valley floor, 520 units below the eye

/** Heights above GROUND where the valley mist is thick, and where it has cleared. */
export const MIST = { full: 62, clear: 168 };

export interface XZ { x: number; z: number }

/* ── the land ──────────────────────────────────────────────────────────── */

interface Bump { x: number; z: number; rx: number; rz: number; h: number }
const BUMPS: Bump[] = [
  { x: -880, z: -500, rx: 440, rz: 360, h: 250 }, // left hill: the solar field on top, the battery at its foot
  { x: -1560, z: -820, rx: 520, rz: 560, h: 240 }, // its shoulder, running off the left edge
  { x: -600, z: 330, rx: 340, rz: 220, h: 246 }, // the dark mound in the foreground, bottom left
  { x: -470, z: -630, rx: 480, rz: 330, h: 172 }, // the city's terrace
  { x: 330, z: 430, rx: 300, rz: 260, h: 262 }, // the right shoulder under the big pylon
  { x: 820, z: -90, rx: 520, rz: 520, h: 300 }, // its ridge, running back behind card 2
  { x: 800, z: 320, rx: 400, rz: 280, h: 225 }, // the ridge's foot, bottom right
  { x: 380, z: -1200, rx: 560, rz: 380, h: 210 }, // a hill behind the substation
  { x: -820, z: -1550, rx: 700, rz: 420, h: 200 }, // the hills behind the city, fading
  { x: -2100, z: -2300, rx: 900, rz: 700, h: 260 }, // far left
];

interface Flat { x: number; z: number; rx: number; rz: number; level: number }
export const CITY = { x: -432, z: -585, rx: 214, rz: 180, rot: -0.1 };
export const SOLAR = { x: -830, z: -450, w: 280, d: 160 };
export const BATTERY = { x: -800, z: -322, w: 156, d: 66 };
export const SUBSTATION = { x: -118, z: -616 };
/** The hero line's towers: H0 below the frame, H1 at card 1's shoulder, H2 in the mist. */
export const HERO = {
  h0: { x: 34, z: 930 },
  h1: { x: 262, z: 438 },
  h2: { x: 22, z: -86 },
};

const FLATS: Flat[] = [
  { x: CITY.x, z: CITY.z, rx: CITY.rx + 70, rz: CITY.rz + 60, level: 176 },
  { x: SOLAR.x, z: SOLAR.z, rx: SOLAR.w * 0.82, rz: SOLAR.d * 0.9, level: 232 },
  { x: BATTERY.x, z: BATTERY.z, rx: 112, rz: 64, level: 168 },
  { x: SUBSTATION.x, z: SUBSTATION.z, rx: 104, rz: 92, level: 170 },
];

const bump = (x: number, z: number, b: Bump) => {
  const dx = (x - b.x) / b.rx, dz = (z - b.z) / b.rz;
  return b.h * Math.exp(-(dx * dx + dz * dz) * 1.6);
};

/** Terrain height (world y) at (x, z). */
export function heightAt(x: number, z: number): number {
  let h = 26 * fbm(x / 640, z / 640, 4) + 10 * fbm(x / 170, z / 170, 3) + 14;
  for (const b of BUMPS) h += bump(x, z, b);
  // the land rolls on into the distance, where it dissolves into the page
  const far = smoothstep(-1800, -3200, z);
  h += far * (120 + 90 * fbm(x / 1100, 3.7, 3));
  for (const f of FLATS) {
    const dx = (x - f.x) / f.rx, dz = (z - f.z) / f.rz;
    const m = 1 - smoothstep(0.7, 1.15, Math.sqrt(dx * dx + dz * dz));
    if (m > 0) h += (f.level + 3 * fbm(x / 90, z / 90, 2) - h) * m;
  }
  return GROUND + h;
}

/** Gravel roads, laid on the land as ribbons: the land is lived in. */
export const ROADS: XZ[][] = [
  // from the mist up the terrace into the city
  [{ x: -330, z: -110 }, { x: -380, z: -250 }, { x: -432, z: -392 }],
  // along the terrace front to the battery, then up to the solar field
  [{ x: -432, z: -392 }, { x: -560, z: -372 }, { x: -700, z: -350 }, { x: -800, z: -385 }, { x: -880, z: -440 }],
  // the substation's access
  [{ x: -232, z: -580 }, { x: -150, z: -606 }],
  // out of the city's back, into the haze
  [{ x: -480, z: -780 }, { x: -620, z: -1010 }, { x: -860, z: -1270 }, { x: -1180, z: -1500 }],
];

/* ── the network ───────────────────────────────────────────────────────── */

export type TowerKind = "lattice" | "pole" | "gantry";
export interface TowerSpec extends XZ { kind: TowerKind; scale?: number; noEarth?: boolean; hero?: boolean; drop?: number }

// Route ids are shared with the wire shader's per-route uniforms.
export const R_GRID_FAR = 0; // grid in from the distant pylons on the left
export const R_GRID_NEAR = 1; // the hero line: up past card 1 and down into the city
export const R_SOLAR = 2; // solar field -> battery
export const R_BATTERY = 3; // battery -> city
export const R_STREET_GRID = 4; // the substation feeding the streets
export const R_STREET_BATT = 5; // the battery feeding the streets
export const ROUTE_COUNT = 6;

export interface RouteSpec { id: number; towers: TowerSpec[]; bundle?: number }

// Each route is listed source first; pulses travel in list order.
export const ROUTES: RouteSpec[] = [
  {
    id: R_GRID_FAR,
    towers: [
      { kind: "lattice", x: -3300, z: -4300 },
      { kind: "lattice", x: -2650, z: -3700 },
      { kind: "lattice", x: -2020, z: -3100 },
      { kind: "lattice", x: -1430, z: -2520 },
      { kind: "lattice", x: -880, z: -1980 },
      { kind: "lattice", x: -420, z: -1520 },
      { kind: "lattice", x: -40, z: -1110 },
      { kind: "gantry", x: SUBSTATION.x + 6, z: SUBSTATION.z - 66 },
    ],
  },
  {
    id: R_GRID_NEAR,
    bundle: 2, // twin sub-conductors per phase: the hero line reads heavier
    towers: [
      // below the frame, sunk into a cutting: on the one-column layout its span
      // crosses card 1 and runs on behind card 2, so no wire ends in the air
      { kind: "lattice", ...HERO.h0, hero: true, noEarth: true, drop: 120 },
      { kind: "lattice", ...HERO.h1, hero: true },
      { kind: "lattice", ...HERO.h2, hero: true },
      { kind: "gantry", x: SUBSTATION.x + 18, z: SUBSTATION.z + 64 },
    ],
  },
  {
    id: R_SOLAR,
    towers: [
      { kind: "pole", x: SOLAR.x + 70, z: SOLAR.z + SOLAR.d * 0.5 + 18 },
      { kind: "pole", x: BATTERY.x - 40, z: BATTERY.z - 52 },
    ],
  },
  {
    id: R_BATTERY,
    towers: [
      // along the terrace front, into the middle of the city from the south
      { kind: "pole", x: BATTERY.x + BATTERY.w * 0.5 + 14, z: BATTERY.z + 2 },
      { kind: "pole", x: -660, z: -352 },
      { kind: "pole", x: -572, z: -366 },
      { kind: "pole", x: -486, z: -378 },
    ],
  },
];
