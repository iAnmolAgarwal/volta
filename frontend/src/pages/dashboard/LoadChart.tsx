import { useEffect, useId, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import { clsx } from "clsx";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts";
import { BatteryCharging, TriangleAlert, UtilityPole } from "lucide-react";
import { GlassCard } from "@/components/app/GlassCard";
import { NARROW, useMedia } from "@/components/landing/useMedia";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { dayMonth, hhmm, isStorage, OVERLOAD_AT_KW, PEAK_HOURS, shortMode, STORAGE_ABOVE_KW, type ModeName, type RunHour } from "@/lib/api";
import { ModeTrack, type TrackUnit } from "./ModeTrack";
import { chargeSource, supplyOf } from "./supply";

/* The dashboard's load chart, as the landing's chart cards are built: a paper
 * card with the dark moss plate inset at its top, then its label and title
 * (Sylva's floating cards; the landing's "Next-24h peak"). Structure from the
 * shadcn "Area Chart - Interactive" (a title, a range select, stacked gradient
 * areas, a glass tooltip, a legend), in Screen 1's chart look.
 *
 * 24h and 72h are hourly, with the supply split so the stack is an energy
 * balance: the grid serving the load (--flow-grid, lime, solid), the battery's
 * discharge (--flow-battery, pale green, a thin solid edge) and the solar
 * serving the load (--flow-solar, Sylva's warm light, a dotted edge) sum to the predicted
 * demand every hour, so the white demand line rides on the stack's top; the
 * battery's charging is drawn below the axis. 7 days and All are daily: an
 * envelope from each day's lowest to highest hour, the daily mean as the line,
 * and a red marker on each day with overload hours, sized by how many.
 *
 * The 160 and 200 kW lines are labelled past the plot's right end, in spaced
 * caps; a faint band marks each 18–22 evening window (hourly ranges).
 * Under the plot runs the mode track (ModeTrack.tsx): Main Grid against
 * Renewable Storage on the chart's own x scale, per hour or per day, with the
 * overload hours dotted; the axis ticks sit under it.
 * MainChart stacks the backend's net fields, whose top overshoots the demand
 * in charging hours, hence this page-local chart
 * (design-notes/m2/dashboard-requests.md). */

export type ChartRange = "24h" | "72h" | "7d" | "all";

const RANGES: { id: ChartRange; label: string; hours: number }[] = [
  { id: "24h", label: "24h", hours: 24 },
  { id: "72h", label: "72h", hours: 72 },
  { id: "7d", label: "7 days", hours: 168 },
  { id: "all", label: "All", hours: Infinity },
];
const DAILY: ChartRange[] = ["7d", "all"];

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

interface DayRow {
  d: number; // day ordinal in the run (the x value)
  ts: string; // the day's first hour
  first: number;
  last: number;
  hours: number;
  band: [number, number];
  min: number;
  max: number;
  mean: number;
  overloadHours: number;
  storageHours: number;
  peakIndex: number;
  peakTs: string;
}

/* the three supply flows, each on its own flow token (dashboard.css: --vd-grid,
 * --vd-battery, --vd-solar), told apart by fill weight and edge: the grid a
 * solid lime edge over a deep gradient, the battery a thin solid edge over a
 * lighter fill, the solar a dotted edge over the faintest wash */
const SERIES = [
  { key: "grid" as const, color: "var(--vd-grid)", name: "Grid to load", top: 0.42, bottom: 0.05, width: 1.5, dash: undefined, edge: 1 },
  { key: "battery" as const, color: "var(--vd-battery)", name: "Battery discharge", top: 0.42, bottom: 0.14, width: 1.1, dash: undefined, edge: 0.8 },
  { key: "pv" as const, color: "var(--vd-solar)", name: "Solar to load", top: 0.26, bottom: 0.06, width: 1.4, dash: "1.5 2.5", edge: 1 },
];

/* the plot's margins: every label on the plate keeps 12 px from the plate's edges
 * (the y ticks on the left, the 160 / 200 labels on the right) */
const PLATE_PAD = 12;
const Y_AXIS_W = 40;
/** Past the plot's right end: the label's 10 px offset, its width ("OVERLOAD" in
 * spaced caps, 78 px wide; "200" alone on a phone, 24 px) and the plate padding. */
const RIGHT = { wide: 10 + 78 + PLATE_PAD, narrow: 6 + 24 + PLATE_PAD };

const config = {
  grid: { label: "Grid", color: "var(--vd-grid)" },
  battery: { label: "Battery", color: "var(--vd-battery)" },
  pv: { label: "Solar", color: "var(--vd-solar)" },
  charging: { label: "Charging", color: "var(--vd-battery)" },
  demand: { label: "Demand", color: "var(--ink)" },
} satisfies ChartConfig;

const kw = (v: number) => `${v.toFixed(1)} kW`;
/** Axis numbers with a true minus sign (U+2212). */
const axisNum = (v: number) => (v < 0 ? `−${Math.round(-v)}` : String(Math.round(v)));

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

/** Group hourly rows into calendar days (the run's own clock). */
function toDays(rows: Row[], dayOf: Map<number, number>): DayRow[] {
  const out: DayRow[] = [];
  for (const r of rows) {
    const d = dayOf.get(r.i) ?? 0;
    let day = out[out.length - 1];
    if (!day || day.d !== d) {
      day = { d, ts: r.ts, first: r.i, last: r.i, hours: 0, band: [r.demand, r.demand], min: r.demand, max: r.demand, mean: 0, overloadHours: 0, storageHours: 0, peakIndex: r.i, peakTs: r.ts };
      out.push(day);
    }
    day.last = r.i;
    day.hours += 1;
    day.mean += r.demand;
    if (r.demand < day.min) day.min = r.demand;
    if (r.demand > day.max) {
      day.max = r.demand;
      day.peakIndex = r.i;
      day.peakTs = r.ts;
    }
    if (r.overload) day.overloadHours += 1;
    if (isStorage(r.mode)) day.storageHours += 1;
  }
  for (const day of out) {
    day.mean /= day.hours;
    day.band = [day.min, day.max];
  }
  return out;
}

function ticksFor(rows: Row[], hours: number): number[] {
  if (rows.length === 0) return [];
  if (hours <= 24) return rows.filter((r) => r.hour % 3 === 0).map((r) => r.i);
  return rows.filter((r) => r.hour % 6 === 0).map((r) => r.i);
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

function HourTip({ active, payload, compact }: { active?: boolean; payload?: { payload?: Row }[]; compact?: boolean }) {
  const r = payload?.[0]?.payload;
  if (!active || !r) return null;
  const storage = isStorage(r.mode);
  const ModeIcon = storage ? BatteryCharging : UtilityPole;
  return (
    <div className={clsx("va-tip vd-tip", compact && "is-compact")}>
      <div className="va-tip-head">
        <span className="va-tip-time"><b>{hhmm(r.ts)}</b> {dayMonth(r.ts)}</span>
        {r.overload && <span className="va-flag"><i aria-hidden="true" />Overload</span>}
      </div>
      <div className="va-tip-kw"><span className="va-num">{r.demand.toFixed(1)}</span> kW <small>predicted</small></div>
      <div className={clsx("va-tip-mode", storage ? "is-storage" : "is-grid")}>
        <ModeIcon strokeWidth={1.5} aria-hidden />
        {shortMode(r.mode)}
      </div>
      {!compact && (
        <>
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
                <span>Charging ({r.source.replace("from ", "").replace(" and the ", " + ").replace("the ", "")})</span>
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
        </>
      )}
    </div>
  );
}

function DayTip({ active, payload, compact }: { active?: boolean; payload?: { payload?: DayRow }[]; compact?: boolean }) {
  const r = payload?.[0]?.payload;
  if (!active || !r) return null;
  return (
    <div className={clsx("va-tip vd-tip", compact && "is-compact")}>
      <div className="va-tip-head">
        <span className="va-tip-time"><b>{dayMonth(r.ts)}</b> {r.hours < 24 ? `${r.hours} h` : "daily"}</span>
        {r.overloadHours > 0 && <span className="va-flag"><i aria-hidden="true" />{r.overloadHours} h overload</span>}
      </div>
      <div className="va-tip-kw"><span className="va-num">{Math.round(r.min)}–{Math.round(r.max)}</span> kW <small>low to peak</small></div>
      {!compact && (
        <div className="va-tip-rows">
          <div className="va-tip-row"><i className="vd-tip-line" aria-hidden="true" /><span>Daily mean</span><b>{kw(r.mean)}</b></div>
          <div className="va-tip-row"><i className="is-hollow" aria-hidden="true" /><span>Peak at {hhmm(r.peakTs)}</span><b>{kw(r.max)}</b></div>
          <div className="va-tip-row"><i className="is-hollow" aria-hidden="true" /><span>On storage</span><b>{r.storageHours} of {r.hours} h</b></div>
        </div>
      )}
    </div>
  );
}

interface DotProps { cx?: number; cy?: number; index?: number; payload?: Row & DayRow }
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
  /** Hover reports the hour under the pointer (a day's peak hour on daily ranges), and null on leave. */
  onFocusHour: (index: number | null) => void;
  /** A click, a tap or a touch-drag on the plate pins its hour. */
  onPick: (index: number) => void;
  delay?: number;
  className?: string;
}

export function LoadChart({ hours, start, focusIndex, onFocusHour, onPick, delay, className }: LoadChartProps) {
  const uid = useId().replace(/:/g, "");
  const [range, setRange] = useState<ChartRange>("24h");
  const span = RANGES.find((r) => r.id === range)?.hours ?? 24;
  const daily = DAILY.includes(range);
  const narrow = useMedia(NARROW);
  // the tooltip shows only while a pointer is on the plate; a scroll under a still
  // pointer hides it (and drops the hover), so it never lingers at a stale hour
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!live) return;
    const off = () => {
      setLive(false);
      onFocusHour(null);
    };
    window.addEventListener("scroll", off, { passive: true });
    return () => window.removeEventListener("scroll", off);
  }, [live, onFocusHour]);

  const all = useMemo(() => toRows(hours), [hours]);
  // each hour's calendar day in the run, as an ordinal (the daily ranges' x)
  const dayOf = useMemo(() => {
    const m = new Map<number, number>();
    let d = -1;
    let prev = "";
    for (const h of hours) {
      const key = h.timestamp.slice(0, 10);
      if (key !== prev) {
        d += 1;
        prev = key;
      }
      m.set(h.index, d);
    }
    return m;
  }, [hours]);
  const rows = useMemo(() => {
    if (!Number.isFinite(span) || all.length <= span) return all;
    const pos = Math.max(0, all.findIndex((r) => r.i >= start));
    const from = Math.min(pos, all.length - span);
    return all.slice(from, from + span);
  }, [all, span, start]);
  const days = useMemo(() => (daily ? toDays(rows, dayOf) : []), [daily, rows, dayOf]);

  const ticks = useMemo(() => {
    if (!daily) return ticksFor(rows, Math.min(span, rows.length));
    const step = Math.max(1, Math.ceil(days.length / (narrow ? 4 : 8)));
    return days.filter((_, k) => k % step === 0).map((d) => d.d);
  }, [daily, rows, span, days, narrow]);
  const bands = useMemo(() => (daily ? [] : peakBands(rows)), [daily, rows]);
  const units = useMemo<TrackUnit[]>(
    () =>
      daily
        ? days.map((d) => ({ x: d.d, storage: d.storageHours * 2 > d.hours, overload: d.overloadHours > 0, focusAt: d.peakIndex }))
        : rows.map((r) => ({ x: r.i, storage: isStorage(r.mode), overload: r.overload, focusAt: r.i })),
    [daily, days, rows],
  );
  const track = narrow ? { h: 8, gap: 6 } : { h: 10, gap: 7 };

  const xFirst = daily ? (days[0]?.d ?? 0) : (rows[0]?.i ?? 0);
  const xLast = daily ? (days[days.length - 1]?.d ?? 0) : (rows[rows.length - 1]?.i ?? 0);
  // the domain is fitted in 50s, with headroom over the top tick for the kW unit; the ticks fall on round values through 0
  const top = Math.max(OVERLOAD_AT_KW, ...rows.map((r) => r.demand)) * 1.1;
  const low = daily ? 0 : Math.min(0, ...rows.map((r) => r.charging)) * 1.06;
  const yMax = Math.ceil(top / 50) * 50;
  const yMin = low < 0 ? -Math.ceil(-low / 50) * 50 : 0;
  const yStep = yMax - yMin > 320 ? 100 : 50;
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax - yStep * 0.5; v += yStep) yTicks.push(v);

  const focusRow = focusIndex != null ? rows.find((r) => r.i === focusIndex) : undefined;
  const focusX = focusRow ? (daily ? dayOf.get(focusRow.i) : focusRow.i) : undefined;

  const fmtTick = (x: number) => {
    if (daily) {
      const d = days.find((r) => r.d === x);
      return d ? dayMonth(d.ts) : "";
    }
    const r = rows.find((v) => v.i === x);
    if (!r) return "";
    return span > 24 && r.hour === 0 ? dayMonth(r.ts) : hhmm(r.ts);
  };
  const n = rows.length;
  const desc =
    n === 0
      ? "No hours"
      : daily
        ? `${dayMonth(rows[0].ts)} – ${dayMonth(rows[n - 1].ts)} · ${n.toLocaleString()} h, by day: low to peak and the mean`
        : `${hhmm(rows[0].ts)} ${dayMonth(rows[0].ts)} – ${hhmm(rows[n - 1].ts)} ${dayMonth(rows[n - 1].ts)} · ${n.toLocaleString()} h`;

  const storageN = rows.filter((r) => isStorage(r.mode)).length;
  const overloadN = rows.filter((r) => r.overload).length;
  const trackSummary = `Mode track: ${storageN} of ${n} hours on Renewable Storage, ${n - storageN} on Main Grid, ${overloadN} at critical overload.`;

  /** The hour a chart event lands on: the hour itself, or the day's peak hour. */
  const hourAt = (k: unknown): number | undefined => {
    if (k == null) return undefined;
    if (daily) return days[Number(k)]?.peakIndex;
    return rows[Number(k)]?.i;
  };
  const pick = (s: { activeTooltipIndex?: unknown } | null | undefined) => {
    setLive(true);
    const i = hourAt(s?.activeTooltipIndex);
    if (i != null) onPick(i);
  };

  /* The keyboard: the plot is one slider over the page's focused hour (Recharts'
   * own keyboard layer is off, so there is never a second cursor). Arrows step an
   * hour (a day on the daily ranges, landing on its peak hour); Home / End go to
   * the range's ends. */
  const stops = daily ? days.map((d) => d.peakIndex) : rows.map((r) => r.i);
  const focusAt = focusIndex == null ? -1 : daily ? days.findIndex((d) => focusIndex >= d.first && focusIndex <= d.last) : rows.findIndex((r) => r.i === focusIndex);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (stops.length === 0) return;
    const last = stops.length - 1;
    const at = focusAt < 0 ? 0 : focusAt;
    const to: Record<string, number> = { ArrowRight: at + 1, ArrowUp: at + 1, ArrowLeft: at - 1, ArrowDown: at - 1, Home: 0, End: last };
    if (!(e.key in to)) return;
    e.preventDefault();
    setLive(false);
    onFocusHour(null);
    onPick(stops[Math.max(0, Math.min(last, to[e.key]))]);
  };
  const focusHour = focusIndex != null ? hours[focusIndex] : undefined;
  /** The hour under a client x: the plot spans the surface less its margins, linear over [xFirst, xLast]. */
  const hourAtX = (clientX: number, surface: Element | null): number | undefined => {
    if (!surface || stops.length === 0) return undefined;
    const box = surface.getBoundingClientRect();
    const left = box.left + PLATE_PAD + Y_AXIS_W;
    const width = box.width - PLATE_PAD - Y_AXIS_W - (narrow ? RIGHT.narrow : RIGHT.wide);
    if (width <= 0 || clientX < left - 1 || clientX > left + width + 1) return undefined;
    const x = Math.round(xFirst + ((clientX - left) / width) * (xLast - xFirst));
    return daily ? days.find((d) => d.d === x)?.peakIndex : rows.find((r) => r.i === x)?.i;
  };

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
    <GlassCard variant="paper" className={clsx("va-chart-card vd-chart", className)} delay={delay} aria-labelledby="vd-chart-title">
      <div className="va-plate va-chart-plate">
        <div
          className="vd-plot"
          role="slider"
          tabIndex={0}
          aria-label="Hour in focus on the chart"
          aria-valuemin={stops[0] ?? 0}
          aria-valuemax={stops[stops.length - 1] ?? 0}
          aria-valuenow={focusIndex ?? undefined}
          aria-valuetext={focusHour ? `${hhmm(focusHour.timestamp)} ${dayMonth(focusHour.timestamp)}, ${focusHour.prediction_kw.toFixed(1)} kW, ${shortMode(focusHour.mode)}${focusHour.overload ? ", critical overload" : ""}` : undefined}
          onKeyDown={onKey}
          // a click or a tap pins the hour under it, read from the click's own x (Recharts
          // reports hover a frame later, and its touch callback can miss the hour)
          onClick={(e) => {
            const i = hourAtX(e.clientX, e.currentTarget.querySelector(".recharts-surface"));
            if (i != null) onPick(i);
          }}
        >
        <div className="va-plate-media" key={range}>
          <span className="va-axis-unit" aria-hidden="true">kW</span>
          <ChartContainer config={config} className="va-chart aspect-auto h-full w-full" initialDimension={{ width: 900, height: 340 }}>
            <ComposedChart
              data={(daily ? days : rows) as (Row | DayRow)[]}
              margin={{ top: 26, right: narrow ? RIGHT.narrow : RIGHT.wide, bottom: 4, left: PLATE_PAD }}
              accessibilityLayer={false}
              onMouseMove={(s) => {
                setLive(true);
                const i = hourAt(s?.activeTooltipIndex);
                if (i != null) onFocusHour(i);
              }}
              onMouseLeave={() => {
                setLive(false);
                onFocusHour(null);
              }}
              onTouchStart={pick}
              onTouchMove={pick}
            >
              <defs>
                {SERIES.map((s) => (
                  <linearGradient key={s.key} id={`${s.key}${uid}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" style={{ stopColor: s.color, stopOpacity: s.top }} />
                    <stop offset="100%" style={{ stopColor: s.color, stopOpacity: s.bottom }} />
                  </linearGradient>
                ))}
                <linearGradient id={`charging${uid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" style={{ stopColor: "var(--vd-battery)", stopOpacity: 0.34 }} />
                  <stop offset="100%" style={{ stopColor: "var(--vd-battery)", stopOpacity: 0.04 }} />
                </linearGradient>
                <linearGradient id={`band${uid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" style={{ stopColor: "var(--vd-grid)", stopOpacity: 0.34 }} />
                  <stop offset="100%" style={{ stopColor: "var(--vd-grid)", stopOpacity: 0.08 }} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--chart-grid-line)" />
              <XAxis dataKey={daily ? "d" : "i"} type="number" domain={[xFirst, xLast]} ticks={ticks} tickFormatter={fmtTick} tickLine={false} axisLine={false} tickMargin={10 + track.gap + track.h} height={30 + track.gap + track.h} interval="preserveStartEnd" />
              <YAxis domain={[yMin, yMax]} ticks={yTicks} interval={0} tickLine={false} axisLine={false} width={Y_AXIS_W} tickMargin={6} tickFormatter={axisNum} />
              {bands.map(([a, b], k) => (
                <ReferenceArea
                  key={a}
                  x1={Math.max(a - 0.5, xFirst)}
                  x2={Math.min(b + 0.5, xLast)}
                  fill="var(--mode-storage)"
                  fillOpacity={0.045}
                  stroke="none"
                  ifOverflow="hidden"
                  label={n <= 24 && k === 0 ? { value: "18–22", position: "insideTop", className: "va-band-label" } : undefined}
                />
              ))}
              {yMin < 0 && <ReferenceLine y={0} stroke="var(--glass-edge)" />}
              <ReferenceLine y={STORAGE_ABOVE_KW} stroke="var(--chart-ref-line)" strokeDasharray="2 4" label={narrow ? STORAGE_LABEL.Narrow : STORAGE_LABEL.Wide} />
              <ReferenceLine y={OVERLOAD_AT_KW} stroke="var(--overload-soft)" strokeDasharray="2 4" label={narrow ? OVERLOAD_LABEL.Narrow : OVERLOAD_LABEL.Wide} />
              <ChartTooltip
                active={live ? undefined : false}
                cursor={false}
                content={daily ? <DayTip compact={narrow} /> : <HourTip compact={narrow} />}
                wrapperStyle={{ outline: "none" }}
                {...(narrow ? { position: { y: 4 } } : {})}
              />
              {daily ? (
                <>
                  <Area dataKey="band" type="monotone" stroke="var(--vd-grid)" strokeOpacity={0.55} strokeWidth={1} fill={`url(#band${uid})`} isAnimationActive={false} activeDot={false} className="va-area va-area--grid" />
                  <Line
                    dataKey="mean"
                    type="monotone"
                    stroke="var(--ink)"
                    strokeOpacity={0.82}
                    strokeWidth={1.3}
                    isAnimationActive={false}
                    activeDot={{ r: 3.5, fill: "var(--ink)", stroke: "var(--bg-deep)", strokeWidth: 1.5 }}
                    dot={false}
                    className="va-demand"
                  />
                  <Line
                    dataKey="max"
                    stroke="none"
                    isAnimationActive={false}
                    activeDot={false}
                    legendType="none"
                    dot={(p: DotProps) =>
                      p.payload && p.payload.overloadHours > 0 ? (
                        <circle key={`d${p.index}`} cx={p.cx} cy={p.cy} r={2 + Math.min(4, p.payload.overloadHours / 4)} className="va-overload-dot" />
                      ) : (
                        <g key={`d${p.index}`} />
                      )
                    }
                  />
                </>
              ) : (
                <>
                  {SERIES.map((s) => (
                    <Area
                      key={s.key}
                      dataKey={s.key}
                      stackId="supply"
                      type="monotone"
                      stroke={s.color}
                      strokeWidth={s.width}
                      strokeOpacity={s.edge}
                      strokeDasharray={s.dash}
                      fill={`url(#${s.key}${uid})`}
                      isAnimationActive={false}
                      activeDot={{ r: 2.5, fill: s.color, stroke: "var(--bg-deep)", strokeWidth: 1.2 }}
                      className={`va-area vd-area--${s.key}`}
                    />
                  ))}
                  <Area
                    dataKey="charging"
                    stackId="charge"
                    type="monotone"
                    stroke="var(--vd-battery)"
                    strokeOpacity={0.9}
                    strokeWidth={1.1}
                    strokeDasharray="3 3"
                    fill={`url(#charging${uid})`}
                    isAnimationActive={false}
                    activeDot={false}
                    className="va-area vd-area--battery vd-area-charging"
                  />
                  <Line
                    dataKey="demand"
                    type="monotone"
                    stroke="var(--ink)"
                    strokeOpacity={0.8}
                    strokeWidth={1.2}
                    isAnimationActive={false}
                    activeDot={{ r: 3.5, fill: "var(--ink)", stroke: "var(--bg-deep)", strokeWidth: 1.5 }}
                    dot={(p: DotProps) =>
                      p.payload?.overload && n <= 72 ? <circle key={`o${p.index}`} cx={p.cx} cy={p.cy} r={2.4} className="va-overload-dot" /> : <g key={`o${p.index}`} />
                    }
                    className="va-demand"
                  />
                </>
              )}
              {focusRow && focusX != null && <ReferenceLine x={focusX} stroke="var(--ink-soft)" strokeWidth={1} className="va-focus-rule" />}
              {focusRow && focusX != null && (
                <ReferenceDot x={focusX} y={focusRow.demand} r={4.5} fill={focusRow.overload ? "var(--flow-overload)" : "var(--vd-grid)"} stroke="var(--bg-deep)" strokeWidth={2} className="va-focus-dot" />
              )}
              <ModeTrack units={units} xFirst={xFirst} xLast={xLast} focusX={focusX} height={track.h} gap={track.gap} label onHover={onFocusHour} onPick={onPick} />
            </ComposedChart>
          </ChartContainer>
        </div>
        </div>
      </div>

      <div className="vd-chart-foot">
        <div className="vd-chart-heading">
          <p className="va-card-label">Load forecast</p>
          <h2 className="va-card-title" id="vd-chart-title">Predicted load and supply</h2>
          <p className="va-chart-desc">{desc}</p>
          <p className="sr-only">{trackSummary}</p>
        </div>
        <div className="vd-chart-range">{rangeControl}</div>
        <ul className="va-legend" aria-label="Legend">
          {daily ? (
            <>
              <li><i className="vd-legend-band" aria-hidden="true" />Daily low to peak</li>
              <li><i className="va-legend-line" aria-hidden="true" />Daily mean demand</li>
              <li><i className="vd-legend-dot" aria-hidden="true" />Overload hours that day</li>
            </>
          ) : (
            <>
              {SERIES.map((s) => (
                <li key={s.key}><i className={clsx("va-legend-swatch", s.dash && "is-dotted")} style={{ "--sw": s.color } as CSSProperties} aria-hidden="true" />{s.name}</li>
              ))}
              <li><i className="vd-legend-charging" aria-hidden="true" />Charging, below 0</li>
              <li><i className="va-legend-line" aria-hidden="true" />Predicted demand</li>
            </>
          )}
          <li><i className="va-legend-dash" aria-hidden="true" />{STORAGE_ABOVE_KW} kW storage</li>
          <li><i className="va-legend-dash va-legend-dash--overload" aria-hidden="true" />{OVERLOAD_AT_KW} kW overload</li>
          {!daily && <li><i className="va-legend-band" aria-hidden="true" />18–22 evening window</li>}
        </ul>
        <ul className="va-legend vd-track-legend" aria-label="Mode track legend">
          <li className="vd-track-cap">{daily ? "Mode track · each day's majority" : "Mode track"}</li>
          <li><span className="vd-key" aria-hidden="true"><i className="is-grid" /></span><UtilityPole className="vd-key-icon" strokeWidth={1.5} aria-hidden />Main Grid</li>
          <li><span className="vd-key" aria-hidden="true"><i className="is-storage" /></span><BatteryCharging className="vd-key-icon" strokeWidth={1.5} aria-hidden />Renewable Storage</li>
          <li><span className="vd-key" aria-hidden="true"><i className="is-grid" /><b /></span><TriangleAlert className="vd-key-icon" strokeWidth={1.5} aria-hidden />{daily ? "A day with overload hours" : "Overload hour"}</li>
        </ul>
      </div>
    </GlassCard>
  );
}
