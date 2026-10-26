import { useCallback, type MouseEvent } from "react";
import { useNavigate } from "react-router";

/* Client-side navigation for plain <a href> elements, so every link keeps its
 * own markup and look. On the landing page a pointer click first lets the
 * scene's click burst play (it starts on pointerdown) before the route
 * changes; keyboard activation, modified clicks and reduced motion skip the
 * wait, and modified clicks fall through to the browser (new tab etc.). */

/** How long the landing scene's click burst needs to read (its ring opens and fades in ~1/3 s). */
export const BURST_MS = 360;

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useRouteLink() {
  const navigate = useNavigate();
  return useCallback(
    (to: string, delayMs = 0) =>
      (e: MouseEvent<HTMLAnchorElement>) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        const wait = delayMs > 0 && e.detail > 0 && !reduced() ? delayMs : 0;
        if (wait) window.setTimeout(() => navigate(to), wait);
        else navigate(to);
      },
    [navigate],
  );
}
