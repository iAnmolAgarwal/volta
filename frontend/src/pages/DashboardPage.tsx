import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Database, History, RotateCw, Sparkles, Upload } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { Pill } from "@/components/app/Pill";
import { EmptyState, ErrorState, Shimmer } from "@/components/app/States";
import { forecastSample, getLastRunId, getRun, isApiError, listRuns, setLastRunId, type Run, type RunListItem } from "@/lib/api";
import { WORDMARK } from "@/lib/brand";
import { Dashboard } from "./dashboard/Dashboard";
import { isUnsaved, keepUnsaved, readUnsaved, UNSAVED_URL } from "./dashboard/unsaved";
import "@/styles/pages/dashboard.css";

/* /dashboard, /dashboard?run=<id> and /dashboard?unsaved=1.
 *
 * - ?run=<id>, else the viewer's last run: read through GET /api/runs/{id} (Stratus, or the Data Store for older runs).
 * - ?unsaved=1: a complete forecast the store did not keep (its quota spent,
 *   say), handed over in sessionStorage (dashboard/unsaved.ts). Shown as is.
 * - Neither (a first visit): GET /api/runs, then open the newest saved run
 *   (a replace to ?run=<id>). Only when the store holds no runs at all, an
 *   empty state; "Use sample data" forecasts the sample once and opens it
 *   here, saved or not. A failed listing is an ErrorState with Retry.
 * A bad id is an ErrorState. While the runs are listed or a run loads, a
 * skeleton in the dashboard's own layout holds its place. */

type Load = { state: "loading"; for: string } | { state: "error"; for: string; error: unknown } | { state: "ready"; for: string; run: Run };
type Listing = { state: "loading" } | { state: "error"; error: unknown } | { state: "empty" };

/** The most recently created run, whatever order the list arrives in. */
function newestOf(runs: RunListItem[]): RunListItem | null {
  let best: RunListItem | null = null;
  for (const r of runs) if (!best || Date.parse(r.created) > Date.parse(best.created)) best = r;
  return best;
}

