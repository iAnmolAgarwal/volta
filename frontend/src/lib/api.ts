/* The typed client for the Microgrid API. The contract is docs/api.md.
 *
 * CORS (M2 spec, "Routing and the API"): the Catalyst gateway answers preflights
 * itself, without CORS headers, so every browser request must be a "simple"
 * one. JSON bodies therefore go out as text/plain;charset=UTF-8 (the backend
 * force-parses them), there are no custom headers, and CSV uploads stay
 * multipart FormData (the browser sets that boundary header itself).
 *
 * Every failure is thrown as an ApiError with a `kind`, the HTTP status and the
 * backend's `{error, details}`, so a screen can say exactly what went wrong.
 */

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

/* ── response types (docs/api.md) ─────────────────────────────────────────── */

export const STORAGE = "Renewable Storage Mode";
export const GRID = "Main Grid Mode";
export type ModeName = typeof STORAGE | typeof GRID;

export const CAPACITY_KWH = 800; // docs/battery.md, capacity_kwh
export const MIN_SOC_PCT = 10; // docs/battery.md, min_soc
export const STORAGE_ABOVE_KW = 160; // the controller (backend/controller.py)
export const OVERLOAD_AT_KW = 200;
export const PEAK_HOURS = [18, 22] as const; // Renewable Storage Mode, inclusive
export const MAX_ROWS = 2000;

export type RunSource = "csv" | "sample" | "manual";

/** One forecast hour. `battery_kw` > 0 is discharging, < 0 charging. */
export interface RunHour {
  index: number;
  timestamp: string; // "2015-06-16 18:00:00", local clock time
  hour: number;
  ambient_temp_c: number;
  humidity_pct: number;
  solar_irradiance_wm2: number;
  prediction_kw: number;
  mode: ModeName;
  overload: boolean;
  soc_pct: number;
  pv_kw: number; // runs saved before the PV model store null; the client reads that as 0
  battery_kw: number;
  grid_kw: number;
  reason: string;
}

export interface RunMeta {
  id: string;
  created: string;
  saved: boolean;
  source: RunSource;
  filename: string | null;
  csv_key: string | null;
  errors?: string[];
}

export interface CleaningFix {
  code: string;
  label: string;
  count: number;
}

export interface RejectedRow {
  row: number; // 1-based; for a CSV, row 1 is the line after the header
  reason: string;
}

export interface Cleaning {
  rows_in: number;
  rows_out: number;
  timestamp_formats: Record<string, number>;
  fixes: CleaningFix[];
  rejected_count: number;
  rejected: RejectedRow[]; // at most 50 listed; rejected_count is complete
}

export interface RunSummary {
  n_hours: number;
  start: string;
  end: string;
  peak_kw: number;
  peak_timestamp: string;
  storage_hours: number;
  grid_hours: number;
  overload_count: number;
  switch_count: number;
  min_soc_pct: number;
}

export interface RunWindow {
  start: number;
  end: number;
  size: number;
  hours: RunHour[];
}

export interface SwitchEvent {
  index: number;
  timestamp: string;
  from: ModeName;
  to: ModeName;
  label: string;
}

export interface OverloadAlert {
  index: number;
  timestamp: string;
  prediction_kw: number;
  label: string;
}

/** The body of POST /api/forecast and GET /api/runs/{id}. */
export interface Run {
  run: RunMeta;
  cleaning: Cleaning;
  summary: RunSummary;
  window: RunWindow;
  hours: RunHour[];
  switch_events: SwitchEvent[];
  overload_alerts: OverloadAlert[];
}

/** A row of GET /api/runs. */
export interface RunListItem {
  id: string;
  created: string;
  source: RunSource;
  filename: string | null;
  rows_in: number;
  n_rows: number;
  peak_kw: number;
  peak_timestamp: string;
  overload_count: number;
  storage_hours: number;
  switch_count: number;
  start: string;
  end: string;
  csv_key: string | null;
}

/** A manual telemetry row. Values may be strings; the backend cleans them. */
export interface TelemetryRow {
  timestamp: string;
  ambient_temp_c: number | string | null;
  humidity_pct?: number | string | null;
  solar_irradiance_wm2?: number | string | null;
}

