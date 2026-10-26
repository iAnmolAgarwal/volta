import { clsx } from "clsx";
import { ArrowDown, ArrowUp, Minus, Sun } from "lucide-react";
import { CAPACITY_KWH, MIN_SOC_PCT } from "@/lib/api";

/* Sylva's side-stat ring mark, grown into the battery gauge: the dotted ring is
 * the track, a lime arc is the state of charge, a short tick marks the 10%
 * reserve the battery never goes below. In the middle, the charge in % and kWh;
 * under it, two side stats: what the battery is doing (from battery_kw: > 0
 * discharging, < 0 charging) and what the sun is adding (pv_kw). */

export interface RingGaugeProps {
  /** State of charge at the end of the hour, 0–100. */
  socPct: number;
  /** > 0 discharging, < 0 charging, 0 idle. */
  batteryKw: number;
  pvKw: number;
  capacityKwh?: number;
  /** A caption over the ring, e.g. "Battery at 18:00". */
  label?: string;
  className?: string;
}

const R = 86; // track radius in the 200-unit viewBox
const C = 2 * Math.PI * R;
const kw = (v: number) => `${Math.abs(v).toFixed(1)} kW`;

function batteryState(batteryKw: number): "charging" | "discharging" | "idle" {
  if (batteryKw > 0.05) return "discharging";
  if (batteryKw < -0.05) return "charging";
  return "idle";
}

export function RingGauge({ socPct, batteryKw, pvKw, capacityKwh = CAPACITY_KWH, label, className }: RingGaugeProps) {
  const soc = Math.max(0, Math.min(100, socPct));
  const kwh = (soc / 100) * capacityKwh;
  const state = batteryState(batteryKw);
  const StateIcon = state === "charging" ? ArrowUp : state === "discharging" ? ArrowDown : Minus;
  const stateText = state === "charging" ? `Charging · ${kw(batteryKw)}` : state === "discharging" ? `Discharging · ${kw(batteryKw)}` : "Idle";
  const reserve = (MIN_SOC_PCT / 100) * 360;
  const head = (soc / 100) * 2 * Math.PI - Math.PI / 2;

  return (
    <figure className={clsx("va-ring", `is-${state}`, soc <= MIN_SOC_PCT + 0.01 && "at-reserve", className)}>
      {label && <figcaption className="va-ring-label">{label}</figcaption>}
      <div
        className="va-ring-dial"
        role="meter"
        aria-label="Battery state of charge"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(soc)}
        aria-valuetext={`${Math.round(soc)}%, ${Math.round(kwh)} of ${capacityKwh} kWh, ${stateText}`}
      >
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle className="va-ring-track" cx="100" cy="100" r={R} />
          <circle className="va-ring-inner" cx="100" cy="100" r={R - 14} />
          <circle
            className="va-ring-arc"
            cx="100"
            cy="100"
            r={R}
            strokeDasharray={`${C} ${C}`}
            strokeDashoffset={C * (1 - soc / 100)}
            transform="rotate(-90 100 100)"
          />
          <line className="va-ring-reserve" x1="100" y1={100 - R - 7} x2="100" y2={100 - R + 7} transform={`rotate(${reserve} 100 100)`} />
          {soc > 0 && <circle className="va-ring-head" cx={100 + R * Math.cos(head)} cy={100 + R * Math.sin(head)} r="3.6" />}
        </svg>
        <div className="va-ring-centre">
          <span className="va-ring-pct">{Math.round(soc)}<small>%</small></span>
          <span className="va-ring-kwh">{Math.round(kwh)} of {capacityKwh} kWh</span>
        </div>
      </div>
      <dl className="va-ring-stats">
        <div className="va-stat">
          <span className="va-stat-mark" aria-hidden="true"><StateIcon strokeWidth={1.4} aria-hidden /></span>
          <div><dt>Battery</dt><dd>{stateText}</dd></div>
        </div>
        <div className="va-stat va-stat--solar">
          <span className="va-stat-mark" aria-hidden="true"><Sun strokeWidth={1.4} aria-hidden /></span>
          <div><dt>Solar</dt><dd>{pvKw > 0.05 ? kw(pvKw) : "None this hour"}</dd></div>
        </div>
      </dl>
    </figure>
  );
}
