import { cssVars } from "./cssVars";
import { HEADLINE } from "./headlines";

/* The headline the developer picked, "Power that / thinks ahead". */

export function Headline() {
  const [a, b] = HEADLINE;
  return (
    <h1 className="vl-headline par" style={cssVars({ "--pd": 18, "--pr": 1.2 })}>
      <span><i style={cssVars({ "--d": "260ms" })}>{a}</i></span>
      <span><i style={cssVars({ "--d": "360ms" })}>{b}</i></span>
    </h1>
  );
}
