"""Run history: each forecast run in the Catalyst Data Store, each uploaded CSV in Stratus.

Tables (created through the Catalyst MCP; see docs/api.md):
    runs       one row per run; ROWID is the run id, CREATEDTIME the creation time
    run_hours  one row per forecast hour, run_id -> runs.ROWID

The SDK is initialised per request in admin scope from the X-ZC-* headers the
Catalyst gateway adds, so runs are saved for logged-out visitors too. Outside
Catalyst (local runs, tests) there is no store and the API says so.
"""

import json
import os
import re
import uuid
from datetime import datetime, timezone

RUNS_TABLE = "runs"
HOURS_TABLE = "run_hours"
DEFAULT_BUCKET = "microgrid-uploads"  # UPLOAD_BUCKET overrides
PROJECT_UTC_OFFSET = "+05:30"  # CREATEDTIME is in the project's time zone (Asia/Kolkata), without an offset
INSERT_BATCH = 200  # Data Store bulk-insert limit
SELECT_PAGE = 300  # ZCQL row limit per query
CLEANING_MAX_CHARS = 10_000  # limit of the Data Store text column runs.cleaning_json

RUN_FIELDS = {  # run record key -> runs column
    "source": "source_type", "filename": "file_name", "rows_in": "rows_in", "n_rows": "n_rows",
    "peak_kw": "peak_kw", "peak_timestamp": "peak_at", "overload_count": "overload_count",
    "storage_hours": "storage_hours", "switch_count": "switch_count", "start": "start_at", "end": "end_at",
    "csv_key": "csv_key",
}
HOUR_FIELDS = {  # hour key -> run_hours column
    "index": "idx", "timestamp": "ts", "ambient_temp_c": "temp_c", "humidity_pct": "humidity_pct",
    "solar_irradiance_wm2": "solar_wm2", "prediction_kw": "prediction_kw", "mode": "grid_mode",
    "overload": "is_overload", "soc_pct": "soc_pct", "battery_kw": "battery_kw", "grid_kw": "grid_kw",
    "reason": "reason",
}
INT_KEYS = {"rows_in", "n_rows", "overload_count", "storage_hours", "switch_count", "index"}
FLOAT_KEYS = {"peak_kw", "ambient_temp_c", "humidity_pct", "solar_irradiance_wm2", "prediction_kw",
              "soc_pct", "battery_kw", "grid_kw"}


class StoreError(RuntimeError):
    """The Data Store or Stratus refused or failed. Maps to HTTP 502 (503 when there is no store)."""


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


def hour_to_row(run_id: str, hour: dict) -> dict:
    row = {col: hour[key] for key, col in HOUR_FIELDS.items()}
    row["is_overload"] = "true" if hour["overload"] else "false"
    row["run_id"] = run_id
    return row


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

    def put_csv(self, key: str, data: bytes) -> None:
        bucket = self.app.stratus().bucket(self.bucket)
        self._call("Stratus upload", bucket.put_object, key, data, {"content_type": "text/csv"})

    def save(self, record: dict, hours: list[dict]) -> dict:
        """Insert the run, then its hours; on a failure, remove the half-written run."""
        datastore = self.app.datastore()
        row = self._call("saving the run", datastore.table(RUNS_TABLE).insert_row, run_to_row(record))
        run_id = str(row["ROWID"])
        try:
            table = datastore.table(HOURS_TABLE)
            for i in range(0, len(hours), INSERT_BATCH):
                rows = [hour_to_row(run_id, h) for h in hours[i:i + INSERT_BATCH]]
                self._call("saving the hourly rows", table.insert_rows, rows)
        except StoreError:
            try:
                datastore.table(RUNS_TABLE).delete_row(run_id)
            except Exception:  # noqa: BLE001 - the original error is the one to report
                pass
            raise
        return {"id": run_id, "created": created_iso(row.get("CREATEDTIME", ""))}

    def _query(self, what: str, query: str) -> list:
        return self._call(what, self.app.zcql().execute_query, query) or []

    def list_runs(self, limit: int = 20) -> list[dict]:
        cols = ", ".join(["ROWID", "CREATEDTIME", *RUN_FIELDS.values()])
        rows = _unwrap(self._query("listing runs", f"SELECT {cols} FROM {RUNS_TABLE} ORDER BY CREATEDTIME DESC LIMIT 0, {int(limit)}"), RUNS_TABLE)
        return [run_from_row(r) for r in rows]

    def get_run(self, run_id: int) -> tuple[dict, list[dict]] | None:
        """(run, hours in order), or None when there is no such run."""
        run_id = int(run_id)  # also keeps the queries below free of injected text
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
        return run_from_row(found[0]), hours
