"""CatalystRunStore against a fake zcatalyst_sdk app: no network, no Catalyst account."""

import json
import re
from datetime import datetime, timezone

import pytest
from zcatalyst_sdk.exceptions import CatalystAPIError

from backend.store import (CLEANING_MAX_CHARS, DAILY_SAVE_LIMIT, SERIES_POINTS, demand_series, HOUR_FIELDS, HOURS_TABLE, INDEX_KEY, RUN_ID, RUNS_INDEXED,
                           RUNS_TABLE, SELECT_PAGE, CatalystRunStore, DailyLimitError, StoreError, created_iso,
                           hour_from_row, run_from_row, run_to_row, upload_key)


class FakeTable:
    def __init__(self, db, name):
        self.db, self.name = db, name

    def insert_row(self, row):
        return self.insert_rows([row])[0]

    def insert_rows(self, rows):
        if self.name in self.db.fail_insert:
            raise CatalystAPIError("FREE_USAGE_LIMIT_REACHED", "You have exhausted the free tier allowance for Datastore - Insert",
                                   http_status_code=400)
        self.db.insert_calls.append((self.name, len(rows)))
        out = []
        for r in rows:
            self.db.next_id += 1
            # the Data Store hands every value back as a string
            stored = {k: str(v) for k, v in r.items()} | {"ROWID": str(self.db.next_id),
                                                          "CREATEDTIME": "2026-10-26 21:03:11:123"}
            self.db.tables[self.name].append(stored)
            out.append(stored)
        return out

    def delete_row(self, row_id):
        self.db.tables[self.name] = [r for r in self.db.tables[self.name] if r["ROWID"] != str(row_id)]
        return True


class FakeZcql:
    def __init__(self, db):
        self.db = db

    def execute_query(self, query):
        self.db.queries.append(query)
        m = re.match(r"SELECT (.+) FROM (\w+)(?: WHERE (\w+) = (\d+)(?: AND idx > (-?\d+))?)?"
                     r"(?: ORDER BY (\w+)( DESC)?)?(?: LIMIT (\d+), (\d+))?$", query)
        cols, table, where_col, where_val, after, order, desc, offset, count = m.groups()
        rows = [r for r in self.db.tables[table] if not where_col or r.get(where_col) == where_val]
        if after is not None:
            rows = [r for r in rows if int(r["idx"]) > int(after)]
        if order:
            key = (lambda r: int(r[order])) if order == "idx" else (lambda r: int(r["ROWID"]))
            rows = sorted(rows, key=key, reverse=bool(desc))
        if offset is not None:
            start = max(int(offset) - 1, 0)  # like Catalyst: the offset counts from 1, and 0 acts as 1
            rows = rows[start:start + int(count)]
        if cols != "*":
            rows = [{c: r.get(c) for c in cols.split(", ")} for r in rows]
        return [{table: r} for r in rows]


class FakeBucket:
    def __init__(self, db, name):
        self.db, self.name = db, name

    def put_object(self, key, body, options=None):
        if any(key.startswith(prefix) for prefix in self.db.fail_put):
            raise CatalystAPIError("STRATUS_ERROR", "upload refused", http_status_code=500)
        self.db.objects[(self.name, key)] = (body, options)
        return True

    def get_object(self, key, options=None):
        if (self.name, key) not in self.db.objects:
            raise CatalystAPIError("NOT_FOUND", "Object not found", http_status_code=404)
        return self.db.objects[(self.name, key)][0]


class FakeApp:
    def __init__(self):
        self.tables = {RUNS_TABLE: [], HOURS_TABLE: []}
        self.objects, self.queries, self.insert_calls, self.fail_insert, self.fail_put = {}, [], [], set(), set()
        self.next_id = 7000

    def datastore(self):
        app = self

        class Datastore:
            def table(self, name):
                return FakeTable(app, name)

        return Datastore()

    def zcql(self):
        return FakeZcql(self)

    def stratus(self):
        app = self

        class Stratus:
            def bucket(self, name):
                return FakeBucket(app, name)

        return Stratus()


