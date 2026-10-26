import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { History, Layers, RotateCw, Upload } from "lucide-react";
import { LogItem } from "@/components/app/LogItem";
import { PageHeader } from "@/components/app/PageHeader";
import { Pill } from "@/components/app/Pill";
import { EmptyState, ErrorState, Shimmer } from "@/components/app/States";
import { cssVars } from "@/components/landing/cssVars";
import { getLastRunId, listRuns } from "@/lib/api";
import { WORDMARK } from "@/lib/brand";
import { FilterDock } from "./history/FilterDock";
import { HistoryStats } from "./history/HistoryStats";
import { MarkRing } from "./history/Marks";
import { countBySource, createdShort, FILTER_LABEL, hoursText, isFilter, listStats, newestFirst, runHref, runTitle, type SavedRun, type SourceFilter } from "./history/model";
import { RunCard } from "./history/RunCard";
import "@/styles/pages/history.css";

const RUNS_LISTED = 20; // GET /api/runs returns at most the 20 newest

/* /history: the saved runs (GET /api/runs, the latest 20, newest first) as
 * Sylva's Field Notes, under the dashboard's hero: the headline on the 46 rail
 * with the viewer's last run under it, the lede at x 520 with the source
 * filter under it (where Sylva's pill sits), and three side stats down
 * Sylva's diagonal. Each card is a link that reopens the run on the dashboard.
 *
 * The filter lives in the URL (?source=csv), so Back and a shared link keep
 * it. The header stays mounted through loading, error and ready, so it
 * enters once; the cards wipe in after it, and again, quicker, on a filter
 * change. */

type Load = { state: "loading" } | { state: "error"; error: unknown } | { state: "ready"; runs: SavedRun[] };

const CARD_DELAY = 560; // after the header (60/120/320), the resume note (380) and the dock (460)
const STEP = 70;
const STEP_QUICK = 45;

