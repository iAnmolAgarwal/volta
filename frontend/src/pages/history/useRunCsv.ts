import { useCallback, useEffect, useRef, useState } from "react";
import { getRun, isApiError, type RunHour } from "@/lib/api";
import { downloadCsv, runCsv, runCsvName } from "@/lib/csv";

/* "Download CSV" on a History card: the list has no hours, so the first click
 * reads the run once (GET /api/runs/{id}) and keeps its hours, so a second
 * click downloads again without another request. Nothing is fetched until the
 * viewer asks. Leaving the page aborts a read in flight. */

export type CsvState = { state: "idle" } | { state: "busy" } | { state: "error"; message: string };

function errorText(e: unknown): string {
  if (isApiError(e)) {
    if (e.kind === "network") return "Couldn't reach the API, so no CSV was made. Check the connection and retry.";
    if (e.kind === "timeout") return "The API took too long to answer, so no CSV was made. Retry in a moment.";
    if (e.kind === "not_found") return "This run is no longer stored, so there is no CSV to make.";
    if (e.status) return `The run couldn't be read (HTTP ${e.status}), so no CSV was made.`;
  }
  return "The run couldn't be read, so no CSV was made.";
}

export function useRunCsv(id: string) {
  const [status, setStatus] = useState<CsvState>({ state: "idle" });
  const hours = useRef<RunHour[] | null>(null);
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => () => inflight.current?.abort(), []);

  const download = useCallback(async () => {
    if (inflight.current) return; // already reading
    if (hours.current) {
      downloadCsv(runCsvName(id), runCsv(hours.current));
      return;
    }
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setStatus({ state: "busy" });
    try {
      const run = await getRun(id, { signal: ctrl.signal });
      hours.current = run.hours;
      downloadCsv(runCsvName(id), runCsv(run.hours));
      setStatus({ state: "idle" });
    } catch (e) {
      if (!ctrl.signal.aborted) setStatus({ state: "error", message: errorText(e) });
    } finally {
      if (inflight.current === ctrl) inflight.current = null;
    }
  }, [id]);

  return { status, download };
}
