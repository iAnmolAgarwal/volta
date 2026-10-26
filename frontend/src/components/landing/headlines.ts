/* The three headline options from the developer's direction (spec, "Headline"). */

export const HEADLINES: [string, string][] = [
  ["Step into", "the living grid"],
  ["Power that", "thinks ahead"],
  ["Every hour,", "balanced"],
];

export function readHeadlineParam(): number {
  const h = Number(new URLSearchParams(window.location.search).get("h"));
  return h >= 1 && h <= HEADLINES.length ? h - 1 : 0;
}
