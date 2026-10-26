"""Grid transition controller (problem statement, section 6).

Per forecast hour:
- Renewable Storage Mode when demand > 160 kW, or the hour is 18-22 inclusive;
  otherwise Main Grid Mode.
- Critical Overload Alert when demand >= 200 kW, independent of the mode.

Standard library only, so it runs unchanged in any Catalyst runtime.
"""

import math
from datetime import datetime

STORAGE_MODE = "Renewable Storage Mode"
GRID_MODE = "Main Grid Mode"
STORAGE_ABOVE_KW = 160.0  # strictly above
OVERLOAD_AT_KW = 200.0  # at or above
EVENING_FIRST_HOUR, EVENING_LAST_HOUR = 18, 22  # inclusive


def check_demand(demand_kw) -> float:
    """Return demand as a float; raise ValueError if it is NaN, infinite or negative."""
    if isinstance(demand_kw, bool):
        raise ValueError(f"demand_kw must be a number, got {demand_kw!r}")
    demand = float(demand_kw)
    if not math.isfinite(demand) or demand < 0:
        raise ValueError(f"demand_kw must be a finite number >= 0, got {demand_kw!r}")
    return demand


def hour_of(ts) -> int:
    """Hour of a datetime (pandas Timestamps included) or an ISO 8601 string."""
    if isinstance(ts, str):
        ts = datetime.fromisoformat(ts)
    if not isinstance(ts, datetime):
        raise TypeError(f"ts must be a datetime or ISO 8601 string, got {type(ts).__name__}")
    return ts.hour


def decide(ts, demand_kw) -> dict:
    """Grid mode and overload flag for one forecast hour."""
    demand = check_demand(demand_kw)
    evening = EVENING_FIRST_HOUR <= hour_of(ts) <= EVENING_LAST_HOUR
    mode = STORAGE_MODE if demand > STORAGE_ABOVE_KW or evening else GRID_MODE
    return {"mode": mode, "overload": demand >= OVERLOAD_AT_KW}
