import importlib.util
import stat

import pytest

from fakes import FakeResponse
from model.data import ROOT

spec = importlib.util.spec_from_file_location("zoho_auth", ROOT / "scripts" / "zoho_auth.py")
zoho_auth = importlib.util.module_from_spec(spec)
spec.loader.exec_module(zoho_auth)

SECRETS = ["client-secret-SECRET", "grant-code-SECRET", "refresh-token-SECRET"]


@pytest.fixture
def env_file(tmp_path, monkeypatch):
    for k in ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"]:
        monkeypatch.delenv(k, raising=False)
    path = tmp_path / ".env"
    path.write_text("# comment\nZOHO_CLIENT_ID=1000.ID\nZOHO_CLIENT_SECRET=client-secret-SECRET\nZOHO_REFRESH_TOKEN=\nQUICKML_BATCH_SIZE=1000\n")
    return path


def test_writes_the_refresh_token_without_printing_secrets(env_file, capsys):
    sent = {}

    def post(url, data, timeout):
        sent.update(url=url, data=data)
        return FakeResponse(200, {"refresh_token": "refresh-token-SECRET", "access_token": "a"})

    assert zoho_auth.main(env_file, ask=lambda prompt: "grant-code-SECRET", post=post) == 0
    assert sent["url"] == "https://accounts.zoho.in/oauth/v2/token"
    assert sent["data"] == {"grant_type": "authorization_code", "client_id": "1000.ID",
                            "client_secret": "client-secret-SECRET", "code": "grant-code-SECRET"}
    lines = env_file.read_text().splitlines()
    assert "ZOHO_REFRESH_TOKEN=refresh-token-SECRET" in lines
    assert lines[0] == "# comment" and "QUICKML_BATCH_SIZE=1000" in lines and len(lines) == 5
    assert stat.S_IMODE(env_file.stat().st_mode) == 0o600
    out = capsys.readouterr()
    assert not any(s in out.out + out.err for s in SECRETS)


def test_zoho_error_exits_non_zero_without_secrets(env_file, capsys):
    post = lambda url, data, timeout: FakeResponse(200, {"error": "invalid_code"})  # noqa: E731
    assert zoho_auth.main(env_file, ask=lambda prompt: "grant-code-SECRET", post=post) == 1
    out = capsys.readouterr()
    assert "invalid_code" in out.err and not any(s in out.out + out.err for s in SECRETS)
    assert "ZOHO_REFRESH_TOKEN=\n" in env_file.read_text()


def test_missing_client_credentials_are_asked_for_hidden(tmp_path, monkeypatch):
    for k in ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET"]:
        monkeypatch.delenv(k, raising=False)
    path = tmp_path / ".env"
    prompts = []

    def ask(prompt):
        prompts.append(prompt)
        return {"ZOHO_CLIENT_ID: ": "1000.ID"}.get(prompt, "client-secret-SECRET" if "SECRET" in prompt else "code")

    post = lambda url, data, timeout: FakeResponse(200, {"refresh_token": "refresh-token-SECRET"})  # noqa: E731
    assert zoho_auth.main(path, ask=ask, post=post) == 0
    assert len(prompts) == 3
    assert set(path.read_text().splitlines()) == {"ZOHO_REFRESH_TOKEN=refresh-token-SECRET", "ZOHO_CLIENT_ID=1000.ID",
                                                  "ZOHO_CLIENT_SECRET=client-secret-SECRET"}
