import { useMemo, type MouseEvent } from "react";
import { ArrowUpRight, Check, CloudCheck, Database, Download, LoaderCircle, RotateCw } from "lucide-react";
import { GlassCard } from "@/components/app/GlassCard";
import { Pill } from "@/components/app/Pill";
import { cssVars } from "@/components/landing/cssVars";
import { setLastRunId } from "@/lib/api";
import { runCsvName } from "@/lib/csv";
import { useRouteLink } from "@/lib/useRouteLink";
import { atText, createdFull, runHref, createdShort, hoursText, lengthText, overloadShare, runTitle, seriesOf, shareText, shortId, SOURCE_LABEL, spanEnds, spanText, storeOf, type SavedRun } from "./model";
import { MarkOverload, MarkPeak, MarkSpan } from "./Marks";
import { RunCurve } from "./RunCurve";
import { useRunCsv } from "./useRunCsv";

/* One saved run as Sylva's Field Note: the paper card reads downward, a small
 * label (source · when it was saved), the headline (the file), then the moss
 * plate at its foot, inset 14 as Sylva's photograph is, holding the run's data
 * in side-stat form. The knob sits on the plate's lower-right corner.
 *
 * A Stratus run carries its demand as a 48-point series, so its plate leads
 * with the run's shape (the landing Field Note's curve), its two ends on the
 * data's clock under it. The older Data Store runs have no series and keep
 * the span row, in a box of the curve's height, so every plate in a row
 * lines up.
 *
 * The whole card is one real link to /dashboard?run=<id> (the headline's link
 * is stretched over the card), so Enter, a click, a middle-click and "open in
 * new tab" all work; following it records the run as the viewer's last.
 *
 * "CSV" is the card's one other control: a real button beside the store chip,
 * raised over the stretched link (never inside it), that reads the run once
 * and hands the browser its results as a CSV. It shows its own busy state, a
 * brief check once the file is handed over, and an inline error under the row. */

