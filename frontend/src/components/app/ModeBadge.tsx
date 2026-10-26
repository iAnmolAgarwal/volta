import { clsx } from "clsx";
import { BatteryCharging, UtilityPole } from "lucide-react";
import { isStorage, shortMode, type ModeName } from "@/lib/api";

/* The controller's state, as a dock-style glass pill: an icon tile, a spaced-caps
 * eyebrow and the mode's short name, each mode with its own token colour, so
 * colour is never the only signal (an icon and a word always come with it).
 * The optional reason is the controller's own `reason` for the hour. */

export interface ModeBadgeProps {
  mode: ModeName;
  /** The controller's `reason` for this hour, shown under the pill. */
  reason?: string | null;
  /** Adds the landing's Overload flag (≥ 200 kW). */
  overload?: boolean;
  /** The eyebrow over the name; default "Mode". */
  eyebrow?: string;
  size?: "md" | "lg";
  /** Announce changes to screen readers (for a badge that follows a focused hour). */
  live?: boolean;
  className?: string;
}

export function ModeBadge({ mode, reason, overload, eyebrow = "Mode", size = "md", live, className }: ModeBadgeProps) {
  const storage = isStorage(mode);
  const Icon = storage ? BatteryCharging : UtilityPole;
  return (
    <div className={clsx("va-mode", `va-mode--${size}`, storage ? "is-storage" : "is-grid", className)} aria-live={live ? "polite" : undefined}>
      <div className="va-mode-pill">
        <span className="va-mode-tile" aria-hidden="true"><Icon strokeWidth={1.4} aria-hidden /></span>
        <span className="va-mode-text">
          <span className="va-mode-eyebrow">
            {eyebrow}
            {/* beside the label, as on the landing's card 2 */}
            {overload && (
              <span className="va-flag" aria-label="Critical overload: 200 kW or more">
                <i aria-hidden="true" />Overload
              </span>
            )}
          </span>
          <span className="va-mode-name">{shortMode(mode)}</span>
        </span>
      </div>
      {reason && <p className="va-mode-reason">{reason}</p>}
    </div>
  );
}
