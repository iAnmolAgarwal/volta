import type { ComponentType, ReactNode } from "react";
import { clsx } from "clsx";
import { Inbox, TriangleAlert } from "lucide-react";
import { ApiError, errorTitle } from "@/lib/api";

/* Loading, empty and error states, in the same vocabulary: the landing's slow
 * sheen for loading; a side-stat mark grown into a dotted ring, a light Lexend
 * line and an action for empty and error. */

/** The landing's loading sheen. `overlay` fills its (positioned) parent; `card`
 * and `chart` stand in for a card or a chart plate; `text` draws `lines` bars. */
export function Shimmer({ variant = "card", lines = 3, label = "Loading", className }: { variant?: "overlay" | "card" | "chart" | "text"; lines?: number; label?: string; className?: string }) {
  if (variant === "text") {
    return (
      <span className={clsx("va-shimmer-text", className)} role="status" aria-label={label}>
        {Array.from({ length: lines }, (_, i) => <span key={i} className="va-shimmer-line"><span className="va-shimmer va-shimmer--overlay" /></span>)}
      </span>
    );
  }
  return (
    <span className={clsx("va-shimmer-box", `va-shimmer-box--${variant}`, className)} role="status" aria-label={label}>
      <span className="va-shimmer va-shimmer--overlay" aria-hidden="true" />
    </span>
  );
}

interface StateProps {
  title: ReactNode;
  children?: ReactNode; // the body text
  action?: ReactNode; // a Pill, usually
  icon?: ComponentType<{ strokeWidth?: number; "aria-hidden"?: boolean }>;
  /** `card` sits on a glass card; `plain` sits on the page. */
  surface?: "card" | "plain";
  className?: string;
}

export function EmptyState({ title, children, action, icon: Icon = Inbox, surface = "card", className }: StateProps) {
  return (
    <div className={clsx("va-state", `va-state--${surface}`, className)}>
      <span className="va-state-mark" aria-hidden="true"><Icon strokeWidth={1.2} aria-hidden /></span>
      <h2 className="va-state-title">{title}</h2>
      {children != null && <p className="va-state-body">{children}</p>}
      {action != null && <div className="va-state-action">{action}</div>}
    </div>
  );
}

/** An error, with the API's message and details when it is an ApiError. */
export function ErrorState({ error, title, action, surface = "card", className }: { error: unknown; title?: ReactNode; action?: ReactNode; surface?: "card" | "plain"; className?: string }) {
  const api = error instanceof ApiError ? error : null;
  // the browser's raw "Failed to fetch" says nothing; a bare "HTTP 503" repeats the code shown after it
  const raw = api ? api.message : error instanceof Error ? error.message : String(error);
  const message = api?.kind === "network" ? "Check the connection, then try again." : api && raw === `HTTP ${api.status}` ? "The server answered with an error." : raw;
  const details = api?.details ?? [];
  const shown = details.slice(0, 5);
  return (
    <div className={clsx("va-state", "va-state--error", `va-state--${surface}`, className)} role="alert">
      <span className="va-state-mark" aria-hidden="true"><TriangleAlert strokeWidth={1.2} aria-hidden /></span>
      <h2 className="va-state-title">{title ?? (api ? errorTitle(api) : "Something went wrong")}</h2>
      <p className="va-state-body">
        {message}
        {api && api.status > 0 && <span className="va-state-code"> · HTTP {api.status}</span>}
      </p>
      {shown.length > 0 && (
        <ul className="va-state-details">
          {shown.map((d, i) => <li key={i}>{d}</li>)}
          {details.length > shown.length && <li>and {details.length - shown.length} more</li>}
        </ul>
      )}
      {action != null && <div className="va-state-action">{action}</div>}
    </div>
  );
}
