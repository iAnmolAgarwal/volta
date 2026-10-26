import pandas as pd
import pytest

from backend.battery import BatteryParams, simulate
from backend.controller import GRID_MODE, STORAGE_MODE, decide
from backend.timeline import WINDOW_HOURS, WindowError, build_hours, overload_alerts, switch_events, view, window

S, G = STORAGE_MODE, GRID_MODE


def hours_for(demands, start="2015-06-16 15:00:00"):
    stamps = pd.date_range(start, periods=len(demands), freq="h")
    clean = pd.DataFrame({"timestamp": stamps, "ambient_temp_c": 25.0, "humidity_pct": 50.0, "solar_irradiance_wm2": 0.0})
    decisions = [decide(ts, p) for ts, p in zip(stamps, demands)]
    steps = simulate([(d["mode"], p) for d, p in zip(decisions, demands)], BatteryParams())
    return build_hours(clean, demands, decisions, steps)


def test_hours_carry_prediction_mode_battery_and_reason():
    h = hours_for([212.4, 100.0])
    assert h[0] == {
        "index": 0, "timestamp": "2015-06-16 15:00:00", "hour": 15,
        "ambient_temp_c": 25.0, "humidity_pct": 50.0, "solar_irradiance_wm2": 0.0,
        "prediction_kw": 212.4, "mode": S, "overload": True,
        "soc_pct": 50.0, "battery_kw": 150.0, "grid_kw": 62.4,
        "reason": "212.4 kW > 160; 212.4 kW ≥ 200 raises a critical overload alert",
    }
    assert h[1]["mode"] == G and h[1]["battery_kw"] == -100.0 and h[1]["soc_pct"] == 70.0


def test_switch_events_mark_each_mode_change():
    # 15:00 high, 16:00 low, 17:00 low, 18:00 evening window, 23:00 out again
    demands = [170, 100, 100, 100, 100, 100, 100, 100, 100]
    events = switch_events(hours_for(demands))
    assert [(e["index"], e["from"], e["to"]) for e in events] == [(1, S, G), (3, G, S), (8, S, G)]
    assert [e["label"] for e in events] == [
        "16:00 Renewable Storage → Main Grid",
        "18:00 Main Grid → Renewable Storage",
        "23:00 Renewable Storage → Main Grid",
    ]
    assert events[1]["timestamp"] == "2015-06-16 18:00:00"


def test_no_switch_events_for_a_steady_mode_or_a_single_hour():
    assert switch_events(hours_for([100, 100, 100], start="2015-06-16 01:00")) == []
    assert switch_events(hours_for([300])) == []


def test_overload_alerts_one_per_hour_at_or_above_200():
    alerts = overload_alerts(hours_for([199.99, 200.0, 250.0, 100.0]))
    assert [a["index"] for a in alerts] == [1, 2]
    assert alerts[0]["label"] == "16:00 Critical overload: 200.0 kW"


def test_view_summary():
    v = view(hours_for([170, 210, 100, 100, 100]))  # 15:00..19:00
    s = v["summary"]
    assert s["n_hours"] == 5 and s["peak_kw"] == 210 and s["peak_timestamp"] == "2015-06-16 16:00:00"
    assert s["storage_hours"] == 4 and s["grid_hours"] == 1  # 17:00 is the only Main Grid hour
    assert s["overload_count"] == 1 and s["switch_count"] == 2
    assert s["start"] == "2015-06-16 15:00:00" and s["end"] == "2015-06-16 19:00:00"
    assert len(v["hours"]) == 5 and v["window"]["hours"] == v["hours"]


def test_window_defaults_to_the_first_24_hours():
    hours = hours_for([100] * 50)
    w = view(hours)["window"]
    assert (w["start"], w["end"], w["size"]) == (0, WINDOW_HOURS, 24)
    assert [h["index"] for h in w["hours"]] == list(range(24))


@pytest.mark.parametrize(
    "start, expected",
    [(None, 0), ("", 0), (10, 10), ("10", 10), (49, 49), ("2015-06-17 03:00", 12), ("2015-06-17 03:30", 13),
     ("2015-01-01", 0)],
)
def test_window_start_by_index_or_timestamp(start, expected):
    hours = hours_for([100] * 50)  # 2015-06-16 15:00 .. 2015-06-18 16:00
    w = window(hours, start)
    assert w.start == expected and w.end == min(expected + 24, 50)


@pytest.mark.parametrize("start", [-1, 50, "2015-07-01", "soon"])
def test_bad_window_start(start):
    with pytest.raises(WindowError):
        window(hours_for([100] * 50), start)
