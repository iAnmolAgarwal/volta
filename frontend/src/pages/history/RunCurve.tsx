import { useId, useMemo } from "react";
import { cssVars } from "@/components/landing/cssVars";
import { OVERLOAD_AT_KW } from "@/lib/forecast";
import { curveGeometry, VIEW_H, VIEW_W } from "./curve";

/* The run's shape in its moss plate, made as the landing's Field Note chart
 * is (CardCharts.tsx, PeakChart): the lime line with its soft glow over a
 * lime gradient that fades to the floor, the faint dashed 200 kW line, and
 * the fill tinted with --flow-overload only above the 200 kW line, so only
 * where the line itself is over it; the line stays lime the whole way. The
 * dot marks the line's peak, red when that is an overload (the landing's
 * playhead dot).
 *
 * Plain SVG, no chart instance: two stretched layers (the fill, then the line
 * with a screen-space glow), plus the reference line and the dot as HTML so
 * the dashes and the dot keep their shape at any plate width. */

export function RunCurve({ mean, label }: { mean: number[]; label: string }) {
  const uid = useId().replace(/:/g, "");
  const g = useMemo(() => curveGeometry(mean, OVERLOAD_AT_KW), [mean]);
  const box = `0 0 ${VIEW_W} ${VIEW_H}`;

  return (
    <div className="vh-curve" role="img" aria-label={label}>
      <svg className="vh-curve-svg" viewBox={box} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <defs>
          {/* the landing's fill: its box runs from the line's peak down to 0 kW, so 200 kW sits at `over` */}
          <linearGradient id={`f${uid}`} x1="0" y1="0" x2="0" y2="1">
            {g.over > 0 && <stop offset={0} style={{ stopColor: "var(--flow-overload)", stopOpacity: 0.3 }} />}
            {g.over > 0 && <stop offset={g.over} style={{ stopColor: "var(--flow-overload)", stopOpacity: 0.14 }} />}
            <stop offset={g.over} style={{ stopColor: "var(--flow-grid)", stopOpacity: 0.3 }} />
            <stop offset={1} style={{ stopColor: "var(--flow-grid)", stopOpacity: 0.02 }} />
          </linearGradient>
        </defs>
        <path d={g.area} fill={`url(#f${uid})`} />
      </svg>
      <i className="vh-curve-ref" style={cssVars({ "--y": `${(g.at(OVERLOAD_AT_KW) * 100).toFixed(2)}%` })} aria-hidden="true" />
      <svg className="vh-curve-svg vh-curve-glow" viewBox={box} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path className="vh-curve-line" d={g.line} />
      </svg>
      <i
        className={`vh-curve-peak${g.peak.kw >= OVERLOAD_AT_KW ? " is-over" : ""}`}
        style={cssVars({ "--x": `${(g.peak.x * 100).toFixed(2)}%`, "--y": `${(g.peak.y * 100).toFixed(2)}%` })}
        aria-hidden="true"
      />
    </div>
  );
}
