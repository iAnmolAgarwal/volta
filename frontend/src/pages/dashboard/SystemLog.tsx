import { CalendarClock } from "lucide-react";
import { GlassCard } from "@/components/app/GlassCard";
import { LogItem } from "@/components/app/LogItem";
import type { LogEntry } from "./model";

/* The system log for the window, as Field Notes: the window's
 * opening state, every mode switch, and every run of overload hours (one entry
 * per run, so a hot afternoon reads as one event, not eight). The entry the
 * focused hour sits in wears the paper; selecting one focuses its hour. The
 * heading sits on the card's own left rail, as Sylva's headline sits on the
 * hero's. */

export interface SystemLogProps {
  entries: LogEntry[];
  activeKey: string | null;
  overloadHours: number;
  switches: number;
  onSelect: (index: number) => void;
  delay?: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function SystemLog({ entries, activeKey, overloadHours, switches, onSelect, delay }: SystemLogProps) {
  return (
    <GlassCard className="vd-log" delay={delay} aria-labelledby="vd-log-title">
      <div className="vd-log-head">
        <p className="va-card-label">System log</p>
        <h2 className="va-card-title" id="vd-log-title">{plural(entries.length, "entry", "entries")} in this window</h2>
        <p className="vd-log-note">
          {plural(switches, "mode switch", "mode switches")} and {plural(overloadHours, "overload hour")}, as the controller logged them.
          Select an entry to focus its hour.
        </p>
      </div>
      <ol className="vd-log-list">
        {entries.map((e) => (
          <li key={e.key}>
            <LogItem
              kind={e.kind}
              icon={e.kind === "info" ? CalendarClock : undefined}
              label={e.label}
              title={e.title}
              meta={e.meta}
              active={e.key === activeKey}
              onClick={() => onSelect(e.focusAt)}
            />
          </li>
        ))}
      </ol>
    </GlassCard>
  );
}
