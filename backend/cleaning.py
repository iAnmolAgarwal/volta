"""Cleaning for /api/forecast: a CSV upload or manual rows -> a tidy hourly frame + a report.

Steps, in order. Each one is counted in the report, zero counts included:
1. Read. Headers match case-insensitively. `timestamp` and `ambient_temp_c` are
   required; a missing humidity or solar column is filled with the training median.
2. Timestamps. ISO 8601 always (YYYY-MM-DD or YYYY/MM/DD). The column may also
   use one of SLASH_FORMATS: the one that reads the most values (day-first wins a
   tie). A trailing UTC offset is dropped and the local clock time kept. Rows
   with an empty or unreadable timestamp are rejected.
3. Weather values that are not numbers become missing. Rows with a temperature
   outside TEMP_RANGE_C are rejected.
4. Humidity is clipped to 0-100 and solar irradiance to >= 0.
5. Rows are sorted by time and duplicate timestamps dropped (the first is kept).
6. Missing values are interpolated against time, then filled from the nearest
   value at either end. A column with no values at all gets the training median.

Rejected rows are listed with their 1-based row number in the input (for a CSV,
row 1 is the line after the header). If nothing usable remains, CleaningError.
"""

import io
import re

import numpy as np
import pandas as pd

from backend.service import MAX_ROWS
from model.data import INPUT_COLUMNS
from model.features import FILL_VALUES

TEMP_RANGE_C = (-60.0, 60.0)  # beyond any recorded surface air temperature
HUMIDITY_RANGE = (0.0, 100.0)
WEATHER = INPUT_COLUMNS[1:]
REQUIRED = ["timestamp", "ambient_temp_c"]
SLASH_FORMATS = {  # label -> strptime format; "/" and "-" separators both accepted
    "DD/MM/YYYY HH:MM": "%d/%m/%Y %H:%M",
    "DD/MM/YYYY HH:MM:SS": "%d/%m/%Y %H:%M:%S",
    "DD/MM/YYYY hh:MM AM/PM": "%d/%m/%Y %I:%M %p",
    "MM/DD/YYYY HH:MM": "%m/%d/%Y %H:%M",
    "MM/DD/YYYY HH:MM:SS": "%m/%d/%Y %H:%M:%S",
    "MM/DD/YYYY hh:MM AM/PM": "%m/%d/%Y %I:%M %p",
}
_OFFSET = re.compile(r"(?:Z|[+-]\d{2}:?\d{2})$")
MAX_LISTED = 50  # rejected rows listed one by one; the count is always complete

FIXES = {  # code -> label, in report order
    "rejected_no_timestamp": "Rejected rows with no timestamp",
    "rejected_bad_timestamp": "Rejected rows with an unreadable timestamp",
    "rejected_impossible_temp": f"Rejected rows with a temperature outside {TEMP_RANGE_C[0]:g} to {TEMP_RANGE_C[1]:g} °C",
    "dropped_utc_offset": "Dropped UTC offsets from timestamps (local clock time kept)",
    "unreadable_numbers": "Treated non-numeric weather values as missing",
    "clipped_humidity": "Clipped humidity_pct to 0–100",
    "clipped_solar": "Clipped solar_irradiance_wm2 to ≥ 0",
    "sorted": "Moved rows into time order",
    "dropped_duplicates": "Dropped rows with a duplicate timestamp (first kept)",
    **{f"interpolated_{c}": f"Interpolated missing {c} in time order" for c in WEATHER},
    **{f"filled_default_{c}": f"Filled {c} with the training median (no values to interpolate)" for c in WEATHER},
}


class CleaningError(ValueError):
    """The input cannot be cleaned into any usable rows. Maps to HTTP 400 (413 when too large)."""

    def __init__(self, message: str, status: int = 400, details: list[str] | None = None):
        super().__init__(message)
        self.status, self.details = status, details or []


def read_csv(data: bytes) -> pd.DataFrame:
    """Every cell as a string; empty cells stay empty strings."""
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if not text.strip():
        raise CleaningError("the CSV file is empty")
    try:
        return pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False, skipinitialspace=True)
    except (pd.errors.ParserError, pd.errors.EmptyDataError) as e:
        raise CleaningError(f"could not read the CSV: {str(e).splitlines()[0][:200]}") from None


def rows_frame(rows) -> pd.DataFrame:
    """Manual rows ([{...}, ...]) as a frame of raw values."""
    if not isinstance(rows, list):
        raise CleaningError('rows must be a list: {"rows": [{"timestamp": ..., ...}, ...]}')
    bad = [i + 1 for i, r in enumerate(rows) if not isinstance(r, dict)]
    if bad:
        raise CleaningError(f"{len(bad)} row(s) are not objects", details=[f"row {i}: not an object" for i in bad[:20]])
    return pd.DataFrame(rows, dtype=object)


def _blank(series: pd.Series) -> pd.Series:
    return series.isna() | series.astype(str).str.strip().isin(["", "nan", "NaN", "None", "null"])


