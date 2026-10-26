import { useEffect, useState } from "react";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { DropZone } from "@/components/app/DropZone";
import { Field } from "@/components/app/Field";
import { GlassCard } from "@/components/app/GlassCard";
import { LogItem } from "@/components/app/LogItem";
import { PageHeader } from "@/components/app/PageHeader";
import { Pill } from "@/components/app/Pill";
import { ErrorState } from "@/components/app/States";
import { forecastCsv, forecastSample, MAX_ROWS, setLastRunId, type Run } from "@/lib/api";
import { WORDMARK } from "@/lib/brand";

/* PLACEHOLDER for the Input screen (M2): a live CSV upload and "Use sample
 * data" through the typed client, the cleaning report, and the Field look. The
 * Input screen builder replaces this page (with the 24-hour manual form). */

type Post = { state: "idle" } | { state: "busy"; what: string } | { state: "error"; error: unknown } | { state: "done"; run: Run };

export default function InputPage() {
  const [post, setPost] = useState<Post>({ state: "idle" });
  const [fileName, setFileName] = useState<string | null>(null);
  const [temp, setTemp] = useState("31.2");
  const [start, setStart] = useState("2015-06-16T15:00");

  useEffect(() => {
    document.title = `Forecast input · ${WORDMARK}`;
  }, []);

  const send = async (what: string, go: () => Promise<Run>) => {
    setPost({ state: "busy", what });
    try {
      const run = await go();
      setLastRunId(run.run.id);
      setPost({ state: "done", run });
    } catch (error) {
      setPost({ state: "error", error });
    }
  };

  const t = Number(temp);
  const tempError = temp.trim() === "" ? "Enter a temperature" : !Number.isFinite(t) ? "Not a number" : t < -60 || t > 60 ? "Must be between −60 and 60 °C" : null;
  const busy = post.state === "busy";
  const done = post.state === "done" ? post.run : null;
  const fixes = done?.cleaning.fixes.filter((f) => f.count > 0) ?? [];

  return (
    <div className="va-page">
      <PageHeader
        eyebrow="Forecast"
        title="Telemetry in"
        lede={`Upload hourly weather as a CSV, up to ${MAX_ROWS.toLocaleString()} rows, or start from the bundled sample. Every row is cleaned, forecast and saved.`}
      />
      <div className="va-input-grid">
        <GlassCard label="CSV upload" title="Your telemetry" delay={380}>
          <DropZone
            fileName={fileName}
            busy={busy && post.what === "csv"}
            busyText="Cleaning and forecasting"
            disabled={busy}
            onFile={(file) => {
              setFileName(file.name);
              void send("csv", () => forecastCsv(file));
            }}
            onReject={(_, why) => setPost({ state: "error", error: new Error(why) })}
          />
        </GlassCard>
        <GlassCard label="No file to hand?" title="Use the sample" delay={480}>
          <p className="va-input-note">The bundled 1,000-hour sample: a hot June to July, cleaned, forecast by QuickML and run through the controller.</p>
          <Pill icon={Sparkles} tone="volt" onClick={() => void send("sample", () => forecastSample())} disabled={busy}>
            {busy && post.what === "sample" ? "Forecasting" : "Use sample data"}
          </Pill>
          <div className="va-input-fields">
            <Field label="Start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} hint="The first hour of the window" />
            <Field label="Temperature" inputMode="decimal" value={temp} onChange={(e) => setTemp(e.target.value)} suffix="°C" error={tempError} hint="−60 to 60" />
          </div>
        </GlassCard>
      </div>
      {post.state === "error" && <ErrorState error={post.error} action={<Pill onClick={() => setPost({ state: "idle" })}>Dismiss</Pill>} />}
      {done && (
        <GlassCard
          label={`Run ${done.run.id.slice(-6)} · ${done.run.saved ? "saved" : "not saved"}`}
          title={`${done.cleaning.rows_out.toLocaleString()} of ${done.cleaning.rows_in.toLocaleString()} rows kept`}
          aside={<Pill icon={ArrowUpRight} tone="volt" to={`/dashboard?run=${done.run.id}`}>Open on dashboard</Pill>}
          delay={0}
        >
          <ol className="va-input-report">
            {fixes.length === 0 && <li><LogItem label="Cleaning" title="Nothing needed fixing" /></li>}
            {fixes.map((f) => (
              <li key={f.code}><LogItem kind={f.code.startsWith("rejected") ? "overload" : "info"} label={f.code.replace(/_/g, " ")} title={f.label} meta={f.count.toLocaleString()} /></li>
            ))}
            {done.cleaning.rejected.slice(0, 5).map((r) => (
              <li key={`r${r.row}`}><LogItem kind="overload" label={`Rejected · row ${r.row}`} title={r.reason} /></li>
            ))}
          </ol>
        </GlassCard>
      )}
    </div>
  );
}
