import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowUpRight, History, Sparkles } from "lucide-react";
import { GlassCard } from "@/components/app/GlassCard";
import { PageHeader } from "@/components/app/PageHeader";
import { Pill } from "@/components/app/Pill";
import { EmptyState, ErrorState, Shimmer } from "@/components/app/States";
import { dayMonth, getLastRunId, hhmm, listRuns, setLastRunId, type RunListItem } from "@/lib/api";
import { WORDMARK } from "@/lib/brand";

/* PLACEHOLDER for the History screen (M2): the saved runs from /api/runs as
 * Sylva's paper Field-Note cards, each with its knob into the dashboard. The
 * History screen builder replaces this page. */

type Load = { state: "loading" } | { state: "error"; error: unknown } | { state: "ready"; runs: RunListItem[] };

const SOURCE = { sample: "Sample", csv: "CSV upload", manual: "Manual" } as const;
const created = (iso: string) => `${dayMonth(iso.replace("T", " "))} · ${iso.slice(11, 16)}`;

export default function HistoryPage() {
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const last = getLastRunId();

  useEffect(() => {
    document.title = `History · ${WORDMARK}`;
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoad({ state: "loading" });
    listRuns({ signal: ctrl.signal })
      .then((runs) => setLoad({ state: "ready", runs }))
      .catch((error) => {
        if (!ctrl.signal.aborted) setLoad({ state: "error", error });
      });
    return () => ctrl.abort();
  }, [attempt]);

  const open = (id: string) => {
    setLastRunId(id);
    navigate(`/dashboard?run=${id}`);
  };

  return (
    <div className="va-page">
      <PageHeader eyebrow="History" title="Saved runs" lede="Every forecast is kept in the Data Store, its upload in Stratus. Open one to replay its controller decisions." />
      {load.state === "loading" && (
        <div className="va-history-grid">
          <Shimmer /><Shimmer /><Shimmer />
        </div>
      )}
      {load.state === "error" && <ErrorState error={load.error} action={<Pill onClick={() => setAttempt((a) => a + 1)}>Retry</Pill>} />}
      {load.state === "ready" && load.runs.length === 0 && (
        <EmptyState icon={History} title="No runs saved yet" action={<Pill icon={Sparkles} tone="volt" to="/dashboard">Start with the sample</Pill>}>
          Runs appear here as soon as a forecast is saved.
        </EmptyState>
      )}
      {load.state === "ready" && load.runs.length > 0 && (
        <ol className="va-history-grid">
          {load.runs.map((r, k) => (
            <li key={r.id}>
              <GlassCard
                as="article"
                variant="paper"
                delay={380 + Math.min(k, 8) * 70}
                label={`${SOURCE[r.source] ?? r.source} · ${created(r.created)}`}
                title={r.filename ?? "Manual rows"}
                knob={{ label: `Open run ${r.id.slice(-6)} on the dashboard`, icon: ArrowUpRight, onClick: () => open(r.id) }}
                className="va-history-card"
              >
                <dl className="va-history-stats">
                  <div><dt>Hours</dt><dd>{r.n_rows.toLocaleString()}</dd></div>
                  <div><dt>Peak</dt><dd>{r.peak_kw.toFixed(1)} kW</dd></div>
                  <div><dt>Overloads</dt><dd>{r.overload_count.toLocaleString()}</dd></div>
                </dl>
                <p className="va-history-span">{hhmm(r.start)} {dayMonth(r.start)} – {hhmm(r.end)} {dayMonth(r.end)}</p>
                {r.id === last && <Pill size="sm">Last opened</Pill>}
              </GlassCard>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
