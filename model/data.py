"""Paths and loaders for the starter kit data."""

from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
DOCS_DIR = ROOT / "docs"

TARGET = "target_demand_kw"
INPUT_COLUMNS = ["timestamp", "ambient_temp_c", "humidity_pct", "solar_irradiance_wm2"]


def _load(name: str) -> pd.DataFrame:
    df = pd.read_csv(RAW_DIR / name)
    df["timestamp"] = pd.to_datetime(df["timestamp"], format="ISO8601")
    return df


def load_train() -> pd.DataFrame:
    return _load("train_telemetry.csv")


def load_test() -> pd.DataFrame:
    return _load("sample_test_input.csv")