def make_hours(n):
    return [{
        "index": i, "timestamp": f"2015-06-{16 + i // 24:02d} {i % 24:02d}:00:00", "hour": i % 24,
        "ambient_temp_c": 25.5, "humidity_pct": 50.0, "solar_irradiance_wm2": 0.0, "prediction_kw": 150.25 + i,
        "mode": "Main Grid Mode", "overload": i % 2 == 0, "soc_pct": 80.0, "pv_kw": 12.5, "battery_kw": -100.0, "grid_kw": 250.25,
        "reason": "150.2 kW ≤ 160 and hour 0 is outside 18–22",
    } for i in range(n)]


RECORD = {"source": "csv", "filename": "x.csv", "rows_in": 3, "n_rows": 3, "peak_kw": 212.4,
          "peak_timestamp": "2015-06-16 19:00:00", "overload_count": 1, "storage_hours": 2, "switch_count": 1,
          "start": "2015-06-16 15:00:00", "end": "2015-06-16 17:00:00", "csv_key": "uploads/x.csv",
          "cleaning": {"rows_in": 3, "rows_out": 3, "fixes": [{"code": "sorted", "label": "°C – ≥", "count": 0}]}}


def test_created_iso_adds_the_project_offset():
    assert created_iso("2026-10-26 21:03:11:123") == "2026-10-26T21:03:11+05:30"
    assert created_iso("") == ""


def legacy_hour_row(run_id, hour):
    """A run_hours row as runs saved before 2026-10-27 wrote it (the Data Store hands back strings)."""
    row = {col: str(hour[key]) for key, col in HOUR_FIELDS.items()}
    return row | {"is_overload": "true" if hour["overload"] else "false", "run_id": str(run_id)}


def seed_legacy_run(app, record, hours):
    run_id = FakeTable(app, RUNS_TABLE).insert_row(run_to_row(record))["ROWID"]
    app.tables[HOURS_TABLE].extend(legacy_hour_row(run_id, h) for h in hours)
    return run_id


def index(app):
    return json.loads(app.objects[("microgrid-uploads", INDEX_KEY)][0])


NOW = datetime(2026, 10, 27, 1, 30, 0, tzinfo=timezone.utc)


def test_hour_rows_read_back_with_types_restored():
    for h in make_hours(3):
        assert hour_from_row(legacy_hour_row("42", h)) == h


def test_save_puts_the_run_in_stratus_and_one_row_in_the_data_store():
    app = FakeApp()
    saved = CatalystRunStore(app).save(RECORD, make_hours(450), now=NOW)
    assert RUN_ID.fullmatch(saved["id"]) and saved["id"].startswith("r20261027013000-")
    assert saved["created"] == "2026-10-27T01:30:00+00:00"
    assert saved["storage"] == {"stratus": True, "datastore": True, "reason": None}
    assert app.insert_calls == [(RUNS_TABLE, 1)]  # one request; no run_hours rows any more
    stored = json.loads(app.objects[("microgrid-uploads", f"runs/{saved['id']}.json")][0])
    assert stored["hours"] == make_hours(450) and stored["run"]["cleaning"] == RECORD["cleaning"]
    assert index(app)["runs"][0]["datastore_id"] == app.tables[RUNS_TABLE][0]["ROWID"]
    assert (index(app)["day"], index(app)["saved_today"]) == ("2026-10-27", 1)


def test_a_refused_data_store_insert_still_saves_the_run():
    app = FakeApp()
    app.fail_insert.add(RUNS_TABLE)
    store = CatalystRunStore(app)
    saved = store.save(RECORD, make_hours(5), now=NOW)
    assert saved["storage"] == {"stratus": True, "datastore": False,
                                "reason": "Data Store free-tier insert quota used up for this month"}
    run, hours = store.get_run(saved["id"])
    assert hours == make_hours(5) and run["peak_kw"] == 212.4 and run["storage"]["datastore"] is False
    assert [r["id"] for r in store.list_runs()] == [saved["id"]]


