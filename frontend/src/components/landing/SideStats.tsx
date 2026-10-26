import { FORECAST_ERROR_KW } from "@/lib/forecast";
import { cssVars } from "./cssVars";

/* Sylva's side stats: a faint line mark, a soft label, a bold value. Ours adds
 * a third (C) one diagonal step below B. The marks are drawn in the same thin,
 * dotted line language as Sylva's. */

function MarkError() {
  // a target: the forecast lands within a ring of the actual
  return (
    <svg viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <circle cx="15" cy="15" r="10.5" strokeDasharray="0.6 3.6" />
      <circle cx="15" cy="15" r="5.6" strokeDasharray="0.6 3.2" />
      <path d="M15 11.6v6.8M11.6 15h6.8" />
    </svg>
  );
}

function MarkBattery({ pct }: { pct: number }) {
  const w = Math.max(0, Math.min(1, pct / 100)) * 15;
  return (
    <svg viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="10" width="19" height="10" rx="2.4" />
      <path d="M26 13.4v3.2" />
      <rect x="6.5" y="12" width={w.toFixed(2)} height="6" rx="1" fill="currentColor" stroke="none" opacity="0.7" />
    </svg>
  );
}

function MarkOverload() {
  return (
    <svg viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="15" cy="15" r="10.5" strokeDasharray="0.6 3.6" />
      <path d="M16.2 8.5 11.4 15.6h4.2l-1.8 5.9 4.8-7.1h-4.2z" />
    </svg>
  );
}

export function SideStats({ socPct, overloadHours, total }: { socPct: number; overloadHours: number; total: number }) {
  return (
    <>
      <dl className="vl-stat vl-stat--a mask par" style={cssVars({ "--d": "700ms", "--pd": 12 })}>
        <span className="vl-mark" aria-hidden="true"><MarkError /></span>
        <div><dt>Forecast error</dt><dd>±{FORECAST_ERROR_KW} kW</dd></div>
      </dl>
      <dl className="vl-stat vl-stat--b mask par" style={cssVars({ "--d": "770ms", "--pd": 13 })}>
        <span className="vl-mark" aria-hidden="true"><MarkBattery pct={socPct} /></span>
        <div><dt>Battery</dt><dd className="vl-num">{Math.round(socPct)}%</dd></div>
      </dl>
      <dl className="vl-stat vl-stat--c mask par" style={cssVars({ "--d": "840ms", "--pd": 14 })}>
        <span className="vl-mark" aria-hidden="true"><MarkOverload /></span>
        <div><dt>Overload hours</dt><dd className="vl-num">{overloadHours} of {total}</dd></div>
      </dl>
    </>
  );
}
