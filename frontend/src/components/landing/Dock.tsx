import { useEffect, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { Activity, History, LogIn, ToggleRight, Zap } from "lucide-react";
import { FINE_HOVER, NARROW, REDUCED_MOTION } from "./useMedia";

/* The floating dock, after Sylva's: pills that magnify on a spring as the
 * pointer nears them (anchored at the top, so they grow downward), a specular
 * rim that turns to face the pointer, and an active item that wears the
 * cards' paper. Keyboard focus gets the same magnification. Coarse pointers
 * and reduced motion get a still dock. All layout reads happen in the frame,
 * never in the pointer handler. */

interface Item {
  id: string;
  href: string;
  label: string;
  Icon: ComponentType<{ strokeWidth?: number; "aria-hidden"?: boolean }>;
  enter?: boolean;
}

const ITEMS: Item[] = [
  { id: "forecast", href: "#forecast", label: "Forecast", Icon: Activity },
  { id: "controller", href: "#controller", label: "Controller", Icon: ToggleRight },
  { id: "history", href: "#history", label: "History", Icon: History },
  { id: "dashboard", href: "#dashboard", label: "Launch dashboard", Icon: LogIn, enter: true },
];

// entrance stagger per tile (Sylva: 120ms for the mark, then ~50ms apart)
const DELAYS = [120, 180, 230, 280, 330];

interface Spring { el: HTMLElement; w: number; h: number; v: number; vel: number; target: number; mark: boolean }
interface Spec { el: HTMLElement; ang: number; tAng: number; br: number; tBr: number; focused: boolean; reach: number }

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => x * x * (3 - 2 * x);

export function Dock() {
  const navRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState("forecast");

  useEffect(() => {
    const root = navRef.current;
    if (!root) return;
    const mqHover = window.matchMedia(FINE_HOVER);
    const mqReduced = window.matchMedia(REDUCED_MOTION);
    const mqNarrow = window.matchMedia(NARROW);
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-dock]"));
    const springs: Spring[] = els.map((el) => ({ el, w: 0, h: 0, v: 0, vel: 0, target: 0, mark: el.dataset.dock === "mark" }));
    const specs: Spec[] = [root, ...els].map((el) => ({
      el, ang: 2.4, tAng: 2.4, br: 0, tBr: 0, focused: false, reach: el === root ? 250 : 185,
    }));

    let on = false;
    let unit = 1;
    let live = false;
    let byKey = false;
    let dockDirty = false;
    let specDirty = false;
    let aim = { x: 0, y: 0, seen: false, moved: false };
    let raf = 0;
    let last = 0;

    const measure = () => {
      on = mqHover.matches && !mqReduced.matches;
      unit = window.innerWidth / (mqNarrow.matches ? 760 : 1600);
      if (!mqNarrow.matches && window.innerWidth >= 1900) unit = 1900 / 1600;
      for (const s of springs) {
        s.el.style.width = s.el.style.height = s.el.style.transform = "";
        s.el.dataset.near = "false";
        s.v = s.vel = s.target = 0;
      }
      for (const s of springs) {
        const r = s.el.getBoundingClientRect();
        s.w = r.width;
        s.h = r.height;
      }
      live = false;
      dockDirty = true;
      aim.moved = aim.seen;
      kick();
    };

    const rest = () => {
      live = false;
      dockDirty = true;
      for (const s of springs) { s.target = 0; s.el.dataset.near = "false"; }
    };

    const drawDock = (dt: number) => {
      if (!on) return;
      if (aim.seen && aim.moved && !byKey) {
        const rr = root.getBoundingClientRect();
        // the catch box reaches below the bar, where the pills grow to
        if (aim.x > rr.left - 48 && aim.x < rr.right + 48 && aim.y > rr.top - 44 && aim.y < rr.bottom + 104) {
          for (const s of springs) {
            const r = s.el.getBoundingClientRect();
            const prox = clamp01(1 - Math.abs(aim.x - (r.left + r.width / 2)) / (128 * unit));
            s.target = smooth(prox);
            s.el.dataset.near = s.target > 0.08 ? "true" : "false";
          }
          live = true;
          dockDirty = true;
        } else if (live) rest();
      }
      if (!dockDirty) return;
      let moving = false;
      for (const s of springs) {
        s.vel += (s.target - s.v) * 190 * dt;
        s.vel *= Math.exp(-23 * dt);
        s.v += s.vel * dt;
        if (Math.abs(s.target - s.v) < 0.001 && Math.abs(s.vel) < 0.004) { s.v = s.target; s.vel = 0; } else moving = true;
        const v = Math.min(Math.max(s.v, 0), 1.08);
        const ew = s.mark ? 14 * unit : Math.min(18 * unit, s.w * 0.24);
        const eh = s.mark ? 14 * unit : 16 * unit;
        if (v === 0 && s.target === 0) {
          s.el.style.width = s.el.style.height = s.el.style.transform = "";
        } else {
          s.el.style.width = `${(s.w + ew * v).toFixed(2)}px`;
          s.el.style.height = `${(s.h + eh * v).toFixed(2)}px`;
          s.el.style.transform = `translateY(${(v * 3.5 * unit).toFixed(2)}px)`;
        }
      }
      if (!moving) dockDirty = false;
    };

    const drawSpec = (dt: number) => {
      if (!on) return;
      if (aim.seen && aim.moved) {
        for (const s of specs) {
          const r = s.el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const dx = Math.max(r.left - aim.x, 0, aim.x - r.right);
          const dy = Math.max(r.top - aim.y, 0, aim.y - r.bottom);
          const d = Math.hypot(dx, dy);
          s.tAng = d === 0
            ? Math.atan2(2 / Math.max(r.height, 1), -2 / Math.max(r.width, 1)) +
              ((aim.x - cx) / Math.max(r.width / 2, 1)) * 0.3 +
              ((cy - aim.y) / Math.max(r.height / 2, 1)) * 0.15
            : Math.atan2(cy - aim.y, aim.x - cx);
          s.tBr = Math.max(smooth(clamp01(1 - d / (s.reach * unit))), s.focused ? 0.9 : 0);
        }
        specDirty = true;
      }
      if (!specDirty) return;
      let moving = false;
      for (const s of specs) {
        const diff = ((s.tAng - s.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        s.ang += diff * (1 - Math.exp(-dt * 8));
        s.br += (s.tBr - s.br) * (1 - Math.exp(-dt * 9));
        if (Math.abs(diff) < 0.001 && Math.abs(s.tBr - s.br) < 0.002) { s.ang = s.tAng; s.br = s.tBr; } else moving = true;
        s.el.style.setProperty("--spec-angle", `${s.ang.toFixed(4)}rad`);
        s.el.style.setProperty("--spec-bright", (clamp01(s.br) * 0.92).toFixed(3));
      }
      if (!moving) specDirty = false;
    };

    const frame = (now: number) => {
      raf = 0;
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
      last = now;
      drawDock(dt);
      drawSpec(dt);
      aim.moved = false;
      if (dockDirty || specDirty) kick();
      else last = 0;
    };
    function kick() {
      if (!raf && on) raf = requestAnimationFrame(frame);
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      aim = { x: e.clientX, y: e.clientY, seen: true, moved: true };
      byKey = false;
      dockDirty = specDirty = true;
      kick();
    };
    const onLeave = () => {
      aim.seen = false;
      rest();
      for (const s of specs) s.tBr = s.focused ? 0.9 : 0;
      specDirty = true;
      kick();
    };
    const onFocusIn = (e: FocusEvent) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>("[data-dock]");
      if (!item || !on) return;
      const idx = springs.findIndex((s) => s.el === item);
      springs.forEach((s, i) => {
        s.target = i === idx ? 1 : Math.abs(i - idx) === 1 ? 0.24 : 0;
        s.el.dataset.near = s.target > 0.08 ? "true" : "false";
      });
      for (const s of specs) s.focused = s.el === item;
      live = false;
      byKey = true;
      dockDirty = specDirty = true;
      for (const s of specs) s.tBr = Math.max(s.tBr, s.focused ? 0.9 : 0);
      kick();
    };
    const onFocusOut = () => {
      requestAnimationFrame(() => {
        if (!root.contains(document.activeElement)) {
          byKey = false;
          for (const s of specs) { s.focused = false; s.tBr = 0; }
          rest();
          specDirty = true;
          kick();
        }
      });
    };

    measure();
    void document.fonts?.ready.then(measure); // labels set the pill widths
    window.addEventListener("resize", measure);
    mqHover.addEventListener("change", measure);
    mqReduced.addEventListener("change", measure);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      mqHover.removeEventListener("change", measure);
      mqReduced.removeEventListener("change", measure);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return (
    <div className="vl-dock-wrap">
      <nav ref={navRef} className="vl-dock par" style={{ "--pd": 5 } as CSSProperties} data-spec aria-label="Primary">
        <a className="vl-dock-item vl-dock-mark" href="#top" data-dock="mark" data-spec aria-label="VOLTA, home" style={{ "--d": `${DELAYS[0]}ms` } as CSSProperties}>
          <Zap aria-hidden strokeWidth={1.25} />
        </a>
        {ITEMS.map((it, i) => (
          <a
            key={it.id}
            href={it.href}
            data-dock="item"
            data-spec
            aria-label={it.label}
            aria-current={active === it.id ? "page" : undefined}
            className={`vl-dock-item${active === it.id ? " is-active" : ""}${it.enter ? " vl-dock-item--enter" : ""}`}
            style={{ "--d": `${DELAYS[i + 1]}ms` } as CSSProperties}
            onClick={() => setActive(it.id)}
          >
            <span className="vl-glyph" aria-hidden="true"><it.Icon strokeWidth={1.25} /></span>
            <span className="vl-dock-label">{it.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