export default function HistoryPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("source");
  const filter: SourceFilter = isFilter(raw) ? raw : "all";
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [last] = useState(getLastRunId);
  // the staged entrance belongs to the first paint; a filter change re-deals the cards at once
  const [quick, setQuick] = useState(false);

  useEffect(() => {
    document.title = `History · ${WORDMARK}`;
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoad({ state: "loading" });
    listRuns({ signal: ctrl.signal })
      .then((runs) => setLoad({ state: "ready", runs: newestFirst(runs as SavedRun[]) }))
      .catch((error) => {
        if (!ctrl.signal.aborted) setLoad({ state: "error", error });
      });
    return () => ctrl.abort();
  }, [attempt]);

  const setFilter = useCallback(
    (f: SourceFilter) => {
      setQuick(true);
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (f === "all") next.delete("source");
          else next.set("source", f);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const runs = useMemo(() => (load.state === "ready" ? load.runs : []), [load]);
  const shown = useMemo(() => (filter === "all" ? runs : runs.filter((r) => r.source === filter)), [runs, filter]);
  const counts = useMemo(() => countBySource(runs), [runs]);
  const stats = useMemo(() => listStats(shown, runs.length), [shown, runs.length]);
  const lastRun = runs.find((r) => r.id === last) ?? null;
  const resume = lastRun ?? runs[0] ?? null;
  const ready = load.state === "ready" && runs.length > 0;

  return (
    <div className="va-page vh">
      <div className={`vh-hero${ready || load.state === "loading" ? "" : " is-bare"}`}>
        <PageHeader
          eyebrow={
            <>
              History ·{" "}
              {load.state === "loading" ? "Reading the run index" : load.state === "error" ? "Unavailable" : runs.length === 0 ? "Nothing saved yet" : <span className="va-num">{runs.length >= RUNS_LISTED ? `the latest ${RUNS_LISTED}` : `${runs.length} saved run${runs.length === 1 ? "" : "s"}`}</span>}
            </>
          }
          title="Saved runs"
          lede="Every saved forecast, newest first. Open one to replay its controller decisions."
        />
        {ready && resume && (
          <div className="vh-resume va-reveal" style={cssVars({ "--d": "380ms" })}>
            <LogItem
              to={runHref(resume.id)}
              icon={History}
              label={<>{lastRun ? "Last opened" : "Newest"} · <span className="va-num">{createdShort(resume.created)}</span></>}
              title={`${runTitle(resume)} · ${hoursText(resume.n_rows)}`}
              meta="Reopen"
              aria-label={`Reopen ${lastRun ? "the run you opened last" : "the newest run"}: ${runTitle(resume)}, ${hoursText(resume.n_rows)}`}
            />
          </div>
        )}
        {ready && <FilterDock value={filter} counts={counts} onChange={setFilter} />}
        {ready && shown.length > 0 && <HistoryStats stats={stats} filtered={filter !== "all"} />}
        {load.state === "loading" && (
          <>
            <div className="vh-resume"><Shimmer variant="text" lines={1} label="Loading your last run" className="vh-skel-resume" /></div>
            <div className="vh-skel-dock"><Shimmer variant="overlay" label="Loading the filter" /></div>
            <div className="vh-stats vh-skel-stats" aria-hidden="true">
              {(["a", "b", "c"] as const).map((t) => (
                <div key={t} className={`vh-stat vh-stat--${t}`}>
                  <span className="vh-mark"><MarkRing /></span>
                  <span className="vh-skel-stat"><i><span className="va-shimmer va-shimmer--overlay" /></i><i><span className="va-shimmer va-shimmer--overlay" /></i></span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {load.state === "loading" && (
        <div className="vh-grid" aria-busy="true">
          {Array.from({ length: 6 }, (_, k) => (
            <Shimmer key={k} variant="card" label={k === 0 ? "Loading the saved runs" : "Loading"} className="vh-skel-card" />
          ))}
        </div>
      )}

      {load.state === "error" && (
        <ErrorState
          error={load.error}
          title="The saved runs could not be listed"
          action={
            <>
              <Pill icon={RotateCw} tone="volt" onClick={() => setAttempt((a) => a + 1)}>Retry</Pill>
              <Pill icon={Upload} to="/input">New forecast</Pill>
            </>
          }
        />
      )}

      {load.state === "ready" && runs.length === 0 && (
        <EmptyState
          icon={History}
          className="vh-empty"
          title="No runs yet"
          action={<Pill icon={Upload} tone="volt" to="/input">Start a forecast</Pill>}
        >
          Forecast telemetry from a CSV, the form or the bundled sample, and every run the controller saves appears here.
        </EmptyState>
      )}

      {ready && shown.length === 0 && (
        <EmptyState
          icon={Layers}
          surface="plain"
          className="vh-empty"
          title={`No ${filter === "csv" ? "CSV" : FILTER_LABEL[filter].toLowerCase()} runs here`}
          action={
            <>
              <Pill icon={Layers} onClick={() => setFilter("all")}>Show all {runs.length}</Pill>
              <Pill icon={Upload} to="/input">New forecast</Pill>
            </>
          }
        >
          {runs.length === 1 ? "The one saved run didn't come" : `None of the ${runs.length >= RUNS_LISTED ? `latest ${RUNS_LISTED}` : runs.length} saved runs came`} from {filter === "csv" ? "a CSV upload" : filter === "manual" ? "the form" : "the sample"}.
        </EmptyState>
      )}

      {ready && shown.length > 0 && (
        <ol className="vh-grid" key={filter} aria-label={filter === "all" ? "Saved runs, newest first" : `${FILTER_LABEL[filter]} runs, newest first`}>
          {shown.map((r, k) => (
            <li key={r.id}>
              <RunCard run={r} last={r.id === last} delay={quick ? k * STEP_QUICK : CARD_DELAY + Math.min(k, 8) * STEP} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
