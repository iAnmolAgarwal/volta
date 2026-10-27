"""The hour-by-hour view of a forecast run, shared by /api/forecast and /api/runs/{id}.

hours: one dict per forecast hour (prediction, mode, overload, battery, reason).
Switch events and overload alerts are derived from `hours` alone, so a stored
run rebuilds exactly the same view as the request that created it.
"""

from dataclasses import dataclass

import pandas as pd

from backend.battery import BatteryStep
from backend.controller import STORAGE_MODE, explain

TS_FORMAT = "%Y-%m-%d %H:%M:%S"
WINDOW_HOURS = 24


class WindowError(ValueError):
    """window_start does not name an hour of the run. Maps to HTTP 400."""


@dataclass(frozen=True)
class Window:
    start: int
    end: int

    def as_dict(self, hours: list[dict]) -> dict:
        return {"start": self.start, "end": self.end, "size": self.end - self.start, "hours": hours[self.start:self.end]}


def build_hours(clean: pd.DataFrame, preds, decisions: list[dict], steps: list[BatteryStep]) -> list[dict]:
    """One dict per hour. `preds` are the rounded predictions the decisions were made on."""
    hours = []
    for i, (row, pred, d, s) in enumerate(zip(clean.itertuples(index=False), preds, decisions, steps)):
        ts = pd.Timestamp(row.timestamp)
        hours.append({
            "index": i,
            "timestamp": ts.strftime(TS_FORMAT),
            "hour": ts.hour,
            "ambient_temp_c": round(float(row.ambient_temp_c), 2),
            "humidity_pct": round(float(row.humidity_pct), 2),
            "solar_irradiance_wm2": round(float(row.solar_irradiance_wm2), 2),
            "prediction_kw": float(pred),
            "mode": d["mode"],
            "overload": bool(d["overload"]),
            "soc_pct": round(100 * s.soc_end, 2),  # state of charge at the end of the hour
            "pv_kw": round(s.pv_kw, 2),
            "battery_kw": round(s.battery_kw, 2),  # > 0 discharging, < 0 charging
            "grid_kw": round(s.grid_kw, 2),
            "reason": explain(ts, pred),
        })
    return hours


def _short(mode: str) -> str:
    return mode.removesuffix(" Mode")


def _clock(timestamp: str) -> str:
    return timestamp[11:16]


def switch_events(hours: list[dict]) -> list[dict]:
    """Mode changes between consecutive hours: "18:00 Main Grid → Renewable Storage"."""
    events = []
    for prev, cur in zip(hours, hours[1:]):
        if cur["mode"] != prev["mode"]:
            events.append({
                "index": cur["index"],
                "timestamp": cur["timestamp"],
                "from": prev["mode"],
                "to": cur["mode"],
                "label": f"{_clock(cur['timestamp'])} {_short(prev['mode'])} → {_short(cur['mode'])}",
            })
    return events


def overload_alerts(hours: list[dict]) -> list[dict]:
    """One alert per hour at or above the overload threshold."""
    return [
        {
            "index": h["index"],
            "timestamp": h["timestamp"],
            "prediction_kw": h["prediction_kw"],
            "label": f"{_clock(h['timestamp'])} Critical overload: {h['prediction_kw']:.1f} kW",
        }
        for h in hours
        if h["overload"]
    ]


def summarize(hours: list[dict], events: list[dict], alerts: list[dict]) -> dict:
    peak = max(hours, key=lambda h: h["prediction_kw"])
    storage = sum(h["mode"] == STORAGE_MODE for h in hours)
    return {
        "n_hours": len(hours),
        "start": hours[0]["timestamp"],
        "end": hours[-1]["timestamp"],
        "peak_kw": peak["prediction_kw"],
        "peak_timestamp": peak["timestamp"],
        "storage_hours": storage,
        "grid_hours": len(hours) - storage,
        "overload_count": len(alerts),
        "switch_count": len(events),
        "min_soc_pct": min(h["soc_pct"] for h in hours),
    }


def window(hours: list[dict], start=None, size: int = WINDOW_HOURS) -> Window:
    """The `size` hours from `start`: an hour index, or a timestamp (the first hour at or after it)."""
    if start is None or start == "":
        i = 0
    else:
        try:
            i = int(start)
        except (TypeError, ValueError):
            try:
                when = pd.Timestamp(str(start))
                if when.tzinfo is not None:  # hours are local clock time; keep the clock time, drop the offset
                    when = when.tz_localize(None)
            except (TypeError, ValueError):
                raise WindowError(f"window_start must be an hour index or a timestamp, got {str(start)[:40]!r}") from None
            later = [h["index"] for h in hours if pd.Timestamp(h["timestamp"]) >= when]
            if not later:
                raise WindowError(f"window_start {str(start)[:40]!r} is after the last hour ({hours[-1]['timestamp']})")
            i = later[0]
    if not 0 <= i < len(hours):
        raise WindowError(f"window_start must be between 0 and {len(hours) - 1}, got {i}")
    return Window(i, min(i + size, len(hours)))


def view(hours: list[dict], window_start=None) -> dict:
    """Everything the dashboard draws for a run: summary, events, alerts, the window and the full series."""
    events, alerts = switch_events(hours), overload_alerts(hours)
    return {
        "summary": summarize(hours, events, alerts),
        "window": window(hours, window_start).as_dict(hours),
        "hours": hours,
        "switch_events": events,
        "overload_alerts": alerts,
    }
