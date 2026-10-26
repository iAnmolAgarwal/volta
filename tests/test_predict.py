import os
import re
import socket
import subprocess
import sys

import numpy as np
import pandas as pd
import pytest

import predict
from fakes import ENDPOINT_VARS, FakeResponse, FakeSession, fake_model, proxy_answer
from model.data import ROOT, load_test
from model.features import QUICKML_FEATURES, build_features
from model.quickml_client import ConfigError, PredictionError, QuickMLClient

SAMPLE = ROOT / "sample_test_input.csv"


def expected(df: pd.DataFrame) -> np.ndarray:
    rows = build_features(df)[QUICKML_FEATURES].to_dict(orient="records")
    return np.array([fake_model(r) for r in rows])


def mock_client(handler=proxy_answer, batch_size: int = 7, retries: int = 0) -> QuickMLClient:
    env = {"PREDICT_PROXY_URL": "https://proxy.example/predict",
           "QUICKML_BATCH_SIZE": str(batch_size), "QUICKML_RETRIES": str(retries)}
    return QuickMLClient.from_env(env, session=FakeSession(handler), sleep=lambda s: None)


def clean_env(**extra) -> dict:
    env = {k: v for k, v in os.environ.items() if k not in ENDPOINT_VARS}
    return {**env, **extra}


def run_cli(*args, env) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "predict.py", *args], cwd=ROOT, env=env, capture_output=True, text=True)


# --- predict() ---------------------------------------------------------------


def test_returns_one_float_per_row_in_order():
    df = pd.read_csv(SAMPLE)
    preds = predict.predict(df, client=mock_client())
    assert isinstance(preds, np.ndarray) and preds.dtype == float and len(preds) == len(df)
    np.testing.assert_allclose(preds, expected(df))


def test_shuffled_input_keeps_its_own_order():
    df = pd.read_csv(SAMPLE).sample(frac=1, random_state=1)
    np.testing.assert_allclose(predict.predict(df, client=mock_client()), expected(df))


def test_endpoint_failure_raises_instead_of_a_fallback():
    with pytest.raises(PredictionError, match="HTTP 503"):
        predict.predict(load_test(), client=mock_client(lambda call: FakeResponse(503, text="down")))


def test_short_response_raises():
    def drop_last(call):
        answer = proxy_answer(call)
        answer._body["predictions"].pop()
        return answer

    with pytest.raises(PredictionError, match="expected 7 predictions, got 6"):
        predict.predict(load_test(), client=mock_client(drop_last))


def test_no_configuration_raises(no_endpoint_env, monkeypatch):
    monkeypatch.setattr(predict, "_client", None)
    with pytest.raises(ConfigError, match="no prediction endpoint configured"):
        predict.predict(load_test())


def test_missing_input_column_raises():
    with pytest.raises(ValueError, match="missing columns: humidity_pct"):
        predict.predict(load_test().drop(columns="humidity_pct"), client=mock_client())


def test_self_test_passes_against_a_mock_endpoint(proxy_server, no_endpoint_env, monkeypatch, capsys):
    import test_eval

    monkeypatch.setenv("PREDICT_PROXY_URL", proxy_server.url)
    monkeypatch.setenv("QUICKML_BATCH_SIZE", "250")
    monkeypatch.setattr(predict, "_client", None)
    monkeypatch.chdir(ROOT)
    test_eval.test_student_submission()
    assert capsys.readouterr().out.rstrip().endswith("SUCCESS")
    assert proxy_server.batches == [250, 250, 250, 250]


# --- CLI ---------------------------------------------------------------------


def test_cli_writes_the_contract_format(proxy_server, tmp_path):
    out = tmp_path / "p.csv"
    env = clean_env(PREDICT_PROXY_URL=proxy_server.url, QUICKML_BATCH_SIZE="100")
    result = run_cli("--input", str(SAMPLE), "--output", str(out), env=env)
    assert result.returncode == 0, result.stderr

    lines = out.read_text().splitlines()
    assert lines[0] == "timestamp,target_demand_kw"
    raw = pd.read_csv(SAMPLE, dtype=str)
    assert len(lines) == len(raw) + 1
    stamps, values = zip(*(line.split(",") for line in lines[1:]))
    assert list(stamps) == raw["timestamp"].tolist()  # original strings, original order
    assert all(re.fullmatch(r"\d+\.\d{2}", v) for v in values)
    np.testing.assert_allclose([float(v) for v in values], expected(pd.read_csv(SAMPLE)), atol=0.005)
    assert proxy_server.batches == [100] * 10


def test_cli_fails_loudly_when_the_endpoint_is_down(tmp_path):
    with socket.socket() as s:  # a port with nothing listening
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    out = tmp_path / "p.csv"
    env = clean_env(PREDICT_PROXY_URL=f"http://127.0.0.1:{port}/predict", QUICKML_RETRIES="0")
    result = run_cli("--input", str(SAMPLE), "--output", str(out), env=env)
    assert result.returncode == 1
    assert "predict.py: error:" in result.stderr and "ConnectionError" in result.stderr
    assert not out.exists()


def test_cli_without_configuration_exits_non_zero(no_endpoint_env, monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(predict, "_client", None)
    out = tmp_path / "p.csv"
    assert predict.main(["--input", str(SAMPLE), "--output", str(out)]) == 1
    assert "no prediction endpoint configured" in capsys.readouterr().err
    assert not out.exists()


def test_cli_without_arguments_previews_the_sample(proxy_server, no_endpoint_env, monkeypatch, capsys):
    monkeypatch.setenv("PREDICT_PROXY_URL", proxy_server.url)
    monkeypatch.setenv("QUICKML_BATCH_SIZE", "500")
    monkeypatch.setattr(predict, "_client", None)
    monkeypatch.chdir(ROOT)
    assert predict.main([]) == 0
    assert "Generated 1000 predictions" in capsys.readouterr().out
