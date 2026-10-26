import type { ComponentType, MouseEventHandler, ReactNode } from "react";
import { clsx } from "clsx";
import { Activity, ArrowRightLeft, TriangleAlert } from "lucide-react";
import { useRouteLink } from "@/lib/useRouteLink";

/* A system-log entry, in Sylva's Field Note pattern: a small spaced-caps label,
 * then a headline. `active` wears the cards' paper, as the active dock item
 * does. A button with onClick, a link with `to`, a plain row otherwise. */

export type LogKind = "switch" | "overload" | "info";

export interface LogItemProps {
  label: ReactNode; // e.g. "Mode switch · 23:00"
  title: ReactNode; // e.g. "Renewable Storage → Main Grid"
  kind?: LogKind;
  /** Right-hand detail, e.g. "244 kW". */
  meta?: ReactNode;
  icon?: ComponentType<{ strokeWidth?: number; "aria-hidden"?: boolean }>;
  active?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  to?: string;
  className?: string;
  "aria-label"?: string;
}

const ICONS = { switch: ArrowRightLeft, overload: TriangleAlert, info: Activity };

export function LogItem({ label, title, kind = "info", meta, icon, active, onClick, to, className, ...rest }: LogItemProps) {
  const link = useRouteLink();
  const Icon = icon ?? ICONS[kind];
  const cls = clsx("va-log", `va-log--${kind}`, (onClick || to) && "is-action", active && "is-active", className);
  const body = (
    <>
      <span className="va-log-mark" aria-hidden="true"><Icon strokeWidth={1.4} aria-hidden /></span>
      <span className="va-log-text">
        <span className="va-log-label">{label}</span>
        <span className="va-log-title">{title}</span>
      </span>
      {meta != null && <span className="va-log-meta">{meta}</span>}
    </>
  );
  if (to) {
    return <a className={cls} href={to} onClick={link(to)} aria-current={active ? "true" : undefined} {...rest}>{body}</a>;
  }
  if (onClick) {
    return <button type="button" className={cls} onClick={onClick} aria-pressed={active} {...rest}>{body}</button>;
  }
  return <div className={cls} aria-current={active ? "true" : undefined} {...rest}>{body}</div>;
}
