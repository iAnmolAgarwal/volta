"""Guarding the QuickML free tier: 500 inference calls a month, account-wide, shared by every visitor and by
the graded predict.py run.

Two things live in the Stratus bucket, so they survive AppSail restarts and redeploys:
    quickml/predictions.json  every feature vector QuickML has priced, and its prediction. Identical inputs
                              never reach QuickML twice: the landing's 24 rows, the sample, repeated test_evals.
    quickml/usage.json        QuickML requests sent this calendar month (UTC), and the month they belong to.

At DEMO_RESERVE_AT calls the demo path (/api/forecast: uploads, the form, the sample) answers only from the
cache, so the rest of the month is kept for /api/predict, which predict.py uses and which is never blocked.
Both files are written read-modify-write under a process lock; across AppSail instances a count can be lost,
which only makes the guard trigger a little later.
"""

import threading
from datetime import datetime, timezone

CACHE_KEY = "quickml/predictions.json"
USAGE_KEY = "quickml/usage.json"
MONTHLY_FREE_CALLS = 500
DEMO_RESERVE_AT = 380  # from here on, only /api/predict may spend calls (about 120 kept for grading)

_lock = threading.Lock()


class QuotaReserved(RuntimeError):
    """The demo path would need QuickML, but the rest of this month's calls are kept for predict.py."""


def vector_key(vector) -> str:
    return "|".join(repr(float(v)) for v in vector)


def key_vector(key: str) -> tuple:
    return tuple(float(v) for v in key.split("|"))


class QuickMLLedger:
    """The persistent prediction cache and the monthly QuickML call counter, on any store with
    get_json(key) and put_json(key, value) (CatalystRunStore in AppSail)."""

    def __init__(self, store, clock=lambda: datetime.now(timezone.utc)):
        self.store, self.clock = store, clock

    def _month(self) -> str:
        return f"{self.clock():%Y-%m}"

    def calls_this_month(self) -> int:
        usage = self.store.get_json(USAGE_KEY) or {}
        return int(usage.get("calls", 0)) if usage.get("month") == self._month() else 0

    def add_calls(self, n: int) -> int:
        if n <= 0:
            return self.calls_this_month()
        with _lock:
            calls = self.calls_this_month() + n
            self.store.put_json(USAGE_KEY, {"month": self._month(), "calls": calls})
            return calls

    def cached(self) -> dict:
        """{feature vector tuple: prediction} for everything QuickML has priced."""
        stored = self.store.get_json(CACHE_KEY) or {}
        return {key_vector(k): float(v) for k, v in stored.get("predictions", {}).items()}

    def remember(self, predictions: dict) -> None:
        """Add {feature vector tuple: prediction} to the persistent cache."""
        if not predictions:
            return
        with _lock:
            stored = self.store.get_json(CACHE_KEY) or {}
            merged = stored.get("predictions", {})
            merged.update({vector_key(k): float(v) for k, v in predictions.items()})
            self.store.put_json(CACHE_KEY, {"predictions": merged})
