import { useEffect, useState } from "react";
import { cssVars } from "@/components/landing/cssVars";
import { dayMonth, getLastRunId, listRuns, MAX_ROWS, type RunListItem } from "@/lib/api";

/* Sylva's side stats on the hero's diagonal (the landing's .vl-stat, at its
 * x 1250 / 1346 / 1432), each a faint dotted mark, a soft label and a bold
 * value. The values are live: the latest run and the saved-run count come from
 * GET /api/runs (a read; it saves nothing). A post on this page updates them. */

function MarkRows() {
  return (
    <svg viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <circle cx="15" cy="15" r="10.5" strokeDasharray="0.6 3.6" />
      <path d="M10.5 11.5h9M10.5 15h9M10.5 18.5h6" />
    </svg>
  );
}

function MarkPeak() {
  return (
    <svg viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="15" cy="15" r="10.5" strokeDasharray="0.6 3.6" />
      <path d="M9 19l3.6-4 2.6 2.4L21 10.5" />
      <path d="M17.6 10.5H21v3.4" />
    </svg>
  );
}

function MarkSaved() {
  return (
    <svg viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="15" cy="15" r="10.5" strokeDasharray="0.6 3.6" />
      <path d="M15 10.5V15l3 2" />
      <path d="M9.6 12.4a6 6 0 1 1 .4 5.4" />
      <path d="M9.4 9.8v2.8h2.8" />
    </svg>
  );
}

export interface Latest {
  peakKw: number;
  at: string; // the peak's timestamp
}

type Load = { state: "loading" } | { state: "ready"; runs: RunListItem[] } | { state: "error" };

export function HeroStats({ latest, savedNow = 0 }: { latest?: Latest | null; savedNow?: number }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    listRuns({ signal: ctrl.signal })
      .then((runs) => setLoad({ state: "ready", runs }))
      .catch(() => {
        if (!ctrl.signal.aborted) setLoad({ state: "error" });
      });
    return () => ctrl.abort();
  }, []);

  const runs = load.state === "ready" ? load.runs : [];
  const lastId = getLastRunId();
  const remembered = runs.find((r) => r.id === lastId) ?? runs[0];
  const last: Latest | null = latest ?? (remembered ? { peakKw: remembered.peak_kw, at: remembered.peak_timestamp } : null);
  const count = runs.length + savedNow;
  const lastValue = last ? `${last.peakKw.toFixed(1)} kW peak` : load.state === "loading" ? "…" : "None yet";
  const countValue = load.state === "loading" ? "…" : load.state === "error" ? "—" : `${count}${runs.length >= 20 ? "+" : ""} in history`;

  return (
    <div className="vi-hstats" aria-label="At a glance">
      <dl className="vl-stat vi-hstat vi-hstat--a va-reveal" style={cssVars({ "--d": "520ms" })}>
        <span className="vl-mark" aria-hidden="true"><MarkRows /></span>
        <div><dt>Per forecast</dt><dd className="vl-num">Up to {MAX_ROWS.toLocaleString()} rows</dd></div>
      </dl>
      <dl className="vl-stat vi-hstat vi-hstat--b va-reveal" style={cssVars({ "--d": "590ms" })}>
        <span className="vl-mark" aria-hidden="true"><MarkPeak /></span>
        <div>
          <dt>{last ? `Last run · ${dayMonth(last.at)}` : "Last run"}</dt>
          <dd className="vl-num">{lastValue}</dd>
        </div>
      </dl>
      <dl className="vl-stat vi-hstat vi-hstat--c va-reveal" style={cssVars({ "--d": "660ms" })}>
        <span className="vl-mark" aria-hidden="true"><MarkSaved /></span>
        <div><dt>Saved runs</dt><dd className="vl-num">{countValue}</dd></div>
      </dl>
    </div>
  );
}