export function RunCard({ run, last, delay }: { run: SavedRun; last: boolean; delay: number }) {
  const link = useRouteLink();
  const href = runHref(run.id);
  const store = storeOf(run);
  const title = runTitle(run);
  const when = createdShort(run.created);
  const source = SOURCE_LABEL[run.source] ?? run.source;
  const overShare = overloadShare(run);
  const series = useMemo(() => seriesOf(run), [run]);
  const titleId = `vh-run-${run.id}`;
  const csvErrId = `vh-csv-${run.id}`;
  const csv = useRunCsv(run.id);
  const busy = csv.status.state === "busy";
  const failed = csv.status.state === "error";
  const done = csv.status.state === "done";
  const CsvIcon = busy ? LoaderCircle : failed ? RotateCw : done ? Check : Download;
  const meta = `Run ${shortId(run.id)} · ${lengthText(run)}`;

  const follow = link(href);
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    setLastRunId(run.id);
    follow(e);
  };

  return (
    <GlassCard
      as="article"
      variant="paper"
      delay={delay}
      className={`vh-run${last ? " is-last" : ""}`}
      style={cssVars({ "--draw-d": `${delay + 260}ms` })}
      aria-labelledby={titleId}
      label={
        <>
          <span>{source} · <time dateTime={run.created}>{when}</time></span>
          {last && <span className="vh-flag"><i aria-hidden="true" />Last opened</span>}
        </>
      }
      title={
        <a
          className="vh-run-link"
          href={href}
          id={titleId}
          onClick={onClick}
          onAuxClick={() => setLastRunId(run.id)}
          aria-label={`${title}: ${source.toLowerCase()} run saved ${when}${last ? ", last opened" : ""}. Open on the dashboard`}
          title={`Saved ${createdFull(run.created)}. ${store.detail}`}
        >
          {title}
        </a>
      }
    >
      <div className="vh-run-row">
        <p className="vh-run-meta va-num" title={run.rows_in > run.n_rows ? `Run ${shortId(run.id)}: the cleaner kept ${run.n_rows.toLocaleString("en-GB")} of ${run.rows_in.toLocaleString("en-GB")} rows` : undefined}>
          {meta}
        </p>
        <span className="vh-run-actions">
          <span className="vh-saved" title={store.detail}>
            <Pill size="sm" icon={store.name === "Stratus" ? CloudCheck : Database}>{store.label}</Pill>
            <span className="sr-only">. {store.detail}</span>
          </span>
          <button
            type="button"
            className={`va-pill va-pill--default va-pill--sm is-action vh-csv${busy ? " is-busy" : ""}${done ? " is-done" : ""}`}
            onClick={csv.download}
            aria-busy={busy}
            aria-describedby={failed ? csvErrId : undefined}
            aria-label={busy ? `Preparing the CSV for run ${shortId(run.id)}` : failed ? `Retry the CSV download for run ${shortId(run.id)}` : `Download run ${shortId(run.id)} as CSV`}
            title={busy ? "Reading the run…" : `Download this run's ${hoursText(run.n_rows)} as CSV`}
          >
            <span className="va-pill-glyph" aria-hidden="true"><CsvIcon strokeWidth={1.5} aria-hidden /></span>
            <span className="va-pill-label">{busy ? "Preparing" : failed ? "Retry" : "CSV"}</span>
          </button>
          <span className="sr-only" aria-live="polite">{done ? `${runCsvName(run.id)} downloaded` : ""}</span>
        </span>
        {csv.status.state === "error" && (
          <p className="vh-csv-error" id={csvErrId} role="alert">
            <i aria-hidden="true" />
            {csv.status.message}
          </p>
        )}
      </div>

      <figure className={`va-plate vh-plate${series ? " has-curve" : ""}`}>
        <div className="vh-plate-body">
          {series ? (
            <div className="vh-curve-wrap">
              <RunCurve mean={series.mean_kw} label={curveLabel(run, series.step_hours, series.mean_kw)} />
              <p className="vh-curve-axis va-num">
                <span>{spanEnds(run)[0]}</span>
                <span>{spanEnds(run)[1]}</span>
              </p>
            </div>
          ) : (
            <div className="vh-span-box">
              <div className="vh-span">
                <span className="vh-pmark" aria-hidden="true"><MarkSpan /></span>
                <dl>
                  <dt>Data span</dt>
                  <dd className="va-num">{spanText(run)}</dd>
                </dl>
              </div>
            </div>
          )}
          <div className="vh-readings">
            <div className="vh-reading">
              <span className="vh-pmark" aria-hidden="true"><MarkPeak /></span>
              <dl>
                <dt>Peak</dt>
                <dd className="va-num">{run.peak_kw.toFixed(1)} kW</dd>
                <dd className="vh-sub va-num">{atText(run.peak_timestamp)}</dd>
              </dl>
            </div>
            <div className={`vh-reading${run.overload_count > 0 ? " is-overload" : ""}`}>
              <span className="vh-pmark" aria-hidden="true"><MarkOverload share={overShare} /></span>
              <dl>
                <dt>Overload <span className="vh-dt-note">≥&nbsp;200&nbsp;kW</span></dt>
                <dd className="va-num">{hoursText(run.overload_count)}</dd>
                <dd className="vh-sub va-num">{shareText(overShare)}</dd>
              </dl>
            </div>
          </div>
        </div>
      </figure>

      {/* the knob: Sylva's disc, here a picture of the card's own link */}
      <span className="va-knob vh-knob" aria-hidden="true">
        <span className="va-knob-disc"><ArrowUpRight strokeWidth={1.4} aria-hidden /></span>
      </span>
    </GlassCard>
  );
}

/** What the curve shows, for a screen reader: its spacing, its range and where it peaks. */
function curveLabel(run: SavedRun, step: number, mean: number[]): string {
  const lo = Math.min(...mean);
  const hi = Math.max(...mean);
  const [from, to] = spanEnds(run);
  const each = step === 1 ? "hourly demand" : `mean demand per ${step} h`;
  return `Load curve, ${from} to ${to}: ${each} from ${lo.toFixed(0)} to ${hi.toFixed(0)} kW; the peak hour reached ${run.peak_kw.toFixed(1)} kW, against the 200 kW overload line.`;
}
