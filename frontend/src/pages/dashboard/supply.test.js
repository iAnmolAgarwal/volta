// The supply split's energy balance, on every hour of two saved runs (fixtures/,
// trimmed from GET /api/runs/{id}): 93853000000028005, made with the earlier
// battery dispatch, and r20261026211443-80ddd5, made with the current one
// (PV serves the peak first). The balance must hold under either.
//
// Plain JS on purpose: tsc -b type-checks all of src/, and this keeps it from
// needing vitest's types before `npm install` has added vitest.
import { describe, expect, it } from "vitest";
import before from "./fixtures/run-93853000000028005.json";
import now from "./fixtures/run-r20261026211443-80ddd5.json";
import { batteryWhy, chargeSource, MAX_DISCHARGE_KW, supplyOf } from "./supply";

const TOL = 0.1; // kW
const full = (h) => ({ ambient_temp_c: 0, humidity_pct: 0, solar_irradiance_wm2: 0, reason: "", ...h });

describe.each([
  ["93853000000028005", before],
  ["r20261026211443-80ddd5", now],
])("supplyOf on run %s", (_, run) => {
  it("has the whole run", () => {
    expect(run.hours).toHaveLength(1000);
  });

  it("stacks grid-to-load + discharge + solar-to-load to the demand, every hour", () => {
    const off = run.hours
      .map((h) => {
        const s = supplyOf(h);
        return { index: h.index, err: s.gridToLoad + s.discharge + s.pvToLoad - h.prediction_kw };
      })
      .filter((r) => Math.abs(r.err) > TOL);
    expect(off).toEqual([]);
  });

  it("never draws a negative layer, and charging is all accounted for", () => {
    for (const h of run.hours) {
      const s = supplyOf(h);
      for (const v of [s.gridToLoad, s.discharge, s.pvToLoad, s.charge, s.pvToBatt, s.gridToBatt, s.curtailed]) expect(v).toBeGreaterThanOrEqual(-1e-9);
      expect(Math.abs(s.pvToBatt + s.gridToBatt - s.charge)).toBeLessThan(1e-9);
      expect(s.discharge > 0 && s.charge > 0).toBe(false);
    }
  });

  it("explains every hour in one line", () => {
    for (const h of run.hours) expect(batteryWhy(full(h))).toMatch(/^(Discharging|Charging|Full|At the|Resting)/);
  });
});

describe("batteryWhy at 15:00 on 16 Jun", () => {
  it("earlier dispatch: discharge at its limit, solar charging, the grid over the cap", () => {
    const h = before.hours[0];
    expect(h.timestamp).toBe("2015-06-16 15:00:00");
    expect(supplyOf(h).discharge + h.pv_kw).toBeCloseTo(MAX_DISCHARGE_KW, 1);
    expect(batteryWhy(full(h))).toBe("Discharging at the 100 kW limit while 42 kW of solar charges it; grid 144 kW, 24 kW over the 120 kW cap");
  });

  it("current dispatch: solar serves the peak, the battery holds the grid at the cap", () => {
    const h = now.hours[0];
    expect(h.timestamp).toBe("2015-06-16 15:00:00");
    expect(batteryWhy(full(h))).toBe("Discharging 81.8 kW to hold the grid at the 120 kW cap");
  });

  it("names where charging comes from", () => {
    expect(chargeSource(supplyOf({ prediction_kw: 100, grid_kw: 100, battery_kw: -40, pv_kw: 40 }))).toBe("from solar");
    expect(chargeSource(supplyOf({ prediction_kw: 100, grid_kw: 175, battery_kw: -75, pv_kw: 0 }))).toBe("from the grid");
    expect(chargeSource(supplyOf({ prediction_kw: 100, grid_kw: 130, battery_kw: -60, pv_kw: 30 }))).toBe("from solar and the grid");
  });
});
