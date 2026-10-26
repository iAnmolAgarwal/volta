import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight, Database, History, Sparkles } from "lucide-react";
import { AlertBanner } from "@/components/app/AlertBanner";
import { GlassCard } from "@/components/app/GlassCard";
import { LogItem } from "@/components/app/LogItem";
import { MainChart } from "@/components/app/MainChart";
import { ModeBadge } from "@/components/app/ModeBadge";
import { PageHeader } from "@/components/app/PageHeader";
import { Pill } from "@/components/app/Pill";
import { RingGauge } from "@/components/app/RingGauge";
import { EmptyState, ErrorState, Shimmer } from "@/components/app/States";
import { dayMonth, forecastSample, getLastRunId, getRun, hhmm, isApiError, setLastRunId, shortMode, type Run } from "@/lib/api";
import { WORDMARK } from "@/lib/brand";

/* PLACEHOLDER for the Dashboard screen (M2): it proves the shell on live data
 * (the run in ?run= or the viewer's last run, the focused-hour linkage, the
 * shared components). The Dashboard screen builder replaces this page. */

const WINDOW = 24;

type Load = { state: "idle" } | { state: "loading" } | { state: "error"; error: unknown } | { state: "ready"; run: Run };

export default function DashboardPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const runId = params.get("run") ?? getLastRunId();
  const [load, setLoad] = useState<Load>(runId ? { state: "loading" } : { state: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState<{ error?: unknown } | null>(null);
  const [windowStart, setWindowStart] = useState(0);
  const [selected, setSelected] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    document.title = `Controller · ${WORDMARK}`;
  }, []);

  useEffect(() => {
    if (!runId) return;
    const ctrl = new AbortController();
    setLoad({ state: "loading" });
    getRun(runId, { signal: ctrl.signal })
      .then((run) => {
        setLastRunId(run.run.id);
        setWindowStart(run.window.start);
        setSelected(run.window.start);
        setLoad({ state: "ready", run });
      })
      .catch((error) => {
        if (ctrl.signal.aborted) return;
        // a stale remembered run (deleted since) is forgotten, so the next visit starts clean
        if (isApiError(error) && error.kind === "not_found" && runId === getLastRunId()) setLastRunId(null);
        setLoad({ state: "error", error });
      });
    return () => ctrl.abort();
  }, [runId, attempt]);

  const startSample = useCallback(async () => {
    setStarting({});
    try {
      const run = await forecastSample();
      setLastRunId(run.run.id);
      setStarting(null);
      navigate(`/dashboard?run=${run.run.id}`);
    } catch (error) {
      setStarting({ error });
    }
  }, [navigate]);

  const run = load.state === "ready" ? load.run : null;
  const n = run?.hours.length ?? 0;
  const end = Math.min(windowStart + WINDOW, n);
  const focusIndex = hovered ?? selected;
  const focus = run?.hours[Math.min(Math.max(focusIndex, 0), n - 1)];
  const inWindow = useCallback((i: number) => i >= windowStart && i < end, [windowStart, end]);
  const alerts = useMemo(() => run?.overload_alerts.filter((a) => inWindow(a.index)) ?? [], [run, inWindow]);
  const log = useMemo(() => {
    if (!run) return [];
    const switches = run.switch_events.filter((e) => inWindow(e.index)).map((e) => ({ kind: "switch" as const, index: e.index, ts: e.timestamp, title: `${shortMode(e.from)} → ${shortMode(e.to)}`, meta: undefined as string | undefined }));
    const overloads = run.overload_alerts.filter((a) => inWindow(a.index)).map((a) => ({ kind: "overload" as const, index: a.index, ts: a.timestamp, title: "Critical overload", meta: `${a.prediction_kw.toFixed(1)} kW` }));
    return [...switches, ...overloads].sort((a, b) => a.index - b.index || (a.kind === "switch" ? -1 : 1));
  }, [run, inWindow]);

  const step = (dir: -1 | 1) => {
    const next = Math.min(Math.max(windowStart + dir * WINDOW, 0), Math.max(n - WINDOW, 0));
    setWindowStart(next);
    setSelected(next);
  };
  const jump = (i: number) => {
    const ws = Math.min(Math.floor(i / WINDOW) * WINDOW, Math.max(n - WINDOW, 0));
    if (!inWindow(i)) setWindowStart(ws);
    setSelected(i);
  };

  if (!runId) {
    return (
      <div className="va-page">
        <PageHeader eyebrow="Controller" title="No run yet" lede="Forecast the bundled 1,000-hour sample, or upload your own telemetry, and the controller's decisions appear here." />
        {starting?.error ? (
          <ErrorState error={starting.error} action={<Pill icon={Sparkles} tone="volt" onClick={() => void startSample()}>Try again</Pill>} />
        ) : (
          <EmptyState
            icon={Database}
            title={starting ? "Forecasting the sample" : "Nothing to show yet"}
            action={
              starting ? <Shimmer variant="text" lines={1} label="Forecasting" /> : (
                <>
                  <Pill icon={Sparkles} tone="volt" onClick={() => void startSample()}>Use sample data</Pill>
                  <Pill to="/input">Upload telemetry</Pill>
                </>
              )
            }
          >
            The dashboard opens your latest run. Start one with the sample data, about ten seconds.
          </EmptyState>
        )}
      </div>
    );
  }

  if (load.state === "error") {
    return (
      <div className="va-page">
        <PageHeader eyebrow="Controller" title="Controller" />
        <ErrorState
          error={load.error}
          action={
            <>
              <Pill onClick={() => setAttempt((a) => a + 1)}>Retry</Pill>
              <Pill icon={History} to="/history">Pick another run</Pill>
            </>
          }
        />
      </div>
    );
  }

  if (!run || !focus) {
    return (
      <div className="va-page">
        <PageHeader eyebrow="Controller" title="Controller" lede="Loading the run from the Data Store." />
        <Shimmer variant="chart" label="Loading the run" />
      </div>
    );
  }

  const first = run.hours[windowStart];
  const lastHour = run.hours[end - 1];

  return (
    <div className="va-page va-dash">
      <PageHeader
        eyebrow={`Run ${run.run.id.slice(-6)} · ${run.run.source} · ${run.summary.n_hours.toLocaleString()} h`}
        title="Controller"
        lede="One hour in focus drives the mode, the battery and the log: the hour under the chart, or the one the window starts on."
        actions={
          <>
            <Pill icon={ChevronLeft} onClick={() => step(-1)} disabled={windowStart === 0} aria-label="Previous 24 hours">Prev</Pill>
            <Pill>{`${hhmm(first.timestamp)} ${dayMonth(first.timestamp)} – ${hhmm(lastHour.timestamp)} ${dayMonth(lastHour.timestamp)}`}</Pill>
            <Pill icon={ChevronRight} onClick={() => step(1)} disabled={end >= n} aria-label="Next 24 hours">Next</Pill>
          </>
        }
      />
      <AlertBanner key={windowStart} alerts={alerts} activeIndex={focusIndex} onSelect={jump} delay={380} />
      <div className="va-dash-grid">
        <MainChart
          hours={run.hours}
          start={windowStart}
          focusIndex={focusIndex}
          onFocusHour={setHovered}
          delay={460}
          className="va-dash-chart"
        />
        <GlassCard label={`Hour in focus · ${hhmm(focus.timestamp)} ${dayMonth(focus.timestamp)}`} title={`${focus.prediction_kw.toFixed(1)} kW`} delay={560} className="va-dash-focus">
          <ModeBadge mode={focus.mode} overload={focus.overload} reason={focus.reason} size="lg" live />
          <RingGauge socPct={focus.soc_pct} batteryKw={focus.battery_kw} pvKw={focus.pv_kw} className="va-dash-ring" />
        </GlassCard>
      </div>
      <GlassCard label="System log" title={`${log.length} events in this window`} delay={660}>
        {log.length === 0 ? (
          <EmptyState surface="plain" title="A quiet window">No mode switches and no overloads in these 24 hours.</EmptyState>
        ) : (
          <ol className="va-dash-log">
            {log.map((e) => (
              <li key={`${e.kind}${e.index}`}>
                <LogItem
                  kind={e.kind}
                  label={`${e.kind === "switch" ? "Mode switch" : "Overload"} · ${hhmm(e.ts)}`}
                  title={e.title}
                  meta={e.meta}
                  active={e.index === focusIndex}
                  onClick={() => jump(e.index)}
                />
              </li>
            ))}
          </ol>
        )}
      </GlassCard>
    </div>
  );
}
