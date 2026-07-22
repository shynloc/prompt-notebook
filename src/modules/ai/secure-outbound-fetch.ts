import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";

import {
  resolveOutboundTarget,
  type AddressResolver,
} from "./outbound-url-policy";

interface SecureFetchOptions {
  resolver?: AddressResolver;
}
function responseHeaders(headers: Record<string, string | string[] | undefined>) {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) value.forEach((item) => result.append(name, item));
    else if (value !== undefined) result.set(name, value);
  }
  return result;
}

export async function secureOutboundFetch(
  input: URL,
  init: RequestInit = {},
  options: SecureFetchOptions = {},
) {
  const target = await resolveOutboundTarget(input.toString(), options.resolver);
  const selected = target.addresses[0];
  const lookup = ((_hostname: string, _options: unknown, callback: (error: Error | null, address: string, family: number) => void) => {
    callback(null, selected.address, selected.family);
  }) as LookupFunction;
  const headers = new Headers(init.headers);
  const body = init.body;
  if (body !== undefined && body !== null && typeof body !== "string" && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
    throw new Error("Secure AI provider requests currently require a string or byte body");
  }

  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(target.url, {
      method: init.method ?? "GET",
      headers: Object.fromEntries(headers.entries()),
      lookup,
      family: selected.family,
      servername: target.url.hostname.replace(/^\[|\]$/g, ""),
    }, (incoming) => {
      const stream = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
      resolve(new Response(stream, {
        status: incoming.statusCode ?? 502,
        statusText: incoming.statusMessage,
        headers: responseHeaders(incoming.headers),
      }));
    });
    request.once("error", reject);
    const abort = () => request.destroy(init.signal?.reason instanceof Error ? init.signal.reason : new Error("Request aborted"));
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener("abort", abort, { once: true });
    request.once("close", () => init.signal?.removeEventListener("abort", abort));
    if (typeof body === "string" || Buffer.isBuffer(body) || body instanceof Uint8Array) request.write(body);
    request.end();
  });
}
