"""The work behind /api/forecast and /api/runs: clean -> predict -> controller -> battery -> save.

Predictions are rounded to 0.01 kW before the controller sees them, so every
stored prediction fully explains its stored mode, overload flag and reason.
"""

import logging
from collections.abc import Callable

import numpy as np

from backend.cleaning import clean
from backend.quickml_sdk import in_catalyst
from backend.service import Forecaster
from backend.store import CatalystRunStore, StoreError, upload_key
from backend.timeline import build_hours, view
from model.features import QUICKML_FEATURES, build_features

SOURCES = ("csv", "manual", "sample")
RUNS_LISTED = 20
log = logging.getLogger("forecast")


class NoStoreError(StoreError):
    """No Data Store for this request (it did not come through the Catalyst gateway)."""


def catalyst_store(request):
    if not in_catalyst(request):
        raise NoStoreError("run history needs the Catalyst Data Store; this request did not come through Catalyst")
    return CatalystRunStore.from_request(request)


class ForecastService:
    def __init__(self, forecaster: Forecaster, store_factory: Callable[[object], object] = catalyst_store):
        self.forecaster, self.store_factory = forecaster, store_factory

    def forecast(self, frame, *, source: str, filename: str | None = None, csv_bytes: bytes | None = None,
                 window_start=None, request=None) -> dict:
        cleaned, report = clean(frame)
        raw = self.forecaster.predict_features(build_features(cleaned)[QUICKML_FEATURES], request)
        preds = np.round(raw, 2)
        decisions, steps = self.forecaster.schedule(cleaned["timestamp"], preds, cleaned["solar_irradiance_wm2"])
        hours = build_hours(cleaned, preds, decisions, steps)
        body = view(hours, window_start)  # a bad window_start fails here, before anything is saved
        record = {"source": source, "filename": filename, "rows_in": report["rows_in"], "n_rows": len(hours),
                  "cleaning": report, **{k: body["summary"][k] for k in
                                         ("peak_kw", "peak_timestamp", "overload_count", "storage_hours",
                                          "switch_count", "start", "end")}}
        return {"run": self._save(record, hours, csv_bytes, request), "cleaning": report, **body}

    def _save(self, record: dict, hours: list[dict], csv_bytes: bytes | None, request) -> dict:
        """Save the run; on failure, say so in the response instead of failing the forecast."""
        run = {"saved": False, "id": None, "created": None, "source": record["source"],
               "filename": record["filename"], "csv_key": None, "errors": [],
               "storage": {"stratus": False, "datastore": False, "reason": None}}

        def attempt(what: str, fn, *args):
            """(True, result), or (False, None) with the reason added to run["errors"]."""
            try:
                return True, fn(*args)
            except StoreError as e:
                message = str(e)
            except Exception as e:  # noqa: BLE001 - a storage fault must not cost the user the forecast
                log.exception("%s failed", what)
                message = f"{what} failed: unexpected {type(e).__name__}"
            log.warning("run not fully saved: %s", message)
            run["errors"].append(message)
            return False, None

        ok, store = attempt("opening the run store", self.store_factory, request)
        if not ok:
            run["storage"]["reason"] = run["errors"][-1]
            return run
        check = getattr(store, "check_daily_limit", None)
        if check is not None and not attempt("saving the run", check)[0]:  # no upload once today's saves are used up
            run["storage"]["reason"] = run["errors"][-1]
            return run
        if csv_bytes is not None:
            key = upload_key(record["filename"])
            if attempt("Stratus upload", store.put_csv, key, csv_bytes)[0]:
                run["csv_key"] = record["csv_key"] = key
        ok, saved = attempt("saving the run", store.save, record, hours)
        if ok:
            run.update(saved, saved=True)
        else:
            run["storage"]["reason"] = run["errors"][-1]
        return run

    def list_runs(self, request=None) -> list[dict]:
        return self.store_factory(request).list_runs(RUNS_LISTED)

    def get_run(self, run_id: str, window_start=None, request=None) -> dict | None:
        found = self.store_factory(request).get_run(run_id)
        if found is None:
            return None
        run, hours = found
        if not hours:
            raise StoreError(f"run {run_id} has no hourly rows")
        cleaning = run.pop("cleaning", None)
        return {"run": {**run, "saved": True}, "cleaning": cleaning, **view(hours, window_start)}
