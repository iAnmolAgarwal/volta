// Frames the world on the page's artboard. The scene is composed on Sylva's
// 1600 x 880 artboard ("virtual" units). On desktop the artboard is the centred
// stage, so card 1 at (890, 200) is exactly where the scene expects it. Below
// 900 px, Sylva's one-column layout turns the landscape into a band between the
// stats and the cards, so a crop of the artboard is scaled into that band.
import type { PerspectiveCamera } from "three";
import { FOCAL, OPTIC_X, OPTIC_Y } from "./world";

export interface Frame {
  W: number; // canvas CSS px
  H: number;
  u: number; // CSS px per page unit (the --u token)
  k: number; // CSS px per artboard unit
  ox: number; // where artboard (0, 0) lands on the canvas, CSS px
  oy: number;
  narrow: boolean;
}

/** Below 900 px: artboard point NARROW.vx/vy lands on page units NARROW.x/y, scaled by NARROW.k. */
export const NARROW = { k: 0.66, vx: 725, vy: 330, x: 380, y: 610, fadeFrom: 1000, fadeTo: 1080 };

export function computeFrame(W: number, H: number, u: number, narrow: boolean): Frame {
  if (!narrow) {
    // the stage is centred in the hero (Sylva: .stage with negative margins)
    return { W, H, u, k: u, ox: (W - 1600 * u) / 2, oy: (H - 880 * u) / 2, narrow };
  }
  const k = NARROW.k * u;
  return { W, H, u, k, ox: NARROW.x * u - NARROW.vx * k, oy: NARROW.y * u - NARROW.vy * k, narrow };
}

/** An off-axis projection whose image plane is the artboard: verticals stay vertical. */
export function applyProjection(cam: PerspectiveCamera, f: Frame) {
  const n = cam.near;
  const vx0 = -f.ox / f.k, vx1 = (f.W - f.ox) / f.k;
  const vy0 = -f.oy / f.k, vy1 = (f.H - f.oy) / f.k;
  const left = ((vx0 - OPTIC_X) / FOCAL) * n, right = ((vx1 - OPTIC_X) / FOCAL) * n;
  const top = (-(vy0 - OPTIC_Y) / FOCAL) * n, bottom = (-(vy1 - OPTIC_Y) / FOCAL) * n;
  cam.projectionMatrix.makePerspective(left, right, top, bottom, n, cam.far);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
}
