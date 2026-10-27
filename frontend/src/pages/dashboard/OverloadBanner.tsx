import { useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import { Pill } from "@/components/app/Pill";
import { cssVars } from "@/components/landing/cssVars";
import { OVERLOAD_AT_KW } from "@/lib/api";
import type { OverloadRun } from "./model";

/* The window's overload alert, with its hours grouped into runs: one chip per
 * run of consecutive overload hours (15:00–22:00 · 8 h), not one per hour, so
 * a hot day reads as two stretches and never overflows the pill. Built from the
 * shared AlertBanner's own pieces (its .va-alert glass pill in --overload, its
 * icon, eyebrow and close button) and Pill chips, because AlertBanner takes
 * single hours only. A chip focuses its
 * run's peak hour; the chip of the run the focused hour sits in is pressed.
 * Re-key it (key={windowStart}) to undo a dismiss. */

export interface OverloadBannerProps {
  runs: OverloadRun[];
  focus: number;
  onSelect: (index: number) => void;
  /** After a dismiss: the page moves focus on and announces it. */
  onDismiss?: () => void;
  delay?: number;
}

export function OverloadBanner({ runs, focus, onSelect, onDismiss, delay }: OverloadBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || runs.length === 0) return null;
  const hours = runs.reduce((n, r) => n + r.hours, 0);
  return (
    <section className="va-alert va-reveal vd-alert" style={delay != null ? cssVars({ "--d": `${delay}ms` }) : undefined} aria-label="Critical overload alert">
      <span className="va-alert-icon" aria-hidden="true"><TriangleAlert strokeWidth={1.5} aria-hidden /></span>
      <div className="va-alert-text">
        <p className="va-alert-eyebrow">Critical overload</p>
        <p className="va-alert-title">
          <span className="va-num">{hours}</span> {hours === 1 ? "hour" : "hours"} at or above {OVERLOAD_AT_KW} kW in this window
          {runs.length > 1 && <span className="vd-alert-runs">, in {runs.length} stretches</span>}
        </p>
      </div>
      <ul className="va-alert-chips vd-alert-chips" aria-label="Overload stretches">
        {runs.map((r) => {
          const on = focus >= r.start && focus <= r.end;
          return (
            <li key={r.start}>
              <Pill
                tone="overload"
                size="sm"
                pressed={on}
                onClick={() => onSelect(r.peakIndex)}
                title={`Focus ${r.range}'s peak: ${r.peakKw.toFixed(1)} kW`}
              >
                <b>{r.range}</b> {r.hours} h · {Math.round(r.peakKw)} kW
              </Pill>
            </li>
          );
        })}
      </ul>
      <button type="button" className="va-alert-close" aria-label="Dismiss the overload alert" onClick={() => {
          setDismissed(true);
          onDismiss?.();
        }}>
        <X strokeWidth={1.5} aria-hidden />
      </button>
    </section>
  );
}
