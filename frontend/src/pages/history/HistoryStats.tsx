import type { ReactNode } from "react";
import { cssVars } from "@/components/landing/cssVars";
import { createdFull, createdShort, SOURCE_LABEL, atText, type ListStats } from "./model";
import { MarkLatest, MarkPeak, MarkRuns } from "./Marks";

/* The header's side stats, on Sylva's diagonal (x 1250 → 1346 → 1432, +110 a
 * step), as the dashboard sets its own: a faint mark, a soft label, a bold
 * value. They follow the source filter. On a phone they sit in one row. */

function Stat({ tone, mark, label, value, title, delay, live }: { tone: "a" | "b" | "c"; mark: ReactNode; label: ReactNode; value: ReactNode; title?: string; delay: number; live?: boolean }) {
  return (
    <div className={`vh-stat vh-stat--${tone} va-reveal`} style={cssVars({ "--d": `${delay}ms` })} title={title}>
      <span className="vh-mark" aria-hidden="true">{mark}</span>
      <dl>
        <dt>{label}</dt>
        <dd className="va-num" aria-live={live ? "polite" : undefined}>{value}</dd>
      </dl>
    </div>
  );
}

export function HistoryStats({ stats, filtered }: { stats: ListStats; filtered: boolean }) {
  const { shown, total, latest, peak } = stats;
  return (
    <div className="vh-stats" role="group" aria-label="Saved runs at a glance">
      <Stat
        tone="a"
        delay={700}
        live
        mark={<MarkRuns />}
        label={filtered ? "Runs shown" : "Runs listed"}
        value={filtered ? `${shown} of ${total}` : `${total} saved`}
      />
      <Stat
        tone="b"
        delay={770}
        mark={<MarkLatest />}
        label={latest ? <>Latest<span className="vh-stat-src"> · {SOURCE_LABEL[latest.source] ?? latest.source}</span></> : "Latest"}
        value={latest ? createdShort(latest.created) : "None"}
        title={latest ? createdFull(latest.created) : undefined}
      />
      <Stat
        tone="c"
        delay={840}
        mark={<MarkPeak />}
        label="Peak across runs"
        value={peak ? `${peak.peak_kw.toFixed(1)} kW` : "None"}
        title={peak ? `${peak.peak_kw.toFixed(2)} kW at ${atText(peak.peak_timestamp)}, in ${peak.filename ?? "a form entry"}` : undefined}
      />
    </div>
  );
}
