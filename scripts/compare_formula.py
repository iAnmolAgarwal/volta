"""Compare predictions from the live endpoint with our reference formula.

Usage: python scripts/compare_formula.py /tmp/p.csv [sample_test_input.csv]

The reference is OLS on data/quickml_train.csv (hour blocks + cool_24), the
same fit docs/quickml_columns.md lists. A linear QuickML model trained on that
file should agree to within about 1 kW RMS.
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

sys.path[0] = str(Path(__file__).resolve().parents[1])

from model.data import ROOT, TARGET  # noqa: E402
from model.features import QUICKML_FEATURES, build_features  # noqa: E402


def compare(pred_path: Path, input_path: Path) -> dict:
    train = pd.read_csv(ROOT / "data" / "quickml_train.csv")
    formula = LinearRegression().fit(train[QUICKML_FEATURES], train[TARGET])
    raw, preds = pd.read_csv(input_path), pd.read_csv(pred_path)
    if preds["timestamp"].tolist() != raw["timestamp"].tolist():
        raise SystemExit("predictions and input do not have the same timestamps in the same order")
    diff = preds["target_demand_kw"].to_numpy() - formula.predict(build_features(raw)[QUICKML_FEATURES])
    return {"rows": len(diff), "rms_kw": float(np.sqrt(np.mean(diff**2))), "max_abs_kw": float(np.abs(diff).max()),
            "mean_kw": float(diff.mean())}


if __name__ == "__main__":
    pred = Path(sys.argv[1])
    inp = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "sample_test_input.csv"
    r = compare(pred, inp)
    print(f"{r['rows']} rows: RMS difference {r['rms_kw']:.3f} kW, max {r['max_abs_kw']:.3f} kW, mean {r['mean_kw']:+.3f} kW")
