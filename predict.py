"""HackSphere 3.0 predictions: telemetry rows -> our Catalyst proxy -> QuickML -> kW.

    python predict.py                                  # preview on sample_test_input.csv
    python predict.py --input X.csv --output Y.csv     # writes timestamp,target_demand_kw

Self-contained on purpose: needs only pandas, numpy and requests, so it runs
when copied alone into an empty folder. All rows go to the proxy in one POST
({proxy}/api/predict); the proxy builds the QuickML features and calls the
published QuickML endpoint. PREDICT_PROXY_URL overrides DEFAULT_PROXY_URL.

predict(input_df) returns one float per input row, in input order (the input
may be unsorted and may carry extra columns in any order). Missing weather
values are interpolated in time order, then forward/back-filled at the ends.
There is no fallback curve: if the proxy cannot be reached or answers badly,
this raises.
"""

import argparse
import math
import os
import sys
import time

import numpy as np
import pandas as pd
import requests

DEFAULT_PROXY_URL = "https://microgrid-proxy-50047164504.development.catalystappsail.in"  # AppSail (Development); not a secret
TIMEOUT_S = 120
ATTEMPTS = 3  # connection errors, timeouts and 5xx are retried; kept at 3 to spare the QuickML free tier
BACKOFF_S = [10, 30]  # long waits, so a QuickML blip has time to pass before the next attempt
RETRY_4XX = {408, 429}  # the Catalyst gateway answers 408 after about 30 s while QuickML is slow: retried
INPUT_COLUMNS = ["timestamp", "ambient_temp_c", "humidity_pct", "solar_irradiance_wm2"]

# Inline copy of the QuickML columns built by model/features.py (a test keeps them
# identical): hour-block flags with night (0-5) as the reference, plus the cooling hinge.
HOUR_BLOCKS = {"blk_dawn": (6, 6), "blk_morning": (7, 9), "blk_day": (10, 17), "blk_evening": (18, 22), "blk_late": (23, 23)}
FILL_TEMP_C = 18.55  # model/features.py FILL_VALUES["ambient_temp_c"]


class PredictionError(RuntimeError):
    """The proxy could not be reached, or answered with something unusable."""


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """The QuickML feature columns for each row (row-local, same as model/features.py)."""
    hour = pd.to_datetime(df["timestamp"], format="ISO8601").dt.hour
    temp = pd.to_numeric(df["ambient_temp_c"], errors="coerce").fillna(FILL_TEMP_C).astype(float)
    out = {name: hour.between(lo, hi).astype(int) for name, (lo, hi) in HOUR_BLOCKS.items()}
    out["cool_24"] = (temp - 24).clip(lower=0)
    return pd.DataFrame(out, index=df.index)


def fill_missing_weather(df: pd.DataFrame) -> pd.DataFrame:
    """INPUT_COLUMNS with gaps in the weather columns filled, rows in the original order.

    Values are interpolated against time (so uneven gaps are weighted correctly)
    after sorting by timestamp, then the leading/trailing gaps are back/forward
    filled. A column with no values at all stays missing; the proxy fills it.
    """
    out = df[INPUT_COLUMNS].copy()
    ts = pd.to_datetime(out["timestamp"], format="ISO8601")
    weather = out[INPUT_COLUMNS[1:]].apply(pd.to_numeric, errors="coerce").astype(float)
    order = np.argsort(ts.to_numpy(), kind="stable")
    in_time = weather.iloc[order].set_axis(ts.iloc[order])
    filled = in_time.interpolate(method="time").ffill().bfill()
    weather.iloc[order] = filled.to_numpy()
    out[INPUT_COLUMNS[1:]] = weather
    return out


def _rows(df: pd.DataFrame) -> list[dict]:
    """JSON-safe raw rows: original timestamp strings, numbers, and null for missing values."""
    rows = []
    for rec in df[INPUT_COLUMNS].to_dict(orient="records"):
        row = {"timestamp": str(rec["timestamp"])}
        for col in INPUT_COLUMNS[1:]:
            v = pd.to_numeric(rec[col], errors="coerce")
            row[col] = None if pd.isna(v) else float(v)
        rows.append(row)
    return rows


def _proxy_url() -> str:
    url = (os.environ.get("PREDICT_PROXY_URL") or DEFAULT_PROXY_URL).strip().rstrip("/")
    if not url:
        raise PredictionError("no proxy configured: set DEFAULT_PROXY_URL in predict.py or PREDICT_PROXY_URL")
    return url + "/api/predict"


def _post(url: str, rows: list[dict]) -> dict:
    problem = ""
    for attempt in range(ATTEMPTS):
        try:
            resp = requests.post(url, json={"rows": rows}, timeout=TIMEOUT_S)
        except (requests.ConnectionError, requests.Timeout) as e:
            problem = f"{type(e).__name__}: {str(e)[:300]}"
        else:
            if resp.status_code < 300:
                try:
                    return resp.json()
                except ValueError:
                    raise PredictionError(f"proxy answered with non-JSON: {resp.text[:300]!r}") from None
            problem = f"HTTP {resp.status_code}: {resp.text[:300]!r}"
            if resp.status_code < 500 and resp.status_code not in RETRY_4XX:
                break  # the request itself is wrong; retrying will not help
        if attempt < ATTEMPTS - 1:
            wait = BACKOFF_S[attempt]
            print(f"predict.py: attempt {attempt + 1} of {ATTEMPTS} failed ({problem[:160]}); retrying in {wait} s",
                  file=sys.stderr)
            time.sleep(wait)
    raise PredictionError(f"POST {url} failed after {attempt + 1} attempt(s): {problem}")


def predict(input_df: pd.DataFrame) -> np.ndarray:
    """Parameters:

        input_df (pandas.DataFrame): DataFrame with columns
        ['timestamp', 'ambient_temp_c', 'humidity_pct', 'solar_irradiance_wm2']

    Returns:
        numpy.ndarray: Predicted demand (kW) for each input row, in input order.

    Raises PredictionError if the proxy is unset, unreachable or answers badly,
    and ValueError for unusable input. It never substitutes made-up values.
    """
    missing = [c for c in INPUT_COLUMNS if c not in input_df.columns]
    if missing:
        raise ValueError(f"input is missing columns: {', '.join(missing)}")
    if len(input_df) == 0:
        return np.array([], dtype=float)
    build_features(input_df)  # fail fast, locally, on timestamps the proxy would reject

    body = _post(_proxy_url(), _rows(fill_missing_weather(input_df)))
    values = body.get("predictions") if isinstance(body, dict) else None
    if not isinstance(values, list) or len(values) != len(input_df):
        got = f"{len(values)} values" if isinstance(values, list) else "no 'predictions' list"
        raise PredictionError(f"expected {len(input_df)} predictions, got {got}")
    try:
        preds = np.array([float(v) for v in values], dtype=float)
    except (TypeError, ValueError):
        raise PredictionError("non-numeric prediction in the proxy response") from None
    if not all(math.isfinite(p) for p in preds):
        raise PredictionError("NaN or infinite prediction in the proxy response")
    return preds


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Predict hourly demand (kW) with our QuickML endpoint.")
    parser.add_argument("--input", default="sample_test_input.csv", help="telemetry CSV (default: %(default)s)")
    parser.add_argument("--output", help="write timestamp,target_demand_kw here; omit to print a preview")
    args = parser.parse_args(argv)

    print(f"Predicting {args.input}...")
    df = pd.read_csv(args.input)
    try:
        preds = predict(df)
    except (PredictionError, ValueError) as e:
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
