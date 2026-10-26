/* The Input screen's pure logic: the 24-hour generator, the browser-side checks
 * (the same rules the backend cleans by, docs/api.md "Cleaning"), and turning
 * table rows into the API's TelemetryRow. No React here. */

import { MAX_ROWS, type TelemetryRow } from "@/lib/api";

export const WINDOW_HOURS = 24;
export const TEMP_MIN = -60;
export const TEMP_MAX = 60;

/* ── the table's rows: strings, exactly as typed ─────────────────────────── */

export interface Row {
  id: number; // stable React key, never sent
  timestamp: string;
  temp: string;
  hum: string;
  irr: string;
}

export type Col = "timestamp" | "temp" | "hum" | "irr";
export const COLS: Col[] = ["timestamp", "temp", "hum", "irr"];

/** The DOM id of a table cell, so a rejected row in the report can lead back to it. */
export const cellId = (rowId: number, col: Col) => `vi-r${rowId}-${col}`;

let nextId = 1;
export const newId = () => nextId++;
/** After restoring rows from the session, keep new ids above the restored ones. */
export function bumpIds(rows: Row[]) {
  for (const r of rows) if (r.id >= nextId) nextId = r.id + 1;
}

/* ── timestamps: the layouts the backend reads ───────────────────────────── */

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const okDate = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);

const ISO = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(?:Z|[+-]\d{2}:?\d{2})?$/i;
const DMY = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?\s*(?:Z|[+-]\d{2}:?\d{2})?$/i;

/** Wall-clock parts of a readable timestamp, or null. Day-first wins a tie, as on the backend. */
export function readTimestamp(raw: string): { y: number; m: number; d: number; h: number; mi: number } | null {
  const s = raw.trim();
  let g = ISO.exec(s);
  if (g) {
    const [y, m, d] = [Number(g[1]), Number(g[2]), Number(g[3])];
    const h = g[4] ? Number(g[4]) : 0;
    const mi = g[5] ? Number(g[5]) : 0;
    if (!okDate(y, m, d) || h > 23 || mi > 59) return null;
    return { y, m, d, h, mi };
  }
  g = DMY.exec(s);
  if (g) {
    const [a, b, y] = [Number(g[1]), Number(g[2]), Number(g[3])];
    let h = Number(g[4]);
    const mi = Number(g[5]);
    const ampm = g[7]?.toUpperCase();
    if (ampm) {
      if (h < 1 || h > 12) return null;
      h = (h % 12) + (ampm === "PM" ? 12 : 0);
    }
    if (h > 23 || mi > 59) return null;
    if (okDate(y, b, a)) return { y, m: b, d: a, h, mi }; // DD/MM/YYYY
    if (okDate(y, a, b)) return { y, m: a, d: b, h, mi }; // MM/DD/YYYY
  }
  return null;
}

const utc = (t: { y: number; m: number; d: number; h: number; mi: number }) => Date.UTC(t.y, t.m - 1, t.d, t.h, t.mi);
const iso = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** "15:00 · 16 Jun" for a readable timestamp, or null. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortStamp(raw: string): string | null {
  const t = readTimestamp(raw);
  return t ? `${pad(t.h)}:${pad(t.mi)} · ${t.d} ${MONTHS[t.m - 1]}` : null;
}

/** The timestamp one hour after `raw` (ISO), or "" when `raw` can't be read. */
export function hourAfter(raw: string): string {
  const t = readTimestamp(raw);
  return t ? iso(utc(t) + 3600_000) : "";
}

/* ── cell checks ─────────────────────────────────────────────────────────── */

const num = (s: string) => (s.trim() === "" ? NaN : Number(s.trim()));

export function cellError(col: Col, value: string): string | null {
  const v = value.trim();
  switch (col) {
    case "timestamp":
      if (!v) return "Enter a timestamp";
      return readTimestamp(v) ? null : "Unreadable; try 2015-06-17 13:00";
    case "temp": {
      if (!v) return "Enter a temperature";
      const n = num(v);
      if (!Number.isFinite(n)) return "Not a number";
      return n < TEMP_MIN || n > TEMP_MAX ? "−60 to 60 °C" : null;
    }
    case "hum": {
      if (!v) return null; // optional: the backend interpolates a gap
      const n = num(v);
      if (!Number.isFinite(n)) return "Not a number";
      return n < 0 || n > 100 ? "0 to 100 %" : null;
    }
    case "irr": {
      if (!v) return null;
      const n = num(v);
      if (!Number.isFinite(n)) return "Not a number";
      return n < 0 ? "0 or more" : null;
    }
  }
}

export type RowErrors = Partial<Record<Col, string>>;

export function rowErrors(r: Row): RowErrors {
  const out: RowErrors = {};
  for (const c of COLS) {
    const e = cellError(c, r[c]);
    if (e) out[c] = e;
  }
  return out;
}

export function toTelemetry(rows: Row[]): TelemetryRow[] {
  const opt = (s: string) => (s.trim() === "" ? null : Number(s.trim()));
  return rows.map((r) => ({
    timestamp: r.timestamp.trim(),
    ambient_temp_c: Number(r.temp.trim()),
    humidity_pct: opt(r.hum),
    solar_irradiance_wm2: opt(r.irr),
  }));
}

/* ── the generator ───────────────────────────────────────────────────────── */

export type Shape = "single" | "profile";

