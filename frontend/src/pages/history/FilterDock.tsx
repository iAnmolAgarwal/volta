import { useRef, type ComponentType } from "react";
import { FileSpreadsheet, Layers, PenLine, Sparkles } from "lucide-react";
import { cssVars } from "@/components/landing/cssVars";
import { FILTER_LABEL, FILTERS, type SourceFilter } from "./model";
import { useDockSpring } from "./useDockSpring";

/* The source filter as a small dock, Sylva's: glass pills in spaced caps on a
 * frosted bar with a lit top edge, the chosen one wearing the cards' paper,
 * the pills growing on the dock's spring as the pointer nears. Each item is a
 * toggle button (aria-pressed) with its run count. */

const GLYPH: Record<SourceFilter, ComponentType<{ strokeWidth?: number; "aria-hidden"?: boolean }>> = {
  all: Layers,
  csv: FileSpreadsheet,
  manual: PenLine,
  sample: Sparkles,
};

// Sylva's dock-item stagger, after the bar itself (~50 ms apart)
const DELAYS = [520, 570, 620, 670];

export interface FilterDockProps {
  value: SourceFilter;
  counts: Record<SourceFilter, number>;
  onChange: (f: SourceFilter) => void;
  delay?: number;
}

export function FilterDock({ value, counts, onChange, delay = 460 }: FilterDockProps) {
  const ref = useRef<HTMLDivElement>(null);
  useDockSpring(ref, [counts.all]);
  return (
    <div className="vh-filter va-reveal" style={cssVars({ "--d": `${delay}ms` })}>
      <div ref={ref} className="vh-dock" role="group" aria-label="Filter the runs by source" data-spec>
        {FILTERS.map((f, i) => {
          const Icon = GLYPH[f];
          const on = f === value;
          return (
            <button
              key={f}
              type="button"
              data-dock
              className={`vh-dock-item${on ? " is-on" : ""}`}
              aria-pressed={on}
              aria-label={`${FILTER_LABEL[f]}: ${counts[f]} ${counts[f] === 1 ? "run" : "runs"}`}
              style={cssVars({ "--d": `${DELAYS[i]}ms` })}
              onClick={() => onChange(f)}
            >
              <span className="vh-dock-glyph" aria-hidden="true"><Icon strokeWidth={1.25} aria-hidden /></span>
              <span className="vh-dock-label">{FILTER_LABEL[f]}</span>
              <span className="vh-dock-count va-num" aria-hidden="true">{counts[f]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
