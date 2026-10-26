import { useId, useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { OVERLOAD_AT_KW, STORAGE_ABOVE_KW, STORAGE_MODE, type Hour } from "@/lib/forecast";

/* The two compact card charts. Structure from the shadcn "Area Chart -
 * Interactive" (stacked gradient areas, type="natural", a dot-indicator
 * tooltip), cut down for a card's image area: no axes, no legend, no range
 * select, edge to edge. The look is ours: flow-token strokes with a soft glow,
 * each over its own soft gradient fill, a very faint grid, faint 160/200 kW
 * reference lines, a small glass tooltip in Lexend, and a draw-in on load
 * (landing.css). This module is its own chunk (Cards.tsx loads it lazily), so
 * Recharts never sits in front of the hero's first paint. */

interface Row {
  i: number;
  label: string;
  kw: number;
  grid: number;
  battery: number;
  pv: number;
  overload: boolean;
  storage: boolean;
}

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const kw = (v: number) => `${v.toFixed(1)} kW`;

function toRows(hours: Hour[]): Row[] {
  return hours.map((h, i) => ({
    i,
    label: hh(h.hour),
    kw: h.predictionKw,
    grid: Math.max(h.gridKw, 0),
    battery: Math.max(h.batteryKw, 0), // the discharging part only
    pv: Math.max(h.pvKw, 0),
    overload: h.overload,
    storage: h.mode === STORAGE_MODE,
  }));
}

function TipRow({ color, name, value }: { color: string; name: string; value: string }) {
  return (
    <div className="vl-tip-row">
      <i style={{ background: color }} aria-hidden="true" />
      <span>{name}</span>
      <b>{value}</b>
    </div>
  );
}

const peakConfig = {
  kw: { label: "Forecast", color: "var(--flow-grid)" },
} satisfies ChartConfig;

/** Card 1: the 24-hour prediction in lime; only the part of each hour above 200 kW is tinted red. */
export function PeakChart({ hours, playhead }: { hours: Hour[]; playhead: number | null }) {
  const uid = useId().replace(/:/g, "");
  const rows = useMemo(() => toRows(hours), [hours]);
  const peak = Math.max(...rows.map((r) => r.kw));
  const yMax = Math.max(peak, OVERLOAD_AT_KW) * 1.12;
  const head = playhead != null ? rows[playhead] : null;
  // The fill's box runs from the peak down to 0 kW, so the 200 kW line sits at
  // this fraction of it: above it the fill takes a faint overload tint, below
  // it the lime glow. The line itself stays lime the whole way.
  const over = peak > OVERLOAD_AT_KW ? (peak - OVERLOAD_AT_KW) / peak : 0;

  return (
    <ChartContainer config={peakConfig} className="vl-chart vl-chart--peak aspect-auto h-full w-full" initialDimension={{ width: 300, height: 122 }}>
      <AreaChart data={rows} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false}>
        <defs>
          <linearGradient id={`f${uid}`} x1="0" y1="0" x2="0" y2="1">
            {over > 0 && <stop offset={0} style={{ stopColor: "var(--flow-overload)", stopOpacity: 0.3 }} />}
            {over > 0 && <stop offset={over} style={{ stopColor: "var(--flow-overload)", stopOpacity: 0.14 }} />}
            <stop offset={over} style={{ stopColor: "var(--flow-grid)", stopOpacity: 0.3 }} />
            <stop offset={1} style={{ stopColor: "var(--flow-grid)", stopOpacity: 0.02 }} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grid-line)" />
        <XAxis dataKey="i" type="number" domain={[0, rows.length - 1]} hide />
        <YAxis domain={[0, yMax]} hide />
        <ReferenceLine y={STORAGE_ABOVE_KW} stroke="var(--chart-ref-line)" strokeDasharray="2 4" ifOverflow="extendDomain" />
        <ReferenceLine y={OVERLOAD_AT_KW} stroke="var(--chart-ref-line)" strokeDasharray="2 4" ifOverflow="extendDomain" />
        <ChartTooltip
          cursor={{ stroke: "var(--chart-ref-line)" }}
          content={
            <ChartTooltipContent
              className="vl-tip"
              labelFormatter={(_, p) => (p?.[0]?.payload as Row | undefined)?.label}
              formatter={(v, _n, item) => {
                const r = item.payload as Row;
                return <TipRow color={r.overload ? "var(--flow-overload)" : "var(--flow-grid)"} name={r.overload ? "Overload" : "Forecast"} value={kw(Number(v))} />;
              }}
            />
          }
        />
        <Area
          dataKey="kw"
          type="natural"
          stroke="var(--flow-grid)"
          strokeWidth={1.6}
          fill={`url(#f${uid})`}
          isAnimationActive={false}
          activeDot={{ r: 3, fill: "var(--flow-grid)", stroke: "var(--bg-deep)", strokeWidth: 1.5 }}
          className="vl-area vl-area--grid"
        />
        {head && (
          <ReferenceDot x={head.i} y={head.kw} r={3.5} fill={head.overload ? "var(--flow-overload)" : "var(--flow-grid)"} stroke="var(--bg-deep)" strokeWidth={1.5} className="vl-playhead-dot" />
        )}
      </AreaChart>
    </ChartContainer>
  );
}

