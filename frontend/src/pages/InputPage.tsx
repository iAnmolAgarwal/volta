import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { RotateCcw, Sparkles, X } from "lucide-react";
import { DropZone } from "@/components/app/DropZone";
import { GlassCard } from "@/components/app/GlassCard";
import { PageHeader } from "@/components/app/PageHeader";
import { Pill } from "@/components/app/Pill";
import { ErrorState } from "@/components/app/States";
import { ApiError, forecastCsv, forecastRows, getSample, MAX_ROWS, SAMPLE_FILENAME, setLastRunId, type Run } from "@/lib/api";
import { WORDMARK } from "@/lib/brand";
import { DayForm } from "./input/DayForm";
import { describeError, subjectOf, type What } from "./input/errors";
import { HeroStats } from "./input/HeroStats";
import { BusyCard, CleaningReport, RunSummary } from "./input/Report";
import { RowsTable } from "./input/RowsTable";
import { loadDraft, loadLast, saveDraft, saveLast, type Last } from "./input/session";
import { stepsFor } from "./input/steps";
import { stashUnsaved, storageOf } from "./input/unsaved";
import { cellId, csvRowCount, generate, toTelemetry, type Col, type GenSpec, type Row } from "./input/profile";
import "@/styles/pages/input.css";

/* /input: telemetry in. Three ways to start a forecast, all through the typed
 * client: the bundled sample, a CSV through the DropZone, or a day described by
 * hand (generated into an editable 24-row table, checked in the browser, posted
 * as rows). Each result comes back where its post started: the manual one
 * under the rows; the sample's and the CSV's beside their cards on a desktop
 * (the top of the left column, level with the sticky cards) and right under
 * the card that started them on a phone. A failed post shows where its busy
 * card sat, and the last good report stays under it. The form, the rows and
 * the last report survive a trip away. */

/** The post in flight, or how the last one failed. The last good result is kept apart (`last`). */
type Op =
  | { state: "idle" }
  | { state: "busy"; what: What; fileName?: string; title: string; startedAt: number; steps: string[]; at: number; token: number; cancel: () => void }
  | { state: "error"; what: What; fileName?: string; title: string; error: unknown; retry?: () => void };

/** Where a result is drawn: under the rows, beside the quick cards (desktop), or under one of them (phone). */
type Slot = "manual" | "quick" | "sample" | "csv";
const slotOf = (what: What, phone: boolean): Slot => (what === "manual" ? "manual" : phone ? what : "quick");

const PHONE = "(max-width: 900px)";
const subscribePhone = (cb: () => void) => {
  const mq = window.matchMedia(PHONE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const usePhone = () => useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const scrollTo = (el: Element | null | undefined) => el?.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });

/** Which cell a rejection reason points at. */
const colOf = (reason: string): Col => (/temperature|°C/i.test(reason) ? "temp" : "timestamp");

