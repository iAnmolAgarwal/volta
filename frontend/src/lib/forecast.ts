/* The landing page's data: the next 24 hours from /api/predict on the first 24
 * sample rows. If the API cannot be reached, the bundled snapshot of the same
 * call is used, and `source` says so: the UI must label it, never pass it off as live.
 */

import sample24 from "@/data/sample24.json";
import snapshot from "@/data/snapshot.json";

export const STORAGE_MODE = "Renewable Storage Mode";
export const GRID_MODE = "Main Grid Mode";
export const STORAGE_ABOVE_KW = 160; // controller thresholds (backend/controller.py)
export const OVERLOAD_AT_KW = 200;
export const FORECAST_ERROR_KW = 8.5; // ± typical error: the target's noise σ (docs/model_report.md)

export type Mode = typeof STORAGE_MODE | typeof GRID_MODE;

export interface Hour {
  timestamp: string; // "2015-06-16 15:00:00"
  hour: number;
  predictionKw: number;
  mode: Mode;
  overload: boolean;
  socPct: number; // battery state of charge at the end of the hour
  pvKw: number;
  batteryKw: number; // > 0 discharging, < 0 charging
  gridKw: number;
}

export interface Forecast {
  source: "live" | "snapshot";
  hours: Hour[];
  peak: Hour;
  overloadHours: number;
  current: Hour; // the first hour: what the grid is doing "now"
}

interface PredictResponse {
  predictions: number[];
  signals: { timestamp: string; mode: Mode; overload: boolean }[];
  battery: { soc_end: number; pv_kw: number; battery_kw: number; grid_kw: number }[];
}

function toForecast(body: PredictResponse, source: Forecast["source"]): Forecast {
  const hours = body.predictions.map((p, i): Hour => {
    const s = body.signals[i];
    const b = body.battery[i];
    return {
      timestamp: s.timestamp,
      hour: Number(s.timestamp.slice(11, 13)),
      predictionKw: p,
      mode: s.mode,
      overload: s.overload,
      socPct: 100 * b.soc_end,
      pvKw: b.pv_kw,
      batteryKw: b.battery_kw,
      gridKw: b.grid_kw,
    };
  });
  if (hours.length === 0) throw new Error("empty forecast");
  const peak = hours.reduce((a, h) => (h.predictionKw > a.predictionKw ? h : a));
  return { source, hours, peak, overloadHours: hours.filter((h) => h.overload).length, current: hours[0] };
}

export const SNAPSHOT: Forecast = toForecast(snapshot as PredictResponse, "snapshot");

/** Live forecast, or the labelled snapshot after `timeoutMs` or any error. */
export async function loadForecast(timeoutMs = 8000): Promise<Forecast> {
  const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${base}/api/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: sample24 }),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const body = (await resp.json()) as PredictResponse;
    if (body.predictions?.length !== sample24.length) throw new Error("wrong number of predictions");
    return toForecast(body, "live");
  } catch (e) {
    console.warn("forecast: using the bundled snapshot", e);
    return SNAPSHOT;
  } finally {
    clearTimeout(timer);
  }
}
