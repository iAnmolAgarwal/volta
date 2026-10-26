import random

import numpy as np
import pandas as pd
import pytest

from backend.battery import BatteryParams, simulate
from backend.controller import GRID_MODE, STORAGE_MODE, decide
from model.data import ROOT, TARGET, load_test
from model.features import QUICKML_FEATURES, build_features

S, G = STORAGE_MODE, GRID_MODE
NO_PV = BatteryParams(pv_kw_per_wm2=0.0)
PARAM_SETS = [
    BatteryParams(),
    NO_PV,
    BatteryParams(capacity_kwh=50.0),
    BatteryParams(start_soc=0.10),
    BatteryParams(start_soc=1.00),
    BatteryParams(grid_charge_kw=0.0, grid_cap_kw=0.0),
    BatteryParams(pv_kw_per_wm2=1.0, charge_kw=40.0, grid_charge_kw=40.0),
    BatteryParams(min_soc=0.2, start_soc=0.5, max_soc=0.9, step_hours=0.25),
]


def random_schedule(seed: int, hours: int = 2000) -> list[tuple[str, float, float]]:
    rng = random.Random(seed)
    return [(rng.choice([S, G]), rng.uniform(0, 400), rng.choice([0.0, rng.uniform(0, 1000)])) for _ in range(hours)]


def test_defaults_are_the_documented_ones():
    p = BatteryParams()
    assert (p.capacity_kwh, p.start_soc, p.min_soc, p.max_soc) == (800.0, 0.80, 0.10, 1.00)
    assert (p.max_discharge_kw, p.charge_kw, p.grid_charge_kw) == (100.0, 150.0, 75.0)
    assert (p.grid_cap_kw, p.pv_kw_per_wm2, p.step_hours) == (120.0, 0.25, 1.0)


@pytest.mark.parametrize("params", PARAM_SETS)
@pytest.mark.parametrize("seed", range(5))
def test_limits_are_never_crossed(params, seed):
    p = params
    schedule = random_schedule(seed)
    steps = simulate(schedule, p)
    assert len(steps) == len(schedule)
    eps = 1e-9
    for prev, (mode, demand, solar), step in zip([None, *steps], schedule, steps):
        charge = max(0.0, -step.battery_kw)
        assert p.min_soc - eps <= step.soc_end <= p.max_soc + eps
        assert -p.charge_kw - eps <= step.battery_kw <= p.max_discharge_kw + eps
        assert step.battery_kw <= step.demand_kw + eps  # never discharges more than the load
        assert step.pv_kw == pytest.approx(p.pv_kw_per_wm2 * solar)
        assert step.grid_kw >= 0
        assert step.grid_kw + step.pv_kw + step.battery_kw >= step.demand_kw - 1e-6  # the load is always met
        energy_out = (step.soc_start - step.soc_end) * p.capacity_kwh
        assert energy_out == pytest.approx(step.battery_kw * p.step_hours, abs=1e-6)
        grid_charge = charge - min(step.pv_kw, charge)
        if mode == S:
            assert grid_charge <= eps  # storage mode charges from PV only
            assert step.grid_kw >= min(step.demand_kw - step.pv_kw, p.grid_cap_kw) - 1e-6  # shaves only above the cap
        else:
            assert step.battery_kw <= eps  # grid mode never discharges
            assert grid_charge <= p.grid_charge_kw + eps
        if prev is not None:
            assert step.soc_start == prev.soc_end


@pytest.mark.parametrize("params", PARAM_SETS)
def test_mode_is_never_changed(params):
    schedule = random_schedule(seed=42)
    assert [s.mode for s in simulate(schedule, params)] == [m for m, _, _ in schedule]


def test_follows_the_controller_on_the_sample_test():
    test = load_test()
    demand = 100 + 4 * (test["ambient_temp_c"] - 20).clip(lower=0)  # any plausible curve
    decisions = [decide(ts, d) for ts, d in zip(test["timestamp"], demand)]
    steps = simulate((d["mode"], kw, s) for d, kw, s in zip(decisions, demand, test["solar_irradiance_wm2"]))
    assert [s.mode for s in steps] == [d["mode"] for d in decisions]


# --- peak shaving ------------------------------------------------------------------


@pytest.mark.parametrize(
    "demand, battery, grid",
    [(110.0, 0.0, 110.0), (120.0, 0.0, 120.0), (200.0, 80.0, 120.0), (220.0, 100.0, 120.0), (300.0, 100.0, 200.0)],
)
def test_storage_covers_only_the_import_above_the_cap(demand, battery, grid):
    (step,) = simulate([(S, demand, 0.0)])
    assert (step.battery_kw, step.grid_kw) == pytest.approx((battery, grid))


def test_storage_discharges_down_to_the_floor_and_stays_in_storage_mode():
    p = BatteryParams(capacity_kwh=250.0, start_soc=0.5)  # 100 kWh above the 25 kWh floor
    steps = simulate([(S, 300.0, 0.0)] * 3, p)
    assert [s.battery_kw for s in steps] == pytest.approx([100, 0, 0])
    assert [s.grid_kw for s in steps] == pytest.approx([200, 300, 300])
    assert [s.soc_end for s in steps] == pytest.approx([0.1, 0.1, 0.1])
    assert {s.mode for s in steps} == {S}


# --- solar ------------------------------------------------------------------------


