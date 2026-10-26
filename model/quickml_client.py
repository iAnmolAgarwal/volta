"""QuickML client used by the AppSail proxy (backend/).

QuickMLClient.from_env() calls a published QuickML endpoint directly:
QUICKML_ENDPOINT_URL, QUICKML_ENDPOINT_KEY, ZOHO_ORG_ID and a Zoho OAuth
refresh token (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN).
Access tokens are cached until shortly before they expire.

Rows go out QUICKML_BATCH_SIZE at a time (default 1), up to
QUICKML_CONCURRENCY requests in parallel (default 8), each with a timeout
(QUICKML_TIMEOUT seconds) and retries with exponential backoff
(QUICKML_RETRIES). Every failure raises, and error messages never contain
secret values.

(predict.py does not use this module: it carries its own minimal client for
the proxy so it runs when copied alone.)
"""

import math
import os
import threading
import time
from collections.abc import Callable, Iterable, Mapping
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlsplit

import numpy as np
import pandas as pd
import requests

ZOHO_TOKEN_URL = "https://accounts.zoho.in/oauth/v2/token"
DIRECT_VARS = [
    "QUICKML_ENDPOINT_URL",
    "QUICKML_ENDPOINT_KEY",
    "ZOHO_ORG_ID",  # sent as the CATALYST-ORG header; AppSail reserves CATALYST* variable names
    "ZOHO_CLIENT_ID",
    "ZOHO_CLIENT_SECRET",
    "ZOHO_REFRESH_TOKEN",
]
RETRYABLE_STATUS = {429, 500, 502, 503, 504}
BACKOFF_BASE_S, BACKOFF_CAP_S = 0.5, 8.0
TOKEN_MARGIN_S = 60  # refresh this long before the token says it expires


class ConfigError(RuntimeError):
    """The endpoint settings are missing or invalid."""


class PredictionError(RuntimeError):
    """The endpoint failed or answered with something unusable."""


class Unauthorized(PredictionError):
    """HTTP 401: the access token was rejected."""


def exchange(post: Callable[[dict], dict], rows: list[dict]) -> list[float]:
    """Send rows and return one float per row: the only code that knows the wire schema.

    Request:  {"data": [{feature: value, ...}, ...]}
    Response: {"predictions": [...]}, or QuickML's sample shape
              {"status": "success", "result": [...]}
    The real QuickML body is not documented yet; when it is, change only this.
    """
    body = post({"data": rows})
    if not isinstance(body, dict):
        raise PredictionError(f"expected a JSON object, got {type(body).__name__}")
    if body.get("status", "success") != "success":
        raise PredictionError(f"endpoint reported status {body['status']!r}")
    values = body.get("predictions", body.get("result"))
    if not isinstance(values, list) or len(values) != len(rows):
        got = f"{len(values)} values" if isinstance(values, list) else repr(type(values).__name__)
        raise PredictionError(f"expected {len(rows)} predictions, got {got} (response keys: {sorted(body)})")
    try:
        preds = [float(v) for v in values]
    except (TypeError, ValueError):
        raise PredictionError(f"non-numeric prediction in response: {values!r:.200}") from None
    if not all(math.isfinite(p) for p in preds):
        raise PredictionError("NaN or infinite prediction in response")
    return preds


class Http:
    """POST with a timeout and retries. Redacts registered secrets from every error."""

    def __init__(self, session, timeout: float, retries: int, sleep=time.sleep, secrets: Iterable[str] = ()):
        self.session, self.timeout, self.retries, self.sleep = session, timeout, retries, sleep
        self.secrets = {s for s in secrets if s}

    def add_secret(self, value: str) -> None:
        if value:
            self.secrets.add(value)

    def redact(self, text: str) -> str:
        for s in self.secrets:
            text = text.replace(s, "***")
        return text

    def post(self, url: str, *, json=None, data=None, headers: Callable[[], dict] | None = None) -> dict:
        """POST and return the decoded JSON body. `headers` is called per attempt."""
        host = urlsplit(url).netloc
        for attempt in range(self.retries + 1):
            delay = min(BACKOFF_CAP_S, BACKOFF_BASE_S * 2**attempt)
            try:
                resp = self.session.post(
                    url, json=json, data=data, headers=headers() if headers else None, timeout=self.timeout
                )
            except (requests.ConnectionError, requests.Timeout) as e:
                problem = f"{type(e).__name__}: {str(e)[:300]}"
            else:
                if 200 <= resp.status_code < 300:
                    try:
                        return resp.json()
                    except ValueError:
                        raise PredictionError(self.redact(f"{host} answered with non-JSON: {resp.text!r:.300}")) from None
                problem = f"HTTP {resp.status_code}: {resp.text!r:.300}"
                if resp.status_code == 401:
                    raise Unauthorized(self.redact(f"POST {host} was rejected, {problem}"))
                if resp.status_code not in RETRYABLE_STATUS:
                    raise PredictionError(self.redact(f"POST {host} failed, {problem}"))
                retry_after = str(resp.headers.get("Retry-After", ""))
                if retry_after.isdigit():
                    delay = min(BACKOFF_CAP_S, float(retry_after))
            if attempt < self.retries:
                self.sleep(delay)
        raise PredictionError(self.redact(f"POST {host} failed after {self.retries + 1} attempt(s), last: {problem}"))


