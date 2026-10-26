import { useMemo, type MouseEvent } from "react";
import { ArrowUpRight, CloudCheck, Database } from "lucide-react";
import { GlassCard } from "@/components/app/GlassCard";
import { Pill } from "@/components/app/Pill";
import { cssVars } from "@/components/landing/cssVars";
import { setLastRunId } from "@/lib/api";
import { useRouteLink } from "@/lib/useRouteLink";
import { atText, createdFull, runHref, createdShort, hoursText, overloadShare, rowsText, runTitle, seriesOf, shareText, shortId, SOURCE_LABEL, spanEnds, spanText, storeOf, type CurveScale, type SavedRun } from "./model";
import { MarkOverload, MarkPeak, MarkSpan } from "./Marks";
import { RunCurve } from "./RunCurve";

/* One saved run as Sylva's Field Note: the paper card reads downward, a small
 * label (source · when it was saved), the headline (the file), then the moss
 * plate at its foot, inset 14 as Sylva's photograph is, holding the run's data
 * in side-stat form. The knob sits on the plate's lower-right corner.
 *
 * A Stratus run carries its demand as a 48-point series, so its plate leads
 * with the run's shape (the landing Field Note's curve, on one kW scale for
 * every card, `scale`), its two ends on the data's clock under it. The older
 * Data Store runs have no series and keep the span row.
 *
 * The whole card is one real link to /dashboard?run=<id> (the headline's link
 * is stretched over the card), so Enter, a click, a middle-click and "open in
 * new tab" all work; following it records the run as the viewer's last. */

export function RunCard({ run, last, delay, scale }: { run: SavedRun; last: boolean; delay: number; scale: CurveScale }) {
  const link = useRouteLink();
  const href = runHref(run.id);
  const store = storeOf(run);
  const title = runTitle(run);
  const when = createdShort(run.created);
  const source = SOURCE_LABEL[run.source] ?? run.source;
  const overShare = overloadShare(run);
  const series = useMemo(() => seriesOf(run), [run]);
  const titleId = `vh-run-${run.id}`;

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
        <p className="vh-run-meta">
          <span className="va-num">Run {shortId(run.id)}</span> · <span className="va-num">{rowsText(run)}</span>
        </p>
        <span className="vh-saved">
          <Pill size="sm" icon={store.name === "Stratus" ? CloudCheck : Database}>Saved · {store.name}</Pill>
        </span>
      </div>

      <figure className={`va-plate vh-plate${series ? " has-curve" : ""}`}>
        <div className="vh-plate-body">
          {series ? (
            <div className="vh-curve-wrap">
              <RunCurve series={series} scale={scale} label={curveLabel(run, series.step_hours, series.mean_kw)} />
              <p className="vh-curve-axis va-num">
                <span>{spanEnds(run)[0]}</span>
                <span className="vh-curve-step">{series.step_hours === 1 ? "Hourly" : `${series.step_hours} h a point`}</span>
                <span>{spanEnds(run)[1]}</span>
              </p>
            </div>
          ) : (
            <div className="vh-span">
              <span className="vh-pmark" aria-hidden="true"><MarkSpan /></span>
              <dl>
                <dt>Data span · <span className="va-num">{hoursText(run.n_rows)}</span></dt>
                <dd className="va-num">{spanText(run)}</dd>
              </dl>
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
                <dd className="vh-sub va-num">{series ? shareText(overShare) : `of ${hoursText(run.n_rows)}`}</dd>
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
