/* Plain copy for a failed post. The card names what failed (your hours, the
 * file, the sample) and says what happened in words, not "Failed to fetch".
 * When the server said why ("missing required column(s): timestamp"), its own
 * message is the card's line, never a bare "HTTP 400"; the API's `details`
 * (the columns it found, why rows were refused) are kept underneath. */

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

/** The server's own message, as a sentence, when it sent one: not the "HTTP 400"
 * status line the client falls back to for a body that isn't JSON, and not a
 * message the browser made up (no response, or an unreadable one). */
export function serverSaid(e: ApiError): string | null {
  if (e.status <= 0 || e.kind === "parse") return null;
  const msg = e.message.trim();
  if (!msg || msg === `HTTP ${e.status}`) return null;
  return msg.charAt(0).toUpperCase() + msg.slice(1);
}

/** "…: timestamp" + ". Try again." without doubling a full stop. */
const then = (said: string, next: string) => `${said}${/[.!?]$/.test(said) ? "" : "."} ${next}`;

export function describeError(subject: string, e: unknown): ErrorCopy {
  const title = `${subject} ${subject.startsWith("Your ") && subject.endsWith("hours") ? "weren't" : "wasn't"} forecast`;
  if (!(e instanceof ApiError)) {
    // a browser-side refusal (wrong file type, unreadable file): its message is already plain
    return { title, error: e instanceof Error ? e : new Error(String(e)), retryable: false };
  }
  const plain = (msg: string) => new ApiError(e.kind, msg, e.status, e.details);
  const said = serverSaid(e);
  switch (e.kind) {
    case "network":
      return { title, error: plain("Couldn't reach the forecast service, so nothing was sent. Check your connection and try again."), retryable: true };
    case "timeout":
      return { title, error: plain("The forecast service didn't answer in time. Try again in a moment."), retryable: true };
    case "upstream":
      return { title, error: plain("QuickML didn't return a forecast, and VOLTA never makes one up. Nothing was saved; try again in a moment."), retryable: true };
    case "not_configured":
      return { title, error: plain(said ? then(said, "Nothing was forecast.") : "The forecast service isn't set up on the server right now, so nothing was forecast."), retryable: true };
    case "bad_request":
      // the server's reason is the line itself; its details (columns found, refused rows) follow
      return { title, error: plain(said ?? "The API refused the input without saying why. Check the four columns and try again."), retryable: false };
    case "too_large":
      if (!e.status) return { title, error: plain(e.message), retryable: false }; // refused here, before sending: already plain
      return { title, error: plain(then(said ?? `More than ${MAX_ROWS.toLocaleString()} rows`, "Trim it and try again.")), retryable: false };
    case "quota":
      return { title, error: plain(said ? then(said, "Nothing was sent to QuickML.") : "This month's demo forecast quota is used up, so nothing was sent to QuickML."), retryable: false };
    case "parse":
      return { title, error: plain("The forecast service sent an answer that couldn't be read. Try again."), retryable: true };
    default:
      return { title, error: plain(said ? `The forecast service failed: ${then(said, "Try again in a moment.")}` : "The forecast service failed. Try again in a moment."), retryable: true };
  }
}
