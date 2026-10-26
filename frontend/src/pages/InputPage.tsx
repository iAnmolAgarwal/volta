import { useCallback, useEffect, useRef, useState } from "react";
import { History, RotateCcw, Sparkles, X } from "lucide-react";
import { DropZone } from "@/components/app/DropZone";
import { GlassCard } from "@/components/app/GlassCard";
import { PageHeader } from "@/components/app/PageHeader";
import { Pill } from "@/components/app/Pill";
import { ErrorState } from "@/components/app/States";
import { ApiError, forecastCsv, forecastRows, forecastSample, MAX_ROWS, setLastRunId, type Run } from "@/lib/api";
import { WORDMARK } from "@/lib/brand";
import { DayForm } from "./input/DayForm";
import { BusyCard, CleaningReport, RunSummary } from "./input/Report";
import { RowsTable } from "./input/RowsTable";
import { stashUnsaved } from "./input/unsaved";
import { cellId, csvRowCount, DEFAULT_SPEC, generate, toTelemetry, type Col, type GenSpec, type Row } from "./input/profile";
import "@/styles/pages/input.css";

/* /input: telemetry in. Three ways to start a forecast, all through the typed
 * client: a day described by hand (generated into an editable 24-row table,
 * checked in the browser, posted as rows), a CSV through the DropZone, or the
 * bundled sample. Whatever is posted, the cleaning report and the saved run come
 * back below, with the way into the dashboard. */

type What = "manual" | "csv" | "sample";

type Post =
  | { state: "idle" }
  | { state: "busy"; what: What; title: string; startedAt: number }
  | { state: "error"; what: What; error: unknown; retry?: () => void }
  | { state: "done"; what: What; run: Run; posted?: number[]; stashed: boolean };

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const scrollTo = (el: Element | null) => el?.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });

/** Which cell a rejection reason points at. */
const colOf = (reason: string): Col => (/temperature|°C/i.test(reason) ? "temp" : "timestamp");

