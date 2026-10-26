import { useId, useMemo, useState, type CSSProperties } from "react";
import { clsx } from "clsx";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts";
import { BatteryCharging, UtilityPole } from "lucide-react";
import { GlassCard } from "@/components/app/GlassCard";
import { NARROW, useMedia } from "@/components/landing/useMedia";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { dayMonth, hhmm, isStorage, OVERLOAD_AT_KW, PEAK_HOURS, shortMode, STORAGE_ABOVE_KW, type ModeName, type RunHour } from "@/lib/api";
import { chargeSource, supplyOf } from "./supply";

/* The dashboard's load chart: the shared MainChart's structure and look (the
 * shadcn "Area Chart - Interactive": a card header with a title and a range
 * select, stacked gradient areas, a glass tooltip, a legend; Screen 1's moss
 * plate, flow-token strokes with a soft glow, a faint grid, faint Lexend
 * axes), with the supply split so the stack is an energy balance.
 *
 * Above the axis, stacked: the grid serving the load (lime), the battery's
 * discharge (pale green) and the solar serving the load (warm). They sum to
 * the predicted demand every hour, so the white demand line rides exactly on
 * the stack's top. Below the axis: the battery charging, from solar or the
 * grid. The 160 and 200 kW lines are labelled past the plot's right end, in
 * spaced caps; a faint band marks each 18–22 evening window.
 *
 * MainChart stacks the backend's net fields, whose top overshoots the demand
 * in charging hours, and takes no extra series, hence this page-local chart
 * (design-notes/m2/dashboard-requests.md). */

export type ChartRange = "24h" | "72h" | "7d" | "all";

const RANGES: { id: ChartRange; label: string; hours: number }[] = [
  { id: "24h", label: "24h", hours: 24 },
  { id: "72h", label: "72h", hours: 72 },
  { id: "7d", label: "7 days", hours: 168 },
  { id: "all", label: "All", hours: Infinity },
];

interface Row {
  i: number;
  ts: string;
  hour: number;
  grid: number;
  battery: number;
  pv: number;
  charging: number; // ≤ 0, drawn below the axis
  charge: number;
  source: string;
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
  charging: { label: "Charging", color: "var(--flow-battery)" },
  demand: { label: "Demand", color: "var(--ink)" },
} satisfies ChartConfig;

const SERIES = [
  { key: "grid" as const, color: "var(--flow-grid)", name: "Grid to load", top: 0.4, bottom: 0.04, width: 1.6 },
  { key: "battery" as const, color: "var(--flow-battery)", name: "Battery discharge", top: 0.32, bottom: 0.1, width: 1.25 },
  { key: "pv" as const, color: "var(--flow-solar)", name: "Solar to load", top: 0.46, bottom: 0.16, width: 1.25 },
];

const kw = (v: number) => `${v.toFixed(1)} kW`;

function toRows(hours: RunHour[]): Row[] {
  return hours.map((h) => {
    const s = supplyOf(h);
    return {
      i: h.index,
      ts: h.timestamp,
      hour: h.hour,
      grid: s.gridToLoad,
      battery: s.discharge,
      pv: s.pvToLoad,
      charging: -s.charge,
      charge: s.charge,
      source: chargeSource(s),
      demand: h.prediction_kw,
      overload: h.overload,
      mode: h.mode,
      soc: h.soc_pct,
      reason: h.reason,
    };
  });
}