/** POST /api/predict: predict.py's contract. */
export interface PredictResponse {
  predictions: number[];
  signals: { timestamp: string; mode: ModeName; overload: boolean }[];
  battery: { soc_end: number; pv_kw: number; battery_kw: number; grid_kw: number }[];
}

/* ── errors ───────────────────────────────────────────────────────────────── */

export type ApiErrorKind =
  | "bad_request" // 400: the input or window is unusable; `details` lists why
  | "not_found" // 404: no such run
  | "too_large" // 413: more than 2,000 rows
  | "upstream" // 502: QuickML or the Data Store failed; there is no made-up forecast
  | "not_configured" // 503: QuickML or the store is not configured
  | "server" // any other non-2xx
  | "network" // no response at all
  | "timeout" // gave up waiting
  | "parse"; // a 2xx whose body was not the JSON we expected

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number; // 0 when there was no response
  readonly details: string[];

  constructor(kind: ApiErrorKind, message: string, status = 0, details: string[] = []) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.details = details;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

function kindOf(status: number): ApiErrorKind {
  if (status === 400) return "bad_request";
  if (status === 404) return "not_found";
  if (status === 413) return "too_large";
  if (status === 502) return "upstream";
  if (status === 503) return "not_configured";
  return "server";
}

/** A short, human headline for an error kind (the backend's message goes underneath). */
export function errorTitle(e: ApiError): string {
  switch (e.kind) {
    case "bad_request": return "The input could not be used";
    case "not_found": return "That run no longer exists";
    case "too_large": return `Too many rows (at most ${MAX_ROWS.toLocaleString()})`;
    case "upstream": return "The forecast service failed";
    case "not_configured": return "The forecast service is not configured";
    case "network": return "The API could not be reached";
    case "timeout": return "The API took too long to answer";
    case "parse": return "The API sent an unexpected answer";
    default: return "Something went wrong";
  }
}

/* ── transport ────────────────────────────────────────────────────────────── */

interface CallOpts {
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function call(path: string, init: RequestInit, { signal, timeoutMs = 20000 }: CallOpts = {}): Promise<Response> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const resp = await fetch(`${BASE}${path}`, { ...init, signal: ctrl.signal });
    if (!resp.ok) {
      let message = `HTTP ${resp.status}`;
      let details: string[] = [];
      try {
        const body = (await resp.json()) as { error?: unknown; details?: unknown };
        if (typeof body.error === "string") message = body.error;
        if (Array.isArray(body.details)) details = body.details.map(String);
      } catch {
        /* not JSON (a gateway page): keep the status line */
      }
      throw new ApiError(kindOf(resp.status), message, resp.status, details);
    }
    return resp;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (signal?.aborted) throw e; // the caller cancelled: let its AbortError through
    if (timedOut) throw new ApiError("timeout", `no answer after ${Math.round(timeoutMs / 1000)} s`);
    throw new ApiError("network", e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function json<T>(resp: Response): Promise<T> {
  try {
    return (await resp.json()) as T;
  } catch {
    throw new ApiError("parse", "the response was not JSON", resp.status);
  }
}

/** A JSON POST as a CORS "simple" request: text/plain, no custom headers. */
function postJson(path: string, body: unknown, opts?: CallOpts) {
  return call(path, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(body) }, opts);
}

const qs = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
};

function normaliseRun(run: Run): Run {
  const fix = (h: RunHour): RunHour => ({ ...h, pv_kw: h.pv_kw ?? 0 });
  if (!run || !Array.isArray(run.hours) || !run.window) throw new ApiError("parse", "the run is missing its hours");
  return { ...run, hours: run.hours.map(fix), window: { ...run.window, hours: run.window.hours.map(fix) } };
}

/* ── endpoints ────────────────────────────────────────────────────────────── */

const FORECAST_TIMEOUT = 90000; // a 1,000-row run calls QuickML and saves to the Data Store

export interface ForecastCsvOpts extends CallOpts {
  source?: "csv" | "sample";
  windowStart?: number | string;
  filename?: string;
}

