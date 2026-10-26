import { useSyncExternalStore } from "react";

/** Live result of a CSS media query. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
export const NARROW = "(max-width: 900px)";
export const FINE_HOVER = "(hover: hover) and (pointer: fine)";
