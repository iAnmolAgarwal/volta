import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CircleCheck, Plus, Rows3, Trash2, X } from "lucide-react";
import { Field } from "@/components/app/Field";
import { GlassCard } from "@/components/app/GlassCard";
import { Pill } from "@/components/app/Pill";
import { EmptyState } from "@/components/app/States";
import { cellId, COLS, ROW_LIMIT, rowAfter, rowErrors, shortStamp, type Col, type Row } from "./profile";

/* The editable hours. On a desktop it is a real table on the moss glass, one
 * dock-glass Field per cell with its label kept for screen readers; on a phone
 * each hour becomes a small stacked group of the same Fields, labels shown.
 * Every cell is checked as it is typed, inline, in the Field idiom. */

const META: Record<Col, { label: string; head: string; unit?: string; mode?: "decimal" }> = {
  timestamp: { label: "Timestamp", head: "Timestamp" },
  temp: { label: "Temperature", head: "Temperature", unit: "°C", mode: "decimal" },
  hum: { label: "Humidity", head: "Humidity", unit: "%", mode: "decimal" },
  irr: { label: "Irradiance", head: "Irradiance", unit: "W/m²", mode: "decimal" },
};

export interface RowsTableProps {
  rows: Row[];
  onRows: (rows: Row[]) => void;
  onSubmit: () => void;
  busy?: boolean;
  delay?: number;
}

export function RowsTable({ rows, onRows, onSubmit, busy, delay }: RowsTableProps) {
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  useEffect(() => {
    const el = focus ? document.getElementById(focus.id) : null;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [focus]);
  const focusOn = (id: string) => setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));

  const errors = useMemo(() => rows.map(rowErrors), [rows]);
  const bad = errors.reduce((n, e) => n + Object.keys(e).length, 0);
  const firstBad = (() => {
    const i = errors.findIndex((e) => Object.keys(e).length > 0);
    if (i < 0) return null;
    const col = COLS.find((c) => errors[i][c]) ?? "timestamp";
    return cellId(rows[i].id, col);
  })();
  const n = rows.length;
  const full = n >= ROW_LIMIT;

  const edit = (id: number, col: Col, value: string) => onRows(rows.map((r) => (r.id === id ? { ...r, [col]: value } : r)));
  const add = () => {
    if (full) return;
    const next = rowAfter(rows[n - 1]);
    onRows([...rows, next]);
    focusOn(cellId(next.id, "timestamp"));
  };
  const remove = (k: number) => {
    const after = rows[k + 1] ?? rows[k - 1];
    onRows(rows.filter((_, i) => i !== k));
    if (after) focusOn(`vi-del-${after.id}`); // the last one gone, the empty state takes over
  };

  const status = n === 0 ? null : bad > 0 ? (
    <Pill tone="overload" size="sm" icon={X} onClick={() => firstBad && focusOn(firstBad)} aria-label={`${bad} ${bad === 1 ? "cell needs" : "cells need"} fixing; go to the first`}>
      {bad} {bad === 1 ? "cell" : "cells"} to fix
    </Pill>
  ) : (
    <Pill size="sm" icon={CircleCheck} className="vi-ok">Every cell reads</Pill>
  );

  return (
    <GlassCard
      label={n === 0 ? "Manual rows" : `Manual rows · ${n} ${n === 1 ? "hour" : "hours"}`}
      title={n === 0 ? "Nothing to forecast yet" : bad > 0 ? "Fix the marked cells" : "Check every hour, then forecast"}
      aside={n === 0 ? null : <>{status}<Pill size="sm" icon={Trash2} onClick={() => onRows([])} disabled={busy}>Clear</Pill></>}
      delay={delay}
      className="vi-rows"
      aria-busy={busy || undefined}
    >
      {n === 0 ? (
        <EmptyState
          surface="plain"
          icon={Rows3}
          title="No hours yet"
          action={<Pill icon={Plus} onClick={add} disabled={busy}>Start a blank hour</Pill>}
        >
          Generate a day above, or type your own hours one by one.
        </EmptyState>
      ) : (
        <>
          <table className="vi-table">
            <caption className="vi-sr">Manual telemetry rows. Temperature is required; humidity and irradiance may be left blank and are filled from the neighbouring hours.</caption>
            <thead>
              <tr>
                <th scope="col" className="vi-c-num">Hour</th>
                {COLS.map((c) => (
                  <th key={c} scope="col" className={`vi-c-${c}`}>
                    {META[c].head}
                    {META[c].unit && <span className="vi-unit"> · {META[c].unit}</span>}
                  </th>
                ))}
                <th scope="col" className="vi-c-del"><span className="vi-sr">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, k) => {
                const when = shortStamp(r.timestamp);
                const e = errors[k];
                return (
                  <tr key={r.id} className={Object.keys(e).length ? "is-bad" : undefined}>
                    <th scope="row" className="vi-c-num">
                      <span className="vi-num">{String(k + 1).padStart(2, "0")}</span>
                    </th>
                    {COLS.map((c) => (
                      <td key={c} className={`vi-c-${c}`}>
                        <Field
                          id={cellId(r.id, c)}
                          label={META[c].label}
                          aria-label={`Hour ${k + 1} ${META[c].label.toLowerCase()}`}
                          suffix={META[c].unit}
                          inputMode={META[c].mode}
                          autoComplete="off"
                          spellCheck={false}
                          value={r[c]}
                          placeholder={c === "timestamp" ? "2015-06-17 13:00" : c === "temp" ? "required" : "blank is fine"}
                          onChange={(ev) => edit(r.id, c, ev.target.value)}
                          error={e[c]}
                          disabled={busy}
                        />
                      </td>
                    ))}
                    <td className="vi-c-del">
                      <button
                        type="button"
                        id={`vi-del-${r.id}`}
                        className="vi-del"
                        onClick={() => remove(k)}
                        disabled={busy}
                        aria-label={`Remove hour ${k + 1}${when ? `, ${when}` : ""}`}
                      >
                        <X strokeWidth={1.5} aria-hidden />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="vi-rows-foot">
            <div className="vi-rows-tools">
              <Pill icon={Plus} onClick={add} disabled={busy || full} aria-label="Add an hour">Add<span className="vi-wide-only"> an hour</span></Pill>
              <p className="vi-note">{full ? `The API takes at most ${ROW_LIMIT.toLocaleString()} rows.` : "Blank humidity or irradiance is filled from the neighbouring hours."}</p>
            </div>
            <Pill icon={ArrowRight} tone="volt" onClick={onSubmit} disabled={busy || bad > 0} className="vi-send">
              {busy ? "Forecasting" : bad > 0 ? `Fix ${bad} ${bad === 1 ? "cell" : "cells"} first` : `Forecast ${n} ${n === 1 ? "hour" : "hours"}`}
            </Pill>
          </div>
        </>
      )}
    </GlassCard>
  );
}
