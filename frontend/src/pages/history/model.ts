/* The History screen's readers over GET /api/runs (docs/api.md). Pure
 * functions, so the page only lays things out.
 *
 * Every run carries `storage {stratus, datastore, reason}`, which api.ts's
 * RunListItem does not type yet (logged in design-notes/m2/history-requests.md);
 * it is read defensively here, and the id's shape is the fallback: `r…` ids
 * live in Stratus, all-digit ids are the older Data Store runs. */

import { dayMonth, hhmm, type RunListItem, type RunSource } from "@/lib/api";
import { OVERLOAD_AT_KW } from "@/lib/forecast";

export interface RunStorage {
  stratus?: boolean;
  datastore?: boolean;
  reason?: string | null;
}

/** A Stratus run's demand in at most 48 equal buckets (docs/api.md, GET /api/runs). */
export interface RunSeries {
  step_hours: number;
  mean_kw: number[];
  max_kw: number[];
}

export type SavedRun = RunListItem & { storage?: RunStorage; series?: RunSeries | null };

const finite = (a: unknown): a is number[] => Array.isArray(a) && a.every((v) => typeof v === "number" && Number.isFinite(v));

/** The run's series when it is whole enough to draw (two or more matching points), else null: the older Data Store runs have none. */
export function seriesOf(r: SavedRun): RunSeries | null {
  const s = r.series;
  if (!s || !finite(s.mean_kw) || !finite(s.max_kw)) return null;
  if (s.mean_kw.length < 2 || s.mean_kw.length !== s.max_kw.length) return null;
  return { step_hours: Number.isFinite(s.step_hours) && s.step_hours > 0 ? s.step_hours : 1, mean_kw: s.mean_kw, max_kw: s.max_kw };
}

/** Every card's curve shares one kW scale, so the 200 kW line sits at one height on all of them. */
export interface CurveScale {
  /** The floor: the lowest mean listed, less 40%, so each curve stands on a quiet floor (the landing flow chart's idea) and keeps its shape. */
  lo: number;
  /** The top: the highest peak listed, or 200 kW, with the landing chart's 12% headroom. */
  hi: number;
}

export function curveScale(runs: SavedRun[]): CurveScale {
  let hi = OVERLOAD_AT_KW;
  let lo = Infinity;
  for (const r of runs) {
    if (Number.isFinite(r.peak_kw) && r.peak_kw > hi) hi = r.peak_kw;
    const s = seriesOf(r);
    if (s) for (const v of s.mean_kw) if (v < lo) lo = v;
  }
  return { lo: Number.isFinite(lo) ? Math.max(0, lo * 0.6) : 0, hi: hi * 1.12 };
}

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

/** The share of the run's hours at or above 200 kW. */
export const overloadShare = (r: SavedRun) => (r.n_rows > 0 ? Math.max(0, Math.min(1, r.overload_count / r.n_rows)) : 0);

/** "58% of hours", "<1% of hours", "no hours". */
export function shareText(share: number): string {
  if (share <= 0) return "no hours";
  if (share < 0.01) return "<1% of hours";
  return `${Math.round(share * 100)}% of hours`;
}

/** The run's length, said once on the card: "1,000 h", or "22 of 25 rows kept" when the cleaner dropped some. */
export function lengthText(r: SavedRun): string {
  if (r.rows_in > r.n_rows) return `${r.n_rows.toLocaleString("en-GB")} of ${r.rows_in.toLocaleString("en-GB")} rows kept`;
  return hoursText(r.n_rows);
}

/** The curve's two ends on the data's clock: ["16 Jun · 15:00", "28 Jul · 06:00"], the end as a bare time within one day. */
export function spanEnds(r: SavedRun): [string, string] {
  return [atText(r.start), r.start.slice(0, 10) === r.end.slice(0, 10) ? hhmm(r.end) : atText(r.end)];
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
  /** Hours at or above 200 kW, summed over the runs shown. */
  overloadHours: number;
  latest: SavedRun | null;
  peak: SavedRun | null;
}

export function listStats(shown: SavedRun[], total: number): ListStats {
  let peak: SavedRun | null = null;
  let overloadHours = 0;
  for (const r of shown) {
    if (!peak || r.peak_kw > peak.peak_kw) peak = r;
    overloadHours += r.overload_count;
  }
  return { shown: shown.length, total, overloadHours, latest: shown[0] ?? null, peak };
}

export function countBySource(runs: SavedRun[]): Record<SourceFilter, number> {
  const out: Record<SourceFilter, number> = { all: runs.length, csv: 0, manual: 0, sample: 0 };
  for (const r of runs) if (r.source in out) out[r.source] += 1;
  return out;
}
