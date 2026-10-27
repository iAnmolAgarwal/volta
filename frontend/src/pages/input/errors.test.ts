import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { describeError, serverSaid } from "./errors";

const shown = (e: unknown) => describeError("telemetry.csv", e).error as ApiError;

describe("describeError", () => {
  it("leads a 400 with the server's own message and keeps its details", () => {
    const e = shown(new ApiError("bad_request", "missing required column(s): timestamp", 400, ["columns found: time, temp"]));
    expect(e.message).toBe("Missing required column(s): timestamp");
    expect(e.details).toEqual(["columns found: time, temp"]);
    expect(e.status).toBe(400);
  });

  it("never shows a bare status line when the body was not JSON", () => {
    const e = shown(new ApiError("bad_request", "HTTP 400", 400));
    expect(e.message).not.toMatch(/^HTTP \d+$/);
    expect(e.message).toMatch(/refused the input/);
  });

  it("uses the server's message for other kinds that carry one", () => {
    expect(shown(new ApiError("quota", "demo forecast quota reached", 429, ["x"])).message).toBe("Demo forecast quota reached. Nothing was sent to QuickML.");
    expect(shown(new ApiError("too_large", "at most 2000 rows per forecast, got 2500", 413)).message).toBe("At most 2000 rows per forecast, got 2500. Trim it and try again.");
    expect(shown(new ApiError("server", "internal error", 500)).message).toBe("The forecast service failed: Internal error. Try again in a moment.");
  });

  it("keeps the network, timeout and upstream copy", () => {
    expect(shown(new ApiError("network", "Failed to fetch")).message).toMatch(/^Couldn't reach the forecast service/);
    expect(shown(new ApiError("timeout", "no answer after 90 s")).message).toMatch(/didn't answer in time/);
    expect(shown(new ApiError("upstream", "QuickML 500", 502)).message).toMatch(/^QuickML didn't return a forecast/);
  });

  it("reads no server message from a client-side error", () => {
    expect(serverSaid(new ApiError("network", "Failed to fetch"))).toBeNull();
    expect(serverSaid(new ApiError("parse", "the response was not JSON", 200))).toBeNull();
  });
});
