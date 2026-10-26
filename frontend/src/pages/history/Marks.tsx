/* Side-stat marks for the History screen, in the line language of Sylva's
 * .stat .mark (a 30-unit box, a 0.6/3.6 dotted ring, 1.2 strokes, round caps)
 * and the dashboard's own marks. Each one draws what its stat means. */

const SVG = { viewBox: "0 0 30 30", fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const RING = <circle cx="15" cy="15" r="10.5" strokeDasharray="0.6 3.6" />;

/** Saved runs: a dotted ring holding three stacked notes. */
export function MarkRuns() {
  return (
    <svg {...SVG}>
      {RING}
      <path d="M10.4 11.6h9.2" />
      <path d="M10.4 15h9.2" />
      <path d="M10.4 18.4h5.6" />
    </svg>
  );
}

/** The latest run: a dotted ring with a clock's hands. */
export function MarkLatest() {
  return (
    <svg {...SVG}>
      {RING}
      <circle cx="15" cy="15" r="5.6" strokeDasharray="0.6 3.2" />
      <path d="M15 11.6V15l2.6 1.6" />
    </svg>
  );
}

/** A peak: the day's curve rising to a point (the dashboard's peak mark). */
export function MarkPeak() {
  return (
    <svg {...SVG}>
      {RING}
      <path d="M8.6 19.2 11.8 16l2.4 1.9 4.6-6.1" />
      <circle cx="18.8" cy="11.8" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Overload hours: the bolt, with the run's overload share drawn as an arc on the ring. */
export function MarkOverload({ share }: { share?: number }) {
  const s = share == null ? 0 : Math.max(0, Math.min(1, share));
  const c = 2 * Math.PI * 10.5;
  return (
    <svg {...SVG}>
      {RING}
      {s > 0 && (
        <circle
          className="vh-mark-arc"
          cx="15"
          cy="15"
          r="10.5"
          strokeDasharray={`${(s * c).toFixed(2)} ${c.toFixed(2)}`}
          transform="rotate(-90 15 15)"
        />
      )}
      <path d="M16.2 8.5 11.4 15.6h4.2l-1.8 5.9 4.8-7.1h-4.2z" />
    </svg>
  );
}

/** The data span: two ticks on a line, start → end. */
export function MarkSpan() {
  return (
    <svg {...SVG}>
      {RING}
      <path d="M9.4 15h11.2" />
      <path d="M9.4 12.6v4.8" />
      <path d="M20.6 12.6v4.8" />
    </svg>
  );
}
