/* The History screen's readers over GET /api/runs (docs/api.md). Pure
 * functions, so the page only lays things out.
 *
 * Every run carries `storage {stratus, datastore, reason}`, which api.ts's
 * RunListItem does not type yet (logged in design-notes/m2/history-requests.md);
 * it is read defensively here, and the id's shape is the fallback: `r…` ids
 * live in Stratus, all-digit ids are the older Data Store runs. */

import { dayMonth, hhmm, type RunListItem, type RunSource } from "@/lib/api";

export interface RunStorage {
  stratus?: boolean;
  datastore?: boolean;
  reason?: string | null;
}

export type SavedRun = RunListItem & { storage?: RunStorage };

export type SourceFilter = "all" | RunSource;
export const FILTERS: SourceFilter[] = ["all", "csv", "manual", "sample"];
export const isFilter = (v: string | null): v is SourceFilter => v != null && (FILTERS as string[]).includes(v);

/** The source as a card label says it. */
export const SOURCE_LABEL: Record<RunSource, string> = { csv: "CSV upload", manual: "Manual", sample: "Sample" };
/** The filter dock's item names. */
export const FILTER_LABEL: Record<SourceFilter, string> = { all: "All", csv: "CSV", manual: "Manual", sample: "Sample" };

/** The card's headline: the file, or what a manual run is. */
export const runTitle = (r: SavedRun) => r.filename ?? (r.source === "manual" ? "Form entry" : "Untitled upload");

/** The dashboard's address for a saved run. */
export const runHref = (id: string) => `/dashboard?run=${encodeURIComponent(id)}`;

/** "b082f1": the id's tail, as the dashboard's eyebrow shows it. */
export const shortId = (id: string) => id.slice(-6);

/* ── time: created is a real instant (UTC or +05:30), shown in the viewer's zone ── */

const CREATED = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const CREATED_FULL = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" });

const instant = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

/** "27 Oct, 03:10" in the viewer's time zone. */
export function createdShort(iso: string): string {
  const t = instant(iso);
  return t ? CREATED.format(t).replace(",", " ·") : iso;
}

/** "Tuesday 27 October 2026, 03:10 GMT+5:30", for a title attribute. */
export function createdFull(iso: string): string {
  const t = instant(iso);
  return t ? CREATED_FULL.format(t) : iso;
}

/** Newest first by the real instant; the API's order breaks ties. */
export function newestFirst(runs: SavedRun[]): SavedRun[] {
  return runs.map((r, i) => ({ r, i, t: instant(r.created) })).sort((a, b) => b.t - a.t || a.i - b.i).map((x) => x.r);
}

/* ── the data's own clock (local telemetry time, never shifted) ─────────── */

/** "17 Jun · 00:00 → 23:00" within a day, "16 Jun 15:00 → 28 Jul 06:00" across days. */
export function spanText(r: SavedRun): string {
  if (r.start.slice(0, 10) === r.end.slice(0, 10)) return `${dayMonth(r.start)} · ${hhmm(r.start)} → ${hhmm(r.end)}`;
  return `${dayMonth(r.start)} ${hhmm(r.start)} → ${dayMonth(r.end)} ${hhmm(r.end)}`;
}

/** "23 Jun · 18:00". */
export const atText = (ts: string) => `${dayMonth(ts)} · ${hhmm(ts)}`;

export const hoursText = (n: number) => `${n.toLocaleString("en-GB")} h`;

/** "1,000 rows, all kept" or "22 of 25 rows kept". */
export function rowsText(r: SavedRun): string {
  if (r.rows_in > r.n_rows) return `${r.n_rows.toLocaleString("en-GB")} of ${r.rows_in.toLocaleString("en-GB")} rows kept`;
  return `${r.n_rows.toLocaleString("en-GB")} rows, all kept`;
}

/* ── where the run is kept ───────────────────────────────────────────────── */

export interface Store {
  name: "Stratus" | "Data Store";
  /** The chip's title: where exactly, and why the Data Store row was skipped. */
  detail: string;
}

export function storeOf(r: SavedRun): Store {
  const st = r.storage;
  const stratus = st?.stratus ?? r.id.startsWith("r");
  if (stratus) {
    const skipped = st?.datastore === false && st.reason ? ` The Data Store row was skipped: ${st.reason}.` : st?.datastore ? " Its metadata row is also in the Data Store." : "";
    return { name: "Stratus", detail: `Saved in Stratus as runs/${r.id}.json.${skipped}` };
  }
  return { name: "Data Store", detail: "Saved in the Data Store (runs and run_hours), before runs moved to Stratus on 27 Oct." };
}

/* ── the header's side stats ─────────────────────────────────────────────── */

export interface ListStats {
  shown: number;
  total: number;
  latest: SavedRun | null;
  peak: SavedRun | null;
}

export function listStats(shown: SavedRun[], total: number): ListStats {
  let peak: SavedRun | null = null;
  for (const r of shown) if (!peak || r.peak_kw > peak.peak_kw) peak = r;
  return { shown: shown.length, total, latest: shown[0] ?? null, peak };
}

export function countBySource(runs: SavedRun[]): Record<SourceFilter, number> {
  const out: Record<SourceFilter, number> = { all: runs.length, csv: 0, manual: 0, sample: 0 };
  for (const r of runs) if (r.source in out) out[r.source] += 1;
  return out;
}
