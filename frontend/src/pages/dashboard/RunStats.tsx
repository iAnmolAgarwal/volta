import { GlassCard } from "@/components/app/GlassCard";
import { dayMonth, hhmm, MIN_SOC_PCT, type RunSummary } from "@/lib/api";
import { MarkCharge, MarkOverload, MarkPeak, MarkStorage, Stat } from "./SideStats";

/* The whole run at a glance, from the run's summary: its peak and when, its
 * overload hours, its share of hours on Renewable Storage and the battery's
 * lowest charge. The same side stats as the hero's window diagonal (mark,
 * soft label, bold value), on the system log's composition: a heading on the
 * card's left rail and the stats across the rest, so the window's numbers up
 * top and the run's here read as one pair. */

export function RunStats({ summary, delay }: { summary: RunSummary; delay?: number }) {
  const n = Math.max(1, summary.n_hours);
  const storageShare = summary.storage_hours / n;
  const atReserve = summary.min_soc_pct <= MIN_SOC_PCT + 0.05;
  const d = delay ?? 0;
  return (
    <GlassCard className="vd-run" delay={delay} aria-labelledby="vd-run-title">
      <div className="vd-run-head">
        <p className="va-card-label">Whole run · <span className="va-num">{dayMonth(summary.start)} – {dayMonth(summary.end)}</span></p>
        <h2 className="va-card-title" id="vd-run-title"><span className="va-num">{summary.n_hours.toLocaleString()}</span> hours</h2>
      </div>
      <div className="vd-run-stats" role="group" aria-label="The whole run at a glance">
        <Stat delay={d + 80} mark={<MarkPeak />} label={`Peak · ${hhmm(summary.peak_timestamp)} ${dayMonth(summary.peak_timestamp)}`} value={`${summary.peak_kw.toFixed(1)} kW`} />
        <Stat delay={d + 150} mark={<MarkOverload />} label="Overload" value={`${summary.overload_count.toLocaleString()} of ${summary.n_hours.toLocaleString()} h`} />
        <Stat delay={d + 220} mark={<MarkStorage share={storageShare} />} label="On storage" value={`${Math.round(storageShare * 100)}% of hours`} />
        <Stat delay={d + 290} mark={<MarkCharge share={summary.min_soc_pct / 100} />} label="Lowest charge" value={atReserve ? `${Math.round(summary.min_soc_pct)}% · reserve` : `${Math.round(summary.min_soc_pct)}%`} />
      </div>
    </GlassCard>
  );
}
