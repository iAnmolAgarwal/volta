"""Test doubles for the prediction endpoint. No test touches the network."""

import json

_to_json = json.dumps  # FakeSession.post's `json` argument shadows the module

ENDPOINT_VARS = [
    "PREDICT_PROXY_URL",
    "QUICKML_ENDPOINT_URL",
    "QUICKML_ENDPOINT_KEY",
    "QUICKML_ENVIRONMENT",
    "CATALYST_ORG",
    "ZOHO_CLIENT_ID",
    "ZOHO_CLIENT_SECRET",
    "ZOHO_REFRESH_TOKEN",
    "QUICKML_BATCH_SIZE",
    "QUICKML_TIMEOUT",
    "QUICKML_RETRIES",
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


def proxy_answer(call) -> FakeResponse:
    """A healthy proxy: one prediction per row from fake_model."""
    return FakeResponse(200, {"predictions": [fake_model(r) for r in call["json"]["data"]]})
