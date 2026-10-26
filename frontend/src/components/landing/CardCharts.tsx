import { useId, useMemo, type ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { OVERLOAD_AT_KW, STORAGE_ABOVE_KW, STORAGE_MODE, type Hour } from "@/lib/forecast";

/* The two compact card charts. Structure from the shadcn "Area Chart -
 * Interactive" (stacked gradient areas, type="natural", a dot-indicator
 * tooltip), cut down for a card's image area: no axes, no legend, no range
 * select, edge to edge. The look is ours: flow-token strokes with a soft glow,
 * very faint grid, faint 160/200 kW reference lines, a small glass tooltip in
 * Lexend, and a draw-in on load (landing.css). */

interface Row {
  i: number;
  label: string;
  kw: number;
  kwFill: number;
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
    kwFill: h.predictionKw,
    grid: Math.max(h.gridKw, 0),
    battery: Math.max(h.batteryKw, 0), // the discharging part only
    pv: Math.max(h.pvKw, 0),
    overload: h.overload,
    storage: h.mode === STORAGE_MODE,
  }));
}

/** Horizontal gradient stops that switch colour half-way between hours. */
function hourStops(rows: Row[], pick: (r: Row) => [string, number]): ReactNode[] {
  const n = Math.max(rows.length - 1, 1);
  const out: ReactNode[] = [];
  rows.forEach((r, i) => {
    const [color, opacity] = pick(r);
    const from = i === 0 ? 0 : (i - 0.5) / n;
    const to = i === rows.length - 1 ? 1 : (i + 0.5) / n;
    out.push(<stop key={`${i}a`} offset={from} style={{ stopColor: color, stopOpacity: opacity }} />);
    out.push(<stop key={`${i}b`} offset={to} style={{ stopColor: color, stopOpacity: opacity }} />);
  });
  return out;
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

/** Card 1: the 24-hour prediction; overload hours tinted red. */
export function PeakChart({ hours, playhead }: { hours: Hour[]; playhead: number | null }) {
  const uid = useId().replace(/:/g, "");
  const rows = useMemo(() => toRows(hours), [hours]);
  const yMax = Math.max(...rows.map((r) => r.kw), OVERLOAD_AT_KW) * 1.12;
  const head = playhead != null ? rows[playhead] : null;

  return (
    <ChartContainer config={peakConfig} className="vl-chart vl-chart--peak aspect-auto h-full w-full" initialDimension={{ width: 300, height: 122 }}>
      <AreaChart data={rows} margin={{ top: 6, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false}>
        <defs>
          <linearGradient id={`s${uid}`} x1="0" y1="0" x2="1" y2="0">
            {hourStops(rows, (r) => [r.overload ? "var(--flow-overload)" : "var(--flow-grid)", 1])}
          </linearGradient>
          {/* the fill takes each hour's colour (lime, or red on overload) and fades downward */}
          <linearGradient id={`f${uid}`} x1="0" y1="0" x2="1" y2="0">
            {hourStops(rows, (r) => [r.overload ? "var(--flow-overload)" : "var(--flow-grid)", r.overload ? 0.26 : 0.34])}
          </linearGradient>
          <linearGradient id={`v${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="white" stopOpacity={1} />
            <stop offset="100%" stopColor="white" stopOpacity={0} />
          </linearGradient>
          <mask id={`m${uid}`} maskContentUnits="objectBoundingBox">
            <rect x="0" y="0" width="1" height="1" fill={`url(#v${uid})`} />
          </mask>
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
        <Area dataKey="kwFill" type="natural" stroke="none" fill={`url(#f${uid})`} mask={`url(#m${uid})`} isAnimationActive={false} activeDot={false} tooltipType="none" />
        <Area
          dataKey="kw"
          type="natural"
          stroke={`url(#s${uid})`}
          strokeWidth={1.6}
          fill="none"
          isAnimationActive={false}
          activeDot={{ r: 3, fill: "var(--flow-grid)", stroke: "var(--bg-deep)", strokeWidth: 1.5 }}
          className="vl-area-main"
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

/** Card 2: where the power comes from each hour, with faint storage-mode bands. */
export function FlowChart({ hours, playhead }: { hours: Hour[]; playhead: number | null }) {
  const uid = useId().replace(/:/g, "");
  const rows = useMemo(() => toRows(hours), [hours]);
  const yMax = Math.max(...rows.map((r) => r.grid + r.battery + r.pv), OVERLOAD_AT_KW) * 1.1;
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

  const series = [
    { key: "grid" as const, color: "var(--flow-grid)", name: "Grid", fill: 0.34, line: 1 },
    { key: "battery" as const, color: "var(--flow-battery)", name: "Battery", fill: 0.26, line: 0.55 },
    { key: "pv" as const, color: "var(--flow-solar)", name: "Solar", fill: 0.26, line: 0.55 },
  ];

  return (
    <ChartContainer config={flowConfig} className="vl-chart vl-chart--flow aspect-auto h-full w-full" initialDimension={{ width: 300, height: 158 }}>
      <AreaChart data={rows} margin={{ top: 6, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`${s.key}${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: s.color, stopOpacity: s.fill }} />
              <stop offset="100%" style={{ stopColor: s.color, stopOpacity: s.fill * 0.25 }} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grid-line)" />
        <XAxis dataKey="i" type="number" domain={[0, end]} hide />
        <YAxis domain={[0, yMax]} hide />
        {runs.map(([a, b]) => (
          <ReferenceArea key={a} x1={Math.max(a - 0.5, 0)} x2={Math.min(b + 0.5, end)} fill="var(--mode-storage)" fillOpacity={0.055} stroke="none" ifOverflow="hidden" />
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
                const s = series.find((x) => x.key === name);
                return s ? <TipRow color={s.color} name={s.name} value={kw(Number(v))} /> : null;
              }}
            />
          }
        />
        {series.map((s) => (
          <Area
            key={s.key}
            dataKey={s.key}
            stackId="flow"
            type="monotone" // natural splines overshoot per layer and cross on a stack this jumpy
            stroke={s.color}
            strokeOpacity={s.line}
            strokeWidth={1.2}
            fill={`url(#${s.key}${uid})`}
            isAnimationActive={false}
            activeDot={{ r: 2.5, fill: s.color, stroke: "var(--bg-deep)", strokeWidth: 1.2 }}
            className="vl-area-main"
          />
        ))}
        {playhead != null && <ReferenceLine x={playhead} stroke="var(--ink-soft)" strokeWidth={1} className="vl-playhead" />}
      </AreaChart>
    </ChartContainer>
  );
}
