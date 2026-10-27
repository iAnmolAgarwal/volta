"""Guarding the QuickML free tier: 500 inference calls a month, account-wide, shared by every visitor and by
the graded predict.py run.

One object in the Stratus bucket, quickml/ledger.json, survives AppSail restarts and redeploys:
    predictions   every feature vector QuickML has priced, and its prediction. Identical inputs never reach
                  QuickML twice: the landing's 24 rows, the sample, repeated test_evals.
    month, calls  QuickML requests sent this calendar month (UTC).
Both are written together, once per request that called QuickML, so the ledger costs at most one Stratus
write per QuickML call (Stratus' free tier allows 1,000 object updates a month). The earlier two files,
quickml/predictions.json and quickml/usage.json, are still read when the ledger doesn't exist yet.

At DEMO_RESERVE_AT calls the demo path (/api/forecast: uploads, the form, the sample) answers only from the
cache, so the rest of the month is kept for /api/predict, which predict.py uses and which is never blocked.
Both files are written read-modify-write under a process lock; across AppSail instances a count can be lost,
which only makes the guard trigger a little later.
"""

import threading
from datetime import datetime, timezone

LEDGER_KEY = "quickml/ledger.json"
CACHE_KEY = "quickml/predictions.json"  # read-only fallback (before the ledger)
USAGE_KEY = "quickml/usage.json"  # read-only fallback (before the ledger)
MONTHLY_FREE_CALLS = 500
DEMO_RESERVE_AT = 380  # from here on, only /api/predict may spend calls (about 120 kept for grading)

# Calls made before the counter existed: the console's free-tier dialog read 52 of 500 for October while
# the counter read 4 (2026-10-27), so October starts 48 higher. Months without an entry start at 0.
USAGE_OFFSET = {"2026-10": 48}

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

    def _load(self) -> dict:
        ledger = self.store.get_json(LEDGER_KEY)
        if ledger is not None:
            return ledger
        usage = self.store.get_json(USAGE_KEY) or {}
        cache = self.store.get_json(CACHE_KEY) or {}
        return {"month": usage.get("month"), "calls": usage.get("calls", 0), "predictions": cache.get("predictions", {})}

    def calls_this_month(self) -> int:
        ledger = self._load()
        month = self._month()
        counted = int(ledger.get("calls", 0)) if ledger.get("month") == month else 0
        return counted + USAGE_OFFSET.get(month, 0)

    def cached(self) -> dict:
        """{feature vector tuple: prediction} for everything QuickML has priced."""
        return {key_vector(k): float(v) for k, v in self._load().get("predictions", {}).items()}

    def record(self, calls: int, predictions: dict) -> int:
        """Add QuickML requests to this month's count and their predictions to the cache, in one write."""
        if calls <= 0 and not predictions:
            return self.calls_this_month()
        with _lock:
            ledger = self._load()
            month = self._month()
            counted = (int(ledger.get("calls", 0)) if ledger.get("month") == month else 0) + max(0, calls)
            merged = ledger.get("predictions", {})
            merged.update({vector_key(k): float(v) for k, v in predictions.items()})
            self.store.put_json(LEDGER_KEY, {"month": month, "calls": counted, "predictions": merged})
            return counted + USAGE_OFFSET.get(month, 0)

    def add_calls(self, n: int) -> int:
        return self.record(n, {})

    def remember(self, predictions: dict) -> None:
        self.record(0, predictions)