export default function InputPage() {
  const [draft] = useState(loadDraft);
  const [spec, setSpec] = useState<GenSpec>(draft.spec);
  const [rows, setRows] = useState<Row[]>(draft.rows);
  const [op, setOp] = useState<Op>({ state: "idle" });
  const [last, setLast] = useState<Last | null>(loadLast);
  const [arrived, setArrived] = useState(0); // bumps when a fresh result lands, to move focus to it
  const [savedHere, setSavedHere] = useState(0); // runs saved from this page, for the hero count
  const phone = usePhone();
  const slots = useRef<Partial<Record<Slot, HTMLDivElement | null>>>({});
  const reportHead = useRef<HTMLSpanElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const tokens = useRef(0);

  useEffect(() => {
    document.title = `Forecast input · ${WORDMARK}`;
  }, []);

  // keep the work for the session
  useEffect(() => saveDraft({ spec, rows }), [spec, rows]);

  const opSlot = op.state === "idle" ? null : slotOf(op.what, phone);
  const lastSlot = last ? slotOf(last.what, phone) : null;

  // a post starting or failing brings its slot into view; a fresh report takes focus where it landed
  useEffect(() => {
    if (opSlot) scrollTo(slots.current[opSlot]);
  }, [op.state, opSlot]);
  useEffect(() => {
    if (!arrived || !lastSlot) return;
    scrollTo(slots.current[lastSlot]);
    reportHead.current?.focus({ preventScroll: true });
    // lastSlot is read at arrival only; a later resize must not steal focus
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived]);

  const busy = op.state === "busy";

  /** Post through `go`. It calls `advance` each time the browser sees a step really finish. */
  const send = useCallback(
    (
      what: What,
      subject: string,
      title: string,
      route: { steps: string[]; at: number },
      go: (signal: AbortSignal, advance: () => void) => Promise<Run>,
      extra: { posted?: number[]; fileName?: string } = {},
    ) => {
      const ctrl = new AbortController();
      const token = ++tokens.current;
      const retry = () => send(what, subject, title, route, go, extra);
      const advance = () => setOp((o) => (o.state === "busy" && o.token === token ? { ...o, at: Math.min(o.at + 1, o.steps.length - 1) } : o));
      setOp({ state: "busy", what, fileName: extra.fileName, title, startedAt: Date.now(), ...route, token, cancel: () => ctrl.abort() });
      go(ctrl.signal, advance)
        .then((run) => {
          // a saved run is remembered by id; one that wasn't saved travels in sessionStorage
          const st = storageOf(run);
          if (st.saved && st.id) setLastRunId(st.id);
          const stashed = st.saved ? true : stashUnsaved(run);
          const next: Last = { what, run, posted: extra.posted, stashed };
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
          setOp({ state: "error", what, fileName: extra.fileName, title: copy.title, error: copy.error, retry: copy.retryable ? retry : undefined });
        });
    },
    [],
  );

  const sendRows = () => {
    const n = rows.length;
    if (n === 0) return;
    const body = toTelemetry(rows);
    const subject = subjectOf("manual", `Your ${n} ${n === 1 ? "hour" : "hours"}`);
    send("manual", subject, `Forecasting ${n} manual ${n === 1 ? "hour" : "hours"}`, stepsFor("manual", { rows: n }), (signal) => forecastRows(body, { signal }), {
      posted: rows.map((r) => r.id),
    });
  };

  const sendFile = (file: File) => {
    // the file is read and its size checked inside the post, so the busy card's first step is that read
    send("csv", file.name, `Forecasting ${file.name}`, stepsFor("csv", { fileName: file.name }), async (signal, advance) => {
      let n: number;
      try {
        n = csvRowCount(await file.text());
      } catch {
        throw new Error(`${file.name} couldn't be read from this device. Try saving it again, then drop it here.`);
      }
      if (n > MAX_ROWS) {
        // the API would answer 413; say so before uploading
        throw new ApiError("too_large", `${file.name} has ${n.toLocaleString()} rows and the limit is ${MAX_ROWS.toLocaleString()}. Nothing was sent; trim it and drop it again.`);
      }
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      advance();
      return forecastCsv(file, { signal });
    }, { fileName: file.name });
  };

  const rejectFile = (file: File, why: string) => {
    const copy = describeError(file.name, new Error(`${why}. Choose a .csv file.`));
    setOp({ state: "error", what: "csv", fileName: file.name, title: copy.title, error: copy.error });
  };

  const sendSample = () =>
    send("sample", "The sample", "Forecasting the 1,000-hour sample", stepsFor("sample"), async (signal, advance) => {
      const csv = await getSample({ signal });
      advance();
      return forecastCsv(csv, { signal, source: "sample", filename: SAMPLE_FILENAME });
    });

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

  // the drop zone's chip names only the file whose post is in flight, failed, or made the report shown
  const chip = op.state !== "idle" ? (op.what === "csv" ? op.fileName ?? null : null) : last?.what === "csv" ? last.run.run.filename : null;

  /** One result slot: the post in flight or its error, then the last good report, if they belong here. */
  const result = (slot: Slot): ReactNode => {
    const hasOp = op.state !== "idle" && opSlot === slot;
    const hasLast = last != null && lastSlot === slot;
    if (!hasOp && !hasLast) return null;
    return (
      <>
        {hasOp && (
          <div className="vi-result-grid">
            {op.state === "busy" && <BusyCard title={op.title} startedAt={op.startedAt} steps={op.steps} at={op.at} onCancel={op.cancel} />}
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
        {hasLast && last && (
          <>
            {hasOp && <p className="vi-caps vi-last-cap">Last forecast</p>}
            <div className="vi-result-grid">
              <RunSummary run={last.run} headRef={reportHead} stashed={last.stashed} delay={120} />
              <CleaningReport run={last.run} onRejected={manualRejected} delay={0} />
            </div>
          </>
        )}
      </>
    );
  };
  const slot = (name: Slot, className: string) => (
    <div className={`vi-result ${className}`} ref={(el) => { slots.current[name] = el; }}>
      {result(name)}
    </div>
  );

  // a phone reads top to bottom, so the quick paths lead and the cards rise in that order
  const d = phone ? { sample: 380, csv: 460, day: 540, rows: 620 } : { csv: 540, sample: 620, day: 380, rows: 460 };

  return (
    <div className="va-page vi">
      <PageHeader
        eyebrow="Forecast · telemetry in"
        title="Feed the forecast"
        lede={`Describe a day by hand, drop a CSV of up to ${MAX_ROWS.toLocaleString()} hours, or start from the sample. Every row is cleaned, forecast by QuickML and saved as a run.`}
      />
      <HeroStats latest={latest} savedNow={savedHere} />

      {/* reading order: the quick paths (sample, then CSV) with their results, then the manual flow and its
          result. A desktop keeps the cards in the right column and draws their results beside them. */}
      <div className="vi-grid">
        {/* the rail spans the quick result, the form and the rows only, so the sticky column never rides over the manual report */}
        <div className="vi-side-rail">
          <aside className="vi-side" aria-label="Other ways in">
            <GlassCard variant="paper" label="No file to hand?" title="Use the sample" delay={d.sample} className="vi-sample">
              <p className="vi-sample-text">1,000 hours of a hot June and July: the contest's own test input, cleaned, forecast and saved like any upload.</p>
              <Pill icon={Sparkles} onClick={sendSample} disabled={busy} className="vi-ink">
                {op.state === "busy" && op.what === "sample" ? "Forecasting the sample" : "Use sample data"}
              </Pill>
            </GlassCard>
            {phone && slot("sample", "vi-result--card")}

            <GlassCard label="CSV upload" title="Drop a file" delay={d.csv} className="vi-csv">
              <DropZone
                fileName={chip}
                busy={op.state === "busy" && op.what === "csv"}
                busyText="Cleaning and forecasting"
                disabled={busy}
                hint={`or click to browse · up to ${MAX_ROWS.toLocaleString()} rows`}
                onFile={sendFile}
                onReject={rejectFile}
              />
              <p className="vi-note vi-cols">
                Columns <code>timestamp</code> and <code>ambient_temp_c</code>; <code>humidity_pct</code> and <code>solar_irradiance_wm2</code> if you have them.
              </p>
            </GlassCard>
            {phone && slot("csv", "vi-result--card")}
          </aside>
        </div>

        {!phone && slot("quick", "vi-result--quick")}

        <DayForm spec={spec} onChange={setSpec} onGenerate={onGenerate} hasRows={rows.length > 0} disabled={busy} delay={d.day} />

        <div className="vi-rows-slot" ref={rowsRef}>
          <RowsTable rows={rows} onRows={setRows} onSubmit={sendRows} busy={busy} delay={d.rows} />
        </div>

        {slot("manual", "vi-result--manual")}
      </div>
    </div>
  );
}
