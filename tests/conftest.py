"""Shared fixtures: a clean endpoint environment and a local fake proxy server."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from fakes import ENDPOINT_VARS, fake_model


@pytest.fixture
def no_endpoint_env(monkeypatch):
    """Clear every endpoint variable so the developer's shell cannot leak into a test."""
    for name in ENDPOINT_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr("model.quickml_client.DEFAULT_PROXY_URL", "")


@pytest.fixture
def proxy_server():
    """A real local HTTP server speaking the proxy schema; records batch sizes."""
    batches = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            rows = json.loads(self.rfile.read(int(self.headers["Content-Length"])))["data"]
            batches.append(len(rows))
            body = json.dumps({"predictions": [fake_model(r) for r in rows]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    server.url = f"http://127.0.0.1:{server.server_port}/predict"
    server.batches = batches
    yield server
    server.shutdown()
    server.server_close()
