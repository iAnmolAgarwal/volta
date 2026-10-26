// The History card's mini curve, made as the landing card chart is: the
// monotone mean line never leaves its box or overshoots the data, the scale
// runs from 0 kW to the line's peak (or 200 kW) plus 12%, the overload tint
// starts exactly at 200 kW, and only a whole series is drawn (the older Data
// Store runs have none).
//
// Plain JS on purpose, as supply.test.js: tsc -b type-checks all of src/.
import { describe, expect, it } from "vitest";
import { curveGeometry, VIEW_H, VIEW_W } from "./curve";
import { lengthText, seriesOf, shareText, spanText } from "./model";

const pairs = (d) => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
const TOP = 7; // the landing's top margin, in box units

describe("curveGeometry", () => {
  const mean = [120, 180, 260, 240, 150, 150, 210];
  const g = curveGeometry(mean, 200);
  const top = 260 * 1.12;
  const yOf = (v) => TOP + (VIEW_H - TOP) * (1 - v / top);

  it("spans the box edge to edge", () => {
    const xs = pairs(g.line).map(([x]) => x);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(VIEW_W);
  });

  it("never overshoots the data (monotone); 0.01 for the 2-decimal path", () => {
    for (const [, y] of pairs(g.line)) {
      expect(y).toBeGreaterThanOrEqual(yOf(260) - 0.01);
      expect(y).toBeLessThanOrEqual(yOf(120) + 0.01);
    }
    // a flat run stays flat: points 4 and 5 are both 150 kW
    const seg = g.line.split("C")[5].trim().split(" ").map(Number);
    expect(seg[1]).toBeCloseTo(seg[5], 6);
    expect(seg[3]).toBeCloseTo(seg[5], 6);
  });

  it("scales from 0 kW to the line's peak plus 12%, as the landing chart", () => {
    expect(g.at(0)).toBeCloseTo(1, 9);
    expect(g.at(200)).toBeCloseTo(yOf(200) / VIEW_H, 9);
    // a run that never reaches 200 kW still shows the 200 kW line, with headroom
    expect(curveGeometry([90, 95], 200).at(200)).toBeCloseTo((TOP + (VIEW_H - TOP) * (1 - 200 / 224)) / VIEW_H, 9);
  });

  it("puts the dot on the line's own peak", () => {
    expect(g.peak.kw).toBe(260);
    expect(g.peak.x).toBeCloseTo(2 / 6, 9);
    expect(g.peak.y).toBeCloseTo(yOf(260) / VIEW_H, 9);
  });

  it("tints from 200 kW up only when the line crosses it (the landing's `over`)", () => {
    // the fill's box runs from the peak (260) down to 0 kW, so 200 kW is 60/260 of the way down
    expect(g.over).toBeCloseTo(60 / 260, 9);
    // and in box units that is where the 200 kW line is drawn
    const boxTop = g.peak.y * VIEW_H;
    expect(boxTop + g.over * (VIEW_H - boxTop)).toBeCloseTo(g.at(200) * VIEW_H, 9);
    expect(curveGeometry([150, 199], 200).over).toBe(0);
  });

  it("closes the fill down to the floor", () => {
    expect(g.area.startsWith(g.line)).toBe(true);
    expect(g.area.endsWith(`L${VIEW_W} ${VIEW_H}L0 ${VIEW_H}Z`)).toBe(true);
  });
});

describe("seriesOf", () => {
  const base = { n_rows: 24, rows_in: 24, overload_count: 6, peak_kw: 304.6 };
  it("reads a series by its mean", () => {
    expect(seriesOf({ ...base, series: { step_hours: 1, mean_kw: [1, 2], max_kw: [1, 3] } })?.mean_kw).toEqual([1, 2]);
  });
  it.each([
    ["no series", undefined],
    ["null", null],
    ["one point", { step_hours: 1, mean_kw: [1], max_kw: [1] }],
    ["a non-number", { step_hours: 1, mean_kw: [1, null], max_kw: [1, 2] }],
  ])("draws nothing for %s", (_, series) => {
    expect(seriesOf({ ...base, series })).toBeNull();
  });
});

describe("the card's words", () => {
  it("says the length once, short enough for one line, and the overload as a share", () => {
    expect(lengthText({ n_rows: 1000, rows_in: 1000 })).toBe("1,000 h");
    expect(lengthText({ n_rows: 22, rows_in: 25 })).toBe("22/25 rows");
    expect(shareText(0.577)).toBe("58% of hours");
    expect(shareText(0.004)).toBe("<1% of hours");
    expect(shareText(0)).toBe("no hours");
  });
  it("writes every span in one date format", () => {
    expect(spanText({ start: "2015-06-16 15:00:00", end: "2015-07-28 06:00:00" })).toBe("16 Jun · 15:00 → 28 Jul · 06:00");
    expect(spanText({ start: "2015-06-17 00:00:00", end: "2015-06-17 23:00:00" })).toBe("17 Jun · 00:00 → 23:00");
  });
});
