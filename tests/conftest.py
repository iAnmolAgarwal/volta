"""Shared fixtures: a clean endpoint environment and a local fake proxy server."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from fakes import ENDPOINT_VARS, fake_predictions


@pytest.fixture
def no_endpoint_env(monkeypatch):
    """Clear every endpoint variable so the developer's shell cannot leak into a test."""
    for name in ENDPOINT_VARS:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def proxy_server():
    """A real local HTTP server speaking our proxy contract: POST /api/predict {"rows": [...]}.

    Records the size of each request; set `server.status` to make it fail.
    """
    batches = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path != "/api/predict":
                return self._send(404, {"error": "not found"})
            rows = json.loads(self.rfile.read(int(self.headers["Content-Length"])))["rows"]
            batches.append(len(rows))
            if server.status != 200:
                return self._send(server.status, {"error": "fake failure"})
            self._send(200, {"predictions": fake_predictions(rows), "signals": [], "battery": []})

        def _send(self, status, payload):
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.status = 200
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    server.url = f"http://127.0.0.1:{server.server_port}"
    server.batches = batches
    yield server
    server.shutdown()
    server.server_close()