def test_a_failed_stratus_save_is_an_error_and_leaves_no_orphan_row():
    app = FakeApp()
    store = CatalystRunStore(app)
    app.fail_put.add("runs/r")
    with pytest.raises(StoreError, match="saving the run to Stratus failed"):
        store.save(RECORD, make_hours(5), now=NOW)
    assert app.tables[RUNS_TABLE] == []
    assert ("microgrid-uploads", INDEX_KEY) not in app.objects


def test_the_daily_save_limit_counts_per_utc_day():
    app = FakeApp()
    store = CatalystRunStore(app)
    for _ in range(DAILY_SAVE_LIMIT):
        store.save(RECORD, make_hours(1), now=NOW)
    with pytest.raises(DailyLimitError, match="daily save limit"):
        store.save(RECORD, make_hours(1), now=NOW)
    tomorrow = NOW.replace(day=28, hour=0, minute=0, second=1)
    store.save(RECORD, make_hours(1), now=tomorrow)
    assert (index(app)["day"], index(app)["saved_today"]) == ("2026-10-28", 1)
    assert len(index(app)["runs"]) == RUNS_INDEXED


def test_list_runs_merges_stratus_and_legacy_data_store_runs_once_each():
    app = FakeApp()
    legacy = seed_legacy_run(app, {**RECORD, "filename": "old.csv"}, make_hours(2))  # CREATEDTIME 2026-10-26 21:03 IST
    store = CatalystRunStore(app)
    new = store.save({**RECORD, "filename": "new.csv"}, make_hours(1), now=NOW)  # also writes a runs row
    runs = store.list_runs()
    assert [r["id"] for r in runs] == [new["id"], legacy]  # the new run's Data Store row is not listed twice
    assert runs[0]["storage"]["stratus"] and runs[1]["storage"] == {"stratus": False, "datastore": True, "reason": None}
    assert "cleaning" not in runs[0] and "datastore_id" not in runs[0]


def test_demand_series_buckets_the_run_into_at_most_48_points():
    hours = make_hours(1000)  # prediction_kw = 150.25 + i
    series = demand_series(hours)
    assert series["step_hours"] == 21 and len(series["mean_kw"]) == len(series["max_kw"]) == 48 <= SERIES_POINTS
    assert series["max_kw"][0] == 170.2 and series["mean_kw"][0] == 160.2  # hours 0-20
    assert series["max_kw"][-1] == 1149.2  # the last, shorter bucket (hours 987-999)
    assert demand_series(make_hours(24))["step_hours"] == 1 and len(demand_series(make_hours(24))["max_kw"]) == 24
    assert demand_series([]) == {"step_hours": 0, "mean_kw": [], "max_kw": []}


def test_listed_stratus_runs_carry_their_series_and_legacy_runs_none():
    app = FakeApp()
    legacy = seed_legacy_run(app, RECORD, make_hours(2))
    store = CatalystRunStore(app)
    new = store.save(RECORD, make_hours(30), now=NOW)
    runs = {r["id"]: r for r in store.list_runs()}
    assert runs[new["id"]]["series"]["max_kw"][:2] == [150.2, 151.2]  # bankers' rounding of 150.25
    assert "series" not in runs[legacy]


def test_a_transient_error_mentioning_404_is_not_taken_for_a_missing_index():
    app = FakeApp()
    store = CatalystRunStore(app)
    store.save(RECORD, make_hours(2), now=NOW)

    class Flaky(FakeBucket):
        def get_object(self, key, options=None):
            raise CatalystAPIError("STRATUS_ERROR", "gateway timeout on port 4040", http_status_code=504)

    app.stratus = lambda: type("S", (), {"bucket": lambda self, name: Flaky(app, name)})()
    with pytest.raises(StoreError, match="reading the run index failed"):
        store.save(RECORD, make_hours(2), now=NOW)  # must not overwrite the history with an empty index


