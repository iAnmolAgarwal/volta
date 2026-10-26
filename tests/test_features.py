import numpy as np
import pandas as pd
import pytest

from model.data import TARGET, load_test, load_train
from model.features import FEATURE_COLUMNS, FILL_VALUES, build_features

EXPECTED_COLUMNS = (
    [f"h_{h}" for h in range(24)]
    + ["blk_night", "blk_dawn", "blk_morning", "blk_day", "blk_evening", "blk_late"]
    + ["hour_sin", "hour_cos", "weekday", "is_weekend", "doy_sin", "doy_cos"]
    + ["cool_22", "cool_23", "cool_24", "cool_25", "heat15", "temp", "temp_sq"]
    + ["humidity", "solar", "is_daylight"]
)


@pytest.fixture(scope="module")
def raw():
    """Train (target dropped) followed by the sample test: 5,000 hourly rows."""
    rows = pd.concat([load_train().drop(columns=TARGET), load_test()], ignore_index=True)
    rows["timestamp"] = rows["timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")  # as read from CSV
    return rows


@pytest.fixture(scope="module")
def batch(raw):
    return build_features(raw)


def test_batch_equals_row_by_row(raw, batch):
    rows = pd.concat([build_features(raw.iloc[[i]]) for i in range(len(raw))])
    pd.testing.assert_frame_equal(batch, rows)


def test_batch_equals_24_hour_windows(raw, batch):
    windows = pd.concat([build_features(raw.iloc[i : i + 24]) for i in range(0, len(raw), 24)])
    pd.testing.assert_frame_equal(batch, windows)


def test_row_order_does_not_matter(raw, batch):
    shuffled = raw.sample(frac=1, random_state=0)
    pd.testing.assert_frame_equal(build_features(shuffled).loc[batch.index], batch)


def test_no_nans_and_fixed_column_order(batch):
    assert list(batch.columns) == EXPECTED_COLUMNS == FEATURE_COLUMNS
    assert not batch.isna().any().any()
    assert np.isfinite(batch.to_numpy(dtype=float)).all()


def test_target_column_is_ignored():
    train = load_train()
    pd.testing.assert_frame_equal(build_features(train), build_features(train.drop(columns=TARGET)))


def test_known_values():
    row = pd.DataFrame(
        {
            "timestamp": ["2015-07-04 18:00:00"],  # a Saturday
            "ambient_temp_c": [30.0],
            "humidity_pct": [55.0],
            "solar_irradiance_wm2": [0.0],
        }
    )
    f = build_features(row).iloc[0]
    assert f["h_18"] == 1 and f.filter(like="h_").sum() == 1
    assert f["blk_evening"] == 1 and f.filter(like="blk_").sum() == 1
    assert f["weekday"] == 5 and f["is_weekend"] == 1
    assert (f["cool_22"], f["cool_24"], f["cool_25"]) == (8.0, 6.0, 5.0)
    assert f["heat15"] == 0.0 and f["temp_sq"] == 900.0
    assert f["is_daylight"] == 0


def test_missing_weather_uses_fixed_fill_values():
    row = pd.DataFrame(
        {
            "timestamp": ["2015-07-04 12:00:00"],
            "ambient_temp_c": [None],
            "humidity_pct": ["n/a"],
            "solar_irradiance_wm2": [np.nan],
        }
    )
    f = build_features(row).iloc[0]
    assert f["temp"] == FILL_VALUES["ambient_temp_c"]
    assert f["humidity"] == FILL_VALUES["humidity_pct"]
    assert f["solar"] == FILL_VALUES["solar_irradiance_wm2"]


def test_bad_timestamp_raises():
    row = pd.DataFrame(
        {"timestamp": ["not a time"], "ambient_temp_c": [20.0], "humidity_pct": [50.0], "solar_irradiance_wm2": [0.0]}
    )
    with pytest.raises(ValueError):
        build_features(row)