export default function InputPage() {
  const [spec, setSpec] = useState<GenSpec>(DEFAULT_SPEC);
  const [rows, setRows] = useState<Row[]>([]);
  const [post, setPost] = useState<Post>({ state: "idle" });
  const [fileName, setFileName] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const reportHead = useRef<HTMLSpanElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = `Forecast input · ${WORDMARK}`;
  }, []);

  // the result slot comes into view as a post starts; its heading takes focus when it lands
  useEffect(() => {
    if (post.state === "busy" || post.state === "error") scrollTo(resultRef.current);
    if (post.state === "done") {
      scrollTo(resultRef.current);
      reportHead.current?.focus({ preventScroll: true });
    }
  }, [post]);

  const busy = post.state === "busy";

  const send = useCallback(async (what: What, title: string, go: () => Promise<Run>, posted?: number[]) => {
    const retry = () => void send(what, title, go, posted);
    setPost({ state: "busy", what, title, startedAt: Date.now() });
    try {
      const run = await go();
      // a saved run is remembered by id; an unsaved one (storage quota) travels in sessionStorage
      const stashed = run.run.id ? (setLastRunId(run.run.id), true) : stashUnsaved(run);
      setPost({ state: "done", what, run, posted, stashed });
    } catch (error) {
      // the same input would fail the same way: only a service or network failure is worth a retry
      const again = !(error instanceof ApiError) || !["bad_request", "too_large", "not_found"].includes(error.kind);
      setPost({ state: "error", what, error, retry: again ? retry : undefined });
    }
  }, []);

  const sendRows = () => {
    if (rows.length === 0) return;
    const body = toTelemetry(rows);
    const n = rows.length;
    void send("manual", `Forecasting ${n} manual ${n === 1 ? "hour" : "hours"}`, () => forecastRows(body), rows.map((r) => r.id));
  };

  const sendFile = async (file: File) => {
    setFileName(file.name);
    let n: number;
    try {
      n = csvRowCount(await file.text());
    } catch {
      setPost({ state: "error", what: "csv", error: new Error(`${file.name} could not be read`) });
      return;
    }
    if (n > MAX_ROWS) {
      // the API would answer 413; say so before uploading
      setPost({ state: "error", what: "csv", error: new ApiError("too_large", `${file.name} has ${n.toLocaleString()} rows; trim it to ${MAX_ROWS.toLocaleString()} or fewer and drop it again`) });
      return;
    }
    void send("csv", `Forecasting ${file.name} · ${n.toLocaleString()} ${n === 1 ? "row" : "rows"}`, () => forecastCsv(file));
  };

  const sendSample = () => void send("sample", "Forecasting the 1,000-hour sample", () => forecastSample());

  const onGenerate = () => {
    setRows(generate(spec));
    if (post.state === "done" && post.what === "manual") setPost({ state: "idle" });
    window.requestAnimationFrame(() => scrollTo(rowsRef.current));
  };

  const goToRow = (row: number, reason: string) => {
    if (post.state !== "done" || !post.posted) return;
    const id = post.posted[row - 1];
    const el = id != null ? document.getElementById(cellId(id, colOf(reason))) : null;
    if (el) {
      el.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
      (el as HTMLInputElement).focus({ preventScroll: true });
    }
  };

  const done = post.state === "done" ? post : null;
  const manualRejected = done?.what === "manual" && done.posted ? (row: number) => goToRow(row, done.run.cleaning.rejected.find((r) => r.row === row)?.reason ?? "") : undefined;

  return (
    <div className="va-page vi">
      <PageHeader
        eyebrow="Forecast · telemetry in"
        title="Feed the forecast"
        lede={`Describe a day by hand, drop a CSV of up to ${MAX_ROWS.toLocaleString()} hours, or start from the sample. Every row is cleaned, forecast by QuickML and saved as a run.`}
        actions={<Pill icon={History} to="/history">Saved runs</Pill>}
      />

      <div className="vi-grid">
        <DayForm spec={spec} onChange={setSpec} onGenerate={onGenerate} hasRows={rows.length > 0} disabled={busy} delay={380} />

        <aside className="vi-side" aria-label="Other ways in">
          <GlassCard label="CSV upload" title="Drop a file" delay={460} className="vi-csv">
            <DropZone
              fileName={fileName}
              busy={busy && post.what === "csv"}
              busyText="Cleaning and forecasting"
              disabled={busy}
              hint={`or click to browse · up to ${MAX_ROWS.toLocaleString()} rows`}
              onFile={(file) => void sendFile(file)}
              onReject={(_, why) => setPost({ state: "error", what: "csv", error: new Error(why) })}
            />
            <p className="vi-note vi-cols">
              Columns <code>timestamp</code> and <code>ambient_temp_c</code>; <code>humidity_pct</code> and <code>solar_irradiance_wm2</code> if you have them.
            </p>
          </GlassCard>

          <GlassCard variant="paper" label="No file to hand?" title="Use the sample" delay={560} className="vi-sample">
            <p className="vi-sample-text">1,000 hours of a hot June and July: the contest's own test input, cleaned, forecast and saved like any upload.</p>
            <Pill icon={Sparkles} onClick={sendSample} disabled={busy} className="vi-ink">
              {busy && post.what === "sample" ? "Forecasting the sample" : "Use sample data"}
            </Pill>
          </GlassCard>
        </aside>

        <div className="vi-rows-slot" ref={rowsRef}>
          <RowsTable rows={rows} onRows={setRows} onSubmit={sendRows} busy={busy} delay={660} />
        </div>
      </div>

      <div className="vi-result" ref={resultRef} aria-live="polite">
        {post.state === "busy" && <BusyCard title={post.title} startedAt={post.startedAt} />}
        {post.state === "error" && (
          <ErrorState
            error={post.error}
            action={
              <>
                {post.retry && <Pill icon={RotateCcw} onClick={post.retry}>Try again</Pill>}
                <Pill icon={X} onClick={() => setPost({ state: "idle" })}>Dismiss</Pill>
              </>
            }
          />
        )}
        {done && (
          <div className="vi-result-grid">
            <RunSummary run={done.run} headRef={reportHead} stashed={done.stashed} delay={120} />
            <CleaningReport run={done.run} onRejected={manualRejected} delay={0} />
          </div>
        )}
      </div>
    </div>
  );
}