const flowConfig = {
  grid: { label: "Grid", color: "var(--flow-grid)" },
  battery: { label: "Battery", color: "var(--flow-battery)" },
  pv: { label: "Solar", color: "var(--flow-solar)" },
} satisfies ChartConfig;

const FLOOR = 0.18;

// bottom to top: the grid carries the base load, the battery and the sun ride on it
const SERIES = [
  { key: "grid" as const, color: "var(--flow-grid)", name: "Grid", top: 0.4, bottom: 0.05, width: 1.6 },
  { key: "battery" as const, color: "var(--flow-battery)", name: "Battery", top: 0.3, bottom: 0.12, width: 1.25 },
  { key: "pv" as const, color: "var(--flow-solar)", name: "Solar", top: 0.46, bottom: 0.18, width: 1.25 },
];

/** Card 2: where the power comes from each hour, with very faint storage-mode bands. */
export function FlowChart({ hours, playhead }: { hours: Hour[]; playhead: number | null }) {
  const uid = useId().replace(/:/g, "");
  const rows = useMemo(() => toRows(hours), [hours]);
  const yMax = Math.max(...rows.map((r) => r.grid + r.battery + r.pv), OVERLOAD_AT_KW) * 1.1;
  // The stack stands on a quiet floor (its zero line ~15% up the plate): the
  // knob sits in the plate's bottom-right corner, and this keeps every hour's
  // lines clear above it; the fills fade out into the floor.
  const yMin = -yMax * FLOOR;
  const runs = useMemo(() => {
    const out: [number, number][] = [];
    rows.forEach((r, i) => {
      if (!r.storage) return;
      const lastRun = out[out.length - 1];
      if (lastRun && lastRun[1] === i - 1) lastRun[1] = i;
      else out.push([i, i]);
    });
    return out;
  }, [rows]);
  const end = rows.length - 1;

  return (
    <ChartContainer config={flowConfig} className="vl-chart vl-chart--flow aspect-auto h-full w-full" initialDimension={{ width: 300, height: 158 }}>
      <AreaChart data={rows} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false}>
        <defs>
          {SERIES.map((s) => (
            <linearGradient key={s.key} id={`${s.key}${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: s.color, stopOpacity: s.top }} />
              <stop offset="100%" style={{ stopColor: s.color, stopOpacity: s.bottom }} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grid-line)" />
        <XAxis dataKey="i" type="number" domain={[0, end]} hide />
        <YAxis domain={[yMin, yMax]} hide />
        {runs.map(([a, b]) => (
          <ReferenceArea key={a} x1={Math.max(a - 0.5, 0)} x2={Math.min(b + 0.5, end)} fill="var(--mode-storage)" fillOpacity={0.018} stroke="none" ifOverflow="hidden" />
        ))}
        <ReferenceLine y={STORAGE_ABOVE_KW} stroke="var(--chart-ref-line)" strokeDasharray="2 4" />
        <ReferenceLine y={OVERLOAD_AT_KW} stroke="var(--chart-ref-line)" strokeDasharray="2 4" />
        <ChartTooltip
          cursor={{ stroke: "var(--chart-ref-line)" }}
          content={
            <ChartTooltipContent
              className="vl-tip"
              labelFormatter={(_, p) => {
                const r = p?.[0]?.payload as Row | undefined;
                return r ? `${r.label} · ${r.storage ? "Storage" : "Grid"}` : null;
              }}
              formatter={(v, name) => {
                const s = SERIES.find((x) => x.key === name);
                return s ? <TipRow color={s.color} name={s.name} value={kw(Number(v))} /> : null;
              }}
            />
          }
        />
        {SERIES.map((s) => (
          <Area
            key={s.key}
            dataKey={s.key}
            stackId="flow"
            type="monotone" // natural splines overshoot per layer and cross on a stack this jumpy
            stroke={s.color}
            strokeWidth={s.width}
            fill={`url(#${s.key}${uid})`}
            isAnimationActive={false}
            activeDot={{ r: 2.5, fill: s.color, stroke: "var(--bg-deep)", strokeWidth: 1.2 }}
            className={`vl-area vl-area--${s.key}`}
          />
        ))}
        {playhead != null && <ReferenceLine x={playhead} stroke="var(--ink-soft)" strokeWidth={1} className="vl-playhead" />}
      </AreaChart>
    </ChartContainer>
  );
}
