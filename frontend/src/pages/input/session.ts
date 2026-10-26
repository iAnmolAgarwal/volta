/* The screen's work survives a trip to the dashboard and back: the day form,
 * the edited rows and the last report are kept for the tab's session. Every
 * read and write is guarded; without storage the page simply starts fresh. */

import type { Run } from "@/lib/api";
import type { What } from "./errors";
import { bumpIds, DEFAULT_SPEC, type GenSpec, type Row } from "./profile";

const DRAFT_KEY = "volta:input:draft";
const LAST_KEY = "volta:input:last";

export interface Draft {
  spec: GenSpec;
  rows: Row[];
  fileName: string | null;
}

export interface Last {
  what: What;
  run: Run;
  posted?: number[];
  stashed: boolean;
}

function read<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or full: the page keeps working without it */
  }
}

export function loadDraft(): Draft {
  const d = read<Partial<Draft>>(DRAFT_KEY);
  const rows = Array.isArray(d?.rows) ? d.rows.filter((r) => r && typeof r.id === "number") : [];
  bumpIds(rows);
  const spec = d?.spec && typeof d.spec.start === "string" ? { ...DEFAULT_SPEC, ...d.spec } : DEFAULT_SPEC;
  return { spec, rows, fileName: typeof d?.fileName === "string" ? d.fileName : null };
}

export const saveDraft = (d: Draft) => write(DRAFT_KEY, d);

export function loadLast(): Last | null {
  const l = read<Last>(LAST_KEY);
  return l && l.run && Array.isArray(l.run.hours) && l.run.cleaning ? l : null;
}

export const saveLast = (l: Last) => write(LAST_KEY, l);
