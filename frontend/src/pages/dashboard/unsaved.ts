/* A forecast the Data Store did not keep (`run.saved: false`, `run.id: null`,
 * the reason in `run.errors`; e.g. the insert quota is spent). The forecast is
 * complete, so the dashboard shows it as is.
 *
 * The hand-off with the Input screen: whoever holds an unsaved forecast writes
 * the full response to sessionStorage `volta:lastForecast` and opens
 * /dashboard?unsaved=1. The dashboard reads it back; when it is missing the
 * page falls back to its empty state. Storage may be blocked, so every access
 * is guarded (the page also keeps the response in memory for this visit). */

import type { Run } from "@/lib/api";
import { STRATUS_LABEL, stratusNote } from "../storageNote";

export const UNSAVED_URL = "/dashboard?unsaved=1";
const KEY = "volta:lastForecast";

export const isUnsaved = (run: Run) => !run.run.saved || !run.run.id;

export function keepUnsaved(run: Run): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(run));
  } catch {
    /* blocked or full: the in-memory copy still serves this visit */
  }
}

export function readUnsaved(): Run | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const run = raw ? (JSON.parse(raw) as Run) : null;
    return Array.isArray(run?.hours) && run.hours.length > 0 && run.window ? run : null;
  } catch {
    return null;
  }
}

/** Where a run is kept: `run.storage {stratus, datastore, reason}` (not yet in api.ts's RunMeta). */
interface Storage { stratus?: boolean; datastore?: boolean; reason?: string | null }
const storageOf = (run: Run) => (run.run as Run["run"] & { storage?: Storage }).storage;

/** The header's quiet chip: "Saved" (where it is kept as the title),
 * "Saved", or "Not saved: <reason>", with the detail as its title. */
export function storageChip(run: Run): { saved: boolean; label: string; title: string } {
  const st = storageOf(run);
  const reasons = [st?.reason, ...(run.run.errors ?? [])].filter((r): r is string => Boolean(r));
  if (!isUnsaved(run) && st?.stratus) return { saved: true, label: STRATUS_LABEL, title: stratusNote(st) };
  if (!isUnsaved(run)) {
    const where = [st?.stratus && "Stratus", st?.datastore && "the Data Store"].filter(Boolean).join(" and ");
    return { saved: true, label: "Saved", title: [where ? `Saved to ${where}` : "Saved", ...reasons].join(". ") };
  }
  const why = reasons.join("; ");
  const short = /quota/i.test(why) ? "storage quota" : why.length > 36 ? `${why.slice(0, 34).trimEnd()}…` : why;
  return { saved: false, label: short ? `Not saved: ${short}` : "Not saved", title: why || "This forecast was not saved" };
}
