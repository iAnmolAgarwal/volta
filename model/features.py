"""The one feature builder for the QuickML training CSV, predict.py and the app.

Every feature depends only on its own row: no target lags (the test has no
target) and no rolling windows, so N rows in one batch give exactly the same
features as N single-row calls. tests/test_features.py enforces this.

Keep this module on pandas + numpy only so it can be copied into any runtime.
"""

import numpy as np
import pandas as pd

COOL_THRESHOLDS = (22, 23, 24, 25)
HEAT_THRESHOLD = 15

# Hour blocks with flat demand in the training data (see docs/model_report.md).
HOUR_BLOCKS = {
    "night": range(0, 6),
    "dawn": range(6, 7),
    "morning": range(7, 10),
    "day": range(10, 18),
    "evening": range(18, 23),
    "late": range(23, 24),
}

# Fixed fallbacks for missing weather values (training medians). Constants, not
# batch statistics, so filling never depends on what else is in the batch.
FILL_VALUES = {"ambient_temp_c": 18.55, "humidity_pct": 70.75, "solar_irradiance_wm2": 8.0}

FEATURE_GROUPS = {
    "hour_onehot": [f"h_{h}" for h in range(24)],
    "hour_block": [f"blk_{name}" for name in HOUR_BLOCKS],
    "hour_cyc": ["hour_sin", "hour_cos"],
    "weekday": ["weekday", "is_weekend"],
    "doy_cyc": ["doy_sin", "doy_cos"],
    "cooling": [f"cool_{t}" for t in COOL_THRESHOLDS],
    "heating": [f"heat{HEAT_THRESHOLD}"],
    "temp": ["temp", "temp_sq"],
    "humidity": ["humidity"],
    "solar": ["solar", "is_daylight"],
}
FEATURE_COLUMNS = [c for cols in FEATURE_GROUPS.values() for c in cols]


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Map raw telemetry rows to model features, one output row per input row.

    Needs columns timestamp, ambient_temp_c, humidity_pct, solar_irradiance_wm2.
    Any other column (including target_demand_kw) is ignored. Raises on an
    unparseable timestamp; fills missing weather values from FILL_VALUES.
    """
    ts = pd.to_datetime(df["timestamp"], format="ISO8601")
    weather = {
        col: pd.to_numeric(df[col], errors="coerce").fillna(fill).astype(float)
        for col, fill in FILL_VALUES.items()
    }
    temp = weather["ambient_temp_c"]
    humidity = weather["humidity_pct"].clip(0, 100)
    solar = weather["solar_irradiance_wm2"].clip(lower=0)

    hour = ts.dt.hour
    weekday = ts.dt.day_of_week
    doy_angle = 2 * np.pi * (ts.dt.day_of_year - 1) / 365
    hour_angle = 2 * np.pi * hour / 24

    out = {f"h_{h}": (hour == h).astype(int) for h in range(24)}
    out |= {f"blk_{name}": hour.isin(hours).astype(int) for name, hours in HOUR_BLOCKS.items()}
    out |= {
        "hour_sin": np.sin(hour_angle),
        "hour_cos": np.cos(hour_angle),
        "weekday": weekday.astype(int),
        "is_weekend": (weekday >= 5).astype(int),
        "doy_sin": np.sin(doy_angle),
        "doy_cos": np.cos(doy_angle),
    }
    out |= {f"cool_{t}": (temp - t).clip(lower=0) for t in COOL_THRESHOLDS}
    out |= {
        f"heat{HEAT_THRESHOLD}": (HEAT_THRESHOLD - temp).clip(lower=0),
        "temp": temp,
        "temp_sq": temp**2,
        "humidity": humidity,
        "solar": solar,
        "is_daylight": (solar > 0).astype(int),
    }
    return pd.DataFrame(out, index=df.index)[FEATURE_COLUMNS]
