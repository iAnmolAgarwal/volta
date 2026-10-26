"""Battery state-of-charge model for the dashboard (docs/battery.md has the assumptions).

Steps of `step_hours` (one hour by default). The battery follows the mode the
controller picked and never changes it. Each step:
- PV produces pv_kw_per_wm2 x solar irradiance.
- Renewable Storage Mode is peak shaving. PV serves the load first. If the rest of
  the load is above grid_cap_kw, the battery covers the excess, up to
  max_discharge_kw, and takes no PV. Otherwise spare PV charges the battery, up to
  charge_kw, but never so much that the grid import goes above grid_cap_kw.
- Main Grid Mode: PV charges the battery first, up to charge_kw, and the grid tops it
  up at up to grid_charge_kw, within charge_kw together with PV. The rest of the PV
  serves the load.
- The state of charge never leaves [min_soc, max_soc]; the battery does less instead.
  The main grid covers whatever the battery and PV do not. Surplus PV is curtailed.
No conversion losses.
"""

from collections.abc import Iterable
from dataclasses import dataclass

from backend.controller import GRID_MODE, STORAGE_MODE, check_demand


@dataclass(frozen=True)
class BatteryParams:
    capacity_kwh: float = 800.0
    start_soc: float = 0.80
    min_soc: float = 0.10
    max_soc: float = 1.00
    max_discharge_kw: float = 100.0
    charge_kw: float = 150.0  # PV and grid charging together
    grid_charge_kw: float = 75.0  # Main Grid Mode top-up from the grid
    grid_cap_kw: float = 120.0  # Storage Mode: grid import the battery shaves down to
    pv_kw_per_wm2: float = 0.25  # a 250 kWp array: 0.25 kW per W/m2 of irradiance
    step_hours: float = 1.0

    def __post_init__(self):
        if self.capacity_kwh <= 0 or self.step_hours <= 0:
            raise ValueError("capacity_kwh and step_hours must be > 0")
        if not 0 <= self.min_soc <= self.start_soc <= self.max_soc <= 1:
            raise ValueError("need 0 <= min_soc <= start_soc <= max_soc <= 1")
        if min(self.max_discharge_kw, self.charge_kw, self.grid_charge_kw, self.grid_cap_kw, self.pv_kw_per_wm2) < 0:
            raise ValueError("powers, grid_cap_kw and pv_kw_per_wm2 must be >= 0")
        if self.grid_charge_kw > self.charge_kw:
            raise ValueError("grid_charge_kw cannot exceed charge_kw")


@dataclass(frozen=True)
class BatteryStep:
    mode: str
    demand_kw: float
    pv_kw: float  # PV output this step (before any curtailment)
    battery_kw: float  # > 0 discharging into the load, < 0 charging
    grid_kw: float  # drawn from the main grid: load not covered by battery and PV, plus grid charging
    soc_start: float
    soc_end: float


def _solar(value) -> float:
    solar = float(value)
    if not solar >= 0:  # also rejects NaN
        raise ValueError(f"solar_irradiance_wm2 must be a number >= 0, got {value!r}")
    return solar


def simulate(schedule: Iterable[tuple[str, float, float]], params: BatteryParams = BatteryParams()) -> list[BatteryStep]:
    """Run the battery over (mode, demand_kw, solar_irradiance_wm2) triples, one per step, in order."""
    p = params
    e_min, e_max = p.min_soc * p.capacity_kwh, p.max_soc * p.capacity_kwh
    energy = p.start_soc * p.capacity_kwh
    steps = []
    for mode, demand_kw, solar_wm2 in schedule:
        demand = check_demand(demand_kw)
        pv = p.pv_kw_per_wm2 * _solar(solar_wm2)
        if mode == STORAGE_MODE:
            net = demand - pv  # the load PV leaves for the grid and the battery
            if net > p.grid_cap_kw:  # shave the peak; charging from PV now would only add grid import
                pv_in, discharge = 0.0, min(net - p.grid_cap_kw, p.max_discharge_kw)
            else:  # spare PV charges, but never lifts the import above the cap
                pv_in, discharge = min(pv, p.charge_kw, p.grid_cap_kw - net), 0.0
            grid_in = 0.0
        elif mode == GRID_MODE:
            pv_in = min(pv, p.charge_kw)
            discharge, grid_in = 0.0, min(p.grid_charge_kw, p.charge_kw - pv_in)
        else:
            raise ValueError(f"unknown mode {mode!r}")
        start = energy
        energy = min(e_max, max(e_min, energy + (pv_in + grid_in - discharge) * p.step_hours))
        battery_kw = (start - energy) / p.step_hours
        # The charge that went in came from PV first, then the grid (so a clamp at
        # max_soc cuts grid charging first); the rest of the PV serves the load.
        charge = max(0.0, -battery_kw)
        pv_charge = min(pv, charge)
        grid_kw = max(0.0, demand - max(0.0, battery_kw) - (pv - pv_charge)) + (charge - pv_charge)
        steps.append(BatteryStep(mode, demand, pv, battery_kw, grid_kw, start / p.capacity_kwh, energy / p.capacity_kwh))
    return steps
