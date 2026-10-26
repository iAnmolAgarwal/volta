import type { PointerEvent } from "react";
import { clsx } from "clsx";
import { usePlotArea, useXAxisScale } from "recharts";

/* The mode track: a thin strip under the load chart's plot, drawn inside the
 * chart with the chart's own x scale, so every tile sits exactly under its
 * hour (or day). Hourly ranges get one tile per hour; the daily ranges one per
 * day, in that day's majority mode. Renewable Storage is the lime tile, Main
 * Grid the faint one (the mode tokens, the stepper's two tile tones), and an
 * overload hour (or a day with any) carries the chart's red dot. The legend
 * names both modes with their icons, so colour is never the only signal.
 *
 * Hovering a tile focuses its hour (a day's peak hour on the daily ranges); a
 * click, a tap or a touch-drag pins it, as the plot itself does. */

export interface TrackUnit {
  /** The x value: a run index (hourly) or a day ordinal (daily). */
  x: number;
  storage: boolean;
  overload: boolean;
  /** The run index a hover or a pick focuses. */
  focusAt: number;
}

export interface ModeTrackProps {
  units: TrackUnit[];
  xFirst: number;
  xLast: number;
  /** The focused unit's x, outlined. */
  focusX?: number;
  /** Tile height and its gap under the plot, in px (the axis ticks sit under it). */
  height: number;
  gap: number;
  /** "MODE" in the y-axis gutter, level with the strip, in the ticks' style. */
  label?: boolean;
  onHover: (index: number | null) => void;
  onPick: (index: number) => void;
}

export function ModeTrack({ units, xFirst, xLast, focusX, height, gap, label, onHover, onPick }: ModeTrackProps) {
  const plot = usePlotArea();
  const scale = useXAxisScale();
  if (!plot || !scale || units.length === 0) return null;

  const y = plot.y + plot.height + gap;
  const px = (v: number) => scale(v) ?? plot.x;
  const r = Math.max(1.6, height * 0.21);

  /** The unit under a pointer, from the plot's own span. */
  const unitAt = (e: PointerEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg || plot.width <= 0) return undefined;
    const at = e.clientX - svg.getBoundingClientRect().left;
    const v = Math.round(xFirst + ((at - plot.x) / plot.width) * (xLast - xFirst));
    return units[Math.max(0, Math.min(units.length - 1, v - units[0].x))];
  };

  return (
    <g className="vd-track" aria-hidden="true">
      {label && (
        <text x={plot.x - 4} y={y + height / 2} dy="0.36em" textAnchor="end" className="vd-track-label">MODE</text>
      )}
      {units.map((u) => {
        const x0 = px(Math.max(u.x - 0.5, xFirst));
        const x1 = px(Math.min(u.x + 0.5, xLast));
        const w = x1 - x0;
        const inset = w > 6 ? 1 : w > 3 ? 0.5 : 0;
        const tw = Math.max(0.5, w - inset * 2);
        // the dot sits on its hour, kept inside the plot at the two ends
        // on a dense range the dot shrinks with its tile, so the mode's colour still reads around it
        const dr = Math.min(r, Math.max(0.9, tw * 0.3));
        const cx = Math.max(plot.x + dr + 1, Math.min(plot.x + plot.width - dr - 1, px(u.x)));
        return (
          <g key={u.x} className={clsx("vd-track-tile", u.storage ? "is-storage" : "is-grid", u.x === focusX && "is-focus")}>
            <rect x={x0 + inset} y={y} width={tw} height={height} rx={Math.min(height / 2, tw / 2)} />
            {u.overload && <circle cx={cx} cy={y + height / 2} r={dr} className="vd-track-dot" />}
          </g>
        );
      })}
      <rect
        className="vd-track-hit"
        x={plot.x}
        y={y - 8}
        width={plot.width}
        height={height + 16}
        onPointerMove={(e) => {
          const u = unitAt(e);
          if (!u) return;
          if (e.pointerType === "mouse") onHover(u.focusAt);
          else if (e.buttons) onPick(u.focusAt);
        }}
        onPointerDown={(e) => {
          const u = unitAt(e);
          if (u) onPick(u.focusAt);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") onHover(null);
        }}
      />
    </g>
  );
}