function ticksFor(rows: Row[], hours: number): number[] {
  if (rows.length === 0) return [];
  if (hours <= 24) return rows.filter((r) => r.hour % 3 === 0).map((r) => r.i);
  if (hours <= 72) return rows.filter((r) => r.hour % 6 === 0).map((r) => r.i);
  const midnights = rows.filter((r) => r.hour === 0);
  const step = Math.max(1, Math.ceil(midnights.length / 8));
  return midnights.filter((_, k) => k % step === 0).map((r) => r.i);
}

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
            <span>{s.name}</span>
            <b>{kw(r[s.key])}</b>
          </div>
        ))}
        {r.charge > 0.05 && (
          <div className="va-tip-row">
            <i className="is-hollow" aria-hidden="true" />
            <span>Charging, {r.source}</span>
            <b>{kw(r.charge)}</b>
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
interface LabelBox { viewBox?: { x?: number; y?: number; width?: number } }

/** A reference line's label, past the plot's right end, in spaced caps: its word
 * and value, stacked away from the other line (`up` above its line, else below),
 * or (on a phone, where the plot is narrow) the value alone, level with it. */
function sideLabel(value: number, word: string, up: boolean, overload?: boolean) {
  function Wide({ viewBox }: LabelBox) {
    const x = (viewBox?.x ?? 0) + (viewBox?.width ?? 0) + 10;
    const y = viewBox?.y ?? 0;
    const [a, b] = up ? [word, `${value} KW`] : [`${value} KW`, word];
    return (
      <text x={x} y={y} className={clsx("vd-ref-label", overload && "is-overload")}>
        <tspan x={x} dy={up ? "-1.55em" : "1.2em"} className={up ? "vd-ref-word" : undefined}>{a}</tspan>
        <tspan x={x} dy="1.2em" className={up ? undefined : "vd-ref-word"}>{b}</tspan>
      </text>
    );
  }
  function Narrow({ viewBox }: LabelBox) {
    const x = (viewBox?.x ?? 0) + (viewBox?.width ?? 0) + 6;
    return (
      <text x={x} y={viewBox?.y ?? 0} dy="0.35em" className={clsx("vd-ref-label", overload && "is-overload")}>{value}</text>
    );
  }
  return { Wide, Narrow };
}
const STORAGE_LABEL = sideLabel(STORAGE_ABOVE_KW, "STORAGE", false);
const OVERLOAD_LABEL = sideLabel(OVERLOAD_AT_KW, "OVERLOAD", true, true);

export interface LoadChartProps {
  hours: RunHour[];
  /** The run index the visible range starts at (clamped so the range stays full). */
  start: number;
  focusIndex: number | null;
  /** Hover reports the hour under the pointer, and null on leave. */
  onFocusHour: (index: number | null) => void;
  /** A click or tap on the plate pins its hour. */
  onPick: (index: number) => void;
  delay?: number;
  className?: string;
}

export function LoadChart({ hours, start, focusIndex, onFocusHour, onPick, delay, className }: LoadChartProps) {
  const uid = useId().replace(/:/g, "");
  const [range, setRange] = useState<ChartRange>("24h");
  const span = RANGES.find((r) => r.id === range)?.hours ?? 24;
  const narrow = useMedia(NARROW);

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
  // the domain is fitted in 50s; the ticks fall on round values through 0
  const top = Math.max(OVERLOAD_AT_KW, ...rows.map((r) => r.demand)) * 1.06;
  const low = Math.min(0, ...rows.map((r) => r.charging)) * 1.06;
  const yMax = Math.ceil(top / 50) * 50;
  const yMin = low < 0 ? -Math.ceil(-low / 50) * 50 : 0;
  const yStep = yMax - yMin > 320 ? 100 : 50;
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) yTicks.push(v);
  const focus = focusIndex != null ? rows.find((r) => r.i === focusIndex) : undefined;
  const fmtTick = (i: number) => {
    const r = rows.find((x) => x.i === i);
    if (!r) return "";
    return span > 72 || (span > 24 && r.hour === 0) ? dayMonth(r.ts) : hhmm(r.ts);
  };
  const desc = rows.length > 0 ? `${hhmm(rows[0].ts)} ${dayMonth(rows[0].ts)} – ${hhmm(rows[rows.length - 1].ts)} ${dayMonth(rows[rows.length - 1].ts)} · ${rows.length} h` : "No hours";
  const rowAt = (k: unknown) => (k == null ? undefined : rows[Number(k)]);

  const rangeControl = (
    <div className="va-range" role="group" aria-label="Chart range">
      {RANGES.map((r) => (
        <button key={r.id} type="button" className={clsx("va-range-item", range === r.id && "is-on")} aria-pressed={range === r.id} onClick={() => setRange(r.id)}>
          {r.label}
        </button>
      ))}
    </div>
  );

  return (
    <GlassCard className={clsx("va-chart-card", className)} label="Load forecast" title="Predicted load and supply" aside={rangeControl} delay={delay}>
      <p className="va-chart-desc">{desc}</p>
      <div className="va-plate va-chart-plate">
        <div className="va-plate-media" key={range}>
          <span className="va-axis-unit" aria-hidden="true">kW</span>
          <ChartContainer config={config} className="va-chart aspect-auto h-full w-full" initialDimension={{ width: 900, height: 340 }}>
            <ComposedChart
              data={rows}
              margin={{ top: 30, right: narrow ? 34 : 88, bottom: 4, left: 0 }}
              onMouseMove={(s) => {
                const r = rowAt(s?.activeTooltipIndex);
                if (r) onFocusHour(r.i);
              }}
              onMouseLeave={() => onFocusHour(null)}
              onClick={(s) => {
                const r = rowAt(s?.activeTooltipIndex);
                if (r) onPick(r.i);
              }}
            >
              <defs>
                {SERIES.map((s) => (
                  <linearGradient key={s.key} id={`${s.key}${uid}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" style={{ stopColor: s.color, stopOpacity: s.top }} />
                    <stop offset="100%" style={{ stopColor: s.color, stopOpacity: s.bottom }} />
                  </linearGradient>
                ))}
                <linearGradient id={`charging${uid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" style={{ stopColor: "var(--flow-battery)", stopOpacity: 0.26 }} />
                  <stop offset="100%" style={{ stopColor: "var(--flow-battery)", stopOpacity: 0.03 }} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--chart-grid-line)" />
              <XAxis dataKey="i" type="number" domain={[first, last]} ticks={ticks} tickFormatter={fmtTick} tickLine={false} axisLine={false} tickMargin={10} interval="preserveStartEnd" />
              <YAxis domain={[yMin, yMax]} ticks={yTicks} interval={0} tickLine={false} axisLine={false} width={40} tickMargin={6} tickFormatter={(v: number) => String(Math.round(v))} />
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
              {yMin < 0 && <ReferenceLine y={0} stroke="var(--glass-edge)" />}
              <ReferenceLine y={STORAGE_ABOVE_KW} stroke="var(--chart-ref-line)" strokeDasharray="2 4" label={narrow ? STORAGE_LABEL.Narrow : STORAGE_LABEL.Wide} />
              <ReferenceLine y={OVERLOAD_AT_KW} stroke="var(--overload-soft)" strokeDasharray="2 4" label={narrow ? OVERLOAD_LABEL.Narrow : OVERLOAD_LABEL.Wide} />
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
              <Area
                dataKey="charging"
                stackId="charge"
                type="monotone"
                stroke="var(--flow-battery)"
                strokeOpacity={0.7}
                strokeWidth={1.1}
                strokeDasharray="3 3"
                fill={`url(#charging${uid})`}
                isAnimationActive={false}
                activeDot={false}
                className="va-area va-area--battery vd-area-charging"
              />
              <Line
                dataKey="demand"
                type="monotone"
                stroke="var(--ink)"
                strokeOpacity={0.78}
                strokeWidth={1.2}
                isAnimationActive={false}
                activeDot={{ r: 3.5, fill: "var(--ink)", stroke: "var(--bg-deep)", strokeWidth: 1.5 }}
                dot={(p: DotProps) =>
                  p.payload?.overload && !dense ? <circle key={`o${p.index}`} cx={p.cx} cy={p.cy} r={2.4} className="va-overload-dot" /> : <g key={`o${p.index}`} />
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
          <li key={s.key}><i className="va-legend-swatch" style={{ "--sw": s.color } as CSSProperties} aria-hidden="true" />{s.name}</li>
        ))}
        <li><i className="vd-legend-charging" aria-hidden="true" />Charging, below 0</li>
        <li><i className="va-legend-line" aria-hidden="true" />Predicted demand</li>
        <li><i className="va-legend-dash" aria-hidden="true" />{STORAGE_ABOVE_KW} kW storage</li>
        <li><i className="va-legend-dash va-legend-dash--overload" aria-hidden="true" />{OVERLOAD_AT_KW} kW overload</li>
        <li><i className="va-legend-band" aria-hidden="true" />18–22 evening window</li>
      </ul>
    </GlassCard>
  );
}
