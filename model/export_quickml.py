"""Write data/quickml_train.csv and docs/quickml_columns.md.

The CSV is build_features() on all 4,000 training rows, cut to
QUICKML_FEATURES, plus the target. Upload it to QuickML as the training set.

Usage: python model/export_quickml.py
"""

import sys
from pathlib import Path

if __package__ in (None, ""):  # run as `python model/export_quickml.py`
    sys.path[0] = str(Path(__file__).resolve().parents[1])

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

from model.data import DOCS_DIR, ROOT, TARGET, load_train
from model.features import HOUR_BLOCKS, QUICKML_FEATURES, QUICKML_REFERENCE, build_features
from model.report import Report

CSV_PATH = ROOT / "data" / "quickml_train.csv"
FLOAT_FORMAT = "%.10g"  # drops float noise such as 6.660000000000002; exact to 1e-10


def _hours(name: str) -> str:
    h = HOUR_BLOCKS[name]
    return f"{h.start}" if len(h) == 1 else f"{h.start} to {h.stop - 1}"


FORMULAS = {
    **{
        f"blk_{name}": f"1 if the timestamp's hour is {_hours(name)}, else 0"
        for name in HOUR_BLOCKS
    },
    "cool_24": "max(0, ambient_temp_c - 24)",
    TARGET: "target from train_telemetry.csv (not sent to the endpoint)",
}


def quickml_frame(train: pd.DataFrame) -> pd.DataFrame:
    return build_features(train)[QUICKML_FEATURES].assign(**{TARGET: train[TARGET]})


def main() -> None:
    frame = quickml_frame(load_train())
    frame.to_csv(CSV_PATH, index=False, float_format=FLOAT_FORMAT)
    print(f"Wrote {CSV_PATH} with shape {frame.shape}")

    missing = set(frame.columns) - set(FORMULAS)
    assert not missing, f"document these columns in FORMULAS: {sorted(missing)}"
    cols = pd.DataFrame(
        {
            "formula": [FORMULAS[c] for c in frame.columns],
            "type": ["integer (0/1)" if pd.api.types.is_integer_dtype(frame[c]) else "float" for c in frame.columns],
            "min": np.array([frame[c].min() for c in frame.columns], dtype=object),  # 0/1 stay ints
            "max": np.array([frame[c].max() for c in frame.columns], dtype=object),
        },
        index=pd.Index(frame.columns, name="column"),
    )

    rep = Report("QuickML training columns", "python model/export_quickml.py")
    rep.add(
        f"`data/quickml_train.csv`: {frame.shape[0]:,} rows x {frame.shape[1]} columns, every row of "
        "`train_telemetry.csv`. Built with `build_features()` in `model/features.py`, the same code "
        "`predict.py` and the app use. Target column: `target_demand_kw`.",
    )
    rep.table(cols)
    X, y = frame[QUICKML_FEATURES], frame[TARGET]
    ols = LinearRegression().fit(X, y)
    in_sample = float(np.sqrt(np.mean((y - ols.predict(X)) ** 2)))
    coefs = pd.DataFrame(
        {"coefficient": [ols.intercept_, *ols.coef_]},
        index=pd.Index(["intercept (night base)", *QUICKML_FEATURES], name="term"),
    )
    rep.add(
        "## Reference fit",
        "OLS with an intercept on this CSV. A linear QuickML model trained on the same file should "
        f"land close to these numbers. RMSE ALL (in-sample): {in_sample:.3f} kW.",
    )
    rep.table(coefs, floatfmt=".3f")
    rep.add(
        "## Notes",
        f"- **Reference level.** The hour blocks are dummy-coded with `{QUICKML_REFERENCE}` "
        f"(hours {_hours(QUICKML_REFERENCE.removeprefix('blk_'))}) left out: a row with every `blk_` "
        "column at 0 is a night hour, and the model's intercept is the night base load.\n"
        "- **No timestamp column.** Hour information enters only through the block flags, so QuickML "
        "cannot pick up the date and extrapolate it into the test window.\n"
        "- **Algorithm.** Choose a linear algorithm (linear or ridge regression). Tree ensembles "
        "cannot extend the cooling line past the hottest training temperature; see "
        "`docs/model_report.md`.\n"
        "- **Endpoint input.** Send `build_features(df)[QUICKML_FEATURES]` for each forecast row, "
        "in this column order.",
    )
    rep.write(DOCS_DIR / "quickml_columns.md")


if __name__ == "__main__":
    main()
