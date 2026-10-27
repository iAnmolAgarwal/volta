/* How a saved run is labelled, the same on the Input run card, the Dashboard's
 * header chip and the History cards: just "Saved". Where it is kept is in the
 * title (hover and screen readers). The Data Store's quota story is in the
 * README and docs/api.md, and the API still reports run.storage; it is not
 * repeated on every card. "Not saved" (run.saved false) keeps its own honest
 * treatment where it is shown. */

export interface StoreFlags {
  stratus?: boolean;
  datastore?: boolean;
  reason?: string | null;
}

export const STRATUS_LABEL = "Saved";

/** The quiet title behind the label: where the run is kept. */
export function stratusNote(st: StoreFlags | undefined): string {
  return st?.datastore === true ? "Saved in Stratus, with a metadata row in the Data Store." : "Saved in Stratus.";
}
