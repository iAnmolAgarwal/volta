/* The History card's mini load curve, as plain SVG paths: a run's mean demand
 * per bucket (`series.mean_kw`, GET /api/runs, at most 48 points) drawn in a
 * 300 × 100 box that the card stretches to its plate (preserveAspectRatio
 * "none", strokes kept unscaled). Pure functions, so sixteen cards cost
 * sixteen strings, not sixteen chart instances.
 *
 * The scale is the landing card chart's (CardCharts.tsx, PeakChart): 0 kW at
 * the floor, the line's peak or 200 kW plus 12% at the top, an 8-unit top
 * margin. The line is a monotone cubic (d3's curveMonotoneX, the
 * Fritsch–Carlson tangents) rather than the landing's natural spline: on 48
 * jumpy points a natural spline overshoots and would draw a bucket under
 * 200 kW across the line. */

export const VIEW_W = 300;
export const VIEW_H = 100;
/** The landing chart's 8 px top margin on its ~122 px plate. */
const TOP_PAD = 7;
/** The landing chart's headroom over the peak. */
const HEADROOM = 1.12;

type Pt = readonly [x: number, y: number];

const f = (n: number) => (Math.round(n * 100) / 100).toString();
const sign = (n: number) => (n < 0 ? -1 : 1);

/** The tangent at each point (screen units), for evenly spaced x. */
function tangents(pts: readonly Pt[]): number[] {
  const n = pts.length;
  if (n < 2) return pts.map(() => 0);
  const h = pts[1][0] - pts[0][0];
  const s = (i: number) => (pts[i + 1][1] - pts[i][1]) / h; // segment i's slope
  if (n === 2) return [s(0), s(0)];
  const t = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const s0 = s(i - 1);
    const s1 = s(i);
    t[i] = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.25 * Math.abs(s0 + s1)) || 0;
  }
  t[0] = (3 * s(0) - t[1]) / 2;
  t[n - 1] = (3 * s(n - 2) - t[n - 2]) / 2;
  return t;
}

/** "M … C …": the monotone cubic through `pts`. */
function linePath(pts: readonly Pt[]): string {
  const t = tangents(pts);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const k = (x1 - x0) / 3;
    d += `C${f(x0 + k)} ${f(y0 + k * t[i])} ${f(x1 - k)} ${f(y1 - k * t[i + 1])} ${f(x1)} ${f(y1)}`;
  }
  return d;
}

export interface CurveGeometry {
  /** The mean line. */
  line: string;
  /** The line closed down to the floor: its gradient fill. */
  area: string;
  /** Where a kW level sits, as a fraction of the box from the top. */
  at: (kw: number) => number;
  /** The line's highest point, as fractions of the box, and its kW. */
  peak: { x: number; y: number; kw: number };
  /** Where the 200 kW line falls inside the fill's box (the line's peak down to the floor), 0 when the line never reaches it: the landing's `over`. */
  over: number;
}

export function curveGeometry(mean: readonly number[], overloadKw: number): CurveGeometry {
  const n = mean.length;
  let k = 0;
  for (let i = 1; i < n; i++) if (mean[i] > mean[k]) k = i;
  const peakKw = mean[k];
  const top = Math.max(peakKw, overloadKw) * HEADROOM || 1;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * VIEW_W : VIEW_W / 2);
  const y = (v: number) => TOP_PAD + (VIEW_H - TOP_PAD) * (1 - Math.max(0, Math.min(v, top)) / top);
  const pts: Pt[] = mean.map((v, i) => [x(i), y(v)]);
  const line = linePath(pts);

  return {
    line,
    area: `${line}L${f(VIEW_W)} ${f(VIEW_H)}L0 ${f(VIEW_H)}Z`,
    at: (kw) => y(kw) / VIEW_H,
    peak: { x: pts[k][0] / VIEW_W, y: pts[k][1] / VIEW_H, kw: peakKw },
    over: peakKw > overloadKw ? (peakKw - overloadKw) / peakKw : 0,
  };
}
