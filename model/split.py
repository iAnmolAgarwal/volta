"""Forward-in-time validation split.

The test file is the 1,000 hours after training, so validation copies that
shape: fit on the earliest rows, score on the most recent ones. Never shuffle.
"""

import pandas as pd

TRAIN_FRAC = 0.8


def time_split(df: pd.DataFrame, train_frac: float = TRAIN_FRAC) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return (fit, val): the first `train_frac` of rows by timestamp, then the rest."""
    ordered = df.sort_values("timestamp", kind="stable")
    cut = int(round(len(ordered) * train_frac))
    return ordered.iloc[:cut].copy(), ordered.iloc[cut:].copy()


def describe_split(fit: pd.DataFrame, val: pd.DataFrame) -> str:
    """One Markdown line per part, with its rows and date range."""
    return "\n".join(
        f"- {name}: {len(part):,} rows, {part['timestamp'].min()} to {part['timestamp'].max()}"
        for name, part in [("FIT", fit), ("VAL", val)]
    )
