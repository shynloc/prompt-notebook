import { isIP } from "node:net";

import { parseIpAddressHeaders } from "./client-ip";

/** Trust only headers that the deployment's final reverse proxy overwrites. */
export function trustedClientIp(headers: Pick<Headers, "get">, configuredHeaders = process.env.BETTER_AUTH_IP_ADDRESS_HEADERS) {
  let names: string[] | undefined;
  try { names = parseIpAddressHeaders(configuredHeaders); } catch { return "anonymous"; }
  for (const name of names ?? []) {
    const value = headers.get(name)?.trim();
    if (!value) continue;
    // No comma-separated proxy chains, ports, zone identifiers or forwarding
    // syntax; never fall back to unconfigured browser-supplied CF/XFF headers.
    if (value.includes(",") || value.includes("%") || !isIP(value)) return "anonymous";
    return value.toLowerCase();
  }
  return "anonymous";
}
