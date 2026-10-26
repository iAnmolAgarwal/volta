/* A run the Data Store could not keep (its free-tier insert quota is spent:
 * `run.saved` false, `run.id` null, the reason in `run.errors`) is still a
 * complete forecast. The Input screen hands it to the dashboard through
 * sessionStorage under one agreed key, and links to /dashboard?unsaved=1
 * (the coordinator's contract with the Dashboard builder). */

import type { Run } from "@/lib/api";

export const UNSAVED_KEY = "volta:lastForecast";
export const UNSAVED_HREF = "/dashboard?unsaved=1";

/** Keep an unsaved run for the dashboard. False when storage refused it (private mode, quota). */
export function stashUnsaved(run: Run): boolean {
  try {
    window.sessionStorage.setItem(UNSAVED_KEY, JSON.stringify(run));
    return true;
  } catch {
    return false;
  }
}

/** Where "Open on dashboard" goes for this run. */
export const dashboardHref = (run: Run) => (run.run.id ? `/dashboard?run=${run.run.id}` : UNSAVED_HREF);

/** The storage quota is the expected reason; anything else is shown as it came. */
export const isQuota = (errors: string[] | undefined) => (errors ?? []).some((e) => /FREE_USAGE_LIMIT|quota|usage limit/i.test(e));
