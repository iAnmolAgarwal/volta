"""CatalystRunStore against a fake zcatalyst_sdk app: no network, no Catalyst account."""

import re
from datetime import datetime, timezone

import pytest
from zcatalyst_sdk.exceptions import CatalystAPIError

from backend.store import (HOURS_TABLE, INSERT_BATCH, RUNS_TABLE, SELECT_PAGE, CatalystRunStore, StoreError,
                           created_iso, hour_from_row, hour_to_row, run_from_row, run_to_row, upload_key)


class FakeTable:
    def __init__(self, db, name):
        self.db, self.name = db, name

    def insert_row(self, row):
        return self.insert_rows([row])[0]

    def insert_rows(self, rows):
        if self.name in self.db.fail_insert:
            raise CatalystAPIError("DATA_STORE_ERROR", "insert refused", http_status_code=400)
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
        m = re.match(r"SELECT (.+) FROM (\w+)(?: WHERE (\w+) = (\d+))?(?: ORDER BY (\w+)( DESC)?)? LIMIT (\d+), (\d+)$", query) \
            or re.match(r"SELECT (.+) FROM (\w+) WHERE (\w+) = (\d+)()()()()$", query)
        cols, table, where_col, where_val, order, desc, offset, count = m.groups()
        rows = [r for r in self.db.tables[table] if not where_col or r.get(where_col) == where_val]
        if order:
            key = (lambda r: int(r[order])) if order == "idx" else (lambda r: int(r["ROWID"]))
            rows = sorted(rows, key=key, reverse=bool(desc))
        if offset:
            rows = rows[int(offset):int(offset) + int(count)]
        if cols != "*":
            rows = [{c: r.get(c) for c in cols.split(", ")} for r in rows]
        return [{table: r} for r in rows]


class FakeBucket:
    def __init__(self, db, name):
        self.db, self.name = db, name

    def put_object(self, key, body, options=None):
        self.db.objects[(self.name, key)] = (body, options)
        return True


class FakeApp:
    def __init__(self):
        self.tables = {RUNS_TABLE: [], HOURS_TABLE: []}
        self.objects, self.queries, self.insert_calls, self.fail_insert = {}, [], [], set()
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
        "mode": "Main Grid Mode", "overload": i % 2 == 0, "soc_pct": 80.0, "battery_kw": -100.0, "grid_kw": 250.25,
        "reason": "150.2 kW ≤ 160 and hour 0 is outside 18–22",
    } for i in range(n)]


RECORD = {"source": "csv", "filename": "x.csv", "rows_in": 3, "n_rows": 3, "peak_kw": 212.4,
          "peak_timestamp": "2015-06-16 19:00:00", "overload_count": 1, "storage_hours": 2, "switch_count": 1,
          "start": "2015-06-16 15:00:00", "end": "2015-06-16 17:00:00", "csv_key": "uploads/x.csv",
          "cleaning": {"rows_in": 3, "rows_out": 3, "fixes": [{"code": "sorted", "label": "°C – ≥", "count": 0}]}}


def test_created_iso_adds_the_project_offset():
    assert created_iso("2026-10-26 21:03:11:123") == "2026-10-26T21:03:11+05:30"
    assert created_iso("") == ""


def test_hour_rows_round_trip_with_types_restored():
    for h in make_hours(3):
        row = hour_to_row("42", h)
        assert row["run_id"] == "42" and row["is_overload"] in ("true", "false")
        assert hour_from_row({k: str(v) for k, v in row.items()}) == h


def test_save_inserts_the_run_then_hours_in_batches_of_200():
    app = FakeApp()
    saved = CatalystRunStore(app).save(RECORD, make_hours(450))
    assert saved == {"id": "7001", "created": "2026-10-26T21:03:11+05:30"}
    assert app.insert_calls == [(RUNS_TABLE, 1), (HOURS_TABLE, INSERT_BATCH), (HOURS_TABLE, INSERT_BATCH), (HOURS_TABLE, 50)]
    assert {r["run_id"] for r in app.tables[HOURS_TABLE]} == {"7001"}
    run_row = app.tables[RUNS_TABLE][0]
    assert run_row["source_type"] == "csv" and run_row["peak_kw"] == "212.4"


def test_failed_hour_insert_removes_the_half_written_run():
    app = FakeApp()
    app.fail_insert.add(HOURS_TABLE)
    with pytest.raises(StoreError, match="saving the hourly rows failed"):
        CatalystRunStore(app).save(RECORD, make_hours(5))
    assert app.tables[RUNS_TABLE] == []


def test_failed_run_insert_is_a_store_error():
    app = FakeApp()
    app.fail_insert.add(RUNS_TABLE)
    with pytest.raises(StoreError, match="saving the run failed"):
        CatalystRunStore(app).save(RECORD, make_hours(5))


def test_get_run_pages_through_hours_in_order():
    app = FakeApp()
    store = CatalystRunStore(app)
    run_id = store.save(RECORD, make_hours(2 * SELECT_PAGE + 5))["id"]
    store.save(RECORD, make_hours(4))  # another run's hours must not leak in
    run, hours = store.get_run(int(run_id))
    assert [h["index"] for h in hours] == list(range(2 * SELECT_PAGE + 5))
    assert hours == make_hours(2 * SELECT_PAGE + 5)
    assert run["id"] == run_id and run["peak_kw"] == 212.4 and run["n_rows"] == 3
    assert run["cleaning"] == RECORD["cleaning"]
    assert sum(HOURS_TABLE in q for q in app.queries) == 3  # 300 + 300 + 5


def test_get_missing_run_is_none():
    assert CatalystRunStore(FakeApp()).get_run(123) is None


def test_list_runs_newest_first_without_the_cleaning_report():
    app = FakeApp()
    store = CatalystRunStore(app)
    ids = [store.save({**RECORD, "filename": f"{i}.csv"}, make_hours(1))["id"] for i in range(3)]
    runs = store.list_runs(2)
    assert [r["id"] for r in runs] == ids[::-1][:2]
    assert runs[0]["filename"] == "2.csv" and runs[0]["created"] == "2026-10-26T21:03:11+05:30"
    assert "cleaning" not in runs[0]
    assert app.queries[-1].endswith("ORDER BY CREATEDTIME DESC LIMIT 0, 2")


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