def test_a_failed_index_write_still_saves_the_run():
    app = FakeApp()
    app.fail_put.add(INDEX_KEY)
    store = CatalystRunStore(app)
    saved = store.save(RECORD, make_hours(3), now=NOW)
    assert saved["storage"]["stratus"] and "not listed in History" in saved["storage"]["reason"]
    assert store.get_run(saved["id"])[1] == make_hours(3)


def test_check_daily_limit_raises_before_anything_is_uploaded():
    app = FakeApp()
    store = CatalystRunStore(app)
    store.check_daily_limit(now=NOW)  # fine while under the limit
    app.objects[("microgrid-uploads", INDEX_KEY)] = (json.dumps({"day": "2026-10-27", "saved_today": DAILY_SAVE_LIMIT, "runs": []}).encode(), None)
    with pytest.raises(DailyLimitError):
        store.check_daily_limit(now=NOW)


def test_list_runs_falls_back_to_the_index_when_the_data_store_fails():
    app = FakeApp()
    store = CatalystRunStore(app)
    new = store.save(RECORD, make_hours(1), now=NOW)
    class Broken:
        def execute_query(self, query):
            raise CatalystAPIError("ZCQL_ERROR", "select refused", http_status_code=500)

    app.zcql = lambda: Broken()
    assert [r["id"] for r in store.list_runs()] == [new["id"]]


def test_get_legacy_run_pages_through_hours_in_order():
    app = FakeApp()
    run_id = seed_legacy_run(app, RECORD, make_hours(2 * SELECT_PAGE + 5))
    seed_legacy_run(app, RECORD, make_hours(4))  # another run's hours must not leak in
    run, hours = CatalystRunStore(app).get_run(run_id)
    assert hours == make_hours(2 * SELECT_PAGE + 5)
    assert run["id"] == run_id and run["peak_kw"] == 212.4 and run["cleaning"] == RECORD["cleaning"]
    assert run["storage"] == {"stratus": False, "datastore": True, "reason": None}
    assert sum(HOURS_TABLE in q for q in app.queries) == 3  # 300 + 300 + 5


@pytest.mark.parametrize("run_id", ["123", "r20261027013000-abcdef", "nope", "1; DROP TABLE runs", "r2026"])
def test_get_missing_or_malformed_run_is_none(run_id):
    assert CatalystRunStore(FakeApp()).get_run(run_id) is None


def test_put_csv_goes_to_the_upload_bucket(monkeypatch):
    monkeypatch.setenv("UPLOAD_BUCKET", "my-bucket")
    app = FakeApp()
    CatalystRunStore(app).put_csv("uploads/a.csv", b"timestamp\n")
    assert app.objects == {("my-bucket", "uploads/a.csv"): (b"timestamp\n", {"content_type": "text/csv"})}


def test_upload_key_is_dated_unique_and_safe():
    now = datetime(2026, 10, 26, 15, 30, 12, tzinfo=timezone.utc)
    key = upload_key("../../etc/my data;.csv", now)
    assert re.fullmatch(r"uploads/2026/10/26/153012-[0-9a-f]{8}-my_data_.csv", key), key
    assert upload_key(None, now).endswith("-upload.csv")
    assert upload_key("a.csv", now) != upload_key("a.csv", now)


def test_run_row_mapping():
    row = run_to_row(RECORD)
    assert "cleaning" not in row and "°C" in row["cleaning_json"]
    back = run_from_row({**{k: str(v) for k, v in row.items() if k != "cleaning_json"},
                         "cleaning_json": row["cleaning_json"], "ROWID": "9", "CREATEDTIME": "2026-10-26 10:00:00:000"})
    assert back["id"] == "9" and back["overload_count"] == 1 and back["cleaning"] == RECORD["cleaning"]


def test_oversized_cleaning_report_drops_the_row_list_but_keeps_the_count():
    rejected = [{"row": i, "reason": "x" * 300} for i in range(50)]
    row = run_to_row({**RECORD, "cleaning": {"rejected_count": 900, "rejected": rejected}})
    assert len(row["cleaning_json"]) <= CLEANING_MAX_CHARS
    assert '"rejected_count": 900' in row["cleaning_json"] and '"rejected": []' in row["cleaning_json"]
