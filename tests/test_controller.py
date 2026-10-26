from datetime import datetime

import pandas as pd
import pytest

from backend.controller import GRID_MODE, STORAGE_MODE, decide

S, G = STORAGE_MODE, GRID_MODE


@pytest.mark.parametrize(
    "ts, demand, mode, overload",
    [
        # demand boundaries, outside the evening window
        ("2015-07-01 12:00:00", 160.0, G, False),
        ("2015-07-01 12:00:00", 160.01, S, False),
        ("2015-07-01 12:00:00", 199.99, S, False),
        ("2015-07-01 12:00:00", 200.0, S, True),
        ("2015-07-01 12:00:00", 0.0, G, False),
        # hour boundaries, low demand
        ("2015-07-01 17:00:00", 100.0, G, False),
        ("2015-07-01 17:59:59", 100.0, G, False),
        ("2015-07-01 18:00:00", 100.0, S, False),
        ("2015-07-01 22:00:00", 100.0, S, False),
        ("2015-07-01 22:59:59", 100.0, S, False),
        ("2015-07-01 23:00:00", 100.0, G, False),
        # both rules at once; overload rides on top of the mode
        ("2015-07-01 18:00:00", 160.0, S, False),
        ("2015-07-01 20:00:00", 200.0, S, True),
        ("2015-07-01 23:00:00", 160.0, G, False),
        ("2015-07-01 03:00:00", 250.0, S, True),
    ],
)
def test_truth_table(ts, demand, mode, overload):
    assert decide(ts, demand) == {"mode": mode, "overload": overload}


def test_accepts_datetime_and_timestamp():
    assert decide(datetime(2015, 7, 1, 19), 100)["mode"] == S
    assert decide(pd.Timestamp("2015-07-01 06:00"), 100)["mode"] == G
    assert decide("2015-07-01T21:00", 100)["mode"] == S


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -0.01, -100, "abc", None, True])
def test_bad_demand_raises(bad):
    with pytest.raises((ValueError, TypeError)):
        decide("2015-07-01 12:00:00", bad)


@pytest.mark.parametrize("bad", ["not a time", 1435752000, None])
def test_bad_timestamp_raises(bad):
    with pytest.raises((ValueError, TypeError)):
        decide(bad, 100.0)