def test_pv_charges_the_battery_in_storage_mode():
    (step,) = simulate([(S, 100.0, 400.0)])  # 100 kW of PV, demand under the cap
    assert step.pv_kw == pytest.approx(100.0)
    assert (step.battery_kw, step.grid_kw) == pytest.approx((-100.0, 100.0))
    assert step.soc_end == pytest.approx(0.8 + 100 / 800)


def test_pv_above_the_charge_limit_serves_the_load():
    (step,) = simulate([(S, 100.0, 800.0)])  # 200 kW of PV, 150 kW charge limit
    assert (step.battery_kw, step.grid_kw) == pytest.approx((-150.0, 50.0))


def test_pv_and_peak_shaving_in_the_same_hour():
    # 200 kW demand, 40 kW PV into the battery, 80 kW shaved: net discharge 40 kW, grid at the cap
    (step,) = simulate([(S, 200.0, 160.0)])
    assert (step.pv_kw, step.battery_kw, step.grid_kw) == pytest.approx((40.0, 40.0, 120.0))


def test_grid_mode_charges_from_pv_first_then_the_grid():
    steps = simulate([(G, 100.0, 0.0), (G, 100.0, 200.0), (G, 100.0, 560.0)], BatteryParams(start_soc=0.5))
    # no PV: 75 kW from the grid; 50 kW PV + 75 kW grid; 140 kW PV + 10 kW grid (150 kW limit)
    assert [s.battery_kw for s in steps] == pytest.approx([-75.0, -125.0, -150.0])
    assert [s.grid_kw for s in steps] == pytest.approx([175.0, 175.0, 110.0])


def test_full_battery_sends_pv_to_the_load_and_curtails_the_surplus():
    p = BatteryParams(start_soc=1.0)
    steps = simulate([(G, 100.0, 160.0), (G, 100.0, 800.0), (S, 100.0, 800.0)], p)
    assert [s.battery_kw for s in steps] == pytest.approx([0.0, 0.0, 0.0])
    assert [s.grid_kw for s in steps] == pytest.approx([60.0, 0.0, 0.0])  # 40 kW PV serves load; 200 kW PV covers it
    assert {s.soc_end for s in steps} == {1.0}


def test_grid_charging_is_cut_first_near_full():
    p = BatteryParams(start_soc=0.95)  # 40 kWh of room
    (step,) = simulate([(G, 100.0, 120.0)], p)  # 30 kW PV + 75 kW grid offered
    assert step.battery_kw == pytest.approx(-40.0)
    assert step.grid_kw == pytest.approx(100.0 + 10.0)  # 30 kW PV + 10 kW grid charge
    assert step.soc_end == pytest.approx(1.0)


def test_no_pv_at_night():
    (step,) = simulate([(S, 100.0, 0.0)])
    assert (step.pv_kw, step.battery_kw, step.grid_kw) == (0.0, 0.0, 100.0)


# --- targets on the sample -------------------------------------------------------------


def formula_predictions(df: pd.DataFrame) -> np.ndarray:
    """OLS on data/quickml_train.csv: agrees with the live QuickML endpoint to 0.12 kW RMS."""
    train = pd.read_csv(ROOT / "data" / "quickml_train.csv")
    X = np.column_stack([np.ones(len(train)), train[QUICKML_FEATURES]])
    coef, *_ = np.linalg.lstsq(X, train[TARGET], rcond=None)
    return np.round(np.column_stack([np.ones(len(df)), build_features(df)[QUICKML_FEATURES]]) @ coef, 2)


def test_sample_soc_is_lively_with_the_default_params():
    test = load_test()
    demand = formula_predictions(test)
    decisions = [decide(ts, d) for ts, d in zip(test["timestamp"], demand)]
    steps = simulate((d["mode"], kw, s) for d, kw, s in zip(decisions, demand, test["solar_irradiance_wm2"]))
    p = BatteryParams()
    soc = np.array([s.soc_end for s in steps])
    battery = np.array([s.battery_kw for s in steps])
    assert np.mean(soc <= p.min_soc + 1e-9) < 0.15  # at the floor
    assert np.mean(soc >= p.max_soc - 1e-9) < 0.30  # full
    for i in range(len(steps) - 23):  # every 24-hour window shows a charge/discharge cycle
        window = slice(i, i + 24)
        assert (battery[window] > 0).any() and (battery[window] < 0).any(), i
        assert soc[window].max() - soc[window].min() >= 0.20, i


@pytest.mark.parametrize(
    "kwargs",
    [
        {"capacity_kwh": 0},
        {"step_hours": 0},
        {"min_soc": 0.9},  # above start_soc
        {"start_soc": 0.05},  # below min_soc
        {"max_soc": 1.1},
        {"charge_kw": -1},
        {"max_discharge_kw": -1},
        {"grid_charge_kw": 200.0},  # above charge_kw
        {"grid_cap_kw": -1},
        {"pv_kw_per_wm2": -0.1},
    ],
)
def test_invalid_params_raise(kwargs):
    with pytest.raises(ValueError):
        BatteryParams(**kwargs)


@pytest.mark.parametrize(
    "step",
    [(S, float("nan"), 0.0), (G, -5.0, 0.0), ("Solar Mode", 100.0, 0.0), (S, 100.0, -1.0), (G, 100.0, float("nan"))],
)
def test_bad_input_raises(step):
    with pytest.raises(ValueError):
        simulate([step])
