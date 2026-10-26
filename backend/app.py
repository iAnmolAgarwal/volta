"""AppSail entry point: the HTTP API between predict.py (and the dashboard) and QuickML.

    POST /api/predict    {"rows": [...]} -> {"predictions", "signals", "battery"}  (predict.py's contract)
    POST /api/forecast   CSV upload or {"rows": [...]} -> a cleaned, explained, saved run
    GET  /api/runs       the latest 20 runs
    GET  /api/runs/<id>  one saved run, in the same shape as /api/forecast
    GET  /api/sample     the bundled sample CSV
    GET  /api/health     -> {"status", "version", "quickml_configured", "catalyst_context"}

docs/api.md has request and response examples.
Secrets come only from AppSail environment variables and never appear in a
response. Run locally with `python -m backend.app`.
"""

import logging
import os
from pathlib import Path

from flask import Flask, jsonify, request, send_file
from werkzeug.exceptions import HTTPException

from backend.cleaning import CleaningError, read_csv, rows_frame
from backend.forecast import SOURCES, ForecastService, NoStoreError, catalyst_store
from backend.quickml_sdk import in_catalyst
from backend.service import Forecaster, RequestError, quickml_configured
from backend.store import StoreError
from backend.timeline import WindowError
from model.quickml_client import ConfigError, PredictionError

ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / "version.txt"  # written by scripts/build_appsail.sh
SAMPLE_CSV = ROOT / "sample_test_input.csv"  # copied into the bundle by scripts/build_appsail.sh
log = logging.getLogger("proxy")


def version() -> str:
    return VERSION_FILE.read_text().strip() if VERSION_FILE.exists() else "dev"


def create_app(forecaster: Forecaster | None = None, store_factory=catalyst_store) -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024  # 2,000 rows are about 250 KB
    fc = forecaster or Forecaster()
    runs = ForecastService(fc, store_factory)
    app_version = version()

    def error(status: int, message: str, details: list[str] | None = None):
        body = {"error": message}
        if details:
            body["details"] = details
        return jsonify(body), status

    @app.get("/api/health")
    def health():
        # catalyst_context: did the gateway add the X-ZC-* headers the SDK authenticates with?
        return jsonify(
            status="ok",
            version=app_version,
            quickml_configured=quickml_configured(),
            catalyst_context=in_catalyst(request),
        )

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

    @app.post("/api/forecast")
    def forecast():
        upload = request.files.get("file")
        if upload is not None:
            csv_bytes, filename, rows = upload.read(), upload.filename, None
            source, window_start = request.form.get("source") or "csv", request.form.get("window_start")
        elif request.files or request.form:
            return error(400, "upload the CSV as the multipart field 'file'")
        else:
            payload = request.get_json(silent=True)
            if not isinstance(payload, dict):
                return error(400, 'send a CSV as the multipart field "file", or JSON: {"rows": [...]}')
            csv_bytes, filename, rows = None, None, payload.get("rows")
            source, window_start = payload.get("source") or "manual", payload.get("window_start")
        window_start = request.args.get("window_start", window_start)
        if source not in SOURCES:
            return error(400, f"source must be one of {', '.join(SOURCES)}, got {str(source)[:20]!r}")
        try:
            frame = read_csv(csv_bytes) if csv_bytes is not None else rows_frame(rows)
            return jsonify(runs.forecast(frame, source=source, filename=filename, csv_bytes=csv_bytes,
                                         window_start=window_start, request=request))
        except CleaningError as e:
            return error(e.status, str(e), e.details)
        except WindowError as e:
            return error(400, str(e))
        except ConfigError as e:
            return error(503, str(e))
        except PredictionError as e:
            return error(502, str(e))

    @app.get("/api/runs")
    def list_runs():
        try:
            return jsonify(runs=runs.list_runs(request))
        except NoStoreError as e:
            return error(503, str(e))
        except StoreError as e:
            return error(502, str(e))

    @app.get("/api/runs/<int:run_id>")
    def get_run(run_id: int):
        try:
            found = runs.get_run(run_id, request.args.get("window_start"), request)
        except WindowError as e:
            return error(400, str(e))
        except NoStoreError as e:
            return error(503, str(e))
        except StoreError as e:
            return error(502, str(e))
        return jsonify(found) if found else error(404, f"no run {run_id}")

    @app.get("/api/sample")
    def sample():
        return send_file(SAMPLE_CSV, mimetype="text/csv", as_attachment=True, download_name=SAMPLE_CSV.name)

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
