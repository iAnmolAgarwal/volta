/* The route a post takes, as the busy card shows it. Only what the browser can
 * see finish gets its own step; the server's work is one step, because the API
 * does it in one request and reports no progress. */

import type { What } from "./errors";

export const STEP_SERVER = "Cleaning, QuickML, controller, saving";
export const STEP_REPORT = "The report";

/** The steps for a post, and the one in progress when it starts. */
export function stepsFor(what: What, opts: { rows?: number; fileName?: string } = {}): { steps: string[]; at: number } {
  if (what === "manual") {
    const n = opts.rows ?? 0;
    // the rows were validated before the button could be pressed: that step has really finished
    return { steps: [`${n.toLocaleString()} ${n === 1 ? "row" : "rows"} checked here`, STEP_SERVER, STEP_REPORT], at: 1 };
  }
  if (what === "csv") return { steps: [`Reading ${opts.fileName ?? "the file"}`, STEP_SERVER, STEP_REPORT], at: 0 };
  return { steps: ["Fetching the sample", STEP_SERVER, STEP_REPORT], at: 0 };
}
