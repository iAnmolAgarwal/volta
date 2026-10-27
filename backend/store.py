"""Run history: Stratus holds every run; the Data Store gets one metadata row per run.

The Catalyst free tier allows 5,000 Data Store inserts a month, account-wide, and
writing every hour as a row used it up in a handful of runs. So (docs/api.md, Persistence):
    Stratus      runs/<id>.json    the run, its cleaning report and all its hours
                 runs/index.json   the latest 20 run summaries and a per-UTC-day save counter
                 uploads/...       each uploaded CSV
    Data Store   runs              one row per run, best effort (a refused insert does not
                                   lose the run); run_hours is only read, for runs saved
                                   before 2026-10-27, whose ids are Data Store ROWIDs

The SDK is initialised per request in admin scope from the X-ZC-* headers the
Catalyst gateway adds, so runs are saved for logged-out visitors too. Outside
Catalyst (local runs, tests) there is no store and the API says so.
"""

import json
import os
import re
import threading
import uuid
from datetime import datetime, timezone

RUNS_TABLE = "runs"
HOURS_TABLE = "run_hours"
DEFAULT_BUCKET = "microgrid-uploads"  # UPLOAD_BUCKET overrides
PROJECT_UTC_OFFSET = "+05:30"  # CREATEDTIME is in the project's time zone (Asia/Kolkata), without an offset
SELECT_PAGE = 300  # ZCQL row limit per query
CLEANING_MAX_CHARS = 10_000  # limit of the Data Store text column runs.cleaning_json
INDEX_KEY = "runs/index.json"
RUNS_INDEXED = 20
DAILY_SAVE_LIMIT = 40  # saved runs per UTC day, so no visitor can spend the month's 2,000 Stratus uploads
RUN_ID = re.compile(r"r\d{14}-[0-9a-f]{6}")  # Stratus runs: r + UTC yyyymmddHHMMSS + random, time-sortable
LEGACY_RUN_ID = re.compile(r"\d{1,20}")  # Data Store ROWIDs of the runs saved before 2026-10-27

RUN_FIELDS = {  # run record key -> runs column
    "source": "source_type", "filename": "file_name", "rows_in": "rows_in", "n_rows": "n_rows",
    "peak_kw": "peak_kw", "peak_timestamp": "peak_at", "overload_count": "overload_count",
    "storage_hours": "storage_hours", "switch_count": "switch_count", "start": "start_at", "end": "end_at",
    "csv_key": "csv_key",
}
HOUR_FIELDS = {  # hour key -> run_hours column
    "index": "idx", "timestamp": "ts", "ambient_temp_c": "temp_c", "humidity_pct": "humidity_pct",
    "solar_irradiance_wm2": "solar_wm2", "prediction_kw": "prediction_kw", "mode": "grid_mode",
    "overload": "is_overload", "soc_pct": "soc_pct", "pv_kw": "pv_kw", "battery_kw": "battery_kw", "grid_kw": "grid_kw",
    "reason": "reason",
}
INT_KEYS = {"rows_in", "n_rows", "overload_count", "storage_hours", "switch_count", "index"}
FLOAT_KEYS = {"peak_kw", "ambient_temp_c", "humidity_pct", "solar_irradiance_wm2", "prediction_kw",
              "soc_pct", "pv_kw", "battery_kw", "grid_kw"}


class StoreError(RuntimeError):
    """The Data Store or Stratus refused or failed. Maps to HTTP 502 (503 when there is no store)."""


class DailyLimitError(StoreError):
    """DAILY_SAVE_LIMIT runs are already saved today (UTC); the forecast is still returned."""


SERIES_POINTS = 48  # the History card's mini curve


