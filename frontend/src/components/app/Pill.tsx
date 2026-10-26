import type { ComponentType, MouseEventHandler, ReactNode } from "react";
import { clsx } from "clsx";
import { useRouteLink } from "@/lib/useRouteLink";

/* Sylva's glass chip: a dock pill on its own, in the dock's spaced caps. It is a
 * <button> with onClick, a client-side link with `to`, and a plain <span>
 * otherwise. `pressed` wears the cards' paper, as the active dock item does. */

export type PillTone = "default" | "volt" | "overload";

export interface PillProps {
  children: ReactNode;
  icon?: ComponentType<{ strokeWidth?: number; "aria-hidden"?: boolean }>;
  tone?: PillTone;
  size?: "sm" | "md";
  /** Toggle state; sets aria-pressed on a button. */
  pressed?: boolean;
  /** The current item in a set of links (aria-current). */
  current?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  to?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
  "aria-label"?: string;
}

export function Pill({ children, icon: Icon, tone = "default", size = "md", pressed, current, onClick, to, disabled, type = "button", className, ...rest }: PillProps) {
  const link = useRouteLink();
  const cls = clsx("va-pill", `va-pill--${tone}`, `va-pill--${size}`, (onClick || to || type === "submit") && "is-action", (pressed || current) && "is-on", className);
  const body = (
    <>
      {Icon && <span className="va-pill-glyph" aria-hidden="true"><Icon strokeWidth={1.5} aria-hidden /></span>}
      <span className="va-pill-label">{children}</span>
    </>
  );
  if (to) {
    return (
      <a className={cls} href={to} onClick={link(to)} aria-current={current ? "page" : undefined} {...rest}>
        {body}
      </a>
    );
  }
  if (onClick || type === "submit") {
    return (
      <button type={type} className={cls} onClick={onClick} disabled={disabled} aria-pressed={pressed} {...rest}>
        {body}
      </button>
    );
  }
  return <span className={cls} {...rest}>{body}</span>;
}
