import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Sparkles, X } from "lucide-react";
import { DropZone } from "@/components/app/DropZone";
import { GlassCard } from "@/components/app/GlassCard";
import { PageHeader } from "@/components/app/PageHeader";
import { Pill } from "@/components/app/Pill";
import { ErrorState } from "@/components/app/States";
import { ApiError, forecastCsv, forecastRows, forecastSample, MAX_ROWS, setLastRunId, type Run } from "@/lib/api";
import { WORDMARK } from "@/lib/brand";
import { DayForm } from "./input/DayForm";
import { describeError, subjectOf, type What } from "./input/errors";
import { HeroStats } from "./input/HeroStats";
import { BusyCard, CleaningReport, RunSummary } from "./input/Report";
import { RowsTable } from "./input/RowsTable";
import { loadDraft, loadLast, saveDraft, saveLast, type Last } from "./input/session";
import { stashUnsaved, storageOf } from "./input/unsaved";
import { cellId, csvRowCount, generate, toTelemetry, type Col, type GenSpec, type Row } from "./input/profile";
import "@/styles/pages/input.css";

/* /input: telemetry in. Three ways to start a forecast, all through the typed
 * client: a day described by hand (generated into an editable 24-row table,
 * checked in the browser, posted as rows), a CSV through the DropZone, or the
 * bundled sample. The cleaning report and the run come back below the rows;
 * a failed post shows where the busy card sat, and the last good report stays
 * under it. The form, the rows and the last report survive a trip away. */

/** The post in flight, or how the last one failed. The last good result is kept apart (`last`). */
type Op =
  | { state: "idle" }
  | { state: "busy"; what: What; title: string; startedAt: number; cancel: () => void }
  | { state: "error"; title: string; error: unknown; retry?: () => void };

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const scrollTo = (el: Element | null) => el?.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });

/** Which cell a rejection reason points at. */
const colOf = (reason: string): Col => (/temperature|°C/i.test(reason) ? "temp" : "timestamp");

