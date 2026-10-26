/* Where each hour's power comes from and goes, from the saved hour's fields.
 *
 * The backend's fields are nets: `grid_kw` is everything drawn from the main
 * grid (the load plus any grid charging), `battery_kw` is the battery's net
 * (> 0 discharging, < 0 charging) and `pv_kw` is the PV before curtailment.
 * So grid_kw + battery_kw + pv_kw equals the demand except where PV was
 * curtailed. Splitting them gives a stack that sums to the demand exactly:
 *
 *   gridToLoad + discharge + pvToLoad = demand
 *
 * with the charging (pvToBatt + gridToBatt) drawn on its own, below the axis.
 * The battery's rules are docs/battery.md; its parameters are copied below. */

import { MIN_SOC_PCT, type RunHour } from "@/lib/api";

/** docs/battery.md, "Parameters" (not yet exported by api.ts; see design-notes/m2/dashboard-requests.md). */
export const GRID_CAP_KW = 120;
export const MAX_DISCHARGE_KW = 100;

export interface Supply {
  demand: number;
  gridToLoad: number;
  discharge: number;
  pvToLoad: number;
  /** kW into the battery, all sources (≥ 0). */
  charge: number;
  pvToBatt: number;
  gridToBatt: number;
  curtailed: number;
}

type HourFields = Pick<RunHour, "prediction_kw" | "grid_kw" | "battery_kw" | "pv_kw">;

const pos = (v: number) => Math.max(0, v);

export function supplyOf(h: HourFields): Supply {
  const demand = h.prediction_kw;
  const grid = pos(h.grid_kw);
  const pv = pos(h.pv_kw ?? 0);
  const charge = pos(-h.battery_kw);
  const discharge = pos(h.battery_kw);
  const pvToBatt = Math.min(pv, charge);
  const gridToBatt = charge - pvToBatt;
  const curtailed = pos(grid + pv + h.battery_kw - demand);
  return {
    demand,
    gridToLoad: pos(grid - gridToBatt),
    discharge,
    pvToLoad: pos(pv - pvToBatt - curtailed),
    charge,
    pvToBatt,
    gridToBatt,
    curtailed,
  };
}

/** "Charging 42.3 kW, from solar" / "…, from the grid" / "…, from solar and the grid". */
export function chargeSource(s: Supply): string {
  if (s.pvToBatt > 0.05 && s.gridToBatt > 0.05) return "from solar and the grid";
  return s.gridToBatt > 0.05 ? "from the grid" : "from solar";
}

const k = (v: number) => `${Math.round(v)} kW`;

/** One plain line on what the battery is doing this hour, and why. */
export function batteryWhy(h: RunHour): string {
  const s = supplyOf(h);
  const storage = h.mode === "Renewable Storage Mode";
  const atFloor = h.soc_pct <= MIN_SOC_PCT + 0.5;
  const curtail = s.curtailed > 0.5 ? `; ${k(s.curtailed)} of solar curtailed` : "";

  if (s.discharge > 0.05) {
    const over = h.grid_kw - GRID_CAP_KW;
    if (over <= 0.5) return `Discharging ${s.discharge.toFixed(1)} kW to hold the grid at the ${GRID_CAP_KW} kW cap${curtail}`;
    // above the cap, the discharge was held back: by the reserve, or by its own limit
    if (atFloor) return `Discharging ${k(s.discharge)}, held at the ${MIN_SOC_PCT}% reserve; grid ${k(h.grid_kw)}, ${k(over)} over the ${GRID_CAP_KW} kW cap`;
    const refill = MAX_DISCHARGE_KW - s.discharge;
    const solar = refill > 0.5 ? ` while ${k(refill)} of solar charges it` : "";
    return `Discharging at the ${MAX_DISCHARGE_KW} kW limit${solar}; grid ${k(h.grid_kw)}, ${k(over)} over the ${GRID_CAP_KW} kW cap`;
  }
  if (s.charge > 0.05) {
    if (s.pvToBatt > 0.05 && s.gridToBatt > 0.05) return `Charging ${k(s.charge)}: ${k(s.pvToBatt)} from solar, ${k(s.gridToBatt)} from the grid${curtail}`;
    if (s.gridToBatt > 0.05) return `Charging ${k(s.charge)} from the grid, an off-peak top-up${curtail}`;
    const why = storage ? `, the grid under the ${GRID_CAP_KW} kW cap` : "";
    return `Charging ${k(s.charge)} from solar${why}${curtail}`;
  }
  if (h.soc_pct >= 99.5) return `Full; solar and the grid serve the load${curtail}`;
  if (storage && atFloor) return `At the ${MIN_SOC_PCT}% reserve, so the grid carries the load${curtail}`;
  if (storage) return `Resting: the grid is under the ${GRID_CAP_KW} kW cap${curtail}`;
  return `Resting: Main Grid Mode keeps the charge${curtail}`;
}
