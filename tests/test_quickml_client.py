import pandas as pd
import pytest
import requests

from fakes import FakeResponse, FakeSession, proxy_answer
from model.quickml_client import (
    ZOHO_TOKEN_URL,
    ConfigError,
    PredictionError,
    ProxyTransport,
    QuickMLClient,
    QuickMLTransport,
)

PROXY = {"PREDICT_PROXY_URL": "https://proxy.example/predict"}
DIRECT = {
    "QUICKML_ENDPOINT_URL": "https://api.catalyst.example/quickml/endpoint",
    "QUICKML_ENDPOINT_KEY": "endpoint-key-SECRET",
    "CATALYST_ORG": "60012345",
    "ZOHO_CLIENT_ID": "1000.CLIENTID",
    "ZOHO_CLIENT_SECRET": "client-secret-SECRET",
    "ZOHO_REFRESH_TOKEN": "refresh-token-SECRET",
}
SECRETS = ["endpoint-key-SECRET", "client-secret-SECRET", "refresh-token-SECRET", "access-token-SECRET"]


def indexed_rows(n: int) -> pd.DataFrame:
    """Feature rows whose only column is their position, so order is checkable exactly."""
    return pd.DataFrame({"i": range(n)})


def echo_index(call) -> FakeResponse:
    return FakeResponse(200, {"predictions": [float(r["i"]) for r in call["json"]["data"]]})


def client(env: dict, handler, sleeps: list | None = None, clock=None):
    session = FakeSession(handler)
    kwargs = {"session": session, "sleep": (sleeps.append if sleeps is not None else lambda s: None)}
    if clock is not None:
        kwargs["clock"] = clock
    return QuickMLClient.from_env(env, **kwargs), session


def direct_handler(predict_responses):
    """Zoho token endpoint plus a QuickML endpoint that answers from a list (last one repeats)."""
    tokens = iter(f"access-token-SECRET-{i}" for i in range(100))
    answers = list(predict_responses)

    def handler(call):
        if call["url"] == ZOHO_TOKEN_URL:
            return FakeResponse(200, {"access_token": next(tokens), "expires_in": 3600})
        answer = answers.pop(0) if len(answers) > 1 else answers[0]
        return answer(call) if callable(answer) else answer

    return handler


# --- configuration ---------------------------------------------------------


def test_proxy_is_chosen_and_wins_over_direct():
    c, _ = client({**DIRECT, **PROXY}, proxy_answer)
    assert isinstance(c.transport, ProxyTransport) and c.batch_size == 1


def test_direct_is_chosen_without_a_proxy():
    c, _ = client(DIRECT, proxy_answer)
    assert isinstance(c.transport, QuickMLTransport)


def test_default_proxy_url_is_used_when_nothing_is_set(monkeypatch):
    monkeypatch.setattr("model.quickml_client.DEFAULT_PROXY_URL", "https://appsail.example/predict")
    c, _ = client({}, proxy_answer)
    assert c.transport.url == "https://appsail.example/predict"


def test_nothing_configured_raises(monkeypatch):
    monkeypatch.setattr("model.quickml_client.DEFAULT_PROXY_URL", "")
    with pytest.raises(ConfigError, match="PREDICT_PROXY_URL"):
        client({}, proxy_answer)


def test_direct_names_missing_variables():
    env = {k: v for k, v in DIRECT.items() if k not in ("CATALYST_ORG", "ZOHO_REFRESH_TOKEN")}
    with pytest.raises(ConfigError, match="CATALYST_ORG, ZOHO_REFRESH_TOKEN"):
        client(env, proxy_answer)


@pytest.mark.parametrize(
    "extra", [{"QUICKML_BATCH_SIZE": "0"}, {"QUICKML_BATCH_SIZE": "two"}, {"QUICKML_RETRIES": "-1"},
              {"QUICKML_TIMEOUT": "0"}, {"PREDICT_PROXY_URL": "ftp://proxy.example"}],
)
def test_bad_settings_raise(extra):
    with pytest.raises(ConfigError):
        client({**PROXY, **extra}, proxy_answer)


# --- chunking and order ----------------------------------------------------


@pytest.mark.parametrize("batch, sizes", [(1, [1] * 10), (3, [3, 3, 3, 1]), (10, [10]), (50, [10])])
def test_chunks_reassemble_in_order(batch, sizes):
    c, session = client({**PROXY, "QUICKML_BATCH_SIZE": str(batch)}, echo_index)
    preds = c.predict(indexed_rows(10))
    assert preds.tolist() == [float(i) for i in range(10)]
    assert [len(call["json"]["data"]) for call in session.calls] == sizes


def test_empty_input_makes_no_requests():
    c, session = client(PROXY, echo_index)
    assert c.predict(indexed_rows(0)).tolist() == [] and session.calls == []


def test_quickml_sample_response_shape_is_accepted():
    c, _ = client(PROXY, lambda call: FakeResponse(200, {"status": "success", "result": [123.4]}))
    assert c.predict(indexed_rows(1)).tolist() == [123.4]


@pytest.mark.parametrize(
    "body, message",
    [
        ({"predictions": [1.0, 2.0]}, "expected 1 predictions, got 2 values"),
        ({"prediction": 1.0}, "response keys"),
        ({"predictions": ["abc"]}, "non-numeric"),
        ({"predictions": [float("nan")]}, "NaN or infinite"),
        ({"status": "failure", "result": [1.0]}, "status 'failure'"),
        ([1.0], "expected a JSON object"),
    ],
)
def test_unusable_responses_raise(body, message):
    c, _ = client(PROXY, lambda call: FakeResponse(200, body))
    with pytest.raises(PredictionError, match=message):
        c.predict(indexed_rows(1))


