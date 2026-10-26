import random

import pytest

from backend.battery import BatteryParams, simulate
from backend.controller import GRID_MODE, STORAGE_MODE, decide
from model.data import load_test

S, G = STORAGE_MODE, GRID_MODE
PARAM_SETS = [
    BatteryParams(),
    BatteryParams(capacity_kwh=50.0),
    BatteryParams(start_soc=0.10),
    BatteryParams(start_soc=1.00),
    BatteryParams(min_soc=0.2, start_soc=0.5, max_soc=0.9, step_hours=0.25),
]


def random_schedule(seed: int, hours: int = 2000) -> list[tuple[str, float]]:
    rng = random.Random(seed)
    return [(rng.choice([S, G]), rng.uniform(0, 400)) for _ in range(hours)]


def test_defaults_match_the_spec():
    p = BatteryParams()
    assert (p.capacity_kwh, p.start_soc, p.min_soc, p.max_soc) == (500.0, 0.80, 0.10, 1.00)
    assert (p.max_discharge_kw, p.charge_kw, p.step_hours) == (150.0, 100.0, 1.0)


@pytest.mark.parametrize("params", PARAM_SETS)
@pytest.mark.parametrize("seed", range(5))
def test_limits_are_never_crossed(params, seed):
    schedule = random_schedule(seed)
    steps = simulate(schedule, params)
    assert len(steps) == len(schedule)
    for prev, step in zip([None, *steps], steps):
        assert params.min_soc <= step.soc_end <= params.max_soc
        assert -params.charge_kw <= step.battery_kw <= params.max_discharge_kw
        assert step.battery_kw <= step.demand_kw  # never discharges more than the load
        assert step.grid_kw >= 0
        assert step.battery_kw + step.grid_kw == pytest.approx(step.demand_kw)
        energy_out = (step.soc_start - step.soc_end) * params.capacity_kwh
        assert energy_out == pytest.approx(step.battery_kw * params.step_hours, abs=1e-9)
        if prev is not None:
            assert step.soc_start == prev.soc_end


def test_mode_is_never_changed():
    schedule = random_schedule(seed=42)
    assert [s.mode for s in simulate(schedule)] == [m for m, _ in schedule]


def test_follows_the_controller_on_the_sample_test():
    test = load_test()
    demand = 100 + 4 * (test["ambient_temp_c"] - 20).clip(lower=0)  # any plausible curve
    decisions = [decide(ts, d) for ts, d in zip(test["timestamp"], demand)]
    steps = simulate((d["mode"], kw) for d, kw in zip(decisions, demand))
    assert [s.mode for s in steps] == [d["mode"] for d in decisions]


def test_storage_discharges_until_the_floor():
    steps = simulate([(S, 200.0)] * 4)
    assert [s.battery_kw for s in steps] == pytest.approx([150, 150, 50, 0])
    assert [s.grid_kw for s in steps] == pytest.approx([50, 50, 150, 200])
    assert [s.soc_end for s in steps] == pytest.approx([0.5, 0.2, 0.1, 0.1])
    assert {s.mode for s in steps} == {S}  # still storage mode with an empty battery


def test_discharge_is_capped_by_demand():
    (step,) = simulate([(S, 80.0)])
    assert (step.battery_kw, step.grid_kw, step.soc_end) == pytest.approx((80.0, 0.0, 0.64))


def test_grid_mode_charges_until_full():
    steps = simulate([(G, 120.0)] * 3, BatteryParams(start_soc=0.95))
    assert [s.battery_kw for s in steps] == pytest.approx([-25, 0, 0])
    assert [s.grid_kw for s in steps] == pytest.approx([145, 120, 120])
    assert steps[-1].soc_end == 1.0


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
    ],
)
def test_invalid_params_raise(kwargs):
    with pytest.raises(ValueError):
        BatteryParams(**kwargs)


@pytest.mark.parametrize("step", [(S, float("nan")), (G, -5.0), ("Solar Mode", 100.0)])
def test_bad_input_raises(step):
    with pytest.raises(ValueError):
        simulate([step])
