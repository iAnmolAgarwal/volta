/* The History card's mini load curve, as plain SVG paths: a run's `series`
 * (GET /api/runs, at most 48 equal buckets of mean and max kW) drawn in a
 * 300 × 100 box that the card stretches to its plate (preserveAspectRatio
 * "none", strokes kept unscaled). Pure functions, so sixteen cards cost
 * sixteen strings, not sixteen chart instances.
 *
 * The line is a monotone cubic through the points (d3's curveMonotoneX, the
 * Fritsch–Carlson tangents): unlike the landing chart's natural spline it
 * never overshoots, so a bucket under 200 kW never appears to cross the line. */

export const VIEW_W = 300;
export const VIEW_H = 100;
/** Headroom over the scale's top, as the landing chart's 8-unit top margin, so a peak never touches the plate's rounded edge. */
const TOP_PAD = 12;

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

/** The cubic segments through `pts`, forward ("C …" after an M), or backward when `reverse`. */
function segments(pts: readonly Pt[], reverse = false): string {
  const t = tangents(pts);
  const out: string[] = [];
  if (!reverse) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const d = (x1 - x0) / 3;
      out.push(`C${f(x0 + d)} ${f(y0 + d * t[i])} ${f(x1 - d)} ${f(y1 - d * t[i + 1])} ${f(x1)} ${f(y1)}`);
    }
  } else {
    for (let i = pts.length - 1; i > 0; i--) {
      const [x1, y1] = pts[i];
      const [x0, y0] = pts[i - 1];
      const d = (x1 - x0) / 3;
      out.push(`C${f(x1 - d)} ${f(y1 - d * t[i])} ${f(x0 + d)} ${f(y0 + d * t[i - 1])} ${f(x0)} ${f(y0)}`);
    }
  }
  return out.join("");
}

export interface CurveGeometry {
  /** The mean line. */
  mean: string;
  /** The mean line closed down to the floor (its gradient fill). */
  meanArea: string;
  /** The max line. */
  max: string;
  /** The max line closed down to the floor (tinted only above 200 kW). */
  maxArea: string;
  /** The band between max and mean: the faint envelope. */
  envelope: string;
  /** Where a kW level sits, as a fraction of the box from the top. */
  at: (kw: number) => number;
  /** The highest max bucket, as fractions of the box. */
  peak: { x: number; y: number; kw: number };
}

/** The curve for a series on a shared scale of lo … hi kW (so every card's 200 kW line sits at one height). */
export function curveGeometry(mean: readonly number[], max: readonly number[], lo: number, hi: number): CurveGeometry {
  const n = mean.length;
  const span = hi > lo ? hi - lo : 1;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * VIEW_W : VIEW_W / 2);
  const y = (v: number) => TOP_PAD + (VIEW_H - TOP_PAD) * (1 - (Math.max(lo, Math.min(v, lo + span)) - lo) / span);
  const pm: Pt[] = mean.map((v, i) => [x(i), y(v)]);
  const px: Pt[] = max.map((v, i) => [x(i), y(Math.max(v, mean[i]))]);

  const line = (pts: Pt[]) => `M${f(pts[0][0])} ${f(pts[0][1])}${segments(pts)}`;
  const floor = (pts: Pt[]) => `${line(pts)}L${f(VIEW_W)} ${f(VIEW_H)}L0 ${f(VIEW_H)}Z`;

  let k = 0;
  for (let i = 1; i < n; i++) if (max[i] > max[k]) k = i;

  return {
    mean: line(pm),
    meanArea: floor(pm),
    max: line(px),
    maxArea: floor(px),
    envelope: `${line(px)}L${f(pm[n - 1][0])} ${f(pm[n - 1][1])}${segments(pm, true)}Z`,
    at: (kw) => y(kw) / VIEW_H,
    peak: { x: px[k][0] / VIEW_W, y: px[k][1] / VIEW_H, kw: max[k] },
  };
}
