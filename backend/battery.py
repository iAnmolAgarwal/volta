"""Battery state-of-charge model for the dashboard.

Steps of `step_hours` (one hour by default). The battery follows the mode the
controller picked and never changes it:
- Renewable Storage Mode: discharge to cover demand, up to max_discharge_kw and
  never below min_soc. The main grid covers whatever the battery cannot.
- Main Grid Mode: charge at charge_kw, never above max_soc. The grid covers
  demand plus charging.
No conversion losses.
"""

from collections.abc import Iterable
from dataclasses import dataclass

from backend.controller import GRID_MODE, STORAGE_MODE, check_demand


@dataclass(frozen=True)
class BatteryParams:
    capacity_kwh: float = 500.0
    start_soc: float = 0.80
    min_soc: float = 0.10
    max_soc: float = 1.00
    max_discharge_kw: float = 150.0
    charge_kw: float = 100.0
    step_hours: float = 1.0

    def __post_init__(self):
        if self.capacity_kwh <= 0 or self.step_hours <= 0:
            raise ValueError("capacity_kwh and step_hours must be > 0")
        if not 0 <= self.min_soc <= self.start_soc <= self.max_soc <= 1:
            raise ValueError("need 0 <= min_soc <= start_soc <= max_soc <= 1")
        if self.max_discharge_kw < 0 or self.charge_kw < 0:
            raise ValueError("max_discharge_kw and charge_kw must be >= 0")


@dataclass(frozen=True)
class BatteryStep:
    mode: str
    demand_kw: float
    battery_kw: float  # > 0 discharging into the load, < 0 charging
    grid_kw: float  # drawn from the main grid: load not covered by the battery, plus charging
    soc_start: float
    soc_end: float


def simulate(schedule: Iterable[tuple[str, float]], params: BatteryParams = BatteryParams()) -> list[BatteryStep]:
    """Run the battery over (mode, demand_kw) pairs, one per step, in order."""
    p = params
    e_min, e_max = p.min_soc * p.capacity_kwh, p.max_soc * p.capacity_kwh
    energy = p.start_soc * p.capacity_kwh
    steps = []
    for mode, demand_kw in schedule:
        demand = check_demand(demand_kw)
        start = energy
        if mode == STORAGE_MODE:
            power = max(0.0, min(demand, p.max_discharge_kw, (energy - e_min) / p.step_hours))
            energy = max(e_min, energy - power * p.step_hours)
            battery_kw, grid_kw = power, demand - power
        elif mode == GRID_MODE:
            power = max(0.0, min(p.charge_kw, (e_max - energy) / p.step_hours))
            energy = min(e_max, energy + power * p.step_hours)
            battery_kw, grid_kw = -power, demand + power
        else:
            raise ValueError(f"unknown mode {mode!r}")
        steps.append(BatteryStep(mode, demand, battery_kw, grid_kw, start / p.capacity_kwh, energy / p.capacity_kwh))
    return steps
