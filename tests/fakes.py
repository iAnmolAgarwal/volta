"""Test doubles for the prediction endpoint. No test touches the network."""

import json

_to_json = json.dumps  # FakeSession.post's `json` argument shadows the module

ENDPOINT_VARS = [
    "PREDICT_PROXY_URL",
    "QUICKML_ENDPOINT_URL",
    "QUICKML_ENDPOINT_KEY",
    "QUICKML_ENVIRONMENT",
    "ZOHO_ORG_ID",
    "ZOHO_CLIENT_ID",
    "ZOHO_CLIENT_SECRET",
    "ZOHO_REFRESH_TOKEN",
    "QUICKML_BATCH_SIZE",
    "QUICKML_TIMEOUT",
    "QUICKML_RETRIES",
    "QUICKML_CONCURRENCY",
]


def fake_model(row: dict) -> float:
    """Deterministic stand-in for the QuickML model, distinct per hour block and temperature."""
    blocks = ["blk_dawn", "blk_morning", "blk_day", "blk_evening", "blk_late"]
    return 90.0 + sum((i + 1) * 10 * row[b] for i, b in enumerate(blocks)) + 8.5 * row["cool_24"]


class FakeResponse:
    def __init__(self, status: int = 200, body=None, text: str | None = None, headers: dict | None = None):
        self.status_code, self._body, self.headers = status, body, headers or {}
        self.text = text if text is not None else json.dumps(body)

    def json(self):
        if self._body is None:
            raise ValueError("no JSON body")
        return self._body


class FakeSession:
    """Stands in for requests.Session: records each POST and answers via `handler(call)`."""

    def __init__(self, handler):
        self.handler, self.calls = handler, []

    def post(self, url, json=None, data=None, headers=None, timeout=None):
        if json is not None:
            _to_json(json)  # must serialise, as requests would
        call = {"url": url, "json": json, "data": data, "headers": headers or {}, "timeout": timeout}
        self.calls.append(call)
        answer = self.handler(call)
        if isinstance(answer, Exception):
            raise answer
        return answer


def fake_predictions(rows: list[dict]) -> list[float]:
    """What a healthy proxy answers for raw telemetry rows: fake_model on the real features."""
    import pandas as pd

    from model.features import QUICKML_FEATURES, build_features

    feats = build_features(pd.DataFrame(rows))[QUICKML_FEATURES].to_dict(orient="records")
    return [fake_model(r) for r in feats]


class FakeRunStore:
    """Stands in for backend.store.CatalystRunStore: keeps runs in memory, can be told to fail."""

    def __init__(self, fail_save: Exception | None = None, fail_csv: Exception | None = None):
        self.runs, self.csvs, self.fail_save, self.fail_csv = {}, {}, fail_save, fail_csv
        self.objects = {}  # the bucket's JSON objects (the QuickML ledger)
        self._next = 1000

    def get_json(self, key: str):
        return json.loads(self.objects[key]) if key in self.objects else None

    def put_json(self, key: str, value) -> None:
        self.objects[key] = json.dumps(value)

    def put_csv(self, key: str, data: bytes) -> None:
        if self.fail_csv:
            raise self.fail_csv
        self.csvs[key] = data

    def save(self, record: dict, hours: list[dict]) -> dict:
        if self.fail_save:
            raise self.fail_save
        self._next += 1
        run_id = str(self._next)
        created = f"2026-10-26T12:00:{self._next % 60:02d}+05:30"
        storage = {"stratus": True, "datastore": True, "reason": None}
        self.runs[run_id] = ({**record, "id": run_id, "created": created, "storage": storage}, [dict(h) for h in hours])
        return {"id": run_id, "created": created, "storage": storage}

    def list_runs(self, limit: int = 20) -> list[dict]:
        newest = sorted(self.runs.values(), key=lambda r: int(r[0]["id"]), reverse=True)[:limit]
        return [{k: v for k, v in run.items() if k != "cleaning"} for run, _ in newest]

    def get_run(self, run_id):
        found = self.runs.get(str(run_id))
        return (dict(found[0]), [dict(h) for h in found[1]]) if found else None