export default function DashboardPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const unsaved = params.get("unsaved") === "1";
  const runId = unsaved ? null : (params.get("run") ?? getLastRunId());
  const [load, setLoad] = useState<Load | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [listing, setListing] = useState<Listing | null>(null);
  const [listAttempt, setListAttempt] = useState(0);
  const firstVisit = !unsaved && !runId;
  const [starting, setStarting] = useState<{ error?: unknown } | null>(null);
  const [made, setMade] = useState(0); // forecasts made here, so a repeat at the same URL is re-read
  // a forecast just made here: shown as is, without reading it straight back
  const fresh = useRef<Run | null>(null);

  useEffect(() => {
    document.title = `Controller · ${WORDMARK}`;
  }, []);

  useEffect(() => {
    if (!runId) return;
    if (fresh.current?.run.id === runId) {
      setLoad({ state: "ready", for: runId, run: fresh.current });
      return;
    }
    const ctrl = new AbortController();
    setLoad({ state: "loading", for: runId });
    getRun(runId, { signal: ctrl.signal })
      .then((run) => {
        setLastRunId(run.run.id);
        setLoad({ state: "ready", for: runId, run });
      })
      .catch((error) => {
        if (ctrl.signal.aborted) return;
        // a stale remembered run (deleted since) is forgotten, so the next visit starts clean
        if (isApiError(error) && error.kind === "not_found" && runId === getLastRunId()) setLastRunId(null);
        setLoad({ state: "error", for: runId, error });
      });
    return () => ctrl.abort();
  }, [runId, attempt]);

  // a first visit opens the newest saved run; the empty state is for an empty store only
  useEffect(() => {
    if (!firstVisit) return;
    const ctrl = new AbortController();
    setListing({ state: "loading" });
    listRuns({ signal: ctrl.signal })
      .then((runs) => {
        const newest = newestOf(runs);
        if (newest) navigate(`/dashboard?run=${encodeURIComponent(newest.id)}`, { replace: true });
        else setListing({ state: "empty" });
      })
      .catch((error) => {
        if (ctrl.signal.aborted) return;
        setListing({ state: "error", error });
      });
    return () => {
      ctrl.abort();
      setListing(null); // a later first visit starts from the skeleton, not a stale result
    };
  }, [firstVisit, listAttempt, navigate]);

  // the unsaved hand-off: this visit's copy first, else the tab's sessionStorage
  const unsavedRun = useMemo(() => {
    if (!unsaved) return null;
    const mine = fresh.current;
    return mine && isUnsaved(mine) ? mine : readUnsaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `made` re-reads the hand-off after a new forecast
  }, [unsaved, made]);

  const startSample = useCallback(async () => {
    setStarting({});
    try {
      const run = await forecastSample();
      fresh.current = run;
      setStarting(null);
      setMade((m) => m + 1);
      if (isUnsaved(run)) {
        keepUnsaved(run);
        navigate(UNSAVED_URL, { replace: true });
      } else {
        setLastRunId(run.run.id);
        navigate(`/dashboard?run=${encodeURIComponent(run.run.id)}`, { replace: true });
      }
    } catch (error) {
      setStarting({ error });
    }
  }, [navigate]);

  if (unsavedRun) return <Dashboard key={`unsaved:${unsavedRun.run.created}`} run={unsavedRun} />;

  if (firstVisit && listing?.state === "error") {
    return (
      <div className="va-page vd">
        <PageHeader eyebrow="Controller" title="Controller" lede="The dashboard opens the latest saved run, and the list of runs could not be read." />
        <ErrorState
          error={listing.error}
          title="The saved runs could not be listed"
          action={
            <>
              <Pill icon={RotateCw} tone="volt" onClick={() => setListAttempt((a) => a + 1)}>Retry</Pill>
              <Pill icon={Upload} to="/input">New forecast</Pill>
            </>
          }
        />
      </div>
    );
  }

  if (firstVisit && listing?.state !== "empty") return <DashboardSkeleton listing />;

  if (!runId) {
    return (
      <div className="va-page vd">
        <PageHeader
          eyebrow="Controller"
          title="No run yet"
          lede="Forecast the bundled sample, or upload your own telemetry, and the controller's decisions for every hour appear here."
        />
        {starting?.error ? (
          <ErrorState
            error={starting.error}
            title="The sample could not be forecast"
            action={
              <>
                <Pill icon={RotateCw} tone="volt" onClick={() => void startSample()}>Try again</Pill>
                <Pill icon={Upload} to="/input">Upload telemetry</Pill>
              </>
            }
          />
        ) : (
          <EmptyState
            icon={Database}
            className="vd-empty"
            title={starting ? "Forecasting the sample" : unsaved ? "That forecast is no longer here" : "Nothing to show yet"}
            action={
              starting ? (
                <span className="vd-busy">
                  <Shimmer variant="text" lines={1} label="Forecasting the sample" className="vd-busy-bar" />
                  <span className="vd-busy-text">Cleaning, forecasting with QuickML, saving the run</span>
                </span>
              ) : (
                <>
                  <Pill icon={Sparkles} tone="volt" onClick={() => void startSample()}>Use sample data</Pill>
                  <Pill icon={Upload} to="/input">Upload telemetry</Pill>
                  <Pill icon={History} to="/history">Saved runs</Pill>
                </>
              )
            }
          >
            {starting
              ? "1,000 hours of June and July weather go through the model and the controller. It takes about ten seconds."
              : unsaved
                ? "An unsaved forecast lives only in the tab that made it. Start a new one from the sample, or upload telemetry."
                : "No runs are saved yet. The dashboard opens the newest one; start it from the 1,000-hour sample in about ten seconds."}
          </EmptyState>
        )}
      </div>
    );
  }

  if (load?.for === runId && load.state === "error") {
    return (
      <div className="va-page vd">
        <PageHeader eyebrow={`Run ${runId}`} title="Controller" lede="The dashboard could not open this run." />
        <ErrorState
          error={load.error}
          title={isApiError(load.error) && load.error.kind === "not_found" ? `We couldn't find run ${runId}` : undefined}
          action={
            <>
              <Pill icon={RotateCw} onClick={() => setAttempt((a) => a + 1)}>Retry</Pill>
              <Pill icon={History} to="/history">Pick another run</Pill>
              <Pill icon={Upload} to="/input">New forecast</Pill>
            </>
          }
        />
      </div>
    );
  }

  if (load?.for !== runId || load.state !== "ready") return <DashboardSkeleton />;

  return <Dashboard key={runId} run={load.run} />;
}

/** The loading state: the landing's sheen, laid out as the dashboard will be. */
function DashboardSkeleton({ listing = false }: { listing?: boolean }) {
  return (
    <div className="va-page vd" aria-busy="true">
      <div className="vd-hero">
        <PageHeader
          eyebrow={listing ? "Finding the latest run" : "Loading the run"}
          title="Controller"
          lede={listing ? "Listing the saved runs to open the newest one." : "Reading the saved run and its hours from the Data Store."}
        />
        <div className="vd-state"><Shimmer variant="text" lines={2} label="Loading the grid state" className="vd-skel-badge" /></div>
        <div className="vd-skel-stepper"><Shimmer variant="overlay" label="Loading the window" /></div>
      </div>
      <Shimmer variant="text" lines={1} label="Loading alerts" className="vd-skel-alert" />
      <div className="vd-main">
        <Shimmer variant="chart" label="Loading the load forecast" />
        <Shimmer variant="card" label="Loading the hour in focus" className="vd-skel-focus" />
      </div>
      <Shimmer variant="card" label="Loading the system log" className="vd-skel-log" />
    </div>
  );
}
