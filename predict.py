"""HackSphere 3.0 predictions: telemetry rows -> features -> QuickML endpoint -> kW.

    python predict.py                                  # preview on sample_test_input.csv
    python predict.py --input X.csv --output Y.csv     # writes timestamp,target_demand_kw

predict(input_df) returns one float per input row, in input order. There is no
fallback curve: a missing configuration or a failed endpoint call raises.
Endpoint settings come from environment variables; see .env.example.
"""

import argparse
import sys

import numpy as np
import pandas as pd

from model.data import INPUT_COLUMNS
from model.features import QUICKML_FEATURES, build_features
from model.quickml_client import ConfigError, PredictionError, QuickMLClient

_client = None  # built from the environment on first use, then reused


def get_client() -> QuickMLClient:
    global _client
    if _client is None:
        _client = QuickMLClient.from_env()
    return _client


def predict(input_df: pd.DataFrame, client: QuickMLClient | None = None) -> np.ndarray:
    """Parameters:

        input_df (pandas.DataFrame): DataFrame with columns
        ['timestamp', 'ambient_temp_c', 'humidity_pct', 'solar_irradiance_wm2']

    Returns:
        numpy.ndarray: Predicted demand (kW) for each input row, in input order.

    Raises ConfigError if no endpoint is configured and PredictionError if the
    endpoint call fails. It never substitutes made-up values.
    """
    missing = [c for c in INPUT_COLUMNS if c not in input_df.columns]
    if missing:
        raise ValueError(f"input is missing columns: {', '.join(missing)}")
    features = build_features(input_df)[QUICKML_FEATURES]
    preds = (client or get_client()).predict(features)
    if len(preds) != len(input_df):
        raise PredictionError(f"got {len(preds)} predictions for {len(input_df)} rows")
    return preds


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Predict hourly demand (kW) with the QuickML endpoint.")
    parser.add_argument("--input", default="sample_test_input.csv", help="telemetry CSV (default: %(default)s)")
    parser.add_argument("--output", help="write timestamp,target_demand_kw here; omit to print a preview")
    args = parser.parse_args(argv)

    print(f"Predicting {args.input}...")
    df = pd.read_csv(args.input)
    try:
        preds = predict(df)
    except (ConfigError, PredictionError, ValueError) as e:
        print(f"predict.py: error: {e}", file=sys.stderr)
        return 1

    if args.output:
        out = pd.DataFrame({"timestamp": df["timestamp"], "target_demand_kw": preds})
        out.to_csv(args.output, index=False, float_format="%.2f")
        print(f"Wrote {len(out)} predictions to {args.output}")
    else:
        print(f"Generated {len(preds)} predictions. First 5 samples:\n{preds[:5]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
