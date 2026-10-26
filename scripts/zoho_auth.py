"""Turn a Zoho Self Client grant code into ZOHO_REFRESH_TOKEN in .env, printing no secret.

Usage: python scripts/zoho_auth.py

1. In https://api-console.zoho.in open your Self Client, generate a code with
   scope QuickML.deployment.READ, and copy it (it expires in minutes).
2. Run this script and paste the code at the hidden prompt.

ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET come from the environment or .env; any
that are missing are asked for at a hidden prompt. Only needed for direct REST
access to QuickML; the AppSail proxy normally uses the Catalyst SDK instead.
"""

import getpass
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
TOKEN_URL = "https://accounts.zoho.in/oauth/v2/token"


def read_env_file(path: Path) -> dict:
    values = {}
    if path.exists():
        for line in path.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, _, value = line.partition("=")
                values[key.strip()] = value.strip()
    return values


def write_env_value(path: Path, key: str, value: str) -> None:
    """Set KEY=value in an env file, keeping every other line; the file ends up mode 600."""
    lines = path.read_text().splitlines() if path.exists() else []
    for i, line in enumerate(lines):
        if line.partition("=")[0].strip() == key and not line.lstrip().startswith("#"):
            lines[i] = f"{key}={value}"
            break
    else:
        lines.append(f"{key}={value}")
    path.write_text("\n".join(lines) + "\n")
    path.chmod(0o600)


def exchange_code(code: str, client_id: str, client_secret: str, post=requests.post) -> str:
    """Return the refresh token for a grant code; raise RuntimeError (without secrets) on failure."""
    resp = post(
        TOKEN_URL,
        data={"grant_type": "authorization_code", "client_id": client_id, "client_secret": client_secret, "code": code},
        timeout=30,
    )
    try:
        body = resp.json()
    except ValueError:
        raise RuntimeError(f"Zoho answered HTTP {resp.status_code} with non-JSON") from None
    token = body.get("refresh_token") if isinstance(body, dict) else None
    if not token:
        reason = body.get("error", "no refresh_token in response") if isinstance(body, dict) else "bad response"
        raise RuntimeError(f"Zoho rejected the grant code: {reason} (codes expire in minutes; make a new one)")
    return token


def main(env_path: Path = ROOT / ".env", ask=getpass.getpass, post=requests.post) -> int:
    known = {**read_env_file(env_path), **{k: v for k, v in os.environ.items() if v}}
    client_id = known.get("ZOHO_CLIENT_ID") or ask("ZOHO_CLIENT_ID: ").strip()
    client_secret = known.get("ZOHO_CLIENT_SECRET") or ask("ZOHO_CLIENT_SECRET (hidden): ").strip()
    code = ask("Self Client grant code (hidden): ").strip()
    if not (client_id and client_secret and code):
        print("zoho_auth: client ID, client secret and grant code are all required", file=sys.stderr)
        return 1
    try:
        token = exchange_code(code, client_id, client_secret, post)
    except (RuntimeError, requests.RequestException) as e:
        print(f"zoho_auth: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    write_env_value(env_path, "ZOHO_REFRESH_TOKEN", token)
    for key, value in [("ZOHO_CLIENT_ID", client_id), ("ZOHO_CLIENT_SECRET", client_secret)]:
        if not read_env_file(env_path).get(key):
            write_env_value(env_path, key, value)
    print(f"Saved ZOHO_REFRESH_TOKEN to {env_path} (value not shown).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
