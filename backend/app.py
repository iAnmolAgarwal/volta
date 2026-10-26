"""AppSail entry point: the HTTP proxy between predict.py (and the dashboard) and QuickML.

    POST /api/predict  {"rows": [...]} -> {"predictions", "signals", "battery"}
    GET  /api/health   -> {"status", "version", "quickml_configured"}

Secrets come only from AppSail environment variables and never appear in a
response. Run locally with `python -m backend.app`.
"""

import logging
import os
from pathlib import Path

from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

from backend.service import Forecaster, RequestError, quickml_configured
from model.quickml_client import ConfigError, PredictionError

VERSION_FILE = Path(__file__).resolve().parents[1] / "version.txt"  # written by scripts/build_appsail.sh
log = logging.getLogger("proxy")


def version() -> str:
    return VERSION_FILE.read_text().strip() if VERSION_FILE.exists() else "dev"


def create_app(forecaster: Forecaster | None = None) -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024  # 2,000 rows are about 250 KB
    fc = forecaster or Forecaster()
    app_version = version()

    def error(status: int, message: str, details: list[str] | None = None):
        body = {"error": message}
        if details:
            body["details"] = details
        return jsonify(body), status

    @app.get("/api/health")
    def health():
        return jsonify(status="ok", version=app_version, quickml_configured=quickml_configured())

    @app.post("/api/predict")
    def predict():
        payload = request.get_json(silent=True)
        if payload is None:
            return error(400, 'body must be JSON: {"rows": [...]}')
        try:
            return jsonify(fc.forecast(payload, request))
        except RequestError as e:
            return error(e.status, str(e), e.details)
        except ConfigError as e:
            return error(503, str(e))
        except PredictionError as e:
            return error(502, str(e))

    @app.after_request
    def cors(resp):  # public, credential-free API: the dashboard may live on another origin
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        return resp

    @app.errorhandler(HTTPException)
    def http_error(e):
        return error(e.code, e.name)

    @app.errorhandler(Exception)
    def unexpected(e):
        log.exception("unhandled error")
        return error(500, "internal error")

    return app


def main() -> None:
    from waitress import serve

    logging.basicConfig(level=logging.INFO)
    port = int(os.environ.get("X_ZOHO_CATALYST_LISTEN_PORT", "9000"))
    serve(create_app(), host="0.0.0.0", port=port, threads=8)


if __name__ == "__main__":
    main()
