import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { clsx } from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cssVars } from "@/components/landing/cssVars";
import { dayMonth, hhmm, isStorage, shortMode, type RunHour } from "@/lib/api";
import { WINDOW, windowNumber } from "./model";

/* The 24-hour window stepper, in the dock's vocabulary: a small dock bar with
 * the previous and next windows as its items and the window's span between
 * them, and under it a dock of the window's 24 hours, one slim tile each. A
 * tile's level is that hour's predicted load (lime on Renewable Storage, faint
 * on Main Grid), an overload hour carries the chart's red dot, and the selected
 * hour wears the paper, as the active dock item does. The hour dock is one
 * slider: click or drag along it, or use the arrow keys (Page Up / Down steps a
 * window, Home / End go to its ends). */

export interface WindowStepperProps {
  hours: RunHour[];
  windowStart: number;
  end: number;
  /** The stepper's hour (run index). */
  selected: number;
  /** The focused hour (the chart's hover, else `selected`); outlined when it differs. */
  focus: number;
  /** The run's peak, so a tile's level reads the same in every window. */
  peakKw: number;
  onStep: (dir: -1 | 1) => void;
  /** Select a run index; the page moves the window when it falls outside. */
  onSelect: (index: number) => void;
  delay?: number;
}

const span = (a: RunHour, b: RunHour) => `${dayMonth(a.timestamp)} ${hhmm(a.timestamp)} – ${dayMonth(b.timestamp)} ${hhmm(b.timestamp)}`;

export function WindowStepper({ hours, windowStart, end, selected, focus, peakKw, onStep, onSelect, delay = 0 }: WindowStepperProps) {
  const rail = useRef<HTMLDivElement>(null);
  const n = hours.length;
  const first = hours[windowStart];
  const last = hours[end - 1];
  const inWindow = hours.slice(windowStart, end);
  const { at, total } = windowNumber(windowStart, n);
  const sel = hours[selected];

  const fromPointer = (clientX: number) => {
    const box = rail.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const k = Math.floor(((clientX - box.left) / box.width) * inWindow.length);
    onSelect(windowStart + Math.max(0, Math.min(inWindow.length - 1, k)));
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    fromPointer(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e.clientX);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const to: Record<string, number> = {
      ArrowRight: selected + 1,
      ArrowUp: selected + 1,
      ArrowLeft: selected - 1,
      ArrowDown: selected - 1,
      PageDown: selected + WINDOW,
      PageUp: selected - WINDOW,
      Home: windowStart,
      End: end - 1,
    };
    if (!(e.key in to)) return;
    e.preventDefault();
    onSelect(Math.max(0, Math.min(n - 1, to[e.key])));
  };

  const labels = inWindow.map((h, k) => ({ h, k })).filter(({ h, k }) => k === 0 || h.hour % 6 === 0);

  return (
    <div className="vd-stepper va-reveal" style={cssVars({ "--d": `${delay}ms`, "--count": inWindow.length })} role="group" aria-label="24-hour window">
      <div className="vd-stepper-bar">
        <button type="button" className="va-range-item vd-stepper-btn" onClick={() => onStep(-1)} disabled={windowStart === 0} aria-label="Previous 24 hours">
          <ChevronLeft strokeWidth={1.5} aria-hidden />
        </button>
        <p className="vd-stepper-span" aria-live="polite">
          <span className="vd-stepper-range va-num">{span(first, last)}</span>
          <span className="vd-stepper-count va-num">Window {at} of {total}</span>
        </p>
        <button type="button" className="va-range-item vd-stepper-btn" onClick={() => onStep(1)} disabled={end >= n} aria-label="Next 24 hours">
          <ChevronRight strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      <div
        ref={rail}
        className="vd-hours"
        role="slider"
        tabIndex={0}
        aria-label="Hour in focus"
        aria-valuemin={windowStart}
        aria-valuemax={end - 1}
        aria-valuenow={selected}
        aria-valuetext={sel ? `${hhmm(sel.timestamp)} ${dayMonth(sel.timestamp)}, ${sel.prediction_kw.toFixed(1)} kW, ${shortMode(sel.mode)}${sel.overload ? ", critical overload" : ""}` : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
      >
        {inWindow.map((h) => (
          <span
            key={h.index}
            className={clsx("vd-hour", isStorage(h.mode) ? "is-storage" : "is-grid", h.overload && "is-overload", h.index === selected && "is-on", h.index === focus && h.index !== selected && "is-focus")}
            style={{ "--lv": Math.max(0.06, Math.min(1, h.prediction_kw / Math.max(peakKw, 1))) } as CSSProperties}
            aria-hidden="true"
          >
            <i />
          </span>
        ))}
      </div>
      <div className="vd-hour-ticks" aria-hidden="true">
        {labels.map(({ h, k }) => (
          <span key={h.index} style={{ "--k": k } as CSSProperties}>{hhmm(h.timestamp)}</span>
        ))}
      </div>
    </div>
  );
}
