import type { CSSProperties } from "react";

/** Inline custom properties (stagger delays, parallax depth) without casts at every call site. */
export function cssVars(vars: Record<`--${string}`, string | number>): CSSProperties {
  return vars as CSSProperties;
}
