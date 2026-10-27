import { useEffect, useState, type ComponentType, type ReactNode, type Ref } from "react";
import { ArrowDownUp, ArrowRight, ArrowRightLeft, ArrowUpRight, BatteryCharging, Binary, CircleCheck, Clock, CopyMinus, Database, Droplets, Gauge, Spline, Sun, TriangleAlert, UtilityPole, X } from "lucide-react";
import { GlassCard } from "@/components/app/GlassCard";
import { LogItem } from "@/components/app/LogItem";
import { Pill } from "@/components/app/Pill";
import { Shimmer } from "@/components/app/States";
import { dayMonth, hhmm, type Run } from "@/lib/api";
import { STEP_SERVER } from "./steps";
import { STRATUS_LABEL } from "../storageNote";
import { dashboardHref, storageOf } from "./unsaved";

/* What comes back from a post: the cleaning report on the moss glass, and the
 * run as one of Sylva's paper cards, with the way into the dashboard. While the
 * post is out, a glass card with the landing's sheen holds the place and walks
 * the steps the rows take. */

type Icon = ComponentType<{ strokeWidth?: number; "aria-hidden"?: boolean }>;

const SOURCE = { manual: "Manual rows", csv: "CSV upload", sample: "Sample data" } as const;

/* the rejection fixes, short enough for a chip */
const REJECT_SHORT: Record<string, string> = {
  rejected_no_timestamp: "No timestamp",
  rejected_bad_timestamp: "Unreadable timestamp",
  rejected_impossible_temp: "Temperature outside −60 to 60 °C",
};

/* each zero-count fix, said as the check that passed */
const PASSED: Record<string, string> = {
  rejected_no_timestamp: "Every row had a timestamp",
  rejected_bad_timestamp: "Every timestamp was readable",
  rejected_impossible_temp: "Every temperature was within −60 to 60 °C",
  dropped_utc_offset: "No UTC offsets to drop",
  unreadable_numbers: "Every weather value was a number",
  clipped_humidity: "Humidity stayed within 0–100 %",
  clipped_solar: "No negative irradiance",
  sorted: "Rows were already in time order",
  dropped_duplicates: "No duplicate timestamps",
  interpolated_ambient_temp_c: "No temperature gaps to fill",
  interpolated_humidity_pct: "No humidity gaps to fill",
  interpolated_solar_irradiance_wm2: "No irradiance gaps to fill",
  filled_default_ambient_temp_c: "Temperature had values to work from",
  filled_default_humidity_pct: "Humidity had values to work from",
  filled_default_solar_irradiance_wm2: "Irradiance had values to work from",
};

