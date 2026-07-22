// @vitest-environment node

import { describe, expect, it } from "vitest";

import { GET as live } from "@/app/health/live/route";
import { GET as ready } from "@/app/health/ready/route";

describe("health endpoints", () => {
  it("reports liveness without exposing internals", async () => {
    const response = live();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("reports readiness when PostgreSQL is reachable", async () => {
    const response = await ready();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });
});
