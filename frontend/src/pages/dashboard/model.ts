/* The dashboard's pure readers over a saved run: the 24-hour windows the
 * stepper walks, the window's side stats, and the system log's entries with the
 * rule that picks the one entry the focused hour sits in. No React here. */

import { hhmm, isStorage, shortMode, type Run, type RunHour } from "@/lib/api";

export const WINDOW = 24;

/** The window that holds run index `i`: aligned to the run's 24-hour steps, the last one kept full. */
export function windowFor(i: number, n: number): number {
  return Math.max(0, Math.min(Math.floor(i / WINDOW) * WINDOW, n - WINDOW));
}

/** "Window 3 of 42" for a window start. */
export function windowNumber(start: number, n: number) {
  const total = Math.max(1, Math.ceil(n / WINDOW));
  const at = start >= n - WINDOW ? total : Math.floor(start / WINDOW) + 1;
  return { at: Math.min(at, total), total };
}

export interface WindowStats {
  peak: RunHour;
  overloadHours: number;
  storageHours: number;
  switches: number;
  size: number;
}

export function windowStats(run: Run, start: number, end: number): WindowStats {
  const hours = run.hours.slice(start, end);
  let peak = hours[0];
  for (const h of hours) if (h.prediction_kw > peak.prediction_kw) peak = h;
  return {
    peak,
    overloadHours: hours.filter((h) => h.overload).length,
    storageHours: hours.filter((h) => isStorage(h.mode)).length,
    switches: run.switch_events.filter((e) => e.index >= start && e.index < end).length,
    size: hours.length,
  };
}

/** A run of consecutive overload hours (from the run's overload_alerts). */
export interface OverloadRun {
  start: number;
  end: number;
  hours: number;
  peakIndex: number;
  peakKw: number;
  peakTs: string;
  /** "15:00–22:00", or "15:00" for one hour. */
  range: string;
}

export function overloadRuns(run: Run, start: number, end: number): OverloadRun[] {
  const alerts = run.overload_alerts.filter((a) => a.index >= start && a.index < end).sort((a, b) => a.index - b.index);
  const out: OverloadRun[] = [];
  for (let k = 0; k < alerts.length; ) {
    let j = k;
    while (j + 1 < alerts.length && alerts[j + 1].index === alerts[j].index + 1) j++;
    const span = alerts.slice(k, j + 1);
    const peak = span.reduce((p, a) => (a.prediction_kw > p.prediction_kw ? a : p), span[0]);
    const a = span[0];
    const b = span[span.length - 1];
    out.push({
      start: a.index,
      end: b.index,
      hours: span.length,
      peakIndex: peak.index,
      peakKw: peak.prediction_kw,
      peakTs: peak.timestamp,
      range: span.length > 1 ? `${hhmm(a.timestamp)}–${hhmm(b.timestamp)}` : hhmm(a.timestamp),
    });
    k = j + 1;
  }
  return out;
}

export type EntryKind = "switch" | "overload" | "info";

export interface LogEntry {
  key: string;
  kind: EntryKind;
  /** First and last run index the entry covers (a switch or the opening covers one hour). */
  start: number;
  end: number;
  /** The hour a click focuses: the switch hour, or an overload span's peak. */
  focusAt: number;
  label: string;
  title: string;
  meta?: string;
}

const kw = (v: number) => `${v.toFixed(1)} kW`;

/** The window's log: its opening state, each mode switch, and each run of consecutive overload hours. */
export function logEntries(run: Run, start: number, end: number): LogEntry[] {
  const first = run.hours[start];
  if (!first) return [];
  const out: LogEntry[] = [
    {
      key: `open${start}`,
      kind: "info",
      start,
      end: start,
      focusAt: start,
      label: `Window opens · ${hhmm(first.timestamp)}`,
      title: `In ${shortMode(first.mode)}`,
      meta: `${Math.round(first.soc_pct)}% charge`,
    },
  ];

  for (const e of run.switch_events) {
    if (e.index < start || e.index >= end) continue;
    out.push({
      key: `sw${e.index}`,
      kind: "switch",
      start: e.index,
      end: e.index,
      focusAt: e.index,
      label: `Mode switch · ${hhmm(e.timestamp)}`,
      title: `${shortMode(e.from)} → ${shortMode(e.to)}`,
      meta: kw(run.hours[e.index]?.prediction_kw ?? 0),
    });
  }

  for (const r of overloadRuns(run, start, end)) {
    out.push({
      key: `ov${r.start}`,
      kind: "overload",
      start: r.start,
      end: r.end,
      focusAt: r.peakIndex,
      label: `Overload · ${r.range} · ${r.hours} h`,
      title: r.hours > 1 ? `Peak ${kw(r.peakKw)} at ${hhmm(r.peakTs)}` : `Critical overload, ${kw(r.peakKw)}`,
    });
  }

  const rank: Record<EntryKind, number> = { info: 0, switch: 1, overload: 2 };
  return out.sort((x, y) => x.start - y.start || rank[x.kind] - rank[y.kind]);
}

/** The entry the focused hour sits in: the overload run that holds it, otherwise the
 * latest switch (or the window's opening) before it, i.e. the mode in effect. */
export function activeEntry(entries: LogEntry[], focus: number, start: number, end: number): string | null {
  if (focus < start || focus >= end) return null;
  const overload = entries.find((e) => e.kind === "overload" && e.start <= focus && focus <= e.end);
  if (overload) return overload.key;
  let best: LogEntry | null = null;
  for (const e of entries) {
    if (e.start > focus) break;
    if (e.kind !== "overload") best = e;
  }
  return best?.key ?? null;
}