class ZohoTokenProvider:
    """Access tokens from a Zoho refresh token, cached until shortly before they expire."""

    def __init__(self, client_id: str, client_secret: str, refresh_token: str, http: Http, clock=time.monotonic):
        self.form = {
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "refresh_token",
        }
        self.http, self.clock = http, clock
        self._token, self._expires_at = None, 0.0
        self._lock = threading.Lock()  # concurrent requests share one refresh

    def token(self) -> str:
        with self._lock:
            if self._token is None or self.clock() >= self._expires_at:
                self._refresh()
            return self._token

    def invalidate(self) -> None:
        self._token = None

    def _refresh(self) -> None:
        # Form body, never the query string, so secrets cannot leak through a logged URL.
        body = self.http.post(ZOHO_TOKEN_URL, data=self.form)
        token = body.get("access_token") if isinstance(body, dict) else None
        if not token:
            reason = body.get("error", "no access_token in response") if isinstance(body, dict) else "bad response"
            raise PredictionError(self.http.redact(f"Zoho token refresh failed: {reason}"))
        self.http.add_secret(token)
        self._token = token
        self._expires_at = self.clock() + float(body.get("expires_in", 3600)) - TOKEN_MARGIN_S


class QuickMLTransport:
    """A published QuickML endpoint, called directly with Zoho OAuth."""

    def __init__(self, url: str, endpoint_key: str, org: str, environment: str, tokens: ZohoTokenProvider, http: Http):
        self.url, self.key, self.org, self.environment = url, endpoint_key, org, environment
        self.tokens, self.http = tokens, http
        self.name = f"QuickML {urlsplit(url).netloc}"

    def _headers(self) -> dict:
        return {
            "Authorization": f"Zoho-oauthtoken {self.tokens.token()}",
            "X-QUICKML-ENDPOINT-KEY": self.key,
            "CATALYST-ORG": self.org,
            "Environment": self.environment,
        }

    def __call__(self, payload: dict) -> dict:
        try:
            return self.http.post(self.url, json=payload, headers=self._headers)
        except Unauthorized:
            self.tokens.invalidate()  # token revoked early: refresh once and retry
        try:
            return self.http.post(self.url, json=payload, headers=self._headers)
        except Unauthorized as e:
            raise PredictionError(
                f"{e}; check the Zoho credentials and that the token has the QuickML.deployment.READ scope"
            ) from None


class QuickMLClient:
    """Sends feature rows in chunks, concurrently, and returns predictions in input order."""

    def __init__(self, transport: Callable[[dict], dict], batch_size: int = 1, concurrency: int = 1):
        if batch_size < 1 or concurrency < 1:
            raise ConfigError("batch_size and concurrency must be >= 1")
        self.transport, self.batch_size, self.concurrency = transport, batch_size, concurrency
        self.name = getattr(transport, "name", type(transport).__name__)

    def predict(self, features: pd.DataFrame) -> np.ndarray:
        """One float per feature row, in the same order."""
        rows = features.to_dict(orient="records")
        starts = range(0, len(rows), self.batch_size)

        def send(start: int) -> list[float]:
            chunk = rows[start : start + self.batch_size]
            try:
                return exchange(self.transport, chunk)
            except PredictionError as e:
                raise PredictionError(f"{self.name}, rows {start}-{start + len(chunk) - 1}: {e}") from None

        if self.concurrency == 1 or len(starts) <= 1:
            chunks = [send(s) for s in starts]
        else:
            with ThreadPoolExecutor(max_workers=self.concurrency) as pool:
                chunks = list(pool.map(send, starts))  # map keeps input order
        return np.asarray([p for chunk in chunks for p in chunk], dtype=float)

    @classmethod
    def from_env(
        cls, env: Mapping[str, str] | None = None, session=None, sleep=time.sleep, clock=time.monotonic
    ) -> "QuickMLClient":
        """Build a client from environment variables (see .env.example)."""
        env = os.environ if env is None else env

        def get(name: str) -> str:
            return (env.get(name) or "").strip()

        batch_size = _number(get("QUICKML_BATCH_SIZE"), "QUICKML_BATCH_SIZE", 1, int, minimum=1)
        concurrency = _number(get("QUICKML_CONCURRENCY"), "QUICKML_CONCURRENCY", 8, int, minimum=1)
        timeout = _number(get("QUICKML_TIMEOUT"), "QUICKML_TIMEOUT", 15.0, float, minimum=0.1)
        retries = _number(get("QUICKML_RETRIES"), "QUICKML_RETRIES", 3, int, minimum=0)

        missing = [name for name in DIRECT_VARS if not get(name)]
        if missing:
            raise ConfigError(f"QuickML is not configured: missing {', '.join(missing)} (see .env.example)")
        secrets = [get("QUICKML_ENDPOINT_KEY"), get("ZOHO_CLIENT_SECRET"), get("ZOHO_REFRESH_TOKEN")]
        http = Http(session or requests.Session(), timeout, retries, sleep, secrets)
        tokens = ZohoTokenProvider(get("ZOHO_CLIENT_ID"), get("ZOHO_CLIENT_SECRET"), get("ZOHO_REFRESH_TOKEN"), http, clock)
        transport = QuickMLTransport(
            get("QUICKML_ENDPOINT_URL"),
            get("QUICKML_ENDPOINT_KEY"),
            get("ZOHO_ORG_ID"),
            get("QUICKML_ENVIRONMENT") or "Production",
            tokens,
            http,
        )
        return cls(transport, batch_size, concurrency)


def is_configured(env: Mapping[str, str] | None = None) -> bool:
    """True when every variable direct QuickML access needs is set (values are not checked)."""
    env = os.environ if env is None else env
    return all((env.get(name) or "").strip() for name in DIRECT_VARS)


def _number(raw: str, name: str, default, kind, minimum):
    if not raw:
        return default
    try:
        value = kind(raw)
    except ValueError:
        raise ConfigError(f"{name} must be a number, got {raw!r}") from None
    if value < minimum:
        raise ConfigError(f"{name} must be >= {minimum}, got {raw!r}")
    return value
