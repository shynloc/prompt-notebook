import { describe, expect, it } from "vitest";

import { getDeploymentMode, isLocalDeployment } from "./config";

describe("deployment mode", () => {
  it("defaults to server mode regardless of localhost-looking APP_URL", () => {
    expect(getDeploymentMode({ APP_URL: "http://localhost:5488" })).toBe("server");
    expect(isLocalDeployment({ APP_URL: "https://prompts.example.com" })).toBe(false);
  });

  it.each(["http://localhost:5488", "http://127.0.0.1:5488", "http://[::1]:5488", "http://localhost/", "http://LOCALHOST:80"])("accepts explicit loopback mode: %s", (appUrl) => {
    expect(getDeploymentMode({ APP_DEPLOYMENT_MODE: "local", APP_URL: appUrl })).toBe("local");
  });

  it.each([
    undefined, "", "https://localhost:5488", "http://localhost.example.com", "http://example.com/localhost",
    "http://localhost@evil.example", "http://evil.example@localhost", "http://localhost.",
    "http://127.1", "http://2130706433", "http://0x7f000001", "http://127.0.0.2", "http://0.0.0.0",
    "http://[::ffff:127.0.0.1]", "http://[::1]/notes", "http://localhost?mode=local", "http://localhost#local",
    "http://localhost:65536", " http://localhost", "http://localhost\n", "http://localhost:0",
  ])("rejects a remote, ambiguous or malformed local origin: %s", (appUrl) => {
    expect(() => getDeploymentMode({ APP_DEPLOYMENT_MODE: "local", APP_URL: appUrl })).toThrow();
  });

  it("rejects unknown deployment modes", () => {
    expect(() => getDeploymentMode({ APP_DEPLOYMENT_MODE: "development" })).toThrow("APP_DEPLOYMENT_MODE");
  });
});
