/* Plain copy for a failed post. The card names what failed (your hours, the
 * file, the sample) and says what happened in words, not "Failed to fetch";
 * the API's own `details` (why rows were refused) are kept underneath. */

import { ApiError, MAX_ROWS } from "@/lib/api";

export type What = "manual" | "csv" | "sample";

/** "Your 24 hours", "telemetry.csv", "The sample". */
export function subjectOf(what: What, name?: string): string {
  if (what === "csv") return name ?? "Your CSV";
  if (what === "sample") return "The sample";
  return name ?? "Your hours";
}

export interface ErrorCopy {
  title: string;
  /** An ApiError carrying the plain message, the HTTP status and the details, for ErrorState. */
  error: ApiError | Error;
  /** Whether trying the same thing again could work. */
  retryable: boolean;
}

export function describeError(subject: string, e: unknown): ErrorCopy {
  const title = `${subject} ${subject.startsWith("Your ") && subject.endsWith("hours") ? "weren't" : "wasn't"} forecast`;
  if (!(e instanceof ApiError)) {
    // a browser-side refusal (wrong file type, unreadable file): its message is already plain
    return { title, error: e instanceof Error ? e : new Error(String(e)), retryable: false };
  }
  const plain = (msg: string) => new ApiError(e.kind, msg, e.status, e.details);
  switch (e.kind) {
    case "network":
      return { title, error: plain("Couldn't reach the forecast service, so nothing was sent. Check your connection and try again."), retryable: true };
    case "timeout":
      return { title, error: plain("The forecast service didn't answer in time. Try again in a moment."), retryable: true };
    case "upstream":
      return { title, error: plain("QuickML didn't return a forecast, and VOLTA never makes one up. Nothing was saved; try again in a moment."), retryable: true };
    case "not_configured":
      return { title, error: plain("The forecast service isn't set up on the server right now, so nothing was forecast."), retryable: true };
    case "bad_request":
      return { title, error: plain(e.details.length ? "None of the rows could be used. The cleaner's reasons:" : `The API refused the input: ${e.message}.`), retryable: false };
    case "too_large":
      return { title, error: plain(e.status ? `More than ${MAX_ROWS.toLocaleString()} rows. Trim it and try again.` : e.message), retryable: false };
    case "parse":
      return { title, error: plain("The forecast service sent an answer that couldn't be read. Try again."), retryable: true };
    default:
      return { title, error: plain(`The forecast service failed (${e.message}). Try again in a moment.`), retryable: true };
  }
}
