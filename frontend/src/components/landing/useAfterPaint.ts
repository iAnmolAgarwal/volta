import { useEffect, useState } from "react";

/* True once the page has loaded and the main thread has a quiet moment
 * (developer note 2, "Fast first paint"). The hero text and the dock paint
 * first; heavy extras (the three.js scene, the liquid-metal surfaces) mount
 * after this, so their script and shader work never sits in front of LCP. */

let settled = false;
const waiting = new Set<() => void>();

function settle() {
  if (settled) return;
  settled = true;
  for (const f of waiting) f();
  waiting.clear();
}

function arm() {
  const idle = () => {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(settle, { timeout: 900 });
    else window.setTimeout(settle, 120);
  };
  if (document.readyState === "complete") idle();
  else window.addEventListener("load", idle, { once: true });
}

let armed = false;

export function useAfterPaint(): boolean {
  const [ready, setReady] = useState(settled);
  useEffect(() => {
    if (settled) {
      setReady(true);
      return;
    }
    const on = () => setReady(true);
    waiting.add(on);
    if (!armed) {
      armed = true;
      arm();
    }
    return () => {
      waiting.delete(on);
    };
  }, []);
  return ready;
}
