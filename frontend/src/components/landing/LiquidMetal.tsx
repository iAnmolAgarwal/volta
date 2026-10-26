import { useEffect, useRef } from "react";
import { createMetalRenderer } from "./LiquidMetalShader";

/* The liquid-metal surface for a pill or a disc. It fills its positioned parent
 * (the button), overscanned on every side so the bloom has room, and takes no
 * pointer events: the parent stays the real control and feeds it hover and
 * pointer position. It renders only while on screen and the tab is visible.
 * The caller decides when to use it (desktop, motion allowed); if WebGL2 is
 * missing, `onUnavailable` fires and the caller falls back to plain glass. */
export function LiquidMetal({ onUnavailable }: { onUnavailable?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const tint = getComputedStyle(host).getPropertyValue("--volt") || "#c4f26a";
    const r = createMetalRenderer(canvas, tint);
    if (!r) {
      onUnavailable?.();
      return;
    }

    let raf = 0;
    let visible = true;
    let onScreen = true;
    let hoverT = 0;
    let hover = 0;
    let ptrT = 0;
    let ptr = 0;
    const ptrPos = { x: 0, y: 0 };
    let dpr = 1;
    let box = { w: 1, h: 1, pad: 1 };
    const t0 = performance.now();
    let last = t0;

    const measure = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = host.offsetWidth;
      const h = host.offsetHeight;
      const pad = Math.round(h * 1.1);
      box = { w, h, pad };
      canvas.style.left = canvas.style.top = `${-pad}px`;
      canvas.style.width = `${w + 2 * pad}px`;
      canvas.style.height = `${h + 2 * pad}px`;
      r.resize(Math.round((w + 2 * pad) * dpr), Math.round((h + 2 * pad) * dpr));
    };

    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      hover += (hoverT - hover) * (1 - Math.exp(-dt * 7));
      ptr += (ptrT - ptr) * (1 - Math.exp(-dt * 9));
      const cw = (box.w + 2 * box.pad) * dpr;
      const ch = (box.h + 2 * box.pad) * dpr;
      r.draw({
        cx: cw / 2,
        cy: ch / 2,
        hx: (box.w / 2) * dpr,
        hy: (box.h / 2) * dpr,
        t: (now - t0) / 1000,
        hover,
        ptr: [(ptrPos.x + box.pad) * dpr, (ptrPos.y + box.pad) * dpr, ptr],
        height: ch,
      });
      schedule();
    };
    const schedule = () => {
      if (!raf && visible && onScreen) raf = requestAnimationFrame(frame);
    };

    const onEnter = () => { hoverT = 1; };
    const onLeave = () => { hoverT = 0; ptrT = 0; };
    const onMove = (e: PointerEvent) => {
      const b = host.getBoundingClientRect();
      ptrPos.x = e.clientX - b.left;
      ptrPos.y = e.clientY - b.top;
      ptrT = 1;
    };
    const onFocus = () => { hoverT = 1; };
    const onVis = () => {
      visible = document.visibilityState === "visible";
      last = performance.now();
      schedule();
    };
    host.addEventListener("pointerenter", onEnter);
    host.addEventListener("pointerleave", onLeave);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("focus", onFocus);
    host.addEventListener("blur", onLeave);
    document.addEventListener("visibilitychange", onVis);
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      last = performance.now();
      schedule();
    });
    io.observe(canvas);
    measure();
    schedule();

    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener("pointerenter", onEnter);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("focus", onFocus);
      host.removeEventListener("blur", onLeave);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
      io.disconnect();
      r.dispose();
    };
  }, [onUnavailable]);

  return <canvas ref={ref} className="lm-canvas" aria-hidden="true" />;
}
