import type { RunHour } from "./api";

/* A run's results as CSV, for "Download CSV" on the dashboard and the History cards.
 * One row per hour, in run order: the input telemetry, the QuickML prediction, the
 * controller's signal and the battery model, with the controller's reason last. */

const COLUMNS: [header: string, value: (h: RunHour) => string | number | boolean][] = [
  ["timestamp", (h) => h.timestamp],
  ["ambient_temp_c", (h) => h.ambient_temp_c],
  ["humidity_pct", (h) => h.humidity_pct],
  ["solar_irradiance_wm2", (h) => h.solar_irradiance_wm2],
  ["target_demand_kw", (h) => h.prediction_kw],
  ["grid_mode", (h) => h.mode],
  ["critical_overload", (h) => h.overload],
  ["soc_pct", (h) => h.soc_pct],
  ["grid_kw", (h) => h.grid_kw],
  ["battery_kw", (h) => h.battery_kw],
  ["pv_kw", (h) => h.pv_kw ?? 0],
  ["reason", (h) => h.reason],
];

function cell(v: string | number | boolean | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function runCsv(hours: RunHour[]): string {
  const lines = [COLUMNS.map(([h]) => h).join(",")];
  for (const h of hours) lines.push(COLUMNS.map(([, f]) => cell(f(h))).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** "volta-run-r20261026211443-80ddd5.csv", or "volta-forecast-unsaved.csv". */
export const runCsvName = (id: string | null) => `volta-${id ? `run-${id}` : "forecast-unsaved"}.csv`;

/** Hands the CSV to the browser as a download; nothing is sent anywhere. */
export function downloadCsv(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
