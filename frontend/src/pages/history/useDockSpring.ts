import { useEffect, type RefObject } from "react";
import { FINE_HOVER, REDUCED_MOTION } from "@/components/landing/useMedia";

/* The dock's spring, for an in-page dock (the History filter). The same
 * behaviour as the landing dock (components/landing/Dock.tsx), after Sylva's:
 * as a fine pointer nears an item it grows on a spring, anchored at the top so
 * it grows downward, and takes the `data-near` look; keyboard focus grows the
 * focused item; the specular rim (`data-spec`, landing.css) turns to face the
 * pointer and brightens with its nearness. Coarse pointers and reduced motion
 * get a still dock. Layout is read in the frame, never in the pointer handler.
 *
 * Items are the root's `[data-dock]` children; their size is re-measured on
 * resize and whenever `deps` change (a label or count may change a width). */

interface Spring { el: HTMLElement; w: number; h: number; v: number; vel: number; target: number }

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => x * x * (3 - 2 * x);

export function useDockSpring(ref: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const mqHover = window.matchMedia(FINE_HOVER);
    const mqReduced = window.matchMedia(REDUCED_MOTION);
    const springs: Spring[] = Array.from(root.querySelectorAll<HTMLElement>("[data-dock]")).map((el) => ({ el, w: 0, h: 0, v: 0, vel: 0, target: 0 }));

    let on = false;
    let unit = 1;
    let aim = { x: 0, y: 0, seen: false, moved: false };
    let byKey = false;
    let dirty = false;
    let spec = { ang: 2.4, tAng: 2.4, br: 0, tBr: 0 };
    let raf = 0;
    let last = 0;

    const reset = () => {
      for (const s of springs) {
        s.el.style.width = s.el.style.height = s.el.style.transform = "";
        s.el.dataset.near = "false";
        s.v = s.vel = s.target = 0;
      }
    };

    const measure = () => {
      on = mqHover.matches && !mqReduced.matches;
      unit = Math.min(window.innerWidth, 1900) / 1600;
      reset();
      for (const s of springs) {
        const r = s.el.getBoundingClientRect();
        s.w = r.width;
        s.h = r.height;
      }
      root.style.removeProperty("--spec-bright");
      spec = { ang: 2.4, tAng: 2.4, br: 0, tBr: 0 };
    };

    const frame = (now: number) => {
      raf = 0;
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
      last = now;
      if (aim.seen && aim.moved && !byKey) {
        const rr = root.getBoundingClientRect();
        const inside = aim.x > rr.left - 48 && aim.x < rr.right + 48 && aim.y > rr.top - 44 && aim.y < rr.bottom + 64;
        for (const s of springs) {
          const r = s.el.getBoundingClientRect();
          s.target = inside ? smooth(clamp01(1 - Math.abs(aim.x - (r.left + r.width / 2)) / (128 * unit))) : 0;
          s.el.dataset.near = s.target > 0.08 ? "true" : "false";
        }
        // the rim faces the pointer and brightens as it nears (reach 250 units, as the dock's)
        const cx = rr.left + rr.width / 2;
        const cy = rr.top + rr.height / 2;
        const d = Math.hypot(Math.max(rr.left - aim.x, 0, aim.x - rr.right), Math.max(rr.top - aim.y, 0, aim.y - rr.bottom));
        spec.tAng = d === 0 ? 2.4 + ((aim.x - cx) / Math.max(rr.width / 2, 1)) * 0.3 : Math.atan2(cy - aim.y, aim.x - cx);
        spec.tBr = smooth(clamp01(1 - d / (250 * unit)));
      }
      aim.moved = false;
      let moving = false;
      for (const s of springs) {
        s.vel += (s.target - s.v) * 190 * dt;
        s.vel *= Math.exp(-23 * dt);
        s.v += s.vel * dt;
        if (Math.abs(s.target - s.v) < 0.001 && Math.abs(s.vel) < 0.004) { s.v = s.target; s.vel = 0; } else moving = true;
        const v = Math.min(Math.max(s.v, 0), 1.08);
        if (v === 0 && s.target === 0) {
          s.el.style.width = s.el.style.height = s.el.style.transform = "";
        } else {
          s.el.style.width = `${(s.w + Math.min(18 * unit, s.w * 0.24) * v).toFixed(2)}px`;
          s.el.style.height = `${(s.h + 16 * unit * v).toFixed(2)}px`;
          s.el.style.transform = `translateY(${(v * 3.5 * unit).toFixed(2)}px)`;
        }
      }
      const diff = ((spec.tAng - spec.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      spec.ang += diff * (1 - Math.exp(-dt * 8));
      spec.br += (spec.tBr - spec.br) * (1 - Math.exp(-dt * 9));
      if (Math.abs(diff) > 0.001 || Math.abs(spec.tBr - spec.br) > 0.002) moving = true;
      root.style.setProperty("--spec-angle", `${spec.ang.toFixed(4)}rad`);
      root.style.setProperty("--spec-bright", (clamp01(spec.br) * 0.92).toFixed(3));
      dirty = moving;
      if (dirty) kick();
      else last = 0;
    };
    function kick() {
      if (!raf && on) raf = requestAnimationFrame(frame);
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" || !on) return;
      aim = { x: e.clientX, y: e.clientY, seen: true, moved: true };
      byKey = false;
      kick();
    };
    const onLeave = () => {
      aim.seen = false;
      for (const s of springs) { s.target = 0; s.el.dataset.near = "false"; }
      spec.tBr = 0;
      kick();
    };
    const onFocusIn = (e: FocusEvent) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>("[data-dock]");
      if (!item || !on || !item.matches(":focus-visible")) return;
      const idx = springs.findIndex((s) => s.el === item);
      springs.forEach((s, i) => {
        s.target = i === idx ? 1 : Math.abs(i - idx) === 1 ? 0.24 : 0;
        s.el.dataset.near = s.target > 0.08 ? "true" : "false";
      });
      byKey = true;
      spec.tBr = 0.9;
      kick();
    };
    const onFocusOut = () => {
      requestAnimationFrame(() => {
        if (root.contains(document.activeElement) || !byKey) return;
        byKey = false;
        onLeave();
      });
    };

    measure();
    void document.fonts?.ready.then(measure);
    window.addEventListener("resize", measure);
    mqHover.addEventListener("change", measure);
    mqReduced.addEventListener("change", measure);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    return () => {
      cancelAnimationFrame(raf);
      reset();
      window.removeEventListener("resize", measure);
      mqHover.removeEventListener("change", measure);
      mqReduced.removeEventListener("change", measure);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` are the caller's re-measure triggers
  }, [ref, ...deps]);
}
