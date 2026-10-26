"""Profile the starter kit data and write docs/data_profile.md.

Usage: python model/profile.py
"""

import sys
from pathlib import Path

if __package__ in (None, ""):  # run as `python model/profile.py`
    sys.path[0] = str(Path(__file__).resolve().parents[1])

import pandas as pd

from model.data import DOCS_DIR, TARGET, load_test, load_train
from model.report import Report

TEMP_BANDS = [-5, 0, 5, 10, 15, 20, 22, 24, 26, 28, 30, 32, 35, 40]
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def overview(df: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame(
        {"dtype": df.dtypes.astype(str), "nulls": df.isna().sum(), "unique": df.nunique()}
    )


def time_gaps(df: pd.DataFrame) -> list[str]:
    ts = df["timestamp"]
    steps = ts.diff().dropna()
    off = steps[steps != pd.Timedelta(hours=1)]
    return [
        f"- range: {ts.min()} to {ts.max()} ({len(df):,} rows)",
        f"- sorted ascending: {ts.is_monotonic_increasing}",
        f"- duplicate timestamps: {ts.duplicated().sum()}",
        f"- steps other than 1 hour: {len(off)}"
        + (f" (largest {off.max()})" if len(off) else ""),
    ]


def demand_by(df: pd.DataFrame, key: pd.Series, name: str) -> pd.DataFrame:
    g = df.groupby(key.rename(name), observed=True)[TARGET]
    return g.agg(mean="mean", std="std", rows="count").astype(object)  # keep counts as ints


def temp_range(df: pd.DataFrame) -> dict:
    t = df["ambient_temp_c"]
    return {
        "min": t.min(),
        "p01": t.quantile(0.01),
        "p50": t.median(),
        "p99": t.quantile(0.99),
        "max": t.max(),
        "share > 24 C": (t > 24).mean(),
    }


def main() -> None:
    train, test = load_train(), load_test()
    temp_band = lambda d: pd.cut(d["ambient_temp_c"], TEMP_BANDS)  # noqa: E731

    rep = Report("Data profile", "python model/profile.py")

    for name, df in [("train_telemetry.csv", train), ("sample_test_input.csv", test)]:
        rep.add(f"## {name}", f"Shape: {df.shape[0]:,} rows x {df.shape[1]} columns.")
        rep.table(overview(df))
        rep.add("Time gaps:\n" + "\n".join(time_gaps(df)))
        rep.table(df.drop(columns="timestamp").describe().T)

    gap_h = (test["timestamp"].min() - train["timestamp"].max()) / pd.Timedelta(hours=1)
    rep.add(
        "## Train vs test in time",
        f"The test file starts {gap_h:g} hour after the last training row, so it is the "
        "next 1,000 hours (mid-June to late July). Any model is extrapolating forward "
        "in time into summer.",
    )

    rep.add("## Mean demand by hour (train)")
    rep.table(demand_by(train, train["timestamp"].dt.hour, "hour").T, floatfmt=".1f")

    rep.add("## Mean demand by weekday (train)")
    wd = train["timestamp"].dt.day_of_week.map(dict(enumerate(WEEKDAYS)))
    wd = pd.Categorical(wd, categories=WEEKDAYS, ordered=True)
    rep.table(demand_by(train, pd.Series(wd, index=train.index), "weekday").T, floatfmt=".1f")

    rep.add("## Mean demand by temperature band, °C (train)")
    rep.table(demand_by(train, temp_band(train), "temp_band"), floatfmt=".1f")

    rep.add("## Train vs test temperature range, °C")
    rep.table(pd.DataFrame({"train": temp_range(train), "test": temp_range(test)}).T)
    counts = pd.DataFrame(
        {
            "train rows": temp_band(train).value_counts(sort=False),
            "test rows": temp_band(test).value_counts(sort=False),
        }
    )
    counts.index = counts.index.astype(str).rename("temp_band")
    rep.table(counts)
    outside = ~test["ambient_temp_c"].between(train["ambient_temp_c"].min(), train["ambient_temp_c"].max())
    rep.add(
        f"Test rows outside the training temperature range: {outside.sum()}. "
        f"Test rows above 24 °C: {(test['ambient_temp_c'] > 24).mean():.0%} "
        f"(train: {(train['ambient_temp_c'] > 24).mean():.0%}), so the cooling slope "
        "decides most of the test error."
    )

    rep.write(DOCS_DIR / "data_profile.md")


if __name__ == "__main__":
    main()