def parse_timestamps(raw: pd.Series) -> tuple[pd.Series, dict, int]:
    """(parsed timestamps with NaT where unreadable, {format label: rows read}, offsets dropped)."""
    text = raw.astype(str).str.strip()
    has_offset = text.str.contains(_OFFSET) & text.str.contains(r"\d{2}:\d{2}")
    text = text.where(~has_offset, text.str.replace(_OFFSET, "", regex=True).str.strip())
    parsed = pd.to_datetime(text, format="ISO8601", errors="coerce")
    formats = {"ISO 8601": int(parsed.notna().sum())}

    rest = parsed.isna()
    if rest.any():
        slashed = text[rest].str.replace("-", "/", regex=False)
        tries = {label: pd.to_datetime(slashed, format=fmt, errors="coerce") for label, fmt in SLASH_FORMATS.items()}
        best = max(tries, key=lambda label: int(tries[label].notna().sum()))  # first label wins a tie
        if tries[best].notna().any():
            parsed[rest] = tries[best]
            formats[best] = int(tries[best].notna().sum())
    return parsed, {k: v for k, v in formats.items() if v}, int(has_offset.sum())


def clean(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """(clean frame with INPUT_COLUMNS, timestamps as datetimes, sorted and unique; the report)."""
    df = df.rename(columns=lambda c: str(c).strip().lower())
    dupes = sorted({c for c in df.columns[df.columns.duplicated()]})
    if dupes:
        raise CleaningError(f"duplicate column(s) once case is ignored: {', '.join(map(str, dupes))[:200]}")
    rows_in = len(df)
    if rows_in == 0:
        raise CleaningError("no rows to forecast")
    if rows_in > MAX_ROWS:
        raise CleaningError(f"at most {MAX_ROWS} rows per forecast, got {rows_in}", status=413)
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise CleaningError(f"missing required column(s): {', '.join(missing)}",
                            details=[f"columns found: {', '.join(map(str, df.columns))[:200]}"])

    counts = dict.fromkeys(FIXES, 0)
    rejected = []  # (row number, reason)
    out = pd.DataFrame(index=df.index)
    out["row"] = np.arange(1, rows_in + 1)

    blank_ts = _blank(df["timestamp"])
    out["timestamp"], formats, counts["dropped_utc_offset"] = parse_timestamps(df["timestamp"].where(~blank_ts, ""))
    for i in out.index[blank_ts]:
        rejected.append((out.at[i, "row"], "no timestamp"))
    bad_ts = out["timestamp"].isna() & ~blank_ts
    for i in out.index[bad_ts]:
        rejected.append((out.at[i, "row"], f"unreadable timestamp {str(df.at[i, 'timestamp'])[:40]!r}"))
    counts["rejected_no_timestamp"], counts["rejected_bad_timestamp"] = int(blank_ts.sum()), int(bad_ts.sum())

    for col in WEATHER:
        raw = df[col] if col in df.columns else pd.Series(np.nan, index=df.index, dtype=object)
        values = pd.to_numeric(raw.where(~_blank(raw), np.nan), errors="coerce").astype(float)
        values[~np.isfinite(values)] = np.nan
        counts["unreadable_numbers"] += int((values.isna() & ~_blank(raw)).sum())
        out[col] = values

    temp = out["ambient_temp_c"]
    impossible = (temp < TEMP_RANGE_C[0]) | (temp > TEMP_RANGE_C[1])
    impossible &= out["timestamp"].notna()  # a row is rejected once, for its first problem
    for i in out.index[impossible]:
        rejected.append((out.at[i, "row"], f"impossible temperature {temp[i]:g} °C"))
    counts["rejected_impossible_temp"] = int(impossible.sum())
    out = out[out["timestamp"].notna() & ~impossible]

    hum, sol = out["humidity_pct"], out["solar_irradiance_wm2"]
    counts["clipped_humidity"] = int(((hum < HUMIDITY_RANGE[0]) | (hum > HUMIDITY_RANGE[1])).sum())
    counts["clipped_solar"] = int((sol < 0).sum())
    out["humidity_pct"] = hum.clip(*HUMIDITY_RANGE)
    out["solar_irradiance_wm2"] = sol.clip(lower=0)

    rejected.sort()
    if out.empty:
        raise CleaningError("no usable rows after cleaning",
                            details=[f"row {r}: {why}" for r, why in rejected[:20]])

    before = out.index.to_numpy()
    out = out.sort_values("timestamp", kind="stable")
    counts["sorted"] = int((out.index.to_numpy() != before).sum())
    dup = out["timestamp"].duplicated(keep="first")
    counts["dropped_duplicates"] = int(dup.sum())
    out = out[~dup].reset_index(drop=True)

    for col in WEATHER:
        gaps = int(out[col].isna().sum())
        if gaps == len(out):
            out[col] = FILL_VALUES[col]
            counts[f"filled_default_{col}"] = gaps
        elif gaps:
            series = out[col].set_axis(out["timestamp"])
            out[col] = series.interpolate(method="time").ffill().bfill().to_numpy()
            counts[f"interpolated_{col}"] = gaps

    report = {
        "rows_in": rows_in,
        "rows_out": len(out),
        "timestamp_formats": formats,
        "fixes": [{"code": code, "label": label, "count": counts[code]} for code, label in FIXES.items()],
        "rejected_count": len(rejected),
        "rejected": [{"row": int(r), "reason": why} for r, why in rejected[:MAX_LISTED]],
    }
    return out[INPUT_COLUMNS], report
