export type DeploymentMode = "server" | "local";
type DeploymentEnvironment = Record<string, string | undefined>;

/** Local-mode authentication is a deliberate loopback-only exception, not dev mode. */
export function getDeploymentMode(environment: DeploymentEnvironment = process.env): DeploymentMode {
  const mode = environment.APP_DEPLOYMENT_MODE ?? "server";
  if (mode !== "server" && mode !== "local") {
    throw new Error("APP_DEPLOYMENT_MODE must be server or local");
  }
  if (mode === "local") {
    const value = environment.APP_URL ?? "";
    // Validate the original spelling too: URL() normalizes noncanonical IPv4
    // addresses such as 127.1 and 2130706433 into 127.0.0.1.
    if (value.trim() !== value || !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[1-9][0-9]{0,4})?\/?$/i.test(value)) {
      throw new Error("Local deployment requires an HTTP localhost, 127.0.0.1 or [::1] origin without a path");
    }
    let url: URL;
    try { url = new URL(value); }
    catch { throw new Error("Local deployment APP_URL is invalid"); }
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error("Local deployment APP_URL must use a strict HTTP loopback origin");
    }
  }
  return mode;
}

export function isLocalDeployment(environment: DeploymentEnvironment = process.env) {
  return getDeploymentMode(environment) === "local";
}
