// The History card's mini curve: the monotone path never leaves its box or
// overshoots the data, the shared scale puts 200 kW at one height, and only a
// whole series is drawn (the older Data Store runs have none).
//
// Plain JS on purpose, as supply.test.js: tsc -b type-checks all of src/.
import { describe, expect, it } from "vitest";
import { curveGeometry, VIEW_H, VIEW_W } from "./curve";
import { curveScale, lengthText, seriesOf, shareText } from "./model";

const ys = (d) => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2]));
const xs = (d) => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[1]));

describe("curveGeometry", () => {
  const mean = [120, 180, 260, 240, 150, 150, 210];
  const max = [130, 200, 300, 250, 160, 155, 230];
  const g = curveGeometry(mean, max, 0, 336);

  it("spans the box edge to edge", () => {
    expect(Math.min(...xs(g.mean))).toBe(0);
    expect(Math.max(...xs(g.mean))).toBe(VIEW_W);
  });

  it("never overshoots the data (monotone): every control point lies within its segment's ends", () => {
    const yOf = (v) => 12 + (VIEW_H - 12) * (1 - v / 336);
    const lo = yOf(Math.max(...max)) - 0.01;
    const hi = yOf(Math.min(...mean)) + 0.01;
    for (const y of ys(g.mean)) expect(y).toBeGreaterThanOrEqual(lo);
    for (const y of ys(g.mean)) expect(y).toBeLessThanOrEqual(hi);
    // (0.01: the path is written to 2 decimals) a flat run stays flat: points 4 and 5 are both 150 kW
    const seg = g.mean.split("C")[5].trim().split(" ").map(Number);
    expect(seg[1]).toBeCloseTo(seg[5], 6);
    expect(seg[3]).toBeCloseTo(seg[5], 6);
  });

  it("puts 200 kW at the same height for any series on one scale", () => {
    const other = curveGeometry([90, 95], [100, 110], 0, 336);
    expect(g.at(200)).toBeCloseTo(other.at(200), 9);
    expect(g.at(200)).toBeCloseTo((12 + 88 * (1 - 200 / 336)) / 100, 9);
  });

  it("marks the highest max bucket as the peak", () => {
    expect(g.peak.kw).toBe(300);
    expect(g.peak.x).toBeCloseTo(2 / 6, 9);
  });

  it("closes the envelope back along the mean", () => {
    expect(g.envelope.startsWith(g.max)).toBe(true);
    expect(g.envelope.endsWith("Z")).toBe(true);
  });
});

describe("seriesOf", () => {
  const base = { n_rows: 24, rows_in: 24, overload_count: 6, peak_kw: 304.6 };
  it("reads a whole series", () => {
    expect(seriesOf({ ...base, series: { step_hours: 1, mean_kw: [1, 2], max_kw: [1, 3] } })).toEqual({ step_hours: 1, mean_kw: [1, 2], max_kw: [1, 3] });
  });
  it.each([
    ["no series", undefined],
    ["null", null],
    ["one point", { step_hours: 1, mean_kw: [1], max_kw: [1] }],
    ["mismatched", { step_hours: 1, mean_kw: [1, 2], max_kw: [1] }],
    ["a non-number", { step_hours: 1, mean_kw: [1, null], max_kw: [1, 2] }],
  ])("draws nothing for %s", (_, series) => {
    expect(seriesOf({ ...base, series })).toBeNull();
  });
});

describe("the card's numbers", () => {
  it("shares one scale: the top over the highest peak, the floor under the lowest mean", () => {
    const s = curveScale([
      { peak_kw: 300, series: { step_hours: 1, mean_kw: [100, 200], max_kw: [100, 300] } },
      { peak_kw: 150 },
    ]);
    expect(s.hi).toBeCloseTo(336, 9);
    expect(s.lo).toBeCloseTo(60, 9);
    expect(curveScale([{ peak_kw: 120 }])).toEqual({ lo: 0, hi: 224.00000000000003 });
  });
  it("says the length once, and the overload as a share", () => {
    expect(lengthText({ n_rows: 1000, rows_in: 1000 })).toBe("1,000 h");
    expect(lengthText({ n_rows: 22, rows_in: 25 })).toBe("22 of 25 rows kept");
    expect(shareText(0.577)).toBe("58% of hours");
    expect(shareText(0.004)).toBe("<1% of hours");
    expect(shareText(0)).toBe("no hours");
  });
});
