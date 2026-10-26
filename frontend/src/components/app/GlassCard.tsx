import type { ComponentType, CSSProperties, ElementType, MouseEventHandler, ReactNode } from "react";
import { clsx } from "clsx";
import { ArrowUpRight } from "lucide-react";
import { useRouteLink } from "@/lib/useRouteLink";

/* Sylva's floating cards, as a container. `paper` is the white card (label,
 * title, deep soft shadow, the shadow grows on hover); `glass` is the moss-glass
 * panel the landing plates and tooltips use. Both wipe in behind a mask on
 * mount, a beat apart when given `delay` (Sylva's staged entrances). The knob is
 * Sylva's round white button on the card's lower-right corner. */

export interface Knob {
  label: string; // accessible name, e.g. "Open on dashboard"
  icon?: ComponentType<{ strokeWidth?: number; "aria-hidden"?: boolean }>;
  to?: string; // a route (client-side navigation)
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

export interface GlassCardProps {
  variant?: "paper" | "glass";
  as?: ElementType;
  /** Sylva's small card label ("Field Note 07"). */
  label?: ReactNode;
  /** Sylva's card title, under the label. */
  title?: ReactNode;
  /** Something for the header's right side (a Pill, a range control). */
  aside?: ReactNode;
  knob?: Knob;
  /** Entrance stagger in ms. */
  delay?: number;
  /** Skip the mask-wipe entrance (e.g. a card that re-mounts often). */
  still?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export function CardKnob({ knob }: { knob: Knob }) {
  const link = useRouteLink();
  const Icon = knob.icon ?? ArrowUpRight;
  const disc = (
    <span className="va-knob-disc" aria-hidden="true">
      <Icon strokeWidth={1.4} aria-hidden />
    </span>
  );
  if (knob.to) {
    return (
      <a className="va-knob" href={knob.to} aria-label={knob.label} onClick={link(knob.to)}>
        {disc}
      </a>
    );
  }
  return (
    <button type="button" className="va-knob" aria-label={knob.label} onClick={knob.onClick}>
      {disc}
    </button>
  );
}

export function GlassCard({
  variant = "glass",
  as: Tag = "section",
  label,
  title,
  aside,
  knob,
  delay,
  still,
  className,
  style,
  children,
  ...rest
}: GlassCardProps) {
  const head = label != null || title != null || aside != null;
  return (
    <Tag
      className={clsx("va-card", `va-card--${variant}`, !still && "va-reveal", knob && "has-knob", className)}
      style={delay != null ? ({ "--d": `${delay}ms`, ...style } as CSSProperties) : style}
      {...rest}
    >
      {head && (
        <header className="va-card-head">
          <div className="va-card-heading">
            {label != null && <p className="va-card-label">{label}</p>}
            {title != null && <h2 className="va-card-title">{title}</h2>}
          </div>
          {aside != null && <div className="va-card-aside">{aside}</div>}
        </header>
      )}
      {children}
      {knob && <CardKnob knob={knob} />}
    </Tag>
  );
}