export interface GenSpec {
  start: string; // any readable timestamp; shown and generated as ISO 24-hour, "2015-06-17 00:00"
  temp: { shape: Shape; value: string; low: string; high: string };
  hum: { shape: Shape; value: string; low: string; high: string };
  irr: { shape: Shape; value: string; peak: string; rise: string; set: string };
}

export const DEFAULT_SPEC: GenSpec = {
  start: "2015-06-17 00:00",
  temp: { shape: "profile", value: "32", low: "27", high: "38" },
  hum: { shape: "profile", value: "60", low: "42", high: "78" },
  irr: { shape: "profile", value: "200", peak: "850", rise: "6", set: "19" },
};

/** Where each daily curve turns: Sylva-calm cosines, warmest at 15:00, most humid at 03:00. */
export const WARMEST_HOUR = 15;

export type SpecErrors = Partial<Record<"start" | "tempValue" | "tempLow" | "tempHigh" | "humValue" | "humLow" | "humHigh" | "irrValue" | "irrPeak" | "irrRise" | "irrSet", string>>;

function inRange(s: string, lo: number, hi: number, unit: string, required = true): string | null {
  if (s.trim() === "") return required ? "Required" : null;
  const n = num(s);
  if (!Number.isFinite(n)) return "Not a number";
  if (n < lo || n > hi) return hi === Infinity ? `${lo} or more` : `${lo === TEMP_MIN ? "−60" : lo} to ${hi} ${unit}`.trim();
  return null;
}

export function specErrors(s: GenSpec): SpecErrors {
  const e: SpecErrors = {};
  const set = (k: keyof SpecErrors, v: string | null) => { if (v) e[k] = v; };
  set("start", s.start.trim() === "" ? "Enter the first hour" : readTimestamp(s.start) ? null : "Unreadable; try 2015-06-17 00:00");
  if (s.temp.shape === "single") set("tempValue", inRange(s.temp.value, TEMP_MIN, TEMP_MAX, "°C"));
  else {
    set("tempLow", inRange(s.temp.low, TEMP_MIN, TEMP_MAX, "°C"));
    set("tempHigh", inRange(s.temp.high, TEMP_MIN, TEMP_MAX, "°C"));
    if (!e.tempLow && !e.tempHigh && num(s.temp.low) > num(s.temp.high)) e.tempHigh = "At least the low";
  }
  if (s.hum.shape === "single") set("humValue", inRange(s.hum.value, 0, 100, "%"));
  else {
    set("humLow", inRange(s.hum.low, 0, 100, "%"));
    set("humHigh", inRange(s.hum.high, 0, 100, "%"));
    if (!e.humLow && !e.humHigh && num(s.hum.low) > num(s.hum.high)) e.humHigh = "At least the low";
  }
  if (s.irr.shape === "single") set("irrValue", inRange(s.irr.value, 0, Infinity, ""));
  else {
    set("irrPeak", inRange(s.irr.peak, 0, Infinity, ""));
    set("irrRise", inRange(s.irr.rise, 0, 23, "h"));
    set("irrSet", inRange(s.irr.set, 1, 24, "h"));
    if (!e.irrRise && !e.irrSet && num(s.irr.rise) >= num(s.irr.set)) e.irrSet = "After sunrise";
  }
  return e;
}

const r1 = (n: number) => String(Math.round(n * 10) / 10);

/** 24 hourly rows from a valid spec. */
export function generate(s: GenSpec): Row[] {
  const t0 = readTimestamp(s.start);
  if (!t0) return [];
  const base = utc({ ...t0, mi: 0 });
  const wave = (h: number) => Math.cos((2 * Math.PI * (h - WARMEST_HOUR)) / 24); // 1 at 15:00, −1 at 03:00
  const out: Row[] = [];
  for (let i = 0; i < WINDOW_HOURS; i++) {
    const ms = base + i * 3600_000;
    const h = new Date(ms).getUTCHours();
    const temp = s.temp.shape === "single"
      ? num(s.temp.value)
      : (num(s.temp.low) + num(s.temp.high)) / 2 + ((num(s.temp.high) - num(s.temp.low)) / 2) * wave(h);
    const hum = s.hum.shape === "single"
      ? num(s.hum.value)
      : (num(s.hum.low) + num(s.hum.high)) / 2 - ((num(s.hum.high) - num(s.hum.low)) / 2) * wave(h);
    let irr: number;
    if (s.irr.shape === "single") irr = num(s.irr.value);
    else {
      const rise = num(s.irr.rise);
      const set = num(s.irr.set);
      irr = h > rise && h < set ? num(s.irr.peak) * Math.sin((Math.PI * (h - rise)) / (set - rise)) : 0;
    }
    out.push({ id: newId(), timestamp: iso(ms), temp: r1(temp), hum: r1(hum), irr: String(Math.round(irr)) });
  }
  return out;
}

/** A row one hour after the last, carrying its weather forward (or a blank row). */
export function rowAfter(last: Row | undefined): Row {
  if (!last) return { id: newId(), timestamp: "", temp: "", hum: "", irr: "" };
  return { ...last, id: newId(), timestamp: hourAfter(last.timestamp) };
}

/** How many data rows a CSV holds (non-blank lines after the header). */
export function csvRowCount(text: string): number {
  let n = 0;
  for (const line of text.split(/\r?\n/)) if (line.trim()) n++;
  return Math.max(n - 1, 0);
}

export const ROW_LIMIT = MAX_ROWS;
