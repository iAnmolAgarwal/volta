import { useEffect, useState, type ComponentType, type ReactNode, type Ref } from "react";
import { ArrowDownUp, ArrowRight, ArrowRightLeft, ArrowUpRight, BatteryCharging, Binary, CircleCheck, Clock, CloudOff, CopyMinus, Database, Droplets, Gauge, Spline, Sun, TriangleAlert, UtilityPole } from "lucide-react";
import { GlassCard } from "@/components/app/GlassCard";
import { LogItem } from "@/components/app/LogItem";
import { Pill } from "@/components/app/Pill";
import { Shimmer } from "@/components/app/States";
import { dayMonth, hhmm, type Run } from "@/lib/api";
import { dashboardHref, isQuota } from "./unsaved";

/* What comes back from a post: the cleaning report on the moss glass, and the
 * run as one of Sylva's paper cards, with the way into the dashboard. While the
 * post is out, a glass card with the landing's sheen holds the place. */

type Icon = ComponentType<{ strokeWidth?: number; "aria-hidden"?: boolean }>;

const SOURCE = { manual: "Manual rows", csv: "CSV upload", sample: "Sample data" } as const;
/* the rejection fixes, short enough for a chip (their full labels stay in the "All clear" list when zero) */
const REJECT_SHORT: Record<string, string> = {
  rejected_no_timestamp: "No timestamp",
  rejected_bad_timestamp: "Unreadable timestamp",
  rejected_impossible_temp: "Temperature outside −60 to 60 °C",
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

/* ── busy ────────────────────────────────────────────────────────────────── */

export function BusyCard({ title, startedAt }: { title: string; startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, (now - startedAt) / 1000);
  return (
    <div className="vi-result-grid">
      <GlassCard label={<>Working · <span className="va-num">{s.toFixed(1)} s</span></>} title={title} className="vi-busy" delay={0}>
        <div role="status" className="vi-busy-body">
          <p className="vi-busy-steps">
            <span>Cleaning</span><ArrowRight strokeWidth={1.4} aria-hidden />
            <span>QuickML, every hour</span><ArrowRight strokeWidth={1.4} aria-hidden />
            <span>Controller and battery</span><ArrowRight strokeWidth={1.4} aria-hidden />
            <span>Saved as a run</span>
          </p>
          <Shimmer variant="text" lines={3} label="Forecasting" className="vi-busy-lines" />
          <p className="vi-note">A day takes about three seconds; the 1,000-hour sample a little longer.</p>
        </div>
      </GlassCard>
      <Shimmer variant="card" label="The run, on its way" className="vi-busy-paper" />
    </div>
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
  const isReject = (code: string) => code.startsWith("rejected");
  const rejectedFixes = c.fixes.filter((f) => f.count > 0 && isReject(f.code));
  const fixed = c.fixes.filter((f) => f.count > 0 && !isReject(f.code));
  const clear = c.fixes.filter((f) => f.count === 0);
  const formats = Object.entries(c.timestamp_formats).filter(([, n]) => n > 0);
  const more = c.rejected_count - c.rejected.length;

  return (
    <GlassCard
      label="Cleaning report"
      title={`${c.rows_out.toLocaleString()} of ${c.rows_in.toLocaleString()} rows kept`}
      delay={delay}
      className="vi-clean"
    >
      <div className="vi-clean-top">
        <dl className="vi-counts">
          <Count label="Rows in" value={c.rows_in} />
          <span className="vi-counts-arrow" aria-hidden="true"><ArrowRight strokeWidth={1.2} /></span>
          <Count label="Rows out" value={c.rows_out} />
          <Count label="Rejected" value={c.rejected_count} tone="bad" />
        </dl>
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
          <h3 className="vi-caps vi-caps--bad" id="vi-rej-h">Rejected · {c.rejected_count.toLocaleString()} {c.rejected_count === 1 ? "row" : "rows"}</h3>
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
        <h3 className="vi-caps" id="vi-fixed-h">{fixed.length ? `Fixed · ${fixed.length} ${fixed.length === 1 ? "kind" : "kinds"}` : "Fixed"}</h3>
        <ul className="vi-loglist">
          {fixed.length === 0 && (
            <li><LogItem icon={CircleCheck} label="All clear" title="Nothing needed fixing" /></li>
          )}
          {fixed.map((f) => (
            <li key={f.code}>
              <LogItem icon={fixIcon(f.code)} label="Fixed" title={f.label} meta={`${f.count.toLocaleString()} ${f.count === 1 ? "row" : "rows"}`} />
            </li>
          ))}
        </ul>
      </section>

      <section className="vi-clean-part" aria-labelledby="vi-clear-h">
        <h3 className="vi-caps" id="vi-clear-h">All clear · {clear.length} {clear.length === 1 ? "check" : "checks"}</h3>
        <ul className="vi-clear">
          {clear.map((f) => (
            <li key={f.code}><CircleCheck strokeWidth={1.4} aria-hidden />{f.label}</li>
          ))}
        </ul>
      </section>
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

/** The run, as a paper card. Its title takes focus when a post lands (`headRef`), so the next Tab is "Open on dashboard". */
export function RunSummary({ run, delay, headRef, stashed = true }: { run: Run; delay?: number; headRef?: Ref<HTMLSpanElement>; stashed?: boolean }) {
  const s = run.summary;
  const id = run.run.id as string | null; // null when the Data Store could not keep it
  const saved = run.run.saved && !!id;
  const errs = run.run.errors ?? [];
  const quota = isQuota(errs);
  const tag = id ? `run ${id.slice(-6)}` : "not saved";
  return (
    <GlassCard
      variant="paper"
      label={`${SOURCE[run.run.source] ?? run.run.source} · ${tag}`}
      title={<span ref={headRef} tabIndex={-1} className="vi-focus-target">{s.peak_kw.toFixed(1)} kW peak<span className="vi-peak-at"> at {stamp(s.peak_timestamp)}</span></span>}
      delay={delay}
      className="vi-run"
    >
      <p className="vi-run-span va-num">{s.n_hours.toLocaleString()} {s.n_hours === 1 ? "hour" : "hours"} · {stamp(s.start)} – {stamp(s.end)}</p>
      <dl className="vi-stats">
        <Stat icon={TriangleAlert} tone={s.overload_count > 0 ? "overload" : undefined} label="Overload ≥ 200 kW" value={`${s.overload_count.toLocaleString()} h`} />
        <Stat icon={ArrowRightLeft} label="Mode switches" value={s.switch_count.toLocaleString()} />
        <Stat icon={BatteryCharging} tone="storage" label="Renewable Storage" value={`${s.storage_hours.toLocaleString()} h`} />
        <Stat icon={UtilityPole} label="Main Grid" value={`${s.grid_hours.toLocaleString()} h`} />
        <Stat icon={Gauge} label="Lowest charge" value={`${s.min_soc_pct.toFixed(0)} %`} />
      </dl>
      {/* not saved is a quiet note, not an error: the forecast itself is complete */}
      <div className="vi-saved" title={!saved && errs.length ? errs.join("; ") : undefined}>
        {saved ? <CircleCheck strokeWidth={1.5} aria-hidden /> : <CloudOff strokeWidth={1.5} aria-hidden />}
        <span>
          {saved ? "Saved to the Data Store" : quota ? "Not saved · storage quota" : "Not saved"}
          {run.run.csv_key && <> · upload kept in Stratus</>}
          {!saved && !quota && errs.length > 0 && <> · {errs.join("; ")}</>}
        </span>
      </div>
      <div className="vi-run-go">
        {id || stashed ? (
          <Pill icon={ArrowUpRight} to={dashboardHref(run)} className="vi-ink" aria-label={id ? `Open run ${id.slice(-6)} on the dashboard` : "Open this unsaved forecast on the dashboard"}>
            Open on dashboard
          </Pill>
        ) : (
          <p className="vi-saved">This browser blocks storage, so the dashboard cannot pick up an unsaved forecast. The cleaning report is complete.</p>
        )}
      </div>
    </GlassCard>
  );
}
