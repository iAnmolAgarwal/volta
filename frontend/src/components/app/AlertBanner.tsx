import { useState, type CSSProperties } from "react";
import { clsx } from "clsx";
import { TriangleAlert, X } from "lucide-react";
import { hhmm, OVERLOAD_AT_KW, type OverloadAlert } from "@/lib/api";

/* The overload alert: a full-width glass pill in --overload, entering like the
 * cards. It names the overload hours as chips; a chip calls onSelect(index)
 * with the hour's run index, so the page can move the chart there. Dismissing
 * hides it until the parent re-keys it (e.g. key={windowStart}).
 * Nothing renders when there are no alerts. */

export interface AlertBannerProps {
  alerts: Pick<OverloadAlert, "index" | "timestamp" | "prediction_kw">[];
  onSelect?: (index: number) => void;
  /** The run index of the hour in focus; its chip is pressed. */
  activeIndex?: number | null;
  onDismiss?: () => void;
  dismissible?: boolean;
  /** e.g. "in this window"; default "in this window". */
  scope?: string;
  delay?: number;
  className?: string;
}

export function AlertBanner({ alerts, onSelect, activeIndex, onDismiss, dismissible = true, scope = "in this window", delay, className }: AlertBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || alerts.length === 0) return null;
  const n = alerts.length;
  return (
    <section
      className={clsx("va-alert va-reveal", className)}
      style={delay != null ? ({ "--d": `${delay}ms` } as CSSProperties) : undefined}
      aria-label="Critical overload alert"
    >
      <span className="va-alert-icon" aria-hidden="true"><TriangleAlert strokeWidth={1.5} aria-hidden /></span>
      <div className="va-alert-text">
        <p className="va-alert-eyebrow">Critical overload</p>
        <p className="va-alert-title">
          <span className="va-num">{n}</span> {n === 1 ? "hour" : "hours"} at or above {OVERLOAD_AT_KW} kW {scope}
        </p>
      </div>
      <ul className="va-alert-chips" aria-label="Overload hours">
        {alerts.map((a) => (
          <li key={a.index}>
            {onSelect ? (
              <button
                type="button"
                className={clsx("va-pill va-pill--overload va-pill--sm is-action", activeIndex === a.index && "is-on")}
                aria-pressed={activeIndex === a.index}
                aria-label={`Show ${hhmm(a.timestamp)}, ${a.prediction_kw.toFixed(1)} kW`}
                onClick={() => onSelect(a.index)}
              >
                <span className="va-pill-label"><b>{hhmm(a.timestamp)}</b> {Math.round(a.prediction_kw)} kW</span>
              </button>
            ) : (
              <span className="va-pill va-pill--overload va-pill--sm">
                <span className="va-pill-label"><b>{hhmm(a.timestamp)}</b> {Math.round(a.prediction_kw)} kW</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      {dismissible && (
        <button
          type="button"
          className="va-alert-close"
          aria-label="Dismiss the overload alert"
          onClick={() => {
            setDismissed(true);
            onDismiss?.();
          }}
        >
          <X strokeWidth={1.5} aria-hidden />
        </button>
      )}
    </section>
  );
}