def demand_series(hours: list[dict], points: int = SERIES_POINTS) -> dict:
    """The run's demand in at most `points` equal buckets: each bucket's mean and max kW."""
    kw = [h["prediction_kw"] for h in hours]
    if not kw:
        return {"step_hours": 0, "mean_kw": [], "max_kw": []}
    step = -(-len(kw) // points)  # ceiling division
    buckets = [kw[i:i + step] for i in range(0, len(kw), step)]
    return {"step_hours": step, "mean_kw": [round(sum(b) / len(b), 1) for b in buckets],
            "max_kw": [round(max(b), 1) for b in buckets]}


def new_run_id(now: datetime) -> str:
    return f"r{now:%Y%m%d%H%M%S}-{uuid.uuid4().hex[:6]}"


def run_key(run_id: str) -> str:
    return f"runs/{run_id}.json"


def _when(created: str) -> datetime:
    try:
        return datetime.fromisoformat(created)
    except (TypeError, ValueError):
        return datetime.min.replace(tzinfo=timezone.utc)


def _datastore_reason(e: Exception) -> str:
    text = str(e)
    if "FREE_USAGE_LIMIT" in text:
        return "Data Store free-tier insert quota used up for this month"
    return f"Data Store insert failed: {text[:200]}"


def _not_found(e: Exception) -> bool:
    """A missing object, by its HTTP status only: matching "404" in the message could take a transient
    error for a miss, and an empty index written over the real one would lose the run history."""
    status = getattr(e, "http_status_code", None) or getattr(e, "status_code", None)
    return status == 404


def created_iso(createdtime: str) -> str:
    """'2026-10-26 21:03:11:123' (project time) -> '2026-10-26T21:03:11+05:30'."""
    return createdtime[:19].replace(" ", "T") + PROJECT_UTC_OFFSET if createdtime else ""


def _value(key: str, raw):
    """A Data Store value back in its API type (the Data Store returns strings)."""
    if raw is None or raw == "":
        return None
    if key in INT_KEYS:
        return int(float(raw))
    if key in FLOAT_KEYS:
        return float(raw)
    if key == "overload":
        return raw is True or str(raw).lower() == "true"
    return raw


def run_to_row(record: dict) -> dict:
    row = {col: record.get(key) for key, col in RUN_FIELDS.items() if record.get(key) is not None}
    report = record.get("cleaning") or {}
    text = json.dumps(report, ensure_ascii=False)
    if len(text) > CLEANING_MAX_CHARS:  # the rejected-row list is the only open-ended part; its count stays
        text = json.dumps({**report, "rejected": []}, ensure_ascii=False)
    row["cleaning_json"] = text
    return row


def run_from_row(row: dict) -> dict:
    run = {"id": str(row["ROWID"]), "created": created_iso(row.get("CREATEDTIME", ""))}
    run.update({key: _value(key, row.get(col)) for key, col in RUN_FIELDS.items()})
    if "cleaning_json" in row:
        run["cleaning"] = json.loads(row["cleaning_json"] or "{}")
    return run


def hour_from_row(row: dict) -> dict:
    hour = {key: _value(key, row.get(col)) for key, col in HOUR_FIELDS.items()}
    hour["hour"] = int(hour["timestamp"][11:13])
    return hour


def upload_key(filename: str | None, now: datetime | None = None) -> str:
    """Stratus key for an upload: uploads/2026/10/26/153012-1a2b3c4d-name.csv."""
    now = now or datetime.now(timezone.utc)
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", os.path.basename(filename or "upload.csv"))[-80:] or "upload.csv"
    return f"uploads/{now:%Y/%m/%d}/{now:%H%M%S}-{uuid.uuid4().hex[:8]}-{stem}"


def _unwrap(result, table: str) -> list[dict]:
    """ZCQL wraps every row under its table name: [{"runs": {...}}, ...]."""
    return [r[table] for r in result or [] if table in r]


_INDEX_LOCK = threading.Lock()  # one index read-modify-write at a time in this process (waitress runs 8 threads)


class CatalystRunStore:
    """Run history on the Catalyst Data Store and Stratus, through zcatalyst_sdk."""

    def __init__(self, app, bucket: str | None = None):
        self.app = app
        self.bucket = (bucket or os.environ.get("UPLOAD_BUCKET") or DEFAULT_BUCKET).strip()

    @classmethod
    def from_request(cls, request) -> "CatalystRunStore":
        import zcatalyst_sdk

        try:
            return cls(zcatalyst_sdk.initialize(req=request, scope="admin"))
        except Exception as e:  # noqa: BLE001 - e.g. CatalystAppError when the gateway headers are missing
            raise StoreError(f"the Catalyst SDK could not start: {str(e)[:200]}") from None

    def _call(self, what: str, fn, *args):
        from zcatalyst_sdk.exceptions import CatalystError

        try:
            return fn(*args)
        except CatalystError as e:
            raise StoreError(f"{what} failed: {str(e)[:300]}") from None

    def _bucket(self):
        return self.app.stratus().bucket(self.bucket)

    def put_csv(self, key: str, data: bytes) -> None:
        self._call("Stratus upload", self._bucket().put_object, key, data, {"content_type": "text/csv"})

    def _get_json(self, what: str, key: str):
        """The JSON object at key, or None when there is none."""
        from zcatalyst_sdk.exceptions import CatalystError

        try:
            data = self._bucket().get_object(key)
        except CatalystError as e:
            if _not_found(e):
                return None
            raise StoreError(f"{what} failed: {str(e)[:300]}") from None
        return json.loads(data)

    def _put_json(self, what: str, key: str, value) -> None:
        body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
        self._call(what, self._bucket().put_object, key, body, {"content_type": "application/json", "overwrite": "true"})

    def check_daily_limit(self, now: datetime | None = None) -> None:
        """Raise DailyLimitError when today's saves are used up; called before any upload too."""
        self._saved_today(self._get_json("reading the run index", INDEX_KEY) or {}, now or datetime.now(timezone.utc))

    @staticmethod
    def _saved_today(index: dict, now: datetime) -> int:
        saved_today = index.get("saved_today", 0) if index.get("day") == f"{now:%Y-%m-%d}" else 0
        if saved_today >= DAILY_SAVE_LIMIT:
            raise DailyLimitError(f"daily save limit reached ({DAILY_SAVE_LIMIT} runs a day, UTC)")
        return saved_today

    def save(self, record: dict, hours: list[dict], now: datetime | None = None) -> dict:
        """Save the run to Stratus (the run object, then the index), and try one Data Store row.

        Within one process the index update is serialised; across AppSail instances it isn't, so two
        saves in the same moment on different instances can drop one from the 20-run list (the run
        itself stays stored and can be opened by id)."""
        with _INDEX_LOCK:
            return self._save(record, hours, now or datetime.now(timezone.utc))

    def _save(self, record: dict, hours: list[dict], now: datetime) -> dict:
        index = self._get_json("reading the run index", INDEX_KEY) or {}
        day = f"{now:%Y-%m-%d}"
        saved_today = self._saved_today(index, now)

        run_id, created = new_run_id(now), now.isoformat(timespec="seconds")
        summary = {key: record.get(key) for key in RUN_FIELDS} | {"id": run_id, "created": created}
        storage = {"stratus": True, "datastore": False, "reason": None}
        datastore_id = None
        try:  # evidence of the run in the Data Store; the run itself lives in Stratus
            row = self.app.datastore().table(RUNS_TABLE).insert_row(run_to_row(record))
            datastore_id, storage["datastore"] = str(row["ROWID"]), True
        except Exception as e:  # noqa: BLE001 - quota, schema or network: the run is still saved
            storage["reason"] = _datastore_reason(e)
        try:
            self._put_json("saving the run to Stratus", run_key(run_id),
                           {"run": {**summary, "cleaning": record.get("cleaning"), "storage": storage}, "hours": hours})
        except StoreError:
            if datastore_id:  # don't leave a Data Store row for a run that has no hours anywhere
                try:
                    self.app.datastore().table(RUNS_TABLE).delete_row(datastore_id)
                except Exception:  # noqa: BLE001 - the Stratus error is the one to report
                    pass
            raise
        entry = {**summary, "storage": storage, "series": demand_series(hours), "datastore_id": datastore_id}
        runs = [entry, *index.get("runs", [])][:RUNS_INDEXED]
        try:
            self._put_json("updating the run index", INDEX_KEY, {"day": day, "saved_today": saved_today + 1, "runs": runs})
        except StoreError as e:  # the run is stored and opens by id; it just won't be listed
            storage["reason"] = "; ".join(filter(None, [storage["reason"], f"not listed in History: {e}"]))
        return {"id": run_id, "created": created, "storage": storage}

    def _query(self, what: str, query: str) -> list:
        return self._call(what, self.app.zcql().execute_query, query) or []

    def list_runs(self, limit: int = 20) -> list[dict]:
        """The Stratus index merged with the Data Store's runs rows, newest first, each run once."""
        index = self._get_json("reading the run index", INDEX_KEY) or {}
        indexed = index.get("runs", [])
        linked = {r.get("datastore_id") for r in indexed if r.get("datastore_id")}
        runs = [{k: v for k, v in r.items() if k != "datastore_id"} for r in indexed]
        cols = ", ".join(["ROWID", "CREATEDTIME", *RUN_FIELDS.values()])
        try:
            rows = _unwrap(self._query("listing runs", f"SELECT {cols} FROM {RUNS_TABLE} ORDER BY CREATEDTIME DESC LIMIT 0, {int(limit)}"), RUNS_TABLE)
        except StoreError:
            if not indexed:
                raise
            rows = []  # the Stratus index alone still lists the recent runs
        legacy = [run_from_row(r) | {"storage": {"stratus": False, "datastore": True, "reason": None}}
                  for r in rows if str(r["ROWID"]) not in linked]
        return sorted(runs + legacy, key=lambda r: _when(r.get("created")), reverse=True)[:limit]

    def get_run(self, run_id: str) -> tuple[dict, list[dict]] | None:
        """(run, hours in order), or None when there is no such run."""
        run_id = str(run_id)
        if RUN_ID.fullmatch(run_id):
            found = self._get_json("reading the run", run_key(run_id))
            return (found["run"], found["hours"]) if found else None
        if not LEGACY_RUN_ID.fullmatch(run_id):
            return None
        return self._get_legacy_run(int(run_id))

    def _get_legacy_run(self, run_id: int) -> tuple[dict, list[dict]] | None:
        """A run saved before 2026-10-27: its row in runs, its hours in run_hours."""
        found = _unwrap(self._query("reading the run", f"SELECT * FROM {RUNS_TABLE} WHERE ROWID = {run_id}"), RUNS_TABLE)
        if not found:
            return None
        # Keyset paging on idx: ZCQL's LIMIT offset counts from 1, so offset paging
        # repeats the last row of each page (seen live: 1,001 rows for a 1,000-hour run).
        hours, last = [], -1
        while True:
            page = _unwrap(self._query("reading the hourly rows",
                                       f"SELECT * FROM {HOURS_TABLE} WHERE run_id = {run_id} AND idx > {last} "
                                       f"ORDER BY idx LIMIT 0, {SELECT_PAGE}"),
                           HOURS_TABLE)
            hours.extend(hour_from_row(r) for r in page)
            if len(page) < SELECT_PAGE:
                break
            last = hours[-1]["index"]
        run = run_from_row(found[0]) | {"storage": {"stratus": False, "datastore": True, "reason": None}}
        return run, hours
