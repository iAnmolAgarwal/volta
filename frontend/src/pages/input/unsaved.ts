/* Where a run was kept, read from the response, never assumed.
 *
 * `run.saved` is true once the run is in Stratus (the run store); the optional
 * `run.storage` {stratus, datastore, reason} says whether its metadata row also
 * reached the Data Store, and why not (docs/api.md "Saving", "Persistence").
 * src/lib/api.ts predates `storage`, so it is read here through a local type.
 *
 * A run that was not saved is still a complete forecast: it goes to the
 * dashboard through sessionStorage under one agreed key, at /dashboard?unsaved=1
 * (the coordinator's contract with the Dashboard builder). */

import type { Run } from "@/lib/api";

export const UNSAVED_KEY = "volta:lastForecast";
export const UNSAVED_HREF = "/dashboard?unsaved=1";

export interface RunStorage {
  stratus?: boolean;
  datastore?: boolean;
  reason?: string | null;
}

export interface StorageState {
  saved: boolean;
  id: string | null;
  stratus?: boolean;
  datastore?: boolean;
  reason: string | null;
}

export function storageOf(run: Run): StorageState {
  const meta = run.run as Run["run"] & { storage?: RunStorage; id: string | null };
  const id = meta.id ? String(meta.id) : null;
  const saved = !!meta.saved && !!id;
  const errs = (meta.errors ?? []).filter(Boolean);
  const reason = meta.storage?.reason || (errs.length ? errs.join("; ") : null);
  return { saved, id, stratus: meta.storage?.stratus, datastore: meta.storage?.datastore, reason };
}

/** Keep an unsaved run for the dashboard. False when storage refused it (private mode, quota). */
export function stashUnsaved(run: Run): boolean {
  try {
    window.sessionStorage.setItem(UNSAVED_KEY, JSON.stringify(run));
    return true;
  } catch {
    return false;
  }
}

/** Where "Open on dashboard" goes: the saved run by id, or the session's unsaved forecast. */
export function dashboardHref(run: Run): string {
  const st = storageOf(run);
  return st.saved && st.id ? `/dashboard?run=${encodeURIComponent(st.id)}` : UNSAVED_HREF;
}
