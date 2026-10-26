import { useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { clsx } from "clsx";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts";
import { BatteryCharging, UtilityPole } from "lucide-react";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { dayMonth, hhmm, isStorage, OVERLOAD_AT_KW, PEAK_HOURS, shortMode, STORAGE_ABOVE_KW, type ModeName, type RunHour } from "@/lib/api";
import { GlassCard } from "./GlassCard";

/* The dashboard's load chart. Structure from the shadcn "Area Chart -
 * Interactive" (a card header with a title, a description and a range select;
 * stacked gradient areas; a dot-indicator tooltip; a legend), in Screen 1's
 * chart look: a dark moss plate, flow-token strokes with a soft glow, a very
 * faint grid, faint Lexend axes, a small glass tooltip.
 *
 * Stacked from the bottom: grid_kw (lime), the battery's discharge (pale
 * green), pv_kw (warm). The predicted demand rides on top as a thin white line,
 * with a red dot on every overload hour. Reference lines at 160 kW (storage)
 * and 200 kW (overload); a faint band over each 18–22 evening window.
 *
 * The page owns the focused hour: hovering reports it through onFocusHour
 * (null on leave), and `focusIndex` draws it as a rule and a dot. */

export type ChartRange = "24h" | "72h" | "7d" | "all";

const CHART_RANGES: { id: ChartRange; label: string; hours: number }[] = [
  { id: "24h", label: "24h", hours: 24 },
  { id: "72h", label: "72h", hours: 72 },
  { id: "7d", label: "7 days", hours: 168 },
  { id: "all", label: "All", hours: Infinity },
];

export interface MainChartProps {
  hours: RunHour[];
  /** The run index the visible range starts at (clamped so the range stays full). */
  start?: number;
  range?: ChartRange;
  defaultRange?: ChartRange;
  onRangeChange?: (r: ChartRange) => void;
  /** The run index of the focused hour, drawn as a rule and a dot. */
  focusIndex?: number | null;
  /** Hover reports the hour under the pointer (its run index), and null on leave. */
  onFocusHour?: (index: number | null) => void;
  label?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  delay?: number;
  className?: string;
}

interface Row {
  i: number;
  ts: string;
  hour: number;
  grid: number;
  battery: number; // the discharging part only
  charging: number; // kW into the battery (≥ 0)
  pv: number;
  demand: number;
  overload: boolean;
  mode: ModeName;
  soc: number;
  reason: string;
}

const config = {
  grid: { label: "Grid", color: "var(--flow-grid)" },
  battery: { label: "Battery", color: "var(--flow-battery)" },
  pv: { label: "Solar", color: "var(--flow-solar)" },
  demand: { label: "Demand", color: "var(--ink)" },
} satisfies ChartConfig;

const SERIES = [
  { key: "grid" as const, color: "var(--flow-grid)", name: "Grid", top: 0.4, bottom: 0.04, width: 1.6 },
  { key: "battery" as const, color: "var(--flow-battery)", name: "Battery", top: 0.32, bottom: 0.1, width: 1.25 },
  { key: "pv" as const, color: "var(--flow-solar)", name: "Solar", top: 0.46, bottom: 0.16, width: 1.25 },
];

const kw = (v: number) => `${v.toFixed(1)} kW`;

function toRows(hours: RunHour[]): Row[] {
  return hours.map((h) => ({
    i: h.index,
    ts: h.timestamp,
    hour: h.hour,
    grid: Math.max(h.grid_kw, 0),
    battery: Math.max(h.battery_kw, 0),
    charging: Math.max(-h.battery_kw, 0),
    pv: Math.max(h.pv_kw, 0),
    demand: h.prediction_kw,
    overload: h.overload,
    mode: h.mode,
    soc: h.soc_pct,
    reason: h.reason,
  }));
}

/** Tick positions: every 3 h over a day, 6 h over three days, midnights beyond. */
function ticksFor(rows: Row[], hours: number): number[] {
  if (rows.length === 0) return [];
  if (hours <= 24) return rows.filter((r) => r.hour % 3 === 0).map((r) => r.i);
  if (hours <= 72) return rows.filter((r) => r.hour % 6 === 0).map((r) => r.i);
  const midnights = rows.filter((r) => r.hour === 0);
  const step = Math.max(1, Math.ceil(midnights.length / 8));
  return midnights.filter((_, k) => k % step === 0).map((r) => r.i);
}

/** The 18–22 evening windows inside the visible rows, as [first, last] run indices. */
function peakBands(rows: Row[]): [number, number][] {
  const out: [number, number][] = [];
  for (const r of rows) {
    if (r.hour < PEAK_HOURS[0] || r.hour > PEAK_HOURS[1]) continue;
    const last = out[out.length - 1];
    if (last && last[1] === r.i - 1) last[1] = r.i;
    else out.push([r.i, r.i]);
  }
  return out;
}

function Tip({ active, payload }: { active?: boolean; payload?: { payload?: Row }[] }) {
  const r = payload?.[0]?.payload;
  if (!active || !r) return null;
  const storage = isStorage(r.mode);
  const ModeIcon = storage ? BatteryCharging : UtilityPole;
  return (
    <div className="va-tip">
      <div className="va-tip-head">
        <span className="va-tip-time"><b>{hhmm(r.ts)}</b> {dayMonth(r.ts)}</span>
        {r.overload && <span className="va-flag"><i aria-hidden="true" />Overload</span>}
      </div>
      <div className="va-tip-kw"><span className="va-num">{r.demand.toFixed(1)}</span> kW <small>predicted</small></div>
      <div className={clsx("va-tip-mode", storage ? "is-storage" : "is-grid")}>
        <ModeIcon strokeWidth={1.5} aria-hidden />
        {shortMode(r.mode)}
      </div>
      <div className="va-tip-rows">
        {SERIES.map((s) => (
          <div className="va-tip-row" key={s.key}>
            <i style={{ background: s.color, color: s.color }} aria-hidden="true" />
            <span>{s.key === "battery" ? "Battery out" : s.name}</span>
            <b>{kw(r[s.key])}</b>
          </div>
        ))}
        {r.charging > 0 && (
          <div className="va-tip-row">
            <i className="is-hollow" aria-hidden="true" />
            <span>Charging</span>
            <b>{kw(r.charging)}</b>
          </div>
        )}
        <div className="va-tip-row">
          <i className="is-hollow" aria-hidden="true" />
          <span>Battery</span>
          <b>{Math.round(r.soc)}%</b>
        </div>
      </div>
      <p className="va-tip-reason">{r.reason}</p>
    </div>
  );
}

interface DotProps { cx?: number; cy?: number; index?: number; payload?: Row }

export function MainChart({
  hours,
  start = 0,
  range: rangeProp,
  defaultRange = "24h",
  onRangeChange,
  focusIndex = null,
  onFocusHour,
  label = "Load forecast",
  title = "Predicted load and supply",
  description,
  delay,
  className,
}: MainChartProps) {
  const uid = useId().replace(/:/g, "");
  const [own, setOwn] = useState<ChartRange>(defaultRange);
  const range = rangeProp ?? own;
  const setRange = (r: ChartRange) => {
    if (rangeProp === undefined) setOwn(r);
    onRangeChange?.(r);
  };
  const span = CHART_RANGES.find((r) => r.id === range)?.hours ?? 24;

  const all = useMemo(() => toRows(hours), [hours]);
  const rows = useMemo(() => {
    if (!Number.isFinite(span) || all.length <= span) return all;
    const pos = Math.max(0, all.findIndex((r) => r.i >= start));
    const from = Math.min(pos, all.length - span);
    return all.slice(from, from + span);
  }, [all, span, start]);

  const ticks = useMemo(() => ticksFor(rows, Math.min(span, rows.length)), [rows, span]);
  const bands = useMemo(() => peakBands(rows), [rows]);
  const dense = rows.length > 72;
  const first = rows[0]?.i ?? 0;
  const last = rows[rows.length - 1]?.i ?? 0;
  const top = Math.max(OVERLOAD_AT_KW, ...rows.map((r) => Math.max(r.grid + r.battery + r.pv, r.demand))) * 1.06;
  const yStep = top > 320 ? 100 : 50;
  const yMax = Math.ceil(top / yStep) * yStep;
  const yTicks = Array.from({ length: yMax / yStep + 1 }, (_, k) => k * yStep);
  const focus = focusIndex != null ? rows.find((r) => r.i === focusIndex) : undefined;
  const fmtTick = (i: number) => {
    const r = rows.find((x) => x.i === i);
    if (!r) return "";
    return span > 72 || (span > 24 && r.hour === 0) ? dayMonth(r.ts) : hhmm(r.ts);
  };
  const desc = description ?? (rows.length > 0 ? `${hhmm(rows[0].ts)} ${dayMonth(rows[0].ts)} – ${hhmm(rows[rows.length - 1].ts)} ${dayMonth(rows[rows.length - 1].ts)} · ${rows.length} h` : "No hours");

  const rangeControl = (
    <div className="va-range" role="group" aria-label="Chart range">
      {CHART_RANGES.map((r) => (
        <button
          key={r.id}
          type="button"
          className={clsx("va-range-item", range === r.id && "is-on")}
          aria-pressed={range === r.id}
          onClick={() => setRange(r.id)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );

  return (
    <GlassCard
      className={clsx("va-chart-card", className)}
      label={label}
      title={title}
      aside={rangeControl}
      delay={delay}
    >
      <p className="va-chart-desc">{desc}</p>
      <div className="va-plate va-chart-plate">
        <div className="va-plate-media" key={range}>
          <span className="va-axis-unit" aria-hidden="true">kW</span>
          <ChartContainer config={config} className="va-chart aspect-auto h-full w-full" initialDimension={{ width: 900, height: 340 }}>
            <ComposedChart
              data={rows}
              margin={{ top: 30, right: 14, bottom: 4, left: 0 }}
              onMouseMove={(s) => {
                if (!onFocusHour) return;
                const k = s?.activeTooltipIndex;
                const r = k == null ? undefined : rows[Number(k)];
                if (r) onFocusHour(r.i);
              }}
              onMouseLeave={() => onFocusHour?.(null)}
            >
              <defs>
                {SERIES.map((s) => (
                  <linearGradient key={s.key} id={`${s.key}${uid}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" style={{ stopColor: s.color, stopOpacity: s.top }} />
                    <stop offset="100%" style={{ stopColor: s.color, stopOpacity: s.bottom }} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} stroke="var(--chart-grid-line)" />
              <XAxis
                dataKey="i"
                type="number"
                domain={[first, last]}
                ticks={ticks}
                tickFormatter={fmtTick}
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                interval="preserveStartEnd"
              />
              <YAxis domain={[0, yMax]} ticks={yTicks} tickLine={false} axisLine={false} width={40} tickMargin={6} tickFormatter={(v: number) => String(Math.round(v))} />
              {bands.map(([a, b], k) => (
                <ReferenceArea
                  key={a}
                  x1={Math.max(a - 0.5, first)}
                  x2={Math.min(b + 0.5, last)}
                  fill="var(--mode-storage)"
                  fillOpacity={0.045}
                  stroke="none"
                  ifOverflow="hidden"
                  label={!dense && k === 0 ? { value: "18–22", position: "insideTop", className: "va-band-label" } : undefined}
                />
              ))}
              <ReferenceLine y={STORAGE_ABOVE_KW} stroke="var(--chart-ref-line)" strokeDasharray="2 4" label={{ value: `${STORAGE_ABOVE_KW} kW storage`, position: "insideTopLeft", className: "va-ref-label" }} />
              <ReferenceLine y={OVERLOAD_AT_KW} stroke="var(--overload-soft)" strokeDasharray="2 4" label={{ value: `${OVERLOAD_AT_KW} kW overload`, position: "insideBottomLeft", className: "va-ref-label va-ref-label--overload" }} />
              <ChartTooltip cursor={{ stroke: "var(--chart-ref-line)" }} content={<Tip />} wrapperStyle={{ outline: "none" }} />
              {SERIES.map((s) => (
                <Area
                  key={s.key}
                  dataKey={s.key}
                  stackId="supply"
                  type="monotone"
                  stroke={s.color}
                  strokeWidth={s.width}
                  fill={`url(#${s.key}${uid})`}
                  isAnimationActive={false}
                  activeDot={{ r: 2.5, fill: s.color, stroke: "var(--bg-deep)", strokeWidth: 1.2 }}
                  className={`va-area va-area--${s.key}`}
                />
              ))}
              <Line
                dataKey="demand"
                type="monotone"
                stroke="var(--ink)"
                strokeOpacity={0.78}
                strokeWidth={1.2}
                isAnimationActive={false}
                activeDot={{ r: 3.5, fill: "var(--ink)", stroke: "var(--bg-deep)", strokeWidth: 1.5 }}
                dot={(p: DotProps) =>
                  p.payload?.overload && !dense ? (
                    <circle key={`o${p.index}`} cx={p.cx} cy={p.cy} r={2.4} className="va-overload-dot" />
                  ) : (
                    <g key={`o${p.index}`} />
                  )
                }
                className="va-demand"
              />
              {focus && <ReferenceLine x={focus.i} stroke="var(--ink-soft)" strokeWidth={1} className="va-focus-rule" />}
              {focus && (
                <ReferenceDot x={focus.i} y={focus.demand} r={4.5} fill={focus.overload ? "var(--flow-overload)" : "var(--flow-grid)"} stroke="var(--bg-deep)" strokeWidth={2} className="va-focus-dot" />
              )}
            </ComposedChart>
          </ChartContainer>
        </div>
      </div>
      <ul className="va-legend" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key}><i className="va-legend-swatch" style={{ "--sw": s.color } as CSSProperties} aria-hidden="true" />{s.key === "battery" ? "Battery discharge" : s.name}</li>
        ))}
        <li><i className="va-legend-line" aria-hidden="true" />Predicted demand</li>
        <li><i className="va-legend-dash" aria-hidden="true" />{STORAGE_ABOVE_KW} kW</li>
        <li><i className="va-legend-dash va-legend-dash--overload" aria-hidden="true" />{OVERLOAD_AT_KW} kW overload</li>
        <li><i className="va-legend-band" aria-hidden="true" />18–22 evening window</li>
      </ul>
    </GlassCard>
  );
}
