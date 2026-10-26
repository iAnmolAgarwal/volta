"""The proxy's work for one /api/predict request.

validate rows -> build_features -> QuickML (cached, deduplicated, concurrent)
-> controller signals -> battery state of charge, all in input order.
"""

import math
import os
import threading
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import asdict

import numpy as np
import pandas as pd

from backend.battery import BatteryParams, BatteryStep, simulate
from backend.controller import decide
from model.data import INPUT_COLUMNS
from model.features import QUICKML_FEATURES, build_features
from backend.quickml_sdk import SdkTransport, in_catalyst
from model.quickml_client import ConfigError, PredictionError, QuickMLClient, is_configured, settings

MAX_ROWS = 2000
CACHE_SIZE = 50_000
KEY_DECIMALS = 6  # feature vectors are cached rounded to 1e-6


class RequestError(ValueError):
    """The request body is unusable. Maps to HTTP 400 (or 413 when too large)."""

    def __init__(self, message: str, status: int = 400, details: list[str] | None = None):
        super().__init__(message)
        self.status, self.details = status, details or []


def parse_rows(payload) -> pd.DataFrame:
    """Validate {"rows": [...]} and return the raw telemetry frame. Missing weather may be null."""
    rows = payload.get("rows") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise RequestError('body must be a JSON object: {"rows": [...]}')
    if not rows:
        raise RequestError("rows is empty")
    if len(rows) > MAX_ROWS:
        raise RequestError(f"at most {MAX_ROWS} rows per request, got {len(rows)}", status=413)

    errors = []
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            errors.append(f"row {i}: not an object")
            continue
        ts = row.get("timestamp")
        try:
            if not isinstance(ts, str):
                raise ValueError
            pd.Timestamp(pd.to_datetime(ts, format="ISO8601"))
        except (ValueError, TypeError):
            errors.append(f"row {i}: timestamp must be an ISO 8601 string, got {ts!r:.40}")
        for col in INPUT_COLUMNS[1:]:
            v = row.get(col)
            ok = v is None or (isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v))
            if not ok:
                errors.append(f"row {i}: {col} must be a finite number or null, got {v!r:.40}")
    if errors:
        raise RequestError(f"{len(errors)} invalid value(s)", details=errors[:20])
    return pd.DataFrame([{c: row.get(c) for c in INPUT_COLUMNS} for row in rows])


def quickml_configured(env=None) -> bool:
    """True when either QuickML path has what it needs (values are never exposed)."""
    env = os.environ if env is None else env
    return bool((env.get("QUICKML_ENDPOINT_KEY") or "").strip()) or is_configured(env)


_direct_client = None
_direct_lock = threading.Lock()


def make_client(request=None) -> QuickMLClient:
    """QuickML client for one request.

    Inside Catalyst with QUICKML_ENDPOINT_KEY set: the Catalyst SDK, authenticated
    by the gateway's request headers. Otherwise, direct REST with Zoho OAuth when
    every direct variable is set (shared, so the access token is cached).
    """
    key = (os.environ.get("QUICKML_ENDPOINT_KEY") or "").strip()
    batch_size, _, _, _ = settings()
    if key and in_catalyst(request):
        # SDK state is thread-local, so its calls stay on the request thread.
        return QuickMLClient(SdkTransport(key, request), batch_size, concurrency=1)
    if is_configured():
        global _direct_client
        with _direct_lock:
            if _direct_client is None:
                _direct_client = QuickMLClient.from_env()
            return _direct_client
    if key:
        raise ConfigError("QuickML SDK path needs a request routed through Catalyst (X-ZC-* headers missing)")
    raise ConfigError("QuickML is not configured: set QUICKML_ENDPOINT_KEY in the AppSail environment variables")


class PredictionCache:
    """Thread-safe LRU map from a rounded feature vector to its prediction."""

    def __init__(self, maxsize: int = CACHE_SIZE):
        self.maxsize, self._data, self._lock = maxsize, OrderedDict(), threading.Lock()

    def __len__(self) -> int:
        return len(self._data)

    def get_many(self, keys) -> dict:
        with self._lock:
            found = {}
            for k in keys:
                if k in self._data:
                    self._data.move_to_end(k)
                    found[k] = self._data[k]
            return found

    def put_many(self, items: dict) -> None:
        with self._lock:
            for k, v in items.items():
                self._data[k] = v
                self._data.move_to_end(k)
            while len(self._data) > self.maxsize:
                self._data.popitem(last=False)


class Forecaster:
    """Turns raw telemetry rows into predictions, grid signals and battery state."""

    def __init__(
        self,
        client_factory: Callable[[object], QuickMLClient] = make_client,
        cache_size: int = CACHE_SIZE,
        battery: BatteryParams = BatteryParams(),
    ):
        self.client_factory, self.battery = client_factory, battery
        self.cache = PredictionCache(cache_size)

    def predict_features(self, feats: pd.DataFrame, request=None) -> np.ndarray:
        """Predictions for feature rows; only vectors not already cached reach QuickML, once each."""
        keys = [tuple(round(float(v), KEY_DECIMALS) for v in row) for row in feats.itertuples(index=False)]
        known = self.cache.get_many(dict.fromkeys(keys))
        todo = [k for k in dict.fromkeys(keys) if k not in known]
        if todo:
            client = self.client_factory(request)  # raises ConfigError until configured
            fresh = client.predict(pd.DataFrame(todo, columns=feats.columns))
            new = dict(zip(todo, (float(p) for p in fresh)))
            self.cache.put_many(new)
            known.update(new)
        return np.array([known[k] for k in keys], dtype=float)

    def schedule(self, stamps, preds) -> tuple[list[dict], list[BatteryStep]]:
        """Controller decisions and battery steps for predictions in time order."""
        try:
            decisions = [decide(ts, p) for ts, p in zip(stamps, preds)]
        except ValueError as e:  # e.g. a negative prediction from the model
            raise PredictionError(f"unusable prediction from QuickML: {e}") from None
        return decisions, simulate(((d["mode"], p) for d, p in zip(decisions, preds)), self.battery)

    def forecast(self, payload, request=None) -> dict:
        """`request` is the incoming HTTP request; the SDK path authenticates from its headers."""
        raw = parse_rows(payload)
        preds = self.predict_features(build_features(raw)[QUICKML_FEATURES], request)
        decisions, steps = self.schedule(pd.to_datetime(raw["timestamp"], format="ISO8601"), preds)
        originals = raw["timestamp"].tolist()
        return {
            "predictions": preds.tolist(),
            "signals": [{"timestamp": t, **d} for t, d in zip(originals, decisions)],
            "battery": [{"timestamp": t, **asdict(s)} for t, s in zip(originals, steps)],
        }
