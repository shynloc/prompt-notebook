import {
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";

import {
  defaultAddressResolver,
  isBlockedOutboundAddress,
  resolveOutboundTarget,
  type AddressResolver,
} from "./outbound-url-policy";

type ResolvedTarget = Awaited<ReturnType<typeof resolveOutboundTarget>>;
type RequestTransport = (
  url: URL,
  options: RequestOptions & { servername?: string },
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

export interface SecureFetchOptions {
  resolver?: AddressResolver;
  transports?: {
    http?: RequestTransport;
    https?: RequestTransport;
  };
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home", ".lan"];

function responseHeaders(headers: Record<string, string | string[] | undefined>) {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) value.forEach((item) => result.append(name, item));
    else if (value !== undefined) result.set(name, value);
  }
  return result;
}

function normalizeRemoteResourceUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Remote resource URL is invalid");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Remote resource URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("Remote resource URL cannot include credentials");
  }
  if (url.port) {
    throw new Error("Remote resource URL cannot use a custom port");
  }
  if (!hostname || hostname === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new Error("Remote resource URL cannot target a local hostname");
  }
  if (isIP(hostname) && isBlockedOutboundAddress(hostname)) {
    throw new Error("Remote resource URL cannot target a private or reserved address");
  }
  url.hostname = isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  return url;
}

export async function resolveRemoteResourceTarget(
  value: string,
  resolver: AddressResolver = defaultAddressResolver,
) {
  const url = normalizeRemoteResourceUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolver(hostname);
  if (!addresses.length) throw new Error("Remote resource hostname did not resolve");
  if (addresses.some(({ address, family }) => {
    const actualFamily = isIP(address);
    return (family !== 4 && family !== 6) || actualFamily !== family || isBlockedOutboundAddress(address);
  })) {
    throw new Error("Remote resource hostname resolves to a private or reserved address");
  }
  return { url, addresses };
}

function requestBody(init: RequestInit) {
  const body = init.body;
  if (body === undefined || body === null || typeof body === "string" || Buffer.isBuffer(body) || body instanceof Uint8Array) {
    return body;
  }
  throw new Error("Secure outbound requests currently require a string or byte body");
}

function pinnedRequest(
  target: ResolvedTarget,
  init: RequestInit,
  options: SecureFetchOptions,
) {
  const selected = target.addresses[0];
  const lookup = ((_hostname: string, _options: unknown, callback: (error: Error | null, address: string, family: number) => void) => {
    callback(null, selected.address, selected.family);
  }) as LookupFunction;
  const headers = new Headers(init.headers);
  headers.set("host", target.url.host);
  const body = requestBody(init);
  const protocol = target.url.protocol === "http:" ? "http" : "https";
  const transport = protocol === "http"
    ? options.transports?.http ?? (httpRequest as RequestTransport)
    : options.transports?.https ?? (httpsRequest as RequestTransport);
  const hostname = target.url.hostname.replace(/^\[|\]$/g, "");

  return new Promise<Response>((resolve, reject) => {
    const request = transport(target.url, {
      method: init.method ?? "GET",
      headers: Object.fromEntries(headers.entries()),
      lookup,
      family: selected.family,
      ...(protocol === "https" && !isIP(hostname) ? { servername: hostname } : {}),
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

export async function secureOutboundFetch(
  input: URL,
  init: RequestInit = {},
  options: SecureFetchOptions = {},
) {
  const target = await resolveOutboundTarget(input.toString(), options.resolver);
  return pinnedRequest(target, init, options);
}

export async function secureRemoteResourceFetch(
  input: URL,
  init: RequestInit = {},
  options: SecureFetchOptions = {},
) {
  const target = await resolveRemoteResourceTarget(input.toString(), options.resolver);
  return pinnedRequest(target, init, options);
}
