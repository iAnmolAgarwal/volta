/* How a saved run's home is said, the same on the Input run card, the
 * Dashboard's header chip and the History cards: neutrally, never as a
 * failure. Runs live in Stratus; the Data Store's metadata row is optional, and
 * when its free-tier insert quota is spent the row is simply not written. So a
 * run in Stratus reads "Saved · stored in Stratus", with a quiet note on why
 * the Data Store has no row. "Not saved" (run.saved false) is not this case and
 * keeps its own honest treatment where it is shown. */

export interface StoreFlags {
  stratus?: boolean;
  datastore?: boolean;
  reason?: string | null;
}

export const STRATUS_LABEL = "Saved · stored in Stratus";

/** The month a quota counts in, and the next one's short name: ["October", "Nov"]. On the UTC clock the store uses. */
function monthsOf(created?: string): [string, string] {
  const t = created ? Date.parse(created) : NaN;
  const d = Number.isFinite(t) ? new Date(t) : new Date();
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return [d.toLocaleString("en-GB", { month: "long", timeZone: "UTC" }), next.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })];
}

/** The quiet note under or behind the label: why the run is in Stratus alone, or that its row is in the Data Store too. */
export function stratusNote(st: StoreFlags | undefined, created?: string): string {
  if (st?.datastore === true) return "Runs are kept in Stratus; this one's metadata row is also in the Data Store.";
  if (st?.datastore === false && /quota/i.test(st.reason ?? "")) {
    const [month, next] = monthsOf(created);
    return `The Data Store's free-tier insert quota is used up for ${month}; it resets on 1 ${next}. Runs are kept in Stratus meanwhile.`;
  }
  if (st?.datastore === false && st.reason) return `Runs are kept in Stratus; the Data Store holds no row for this one (${st.reason.replace(/^data store\s*/i, "")}).`;
  return "Runs are kept in Stratus.";
}
