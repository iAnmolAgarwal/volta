import { Activity, ToggleRight } from "lucide-react";
import { STORAGE_MODE, type Forecast, type Hour } from "@/lib/forecast";
import { FlowChart, PeakChart } from "./CardCharts";
import { cssVars } from "./cssVars";

/* The two floating paper cards (Sylva's). Card 1 reads label, title, then
 * plate on top; it sits behind the 3D canvas, so its knob lives outside it
 * (KnobFloat) to stay in front of the landscape. Card 2 sits in front and
 * reads label, title, then plate, with its knob on the plate's corner. */

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

interface CardProps {
  forecast: Forecast;
  hour: Hour;
  index: number;
  loading: boolean;
  played: boolean;
}

function SnapshotChip({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="vl-chip vl-chip--snapshot">Snapshot · offline</span>;
}

export function PeakCard({ forecast, index, loading, played }: CardProps) {
  const { peak } = forecast;
  return (
    <article
      className="vl-card vl-card--peak mask par"
      data-loading={loading || undefined}
      style={cssVars({ "--d": "760ms", "--pd": 10, "--pr": 2.2 })}
      aria-labelledby="vl-peak-title"
    >
      <figure className="vl-plate">
        <div className="vl-plate-media">
          <PeakChart hours={forecast.hours} playhead={played ? index : null} />
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

/** Card 1's knob, outside the card so it paints above the scene. */
export function PeakKnob() {
  return (
    <span className="vl-knob-float par" style={cssVars({ "--pd": 10, "--pr": 2.2 })}>
      <a className="vl-knob mask-circle" href="#forecast" style={cssVars({ "--d": "1100ms" })} aria-label="Open the forecast">
        <Activity aria-hidden strokeWidth={1.4} />
      </a>
    </span>
  );
}

export function ModeCard({ forecast, hour, index, loading, played }: CardProps) {
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
      <figure className="vl-plate">
        <div className="vl-plate-media">
          <FlowChart hours={forecast.hours} playhead={played ? index : null} />
        </div>
        <SnapshotChip show={forecast.source === "snapshot" && !loading} />
        {played && !loading && <span className="vl-chip vl-chip--hour">{hh(hour.hour)}</span>}
        {loading && <span className="vl-shimmer" aria-hidden="true" />}
      </figure>
      <a className="vl-knob" href="#controller" aria-label="Open the controller">
        <ToggleRight aria-hidden strokeWidth={1.4} />
      </a>
    </article>
  );
}
