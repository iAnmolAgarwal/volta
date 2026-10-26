import { useId, useMemo } from "react";
import { cssVars } from "@/components/landing/cssVars";
import { OVERLOAD_AT_KW } from "@/lib/forecast";
import { curveGeometry, VIEW_H, VIEW_W } from "./curve";
import type { CurveScale, RunSeries } from "./model";

/* The run's shape in its moss plate, in the look of the landing's Field Note
 * chart (CardCharts.tsx, PeakChart): the lime line with its soft glow over a
 * lime gradient that fades to the floor, the faint dashed 200 kW reference,
 * and only the part above 200 kW tinted with --flow-overload. A series of
 * buckets also has a max per bucket, drawn as a faint envelope over the mean.
 *
 * Plain SVG, no chart instance: two stretched layers (the fills, then the line
 * with a screen-space glow), plus the reference line and the peak dot as HTML
 * so the dashes and the dot keep their shape at any plate width. */

export function RunCurve({ series, scale, label }: { series: RunSeries; scale: CurveScale; label: string }) {
  const uid = useId().replace(/:/g, "");
  const g = useMemo(() => curveGeometry(series.mean_kw, series.max_kw, scale.lo, scale.hi), [series, scale]);
  const ref = g.at(OVERLOAD_AT_KW);
  const over = g.peak.kw >= OVERLOAD_AT_KW;
  const box = `0 0 ${VIEW_W} ${VIEW_H}`;

  return (
    <div className="vh-curve" role="img" aria-label={label}>
      <svg className="vh-curve-svg" viewBox={box} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`m${uid}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={VIEW_H}>
            <stop offset={0} style={{ stopColor: "var(--flow-grid)", stopOpacity: 0.3 }} />
            <stop offset={1} style={{ stopColor: "var(--flow-grid)", stopOpacity: 0.02 }} />
          </linearGradient>
          <linearGradient id={`o${uid}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={ref * VIEW_H}>
            <stop offset={0} style={{ stopColor: "var(--flow-overload)", stopOpacity: 0.3 }} />
            <stop offset={1} style={{ stopColor: "var(--flow-overload)", stopOpacity: 0.12 }} />
          </linearGradient>
          <clipPath id={`c${uid}`}>
            <rect x="0" y="0" width={VIEW_W} height={ref * VIEW_H} />
          </clipPath>
        </defs>
        <path className="vh-curve-env" d={g.envelope} />
        <path d={g.meanArea} fill={`url(#m${uid})`} />
        <path d={g.maxArea} fill={`url(#o${uid})`} clipPath={`url(#c${uid})`} />
        <path className="vh-curve-max" d={g.max} />
      </svg>
      <i className="vh-curve-ref" style={cssVars({ "--y": `${(ref * 100).toFixed(2)}%` })} aria-hidden="true" />
      <svg className="vh-curve-svg vh-curve-glow" viewBox={box} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path className="vh-curve-mean" d={g.mean} />
      </svg>
      <i
        className={`vh-curve-peak${over ? " is-over" : ""}`}
        style={cssVars({ "--x": `${(g.peak.x * 100).toFixed(2)}%`, "--y": `${(g.peak.y * 100).toFixed(2)}%` })}
        aria-hidden="true"
      />
    </div>
  );
}