/* a glyph for each fix, so the list scans like the landing's side stats */
function fixIcon(code: string): Icon {
  if (code === "dropped_utc_offset") return Clock;
  if (code === "unreadable_numbers") return Binary;
  if (code === "clipped_humidity") return Droplets;
  if (code === "clipped_solar") return Sun;
  if (code === "sorted") return ArrowDownUp;
  if (code === "dropped_duplicates") return CopyMinus;
  if (code.startsWith("interpolated")) return Spline;
  if (code.startsWith("filled_default")) return Database;
  return CircleCheck;
}
const stamp = (ts: string) => `${hhmm(ts)} · ${dayMonth(ts)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/* ── busy ────────────────────────────────────────────────────────────────── */

/* The steps follow the request itself, never a timer: a step is ticked only
 * once the browser has seen it finish (the rows checked, the file read, the
 * sample fetched). The server cleans, forecasts, runs the controller and saves
 * inside one request and reports no progress, so that step stays open, in
 * progress, until the answer arrives; the report replacing this card is the
 * last tick. */

export interface BusyCardProps {
  title: string;
  startedAt: number;
  /** The route this post takes, in order. */
  steps: string[];
  /** The step in progress; every step before it has really finished. */
  at: number;
  onCancel?: () => void;
}

export function BusyCard({ title, startedAt, steps, at, onCancel }: BusyCardProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, (now - startedAt) / 1000);
  const onServer = steps[at] === STEP_SERVER;
  return (
    <GlassCard
      label={<>Working · <span className="va-num">{s.toFixed(1)} s</span></>}
      title={title}
      aside={onCancel && <Pill size="sm" icon={X} onClick={onCancel}>Cancel</Pill>}
      className="vi-busy"
      delay={0}
    >
      <div className="vi-busy-body">
        <ol className="vi-steps" aria-label="Steps">
          {steps.map((step, i) => (
            <li key={step} className={i < at ? "is-done" : i === at ? "is-now" : undefined} aria-current={i === at ? "step" : undefined}>
              <span className="vi-step-dot" aria-hidden="true">{i < at && <CircleCheck strokeWidth={1.5} aria-hidden />}</span>
              {step}
              {i < at ? <span className="vi-sr"> (done)</span> : i === at ? <span className="vi-sr"> (in progress)</span> : null}
            </li>
          ))}
        </ol>
        <Shimmer variant="text" lines={3} label={`Forecasting: ${steps[at]}`} className="vi-busy-lines" />
        <p className="vi-note">
          {onServer
            ? "One request does the cleaning, the QuickML forecast, the controller and the save. It sends no progress, so this step stays open until the answer arrives."
            : "Nothing has reached the forecast service yet."}
        </p>
      </div>
    </GlassCard>
  );
}

/* ── the cleaning report ─────────────────────────────────────────────────── */

function Count({ label, value, tone }: { label: string; value: number; tone?: "bad" }) {
  return (
    <div className={tone === "bad" && value > 0 ? "vi-count is-bad" : "vi-count"}>
      <dt>{label}</dt>
      <dd className="va-num">{value.toLocaleString()}</dd>
    </div>
  );
}

export interface CleaningReportProps {
  run: Run;
  /** Manual posts: jump back to a rejected row's cells. */
  onRejected?: (row: number) => void;
  delay?: number;
}

export function CleaningReport({ run, onRejected, delay }: CleaningReportProps) {
  const c = run.cleaning;
  const [showPassed, setShowPassed] = useState(false);
  const isReject = (code: string) => code.startsWith("rejected");
  const rejectedFixes = c.fixes.filter((f) => f.count > 0 && isReject(f.code));
  const fixed = c.fixes.filter((f) => f.count > 0 && !isReject(f.code));
  const passed = c.fixes.filter((f) => f.count === 0);
  const formats = Object.entries(c.timestamp_formats).filter(([, n]) => n > 0);
  const more = c.rejected_count - c.rejected.length;
  // why rows in and rows out differ, in one line
  const dups = c.fixes.find((f) => f.code === "dropped_duplicates")?.count ?? 0;
  const other = Math.max(0, c.rows_in - c.rows_out - c.rejected_count - dups);
  const gap = [
    c.rejected_count > 0 && `${plural(c.rejected_count, "row")} rejected`,
    dups > 0 && `${plural(dups, "duplicate")} dropped`,
    other > 0 && `${other.toLocaleString()} more dropped`,
  ].filter(Boolean).join(" · ");

  return (
    <GlassCard label="Cleaning report" title={`${c.rows_out.toLocaleString()} of ${c.rows_in.toLocaleString()} rows kept`} delay={delay} className="vi-clean">
      <div className="vi-clean-top">
        <div>
          <dl className="vi-counts">
            <Count label="Rows in" value={c.rows_in} />
            <span className="vi-counts-arrow" aria-hidden="true"><ArrowRight strokeWidth={1.2} /></span>
            <Count label="Rows out" value={c.rows_out} />
            <Count label="Rejected" value={c.rejected_count} tone="bad" />
          </dl>
          <p className="vi-gap">{gap || "Every row kept"}</p>
        </div>
        <div className="vi-formats">
          <h3 className="vi-caps">Timestamp formats</h3>
          <ul>
            {formats.length === 0 && <li><Pill size="sm">None read</Pill></li>}
            {formats.map(([name, n]) => (
              <li key={name}><Pill size="sm" icon={Clock}>{name} <b>× {n.toLocaleString()}</b></Pill></li>
            ))}
          </ul>
        </div>
      </div>

      {c.rejected_count > 0 && (
        <section className="vi-clean-part" aria-labelledby="vi-rej-h">
          <h3 className="vi-caps vi-caps--bad" id="vi-rej-h">Rejected · {plural(c.rejected_count, "row")}</h3>
          <ul className="vi-tally">
            {rejectedFixes.map((f) => (
              <li key={f.code}><Pill size="sm" tone="overload" icon={TriangleAlert}>{REJECT_SHORT[f.code] ?? f.label} <b>× {f.count.toLocaleString()}</b></Pill></li>
            ))}
          </ul>
          <ul className="vi-loglist">
            {c.rejected.map((r) => (
              <li key={r.row}>
                <LogItem
                  kind="overload"
                  label={`Row ${r.row}`}
                  title={r.reason}
                  meta={onRejected ? "Edit" : undefined}
                  onClick={onRejected ? () => onRejected(r.row) : undefined}
                  aria-label={onRejected ? `Row ${r.row}: ${r.reason}. Edit this row` : undefined}
                />
              </li>
            ))}
          </ul>
          {more > 0 && <p className="vi-note">and {more.toLocaleString()} more, not listed.</p>}
        </section>
      )}

      <section className="vi-clean-part" aria-labelledby="vi-fixed-h">
        <h3 className="vi-caps" id="vi-fixed-h">{fixed.length ? `Fixed · ${plural(fixed.length, "kind")}` : "Fixed"}</h3>
        <ul className="vi-loglist">
          {fixed.length === 0 && (
            <li><LogItem icon={CircleCheck} label="All clear" title="Nothing needed fixing" /></li>
          )}
          {fixed.map((f) => (
            <li key={f.code}>
              <LogItem icon={fixIcon(f.code)} label="Fixed" title={f.label} meta={plural(f.count, "row")} />
            </li>
          ))}
        </ul>
      </section>

      {passed.length > 0 && (
        <section className="vi-clean-part vi-passed">
          <button type="button" className="va-pill va-pill--sm is-action vi-passed-toggle" aria-expanded={showPassed} aria-controls="vi-passed-list" onClick={() => setShowPassed((v) => !v)}>
            <span className="va-pill-glyph" aria-hidden="true"><CircleCheck strokeWidth={1.5} aria-hidden /></span>
            <span className="va-pill-label">{plural(passed.length, "check")} passed · {showPassed ? "hide" : "show"}</span>
          </button>
          {showPassed && (
            <ul className="vi-clear" id="vi-passed-list">
              {passed.map((f) => (
                <li key={f.code}><CircleCheck strokeWidth={1.4} aria-hidden />{PASSED[f.code] ?? `No change: ${f.label}`}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </GlassCard>
  );
}

/* ── the run, on paper ───────────────────────────────────────────────────── */

function Stat({ icon: I, label, value, tone }: { icon: Icon; label: string; value: ReactNode; tone?: "storage" | "overload" }) {
  return (
    <div className={tone ? `vi-stat is-${tone}` : "vi-stat"}>
      <span className="vi-stat-mark" aria-hidden="true"><I strokeWidth={1.4} aria-hidden /></span>
      <div>
        <dt>{label}</dt>
        <dd className="va-num">{value}</dd>
      </div>
    </div>
  );
}

/** "Data Store free-tier insert quota used up" → "free-tier insert quota used up" (the line already names the Data Store). */
const reasonText = (r: string) => r.replace(/^data store\s*/i, "").replace(/^\w/, (ch) => ch.toLowerCase());

/** The run, as a paper card. Its title takes focus when a post lands (`headRef`), so the next Tab is "Open on dashboard". */
export function RunSummary({ run, delay, headRef, stashed = true }: { run: Run; delay?: number; headRef?: Ref<HTMLSpanElement>; stashed?: boolean }) {
  const s = run.summary;
  const st = storageOf(run);
  const id = st.id;
  const tag = st.saved && id ? `run ${id.slice(-6)}` : "not saved";
  return (
    <GlassCard
      variant="paper"
      label={`${SOURCE[run.run.source] ?? run.run.source} · ${tag}`}
      title={<span ref={headRef} tabIndex={-1} className="vi-focus-target">{s.peak_kw.toFixed(1)} kW peak<span className="vi-peak-at"> at {stamp(s.peak_timestamp)}</span></span>}
      aside={st.saved ? (
        <span className="vi-chip vi-chip--ok"><CircleCheck strokeWidth={1.6} aria-hidden />Saved</span>
      ) : (
        <span className="vi-chip vi-chip--bad"><TriangleAlert strokeWidth={1.6} aria-hidden />Not saved</span>
      )}
      delay={delay}
      className="vi-run"
    >
      <p className="vi-run-span va-num">{plural(s.n_hours, "hour")} · {stamp(s.start)} – {stamp(s.end)}</p>
      <dl className="vi-stats">
        <Stat icon={TriangleAlert} tone={s.overload_count > 0 ? "overload" : undefined} label="Overload ≥ 200 kW" value={`${s.overload_count.toLocaleString()} h`} />
        <Stat icon={ArrowRightLeft} label="Mode switches" value={s.switch_count.toLocaleString()} />
        <Stat icon={BatteryCharging} tone="storage" label="Renewable Storage" value={`${s.storage_hours.toLocaleString()} h`} />
        <Stat icon={UtilityPole} label="Main Grid" value={`${s.grid_hours.toLocaleString()} h`} />
        <Stat icon={Gauge} label="Lowest charge" value={`${s.min_soc_pct.toFixed(0)} %`} />
      </dl>

      {/* the persistence line is built from run.storage, never assumed */}
      <ul className="vi-store">
        {st.saved ? (
          <>
            <li className="is-ok">
              <CircleCheck strokeWidth={1.5} aria-hidden />
              <span>{st.stratus === false ? "Run saved" : STRATUS_LABEL}{run.run.csv_key ? ", with its CSV" : ""}</span>
            </li>
            {st.datastore === true && (
              <li className="is-muted"><Database strokeWidth={1.5} aria-hidden /><span>Metadata row in the Data Store</span></li>
            )}
          </>
        ) : (
          <li className="is-bad">
            <TriangleAlert strokeWidth={1.5} aria-hidden />
            <span>Not saved{st.reason ? `: ${reasonText(st.reason)}` : ""}{run.run.csv_key ? ". The CSV itself was kept in Stratus" : ""}</span>
          </li>
        )}
      </ul>

      <div className="vi-run-go">
        {st.saved || stashed ? (
          <Pill icon={ArrowUpRight} to={dashboardHref(run)} className="vi-ink" aria-label={st.saved ? "Open this run on the dashboard" : "Open this unsaved forecast on the dashboard"}>
            Open on dashboard
          </Pill>
        ) : (
          <p className="vi-store is-bad">This browser blocks storage, so the dashboard cannot pick up an unsaved forecast. The cleaning report is complete.</p>
        )}
      </div>
    </GlassCard>
  );
}
