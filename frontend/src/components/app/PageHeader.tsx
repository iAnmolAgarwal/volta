import type { ReactNode } from "react";
import { clsx } from "clsx";
import { cssVars } from "@/components/landing/cssVars";

/* Sylva's headline block on an app page: a spaced-caps eyebrow, a light Lexend
 * headline on the left rail, the lede in the column between the first and
 * second guides (Sylva's lede sits at x 520 of 1600), and the page's actions
 * on the right. The headline rises under a fade, the lede wipes in after it. */

export interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ eyebrow, title, lede, actions, className }: PageHeaderProps) {
  return (
    <header className={clsx("va-head", className)}>
      <div className="va-head-titles">
        {eyebrow != null && <p className="va-eyebrow va-rise" style={cssVars({ "--d": "60ms" })}>{eyebrow}</p>}
        <h1 className="va-display va-rise" style={cssVars({ "--d": "120ms" })}>{title}</h1>
      </div>
      {lede != null && <p className="va-lede va-reveal" style={cssVars({ "--d": "320ms" })}>{lede}</p>}
      {actions != null && <div className="va-head-actions va-reveal" style={cssVars({ "--d": "420ms" })}>{actions}</div>}
    </header>
  );
}
