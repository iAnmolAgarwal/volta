import { lazy, Suspense, type ComponentType } from "react";
import { Activity, ToggleRight } from "lucide-react";
import { STORAGE_MODE, type Forecast, type Hour } from "@/lib/forecast";
import { cssVars } from "./cssVars";
import { BURST_MS, useRouteLink } from "@/lib/useRouteLink";

/* The two floating paper cards (Sylva's). Card 1 reads label, title, then
 * plate on top; it sits behind the 3D canvas, so its knob lives outside it
 * (PeakKnob) to stay in front of the landscape. Card 2 sits in front and
 * reads label, title, then plate, with its knob on the plate's corner.
 *
 * The charts are a lazy chunk: the plates paint at once (dark moss), and the
 * charts arrive before their draw-in starts. They are aria-hidden; the card
 * titles, labels and the side stats carry the same data as text. */

const charts = () => import("./CardCharts");
const PeakChart = lazy(() => charts().then((m) => ({ default: m.PeakChart })));
const FlowChart = lazy(() => charts().then((m) => ({ default: m.FlowChart })));

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

interface CardProps {
  forecast: Forecast;
  hour: Hour;
  index: number;
  loading: boolean;
  played: boolean;
  flash: boolean;
}

function SnapshotChip({ show }: { show: boolean }) {
  if (!show) return null;
  // phones show only "Offline" on the narrow plates; the full label stays for screen readers
  return <span className="vl-chip vl-chip--snapshot"><span className="vl-chip-long">Snapshot · </span>offline</span>;
}

export function PeakCard({ forecast, index, loading, played, flash }: CardProps) {
  const { peak } = forecast;
  return (
    <article
      className="vl-card vl-card--peak mask par"
      data-loading={loading || undefined}
      style={cssVars({ "--d": "760ms", "--pd": 10, "--pr": 2.2 })}
      aria-labelledby="vl-peak-title"
    >
      <figure className="vl-plate" data-flash={flash || undefined}>
        <div className="vl-plate-media" aria-hidden="true">
          <Suspense fallback={null}>
            <PeakChart hours={forecast.hours} playhead={played ? index : null} />
          </Suspense>
        </div>
        <SnapshotChip show={forecast.source === "snapshot" && !loading} />
        {loading && <span className="vl-shimmer" aria-hidden="true" />}
      </figure>
      <p className="vl-card-label">Next-24h peak</p>
      <h2 className="vl-card-title" id="vl-peak-title">
        <span className="vl-num vl-line">{peak.predictionKw.toFixed(1)} kW</span> at {hh(peak.hour)}
      </h2>
    </article>
  );
}

/** A card knob: Sylva's white disc, inside a hit area floored at 44px on phones. */
function Knob({ href, label, Icon }: { href: string; label: string; Icon: ComponentType<{ strokeWidth?: number; "aria-hidden"?: boolean }> }) {
  const link = useRouteLink();
  return (
    <a className="vl-knob" href={href} aria-label={label} onClick={link(href, BURST_MS)}>
      <span className="vl-knob-disc" aria-hidden="true">
        <Icon aria-hidden strokeWidth={1.4} />
      </span>
    </a>
  );
}

/** Card 1's knob, outside the card so it paints above the scene. */
export function PeakKnob() {
  return (
    <span className="vl-knob-float par" style={cssVars({ "--pd": 10, "--pr": 2.2 })}>
      <span className="vl-knob-reveal mask-circle" style={cssVars({ "--d": "1100ms" })}>
        <Knob href="/input" label="Open the forecast" Icon={Activity} />
      </span>
    </span>
  );
}

export function ModeCard({ forecast, hour, index, loading, played, flash }: CardProps) {
  const storage = hour.mode === STORAGE_MODE;
  return (
    <article
      className="vl-card vl-card--mode mask par"
      data-loading={loading || undefined}
      style={cssVars({ "--d": "880ms", "--pd": 22, "--pr": 2.4 })}
      aria-labelledby="vl-mode-title"
    >
      <p className="vl-card-label">
        Current mode
        {hour.overload && (
          <span className="vl-flag" aria-label="Critical overload: 200 kW or more">
            <i aria-hidden="true" />Overload
          </span>
        )}
      </p>
      <h2 className="vl-card-title" id="vl-mode-title" aria-live="polite">
        {storage ? "Renewable Storage" : "Main Grid"}
      </h2>
      <figure className="vl-plate" data-flash={flash || undefined}>
        <div className="vl-plate-media" aria-hidden="true">
          <Suspense fallback={null}>
            <FlowChart hours={forecast.hours} playhead={played ? index : null} />
          </Suspense>
        </div>
        <SnapshotChip show={forecast.source === "snapshot" && !loading} />
        {played && !loading && <span className="vl-chip vl-chip--hour">{hh(hour.hour)}</span>}
        {loading && <span className="vl-shimmer" aria-hidden="true" />}
      </figure>
      <Knob href="/dashboard" label="Open the controller" Icon={ToggleRight} />
    </article>
  );
}
