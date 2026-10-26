// runCsv: one row per hour, in order, with commas and quotes in the reason escaped.
// Plain JS, like the other tests, so tsc needn't know vitest.
import { describe, expect, it } from "vitest";
import { runCsv, runCsvName } from "./csv";

const hour = (i, reason) => ({
  index: i, timestamp: `2015-06-16 ${String(15 + i).padStart(2, "0")}:00:00`, hour: 15 + i,
  ambient_temp_c: 35.66, humidity_pct: 56.38, solar_irradiance_wm2: 169, prediction_kw: 244.01,
  mode: "Renewable Storage Mode", overload: true, soc_pct: 69.78, pv_kw: 42.25, battery_kw: 81.76, grid_kw: 120,
  reason,
});

describe("runCsv", () => {
  it("writes a header and one row per hour, in order", () => {
    const lines = runCsv([hour(0, "a"), hour(1, "b")]).trimEnd().split("\r\n");
    expect(lines[0]).toBe("timestamp,ambient_temp_c,humidity_pct,solar_irradiance_wm2,target_demand_kw,grid_mode,critical_overload,soc_pct,grid_kw,battery_kw,pv_kw,reason");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("2015-06-16 15:00:00,35.66,56.38,169,244.01,Renewable Storage Mode,true,69.78,120,81.76,42.25,a");
    expect(lines[2].startsWith("2015-06-16 16:00:00,")).toBe(true);
  });

  it("quotes cells with commas or quotes", () => {
    const row = runCsv([hour(0, '244.0 kW > 160; "peak", alert')]).trimEnd().split("\r\n")[1];
    expect(row.endsWith(',"244.0 kW > 160; ""peak"", alert"')).toBe(true);
  });

  it("names the file after the run", () => {
    expect(runCsvName("r20261026211443-80ddd5")).toBe("volta-run-r20261026211443-80ddd5.csv");
    expect(runCsvName(null)).toBe("volta-forecast-unsaved.csv");
  });
});