export default function InputPage() {
  const [draft] = useState(loadDraft);
  const [spec, setSpec] = useState<GenSpec>(draft.spec);
  const [rows, setRows] = useState<Row[]>(draft.rows);
  const [fileName, setFileName] = useState<string | null>(draft.fileName);
  const [op, setOp] = useState<Op>({ state: "idle" });
  const [last, setLast] = useState<Last | null>(loadLast);
  const [arrived, setArrived] = useState(0); // bumps when a fresh result lands, to move focus to it
  const [savedHere, setSavedHere] = useState(0); // runs saved from this page, for the hero count
  const resultRef = useRef<HTMLDivElement>(null);
  const reportHead = useRef<HTMLSpanElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = `Forecast input · ${WORDMARK}`;
  }, []);

  // keep the work for the session
  useEffect(() => saveDraft({ spec, rows, fileName }), [spec, rows, fileName]);

  // a post starting or failing brings the result slot into view; a fresh report takes focus
  useEffect(() => {
    if (op.state !== "idle") scrollTo(resultRef.current);
  }, [op.state]);
  useEffect(() => {
    if (!arrived) return;
    scrollTo(resultRef.current);
    reportHead.current?.focus({ preventScroll: true });
  }, [arrived]);

  const busy = op.state === "busy";

  const send = useCallback((what: What, subject: string, title: string, go: (signal: AbortSignal) => Promise<Run>, posted?: number[]) => {
    const ctrl = new AbortController();
    const retry = () => send(what, subject, title, go, posted);
    setOp({ state: "busy", what, title, startedAt: Date.now(), cancel: () => ctrl.abort() });
    go(ctrl.signal)
      .then((run) => {
        // a saved run is remembered by id; one that wasn't saved travels in sessionStorage
        const st = storageOf(run);
        if (st.saved && st.id) setLastRunId(st.id);
        const stashed = st.saved ? true : stashUnsaved(run);
        const next: Last = { what, run, posted, stashed };
        saveLast(next);
        setLast(next);
        if (st.saved) setSavedHere((n) => n + 1);
        setOp({ state: "idle" });
        setArrived((n) => n + 1);
      })
      .catch((error) => {
        if (ctrl.signal.aborted) {
          setOp({ state: "idle" }); // cancelled: the last report, if any, stays as it was
          return;
        }
        const copy = describeError(subject, error);
        setOp({ state: "error", title: copy.title, error: copy.error, retry: copy.retryable ? retry : undefined });
      });
  }, []);

  const sendRows = () => {
    const n = rows.length;
    if (n === 0) return;
    const body = toTelemetry(rows);
    const subject = subjectOf("manual", `Your ${n} ${n === 1 ? "hour" : "hours"}`);
    send("manual", subject, `Forecasting ${n} manual ${n === 1 ? "hour" : "hours"}`, (signal) => forecastRows(body, { signal }), rows.map((r) => r.id));
  };

  const fail = (subject: string, error: unknown) => {
    const copy = describeError(subject, error);
    setOp({ state: "error", title: copy.title, error: copy.error });
  };

  const sendFile = async (file: File) => {
    setFileName(file.name);
    let n: number;
    try {
      n = csvRowCount(await file.text());
    } catch {
      fail(file.name, new Error(`${file.name} couldn't be read from this device. Try saving it again, then drop it here.`));
      return;
    }
    if (n > MAX_ROWS) {
      // the API would answer 413; say so before uploading
      fail(file.name, new ApiError("too_large", `${file.name} has ${n.toLocaleString()} rows and the limit is ${MAX_ROWS.toLocaleString()}. Nothing was sent; trim it and drop it again.`));
      return;
    }
    send("csv", file.name, `Forecasting ${file.name} · ${n.toLocaleString()} ${n === 1 ? "row" : "rows"}`, (signal) => forecastCsv(file, { signal }));
  };

  const sendSample = () => send("sample", "The sample", "Forecasting the 1,000-hour sample", (signal) => forecastSample({ signal }));

  const onGenerate = () => {
    setRows(generate(spec));
    window.requestAnimationFrame(() => scrollTo(rowsRef.current));
  };

  const goToRow = (row: number, reason: string) => {
    const id = last?.posted?.[row - 1];
    const el = id != null ? document.getElementById(cellId(id, colOf(reason))) : null;
    if (el) {
      el.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
      (el as HTMLInputElement).focus({ preventScroll: true });
    }
  };
  const manualRejected = last?.what === "manual" && last.posted
    ? (row: number) => goToRow(row, last.run.cleaning.rejected.find((r) => r.row === row)?.reason ?? "")
    : undefined;

  const latest = last ? { peakKw: last.run.summary.peak_kw, at: last.run.summary.peak_timestamp } : null;

  return (
    <div className="va-page vi">
      <PageHeader
        eyebrow="Forecast · telemetry in"
        title="Feed the forecast"
        lede={`Describe a day by hand, drop a CSV of up to ${MAX_ROWS.toLocaleString()} hours, or start from the sample. Every row is cleaned, forecast by QuickML and saved as a run.`}
      />
      <HeroStats latest={latest} savedNow={savedHere} />

      {/* reading order: the manual flow and its result first (so a phone keeps form → rows → report together), then the other ways in */}
      <div className="vi-grid">
        <DayForm spec={spec} onChange={setSpec} onGenerate={onGenerate} hasRows={rows.length > 0} disabled={busy} delay={380} />

        <div className="vi-rows-slot" ref={rowsRef}>
          <RowsTable rows={rows} onRows={setRows} onSubmit={sendRows} busy={busy} delay={460} />
        </div>

        <div className="vi-result" ref={resultRef}>
          {op.state !== "idle" && (
            <div className="vi-result-grid">
              {op.state === "busy" && <BusyCard title={op.title} startedAt={op.startedAt} onCancel={op.cancel} />}
              {op.state === "error" && (
                <ErrorState
                  title={op.title}
                  error={op.error}
                  className="vi-error"
                  action={
                    <>
                      {op.retry && <Pill icon={RotateCcw} onClick={op.retry}>Try again</Pill>}
                      <Pill icon={X} onClick={() => setOp({ state: "idle" })}>Dismiss</Pill>
                    </>
                  }
                />
              )}
            </div>
          )}
          {last && (
            <>
              {op.state !== "idle" && <p className="vi-caps vi-last-cap">Last forecast</p>}
              <div className="vi-result-grid">
                <RunSummary run={last.run} headRef={reportHead} stashed={last.stashed} delay={120} />
                <CleaningReport run={last.run} onRejected={manualRejected} delay={0} />
              </div>
            </>
          )}
        </div>

        {/* the rail spans the form and the rows only, so the sticky column never rides over the report */}
        <div className="vi-side-rail">
          <aside className="vi-side" aria-label="Other ways in">
            <GlassCard label="CSV upload" title="Drop a file" delay={540} className="vi-csv">
              <DropZone
                fileName={fileName}
                busy={op.state === "busy" && op.what === "csv"}
                busyText="Cleaning and forecasting"
                disabled={busy}
                hint={`or click to browse · up to ${MAX_ROWS.toLocaleString()} rows`}
                onFile={(file) => void sendFile(file)}
                onReject={(file, why) => fail(file.name, new Error(`${why}. Choose a .csv file.`))}
              />
              <p className="vi-note vi-cols">
                Columns <code>timestamp</code> and <code>ambient_temp_c</code>; <code>humidity_pct</code> and <code>solar_irradiance_wm2</code> if you have them.
              </p>
            </GlassCard>

            <GlassCard variant="paper" label="No file to hand?" title="Use the sample" delay={620} className="vi-sample">
              <p className="vi-sample-text">1,000 hours of a hot June and July: the contest's own test input, cleaned, forecast and saved like any upload.</p>
              <Pill icon={Sparkles} onClick={sendSample} disabled={busy} className="vi-ink">
                {op.state === "busy" && op.what === "sample" ? "Forecasting the sample" : "Use sample data"}
              </Pill>
            </GlassCard>
          </aside>
        </div>
      </div>
    </div>
  );
}