/** POST /api/forecast with a CSV upload (multipart). */
export async function forecastCsv(file: Blob, { source = "csv", windowStart, filename, ...opts }: ForecastCsvOpts = {}): Promise<Run> {
  const form = new FormData();
  form.append("file", file, filename ?? (file instanceof File ? file.name : "upload.csv"));
  form.append("source", source);
  if (windowStart !== undefined) form.append("window_start", String(windowStart));
  const resp = await call("/api/forecast", { method: "POST", body: form }, { timeoutMs: FORECAST_TIMEOUT, ...opts });
  return normaliseRun(await json<Run>(resp));
}

/** POST /api/forecast with manual rows (JSON, sent as text/plain). */
export async function forecastRows(rows: TelemetryRow[], { windowStart, ...opts }: { windowStart?: number | string } & CallOpts = {}): Promise<Run> {
  const body: Record<string, unknown> = { rows };
  if (windowStart !== undefined) body.window_start = windowStart;
  const resp = await postJson("/api/forecast", body, { timeoutMs: FORECAST_TIMEOUT, ...opts });
  return normaliseRun(await json<Run>(resp));
}

/** GET /api/sample: the bundled 1,000-hour sample CSV. */
export async function getSample(opts?: CallOpts): Promise<Blob> {
  const resp = await call("/api/sample", { method: "GET" }, opts);
  return resp.blob();
}

export const SAMPLE_FILENAME = "sample_test_input.csv";

/** "Use sample data": fetch the sample CSV, then forecast it with source=sample. */
export async function forecastSample(opts: Omit<ForecastCsvOpts, "source" | "filename"> = {}): Promise<Run> {
  const csv = await getSample(opts);
  return forecastCsv(csv, { ...opts, source: "sample", filename: SAMPLE_FILENAME });
}

/** GET /api/runs: the latest 20 runs, newest first. */
export async function listRuns(opts?: CallOpts): Promise<RunListItem[]> {
  const body = await json<{ runs?: RunListItem[] }>(await call("/api/runs", { method: "GET" }, opts));
  if (!Array.isArray(body.runs)) throw new ApiError("parse", "the run list is missing");
  return body.runs;
}

/** GET /api/runs/{id}, optionally with the window starting at an hour index or a timestamp. */
export async function getRun(id: string, { windowStart, ...opts }: { windowStart?: number | string } & CallOpts = {}): Promise<Run> {
  const resp = await call(`/api/runs/${encodeURIComponent(id)}${qs({ window_start: windowStart })}`, { method: "GET" }, { timeoutMs: 30000, ...opts });
  return normaliseRun(await json<Run>(resp));
}

/** POST /api/predict: predict.py's contract, `{rows}` in, predictions + signals + battery out. */
export async function predict(rows: TelemetryRow[], opts?: CallOpts): Promise<PredictResponse> {
  return json<PredictResponse>(await postJson("/api/predict", { rows }, { timeoutMs: FORECAST_TIMEOUT, ...opts }));
}

/* ── the viewer's last run (localStorage; never required) ─────────────────── */

const LAST_RUN_KEY = "volta:lastRunId";

export function getLastRunId(): string | null {
  try {
    return window.localStorage.getItem(LAST_RUN_KEY);
  } catch {
    return null;
  }
}

export function setLastRunId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(LAST_RUN_KEY, id);
    else window.localStorage.removeItem(LAST_RUN_KEY);
  } catch {
    /* private mode or blocked storage: the dashboard falls back to its empty state */
  }
}

/* ── small shared readers ─────────────────────────────────────────────────── */

export const isStorage = (m: ModeName) => m === STORAGE;
/** "Renewable Storage" / "Main Grid", the short form the landing uses. */
export const shortMode = (m: ModeName) => (m === STORAGE ? "Renewable Storage" : "Main Grid");
/** "18:00" from "2015-06-16 18:00:00". */
export const hhmm = (ts: string) => ts.slice(11, 16);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "16 Jun" from "2015-06-16 18:00:00". */
export const dayMonth = (ts: string) => `${Number(ts.slice(8, 10))} ${MONTHS[Number(ts.slice(5, 7)) - 1] ?? ""}`;
