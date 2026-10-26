import type { ReactNode } from "react";
import { cssVars } from "@/components/landing/cssVars";
import { hhmm, type RunHour } from "@/lib/api";
import type { WindowStats } from "./model";

/* The window's KPIs as Sylva's side stats: a faint line mark, a soft label, a
 * bold value, stepped down the diagonal Sylva uses (x 1250 → 1346 → 1432,
 * +110 a step), under a spaced-caps caption naming their scope ("This
 * window"). On a phone they sit in one row, as Sylva's and the landing's do.
 * The marks are drawn in the same thin, dotted line language; the whole-run
 * card (RunStats) reuses them, so a window's peak and the run's read alike. */

const SVG = { viewBox: "0 0 30 30", fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function MarkPeak() {
  // a dotted ring and the day's curve rising to a point
  return (
    <svg {...SVG}>
      <circle cx="15" cy="15" r="10.5" strokeDasharray="0.6 3.6" />
      <path d="M8.6 19.2 11.8 16l2.4 1.9 4.6-6.1" />
      <circle cx="18.8" cy="11.8" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MarkOverload() {
  return (
    <svg {...SVG}>
      <circle cx="15" cy="15" r="10.5" strokeDasharray="0.6 3.6" />
      <path d="M16.2 8.5 11.4 15.6h4.2l-1.8 5.9 4.8-7.1h-4.2z" />
    </svg>
  );
}

export function MarkStorage({ share }: { share: number }) {
  const w = Math.max(0, Math.min(1, share)) * 15;
  return (
    <svg {...SVG}>
      <rect x="4.5" y="10" width="19" height="10" rx="2.4" />
      <path d="M26 13.4v3.2" />
      <rect x="6.5" y="12" width={w.toFixed(2)} height="6" rx="1" fill="currentColor" stroke="none" opacity="0.7" />
    </svg>
  );
}

/** The battery's lowest charge: the dotted ring with an arc for the share of a full battery. */
export function MarkCharge({ share }: { share: number }) {
  const c = 2 * Math.PI * 10.5;
  const arc = Math.max(0, Math.min(1, share)) * c;
  return (
    <svg {...SVG}>
      <circle cx="15" cy="15" r="10.5" strokeDasharray="0.6 3.6" />
      <circle cx="15" cy="15" r="10.5" strokeWidth="1.8" strokeDasharray={`${arc.toFixed(2)} ${c.toFixed(2)}`} transform="rotate(-90 15 15)" />
      <path d="M13.4 12v6.4h3.2V12z" />
      <path d="M14.3 11.1h1.4" />
    </svg>
  );
}

export function Stat({ tone, mark, label, value, delay }: { tone?: "a" | "b" | "c"; mark: ReactNode; label: string; value: ReactNode; delay: number }) {
  return (
    <div className={`vd-stat${tone ? ` vd-stat--${tone}` : ""} va-reveal`} style={cssVars({ "--d": `${delay}ms` })}>
      <span className="vd-mark" aria-hidden="true">{mark}</span>
      <dl>
        <dt>{label}</dt>
        <dd className="va-num">{value}</dd>
      </dl>
    </div>
  );
}

export function SideStats({ stats }: { stats: WindowStats }) {
  const peak: RunHour = stats.peak;
  return (
    <div className="vd-stats" role="group" aria-label="This window at a glance">
      <p className="vd-stats-cap va-reveal" style={cssVars({ "--d": "660ms" })} aria-hidden="true">This window · <span className="va-num">{stats.size} h</span></p>
      <Stat tone="a" delay={700} mark={<MarkPeak />} label={`Peak · ${hhmm(peak.timestamp)}`} value={`${peak.prediction_kw.toFixed(1)} kW`} />
      <Stat tone="b" delay={770} mark={<MarkOverload />} label="Overload" value={`${stats.overloadHours} of ${stats.size} h`} />
      <Stat tone="c" delay={840} mark={<MarkStorage share={stats.storageHours / Math.max(1, stats.size)} />} label="On storage" value={`${stats.storageHours} of ${stats.size} h`} />
    </div>
  );
}
