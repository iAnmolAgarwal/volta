import { cssVars } from "./cssVars";
import { HEADLINES } from "./headlines";

/* The three headline options from the developer's direction, and the small
 * review switcher (glass chips bottom-left, mirrored in ?h=1|2|3). The
 * switcher goes once the developer picks one. */

export function Headline({ option }: { option: number }) {
  const [a, b] = HEADLINES[option];
  return (
    // keyed by option so a switch replays the rise
    <h1 key={option} className="vl-headline par" style={cssVars({ "--pd": 18, "--pr": 1.2 })}>
      <span><i style={cssVars({ "--d": "260ms" })}>{a}</i></span>
      <span><i style={cssVars({ "--d": "360ms" })}>{b}</i></span>
    </h1>
  );
}

export function HeadlineSwitcher({ option, onChange }: { option: number; onChange: (i: number) => void }) {
  const pick = (i: number) => {
    const url = new URL(window.location.href);
    url.searchParams.set("h", String(i + 1));
    window.history.replaceState(null, "", url);
    onChange(i);
  };
  return (
    <div className="vl-review fade" style={cssVars({ "--d": "1150ms" })} role="group" aria-label="Review: headline option">
      <span className="vl-review-label" aria-hidden="true">Headline</span>
      {HEADLINES.map((h, i) => (
        <button
          key={i}
          type="button"
          className="vl-review-chip"
          aria-pressed={option === i}
          aria-label={`Headline ${i + 1}: ${h.join(" ")}`}
          onClick={() => pick(i)}
        >
          {i + 1}
        </button>
      ))}
    </div>
  );
}
