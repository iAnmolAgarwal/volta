"""QuickML through the Catalyst Python SDK (zcatalyst_sdk), inside AppSail.

The SDK authenticates as the project admin from headers the Catalyst gateway
adds to every incoming request (X-ZC-*), so it needs only the endpoint key: no
Zoho OAuth client and no published deployment URL.

SDK 1.4.0's QuickML.predict() posts {"data": <dict>} and rejects a list, while
the endpoint accepts a list of rows. Batches therefore go through the SDK's own
authorized requester to the same path, so 1,000 rows cost one QuickML call.
"""

from model.quickml_client import PredictionError

PROJECT_HEADER = "X-ZC-ProjectId"  # present only on requests routed by Catalyst


def in_catalyst(request) -> bool:
    return request is not None and bool(request.headers.get(PROJECT_HEADER))


class SdkTransport:
    """Transport for QuickMLClient that calls the endpoint via zcatalyst_sdk."""

    name = "QuickML via Catalyst SDK"

    def __init__(self, endpoint_key: str, request):
        import zcatalyst_sdk

        self.key = endpoint_key
        self.quick_ml = zcatalyst_sdk.initialize(req=request).quick_ml()

    def __call__(self, payload: dict) -> dict:
        from zcatalyst_sdk._constants import CatalystService, CredentialUser, RequestMethod
        from zcatalyst_sdk.exceptions import CatalystError

        data = payload["data"]
        try:
            if isinstance(data, dict):
                return self.quick_ml.predict(self.key, data)
            resp = self.quick_ml._requester.request(
                method=RequestMethod.POST,
                path="/endpoints/predict",
                json={"data": data},
                user=CredentialUser.ADMIN,
                catalyst_service=CatalystService.QUICK_ML,
                headers={"X-QUICKML-ENDPOINT-KEY": self.key},
            )
            return resp.response_json
        except CatalystError as e:
            raise PredictionError(f"QuickML SDK call failed: {str(e).replace(self.key, '***')[:500]}") from None
