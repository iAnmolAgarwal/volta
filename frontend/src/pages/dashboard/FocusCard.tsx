import { Droplets, Thermometer } from "lucide-react";
import { GlassCard } from "@/components/app/GlassCard";
import { RingGauge } from "@/components/app/RingGauge";
import { dayMonth, hhmm, type RunHour } from "@/lib/api";
import { batteryWhy } from "./supply";

/* The hour in focus, beside the chart: its predicted load as the card title,
 * the battery's ring, and the telemetry the forecast was made from, as side
 * stats, with one plain line on what the battery is doing and why (supply.ts).
 * It follows the chart's hover, and falls back to the stepper's hour. */

export function FocusCard({ hour, hovering, delay }: { hour: RunHour; hovering: boolean; delay?: number }) {
  return (
    <GlassCard
      className="vd-focus"
      label={<>Hour in focus · <span className="va-num">{hhmm(hour.timestamp)} {dayMonth(hour.timestamp)}</span></>}
      title={<><span className="va-num">{hour.prediction_kw.toFixed(1)}</span> kW <small className="vd-focus-unit">predicted</small></>}
      aside={<span className={hovering ? "vd-source is-hover" : "vd-source"} title={hovering ? "The hour under the chart's cursor" : "The hour the stepper selects"}>{hovering ? "Hover" : "Pinned"}</span>}
      delay={delay}
    >
      <RingGauge socPct={hour.soc_pct} batteryKw={hour.battery_kw} pvKw={hour.pv_kw} label={`Battery at ${hhmm(hour.timestamp)}`} className="vd-ring" />
      <p className="vd-why">{batteryWhy(hour)}</p>
      <dl className="vd-inputs" aria-label="Telemetry for this hour">
        <div className="va-stat">
          <span className="va-stat-mark" aria-hidden="true"><Thermometer strokeWidth={1.4} aria-hidden /></span>
          <div><dt>Temperature</dt><dd>{hour.ambient_temp_c.toFixed(1)} °C</dd></div>
        </div>
        <div className="va-stat">
          <span className="va-stat-mark" aria-hidden="true"><Droplets strokeWidth={1.4} aria-hidden /></span>
          <div><dt>Humidity</dt><dd>{Math.round(hour.humidity_pct)}%</dd></div>
        </div>
      </dl>
    </GlassCard>
  );
}