def test_error_names_the_failing_rows():
    def fail_third_batch(call):
        if call["json"]["data"][0]["i"] == 4:
            return FakeResponse(200, {"predictions": []})
        return echo_index(call)

    c, _ = client({**PROXY, "QUICKML_BATCH_SIZE": "2"}, fail_third_batch)
    with pytest.raises(PredictionError, match="rows 4-5"):
        c.predict(indexed_rows(8))


# --- timeout and retries ---------------------------------------------------


def test_timeout_is_passed_to_every_request():
    c, session = client({**PROXY, "QUICKML_TIMEOUT": "2.5"}, echo_index)
    c.predict(indexed_rows(3))
    assert {call["timeout"] for call in session.calls} == {2.5}


def test_transient_failures_are_retried_with_backoff():
    answers = [FakeResponse(503, text="busy"), requests.ConnectionError("reset"), None]
    sleeps = []
    c, session = client(PROXY, lambda call: answers.pop(0) or echo_index(call), sleeps)
    assert c.predict(indexed_rows(1)).tolist() == [0.0]
    assert len(session.calls) == 3 and sleeps == [0.5, 1.0]


def test_retry_after_header_is_respected():
    answers = [FakeResponse(429, text="slow down", headers={"Retry-After": "3"}), None]
    sleeps = []
    c, _ = client(PROXY, lambda call: answers.pop(0) or echo_index(call), sleeps)
    c.predict(indexed_rows(1))
    assert sleeps == [3.0]


def test_persistent_failure_raises_after_all_retries():
    sleeps = []
    c, session = client({**PROXY, "QUICKML_RETRIES": "2"}, lambda call: requests.Timeout("slow"), sleeps)
    with pytest.raises(PredictionError, match="after 3 attempt"):
        c.predict(indexed_rows(1))
    assert len(session.calls) == 3 and sleeps == [0.5, 1.0]


def test_client_errors_are_not_retried():
    c, session = client(PROXY, lambda call: FakeResponse(400, text='{"message": "bad feature"}'))
    with pytest.raises(PredictionError, match="HTTP 400"):
        c.predict(indexed_rows(1))
    assert len(session.calls) == 1


def test_non_json_success_raises():
    c, _ = client(PROXY, lambda call: FakeResponse(200, body=None, text="<html>oops</html>"))
    with pytest.raises(PredictionError, match="non-JSON"):
        c.predict(indexed_rows(1))


# --- direct QuickML: auth, token cache, secrets ----------------------------


def test_direct_sends_quickml_headers_and_caches_the_token():
    c, session = client(DIRECT, direct_handler([echo_index]))
    c.predict(indexed_rows(5))
    token_calls = [x for x in session.calls if x["url"] == ZOHO_TOKEN_URL]
    predict_calls = [x for x in session.calls if x["url"] != ZOHO_TOKEN_URL]
    assert len(token_calls) == 1 and len(predict_calls) == 5
    assert token_calls[0]["data"] == {
        "refresh_token": "refresh-token-SECRET",
        "client_id": "1000.CLIENTID",
        "client_secret": "client-secret-SECRET",
        "grant_type": "refresh_token",
    }
    assert "SECRET" not in token_calls[0]["url"]  # credentials go in the body, not the URL
    assert predict_calls[0]["headers"] == {
        "Authorization": "Zoho-oauthtoken access-token-SECRET-0",
        "X-QUICKML-ENDPOINT-KEY": "endpoint-key-SECRET",
        "CATALYST-ORG": "60012345",
        "Environment": "Production",
    }


def test_token_is_refreshed_after_it_expires():
    now = [0.0]
    c, session = client(DIRECT, direct_handler([echo_index]), clock=lambda: now[0])
    c.predict(indexed_rows(1))
    now[0] = 3600 - 61  # still inside expiry minus the 60 s margin
    c.predict(indexed_rows(1))
    now[0] = 3600 - 59
    c.predict(indexed_rows(1))
    tokens_used = [x["headers"]["Authorization"] for x in session.calls if x["url"] != ZOHO_TOKEN_URL]
    assert tokens_used == ["Zoho-oauthtoken access-token-SECRET-0"] * 2 + ["Zoho-oauthtoken access-token-SECRET-1"]


def test_rejected_token_is_refreshed_once():
    c, session = client(DIRECT, direct_handler([FakeResponse(401, text="expired"), echo_index]))
    assert c.predict(indexed_rows(1)).tolist() == [0.0]
    assert sum(x["url"] == ZOHO_TOKEN_URL for x in session.calls) == 2


def test_second_rejection_raises_with_a_hint():
    c, _ = client(DIRECT, direct_handler([FakeResponse(401, text="no scope")]))
    with pytest.raises(PredictionError, match="QuickML.deployment.READ"):
        c.predict(indexed_rows(1))


def test_token_endpoint_error_raises_without_secrets():
    def handler(call):
        return FakeResponse(200, {"error": "invalid_code"})

    c, _ = client(DIRECT, handler)
    with pytest.raises(PredictionError, match="invalid_code") as exc:
        c.predict(indexed_rows(1))
    assert not any(s in str(exc.value) for s in SECRETS)


def test_secrets_are_redacted_from_errors():
    def echo_headers(call):
        return FakeResponse(400, text=f"bad request, headers were {call['headers']}")

    c, _ = client(DIRECT, direct_handler([echo_headers]))
    with pytest.raises(PredictionError) as exc:
        c.predict(indexed_rows(1))
    message = str(exc.value)
    assert "***" in message and not any(s in message for s in SECRETS)
