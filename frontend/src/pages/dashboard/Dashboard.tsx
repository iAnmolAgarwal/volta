import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CloudCheck, CloudOff, Download } from "lucide-react";
import { ModeBadge } from "@/components/app/ModeBadge";
import { PageHeader } from "@/components/app/PageHeader";
import { Pill } from "@/components/app/Pill";
import { cssVars } from "@/components/landing/cssVars";
import { dayMonth, hhmm, type Run } from "@/lib/api";
import { downloadCsv, runCsv, runCsvName } from "@/lib/csv";
import { FocusCard } from "./FocusCard";
import { LoadChart } from "./LoadChart";
import { activeEntry, logEntries, overloadRuns, WINDOW, windowFor, windowStats } from "./model";
import { OverloadBanner } from "./OverloadBanner";
import { SideStats } from "./SideStats";
import { SystemLog } from "./SystemLog";
import { isUnsaved, storageChip } from "./unsaved";
import { WindowStepper } from "./WindowStepper";

/* The controller dashboard for one saved run, composed on Sylva's hero:
 * the headline on the left rail with the grid-state badge under it, the lede
 * at x 520 with the window stepper under it (where Sylva's pill sits), and the
 * window's side stats down Sylva's diagonal. Then the overload banner, the load
 * chart with the hour in focus beside it, and the system log.
 *
 * One focused hour drives the badge, the ring, the active log entry and the
 * banner's pressed chip: the hour under the chart's tooltip, or, when nothing
 * is hovered, the stepper's hour. Clicking the chart pins its hour. */

const SOURCE: Record<string, string> = { sample: "Sample", csv: "CSV upload", manual: "Manual entry" };

function reducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function Dashboard({ run }: { run: Run }) {
  const n = run.hours.length;
  const [windowStart, setWindowStart] = useState(() => windowFor(run.window.start, n));
  const [selected, setSelected] = useState(() => windowFor(run.window.start, n));
  const [hovered, setHovered] = useState<number | null>(null);
  // the staged entrance belongs to the first paint; a new window's banner wipes in at once
  const [moved, setMoved] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  // while the page scrolls to the chart, the plate slides under a still pointer and
  // reports "hover"; those reports are not the viewer's, so they are ignored a moment
  const quietUntil = useRef(0);
  const onFocusHour = useCallback((i: number | null) => {
    if (i != null && performance.now() < quietUntil.current) return;
    setHovered(i);
  }, []);
  // once the page scrolls, a frosted shelf rises behind the fixed dock, so data never shows under it (dashboard.css)
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const read = () => setScrolled(window.scrollY > 24);
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);
  const [announce, setAnnounce] = useState("");
  /** After the banner is dismissed: focus moves on to the chart's range select, and the dismissal is announced. */
  const afterDismiss = () => {
    setAnnounce("Overload alert dismissed for this window");
    requestAnimationFrame(() => chartRef.current?.querySelector<HTMLElement>(".va-range-item.is-on, .va-range-item")?.focus());
  };

  const end = Math.min(windowStart + WINDOW, n);
  const focusIndex = Math.max(0, Math.min(n - 1, hovered ?? selected));
  const focus = run.hours[focusIndex];

  const stats = useMemo(() => windowStats(run, windowStart, end), [run, windowStart, end]);
  const entries = useMemo(() => logEntries(run, windowStart, end), [run, windowStart, end]);
  const runs = useMemo(() => overloadRuns(run, windowStart, end), [run, windowStart, end]);
  const activeKey = activeEntry(entries, focusIndex, windowStart, end);

  /** Focus a run index as the stepper's hour, moving the window when it falls outside. */
  const select = useCallback(
    (i: number) => {
      const k = Math.max(0, Math.min(n - 1, i));
      if (k < windowStart || k >= windowStart + WINDOW) {
        setWindowStart(windowFor(k, n));
        setMoved(true);
      }
      setSelected(k);
    },
    [n, windowStart],
  );

  const step = (dir: -1 | 1) => {
    const next = Math.max(0, Math.min(windowStart + dir * WINDOW, n - WINDOW));
    // keep the same hour of the window, so stepping compares like with like
    const offset = selected - windowStart;
    setWindowStart(next);
    setMoved(true);
    setSelected(Math.min(next + offset, Math.min(next + WINDOW, n) - 1));
  };

  /** A banner chip or a log entry: focus the hour, and bring the chart into view when none of it shows. */
  const jump = (i: number) => {
    select(i);
    setHovered(null);
    const el = chartRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (box.bottom > 80 && box.top < window.innerHeight - 80) return;
    quietUntil.current = performance.now() + 1200;
    el.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  };

  const meta = run.run;
  const unsaved = isUnsaved(run);
  const stored = storageChip(run);
  const span = `${dayMonth(run.summary.start)} – ${dayMonth(run.summary.end)}`;

  /* "Download CSV": the run's hours as a file, built here from the run in hand (no request) */
  const [downloaded, setDownloaded] = useState(false);
  useEffect(() => {
    if (!downloaded) return;
    const t = window.setTimeout(() => setDownloaded(false), 1800);
    return () => window.clearTimeout(t);
  }, [downloaded]);
  const download = () => {
    const name = runCsvName(unsaved ? null : meta.id);
    downloadCsv(name, runCsv(run.hours));
    setDownloaded(true);
    setAnnounce(`Downloaded ${name}, ${n.toLocaleString()} hours`);
  };

  return (
    <div className="va-page vd" data-scrolled={scrolled || undefined}>
      <p className="sr-only" aria-live="polite">{announce}</p>
      <div className="vd-hero">
        <PageHeader
          eyebrow={
            <>
              {unsaved ? "Forecast" : `Run ${meta.id.slice(-6)}`} · {SOURCE[meta.source] ?? meta.source} · <span className="va-num">{run.summary.n_hours.toLocaleString()} h</span> · {span}
              <span className="vd-chips">
                <span className={stored.saved ? "vd-saved" : "vd-saved is-not"} title={stored.title}>
                  <Pill size="sm" icon={stored.saved ? CloudCheck : CloudOff}>{stored.label}</Pill>
                </span>
                <Pill
                  size="sm"
                  icon={downloaded ? Check : Download}
                  onClick={download}
                  className={downloaded ? "vd-csv is-done" : "vd-csv"}
                  title={`Download all ${n.toLocaleString()} hours as ${runCsvName(unsaved ? null : meta.id)}`}
                  aria-label={`Download CSV of all ${n.toLocaleString()} hours`}
                >
                  Download CSV
                </Pill>
              </span>
            </>
          }
          title="Controller"
          lede="One hour drives the grid state, the battery and the log: the one under the chart, or the one you step to."
        />
        <div className="vd-state va-reveal" style={cssVars({ "--d": "380ms" })}>
          <ModeBadge mode={focus.mode} overload={focus.overload} reason={focus.reason} eyebrow={`Grid state · ${hhmm(focus.timestamp)}`} size="lg" live={hovered == null} />
        </div>
        <WindowStepper
          hours={run.hours}
          windowStart={windowStart}
          end={end}
          selected={selected}
          focus={focusIndex}
          peakKw={run.summary.peak_kw}
          onStep={step}
          onSelect={select}
          delay={460}
        />
        <SideStats stats={stats} />
      </div>

      <OverloadBanner key={windowStart} runs={runs} focus={focusIndex} onSelect={jump} onDismiss={afterDismiss} delay={moved ? 0 : 560} />

      <div className="vd-main">
        <div className="vd-chart-wrap" ref={chartRef}>
          <LoadChart hours={run.hours} start={windowStart} focusIndex={focusIndex} onFocusHour={onFocusHour} onPick={select} delay={640} className="vd-chart" />
        </div>
        <FocusCard hour={focus} hovering={hovered != null} delay={740} />
      </div>

      <SystemLog entries={entries} activeKey={activeKey} overloadHours={stats.overloadHours} switches={stats.switches} onSelect={jump} delay={840} />
    </div>
  );
}
