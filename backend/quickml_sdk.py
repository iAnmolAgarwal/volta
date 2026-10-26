"""QuickML through the Catalyst Python SDK (zcatalyst_sdk), inside AppSail.

The SDK authenticates as the project admin from headers the Catalyst gateway
adds to every incoming request (X-ZC-*), so it needs only the endpoint key: no
Zoho OAuth client and no published deployment URL.

SDK 1.4.0's QuickML.predict() posts {"data": <dict>} and rejects a list, and it
sends CATALYST-ORG only when X_ZOHO_CATALYST_ORG_ID is set (AppSail does not set
it), which QuickML rejects with ORGID_HEADER_UNAVAILABLE. So every call goes
through the SDK's own authorized requester to the same path, with the org and
environment headers added; 1,000 rows cost one QuickML call.
"""

import os

from model.quickml_client import PredictionError

PROJECT_HEADER = "X-ZC-ProjectId"  # present only on requests routed by Catalyst
ENVIRONMENT_HEADER = "X-ZC-Environment"
DEFAULT_ORG_ID = "60093344122"  # our Catalyst org (not a secret); ZOHO_ORG_ID overrides


def in_catalyst(request) -> bool:
    return request is not None and bool(request.headers.get(PROJECT_HEADER))


class SdkTransport:
    """Transport for QuickMLClient that calls the endpoint via zcatalyst_sdk."""

    name = "QuickML via Catalyst SDK"

    def __init__(self, endpoint_key: str, request):
        import zcatalyst_sdk

        self.key = endpoint_key
        self.quick_ml = zcatalyst_sdk.initialize(req=request).quick_ml()
        self.headers = {
            "X-QUICKML-ENDPOINT-KEY": endpoint_key,
            "CATALYST-ORG": (os.environ.get("ZOHO_ORG_ID") or "").strip() or DEFAULT_ORG_ID,
            "Environment": request.headers.get(ENVIRONMENT_HEADER) or "Development",
        }

    def __call__(self, payload: dict) -> dict:
        import requests
        from zcatalyst_sdk._constants import CatalystService, CredentialUser, RequestMethod
        from zcatalyst_sdk.exceptions import CatalystError

        try:
            resp = self.quick_ml._requester.request(
                method=RequestMethod.POST,
                path="/endpoints/predict",
                json={"data": payload["data"]},
                user=CredentialUser.ADMIN,
                catalyst_service=CatalystService.QUICK_ML,
                headers=dict(self.headers),  # the requester adds its own headers to this dict
            )
            return resp.response_json
        except CatalystError as e:
            raise PredictionError(f"QuickML SDK call failed: {str(e).replace(self.key, '***')[:500]}") from None
        except requests.RequestException as e:  # the SDK lets network errors (e.g. its 30 s read timeout) through
            raise PredictionError(f"QuickML did not answer: {type(e).__name__}: {str(e).replace(self.key, '***')[:300]}") from None
