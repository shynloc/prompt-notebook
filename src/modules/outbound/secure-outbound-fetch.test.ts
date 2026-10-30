// @vitest-environment node

import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  secureRemoteResourceFetch,
  type SecureFetchOptions,
} from "./secure-outbound-fetch";

type TestTransport = NonNullable<NonNullable<SecureFetchOptions["transports"]>["https"]>;

function responseTransport(body = "ok") {
  let captured: { url: URL; options: RequestOptions & { servername?: string } } | undefined;
  const request = new EventEmitter() as ClientRequest;
  request.write = vi.fn();
  request.end = vi.fn();
  request.destroy = vi.fn((error?: Error) => {
    if (error) queueMicrotask(() => request.emit("error", error));
    return request;
  });
  const transport: TestTransport = (url, options, callback) => {
    captured = { url, options };
    const incoming = Readable.from([Buffer.from(body)]) as IncomingMessage;
    incoming.statusCode = 200;
    incoming.statusMessage = "OK";
    incoming.headers = { "content-type": "text/plain" };
    queueMicrotask(() => callback(incoming));
    return request;
  };
  return { transport: vi.fn(transport), captured: () => captured };
}

async function selectedAddress(lookup: LookupFunction) {
  return new Promise<{ address: string; family: number }>((resolve, reject) => {
    lookup("ignored.example", {}, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address: address as string, family: family as number });
    });
  });
}

describe("secure remote resource fetch", () => {
  it("pins the validated IP while retaining the original Host, SNI, path, and query", async () => {
    const resolver = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const { transport, captured } = responseTransport();
    const response = await secureRemoteResourceFetch(
      new URL("https://images.example.com/path/image.png?size=large"),
      { headers: { accept: "image/png", host: "attacker.invalid" } },
      { resolver, transports: { https: transport } },
    );
    const call = captured();
    expect(await response.text()).toBe("ok");
    expect(resolver).toHaveBeenCalledWith("images.example.com");
    expect(call?.url.toString()).toBe("https://images.example.com/path/image.png?size=large");
    expect(call?.options.servername).toBe("images.example.com");
    expect(call?.options.headers).toMatchObject({
      accept: "image/png",
      host: "images.example.com",
    });
    expect(await selectedAddress(call?.options.lookup as LookupFunction)).toEqual({
      address: "93.184.216.34",
      family: 4,
    });
  });

  it.each([
    ["loopback", "127.0.0.1", 4],
    ["private IPv4", "10.0.0.8", 4],
    ["link-local metadata", "169.254.169.254", 4],
    ["IPv4-mapped loopback", "::ffff:7f00:1", 6],
    ["IPv6 link-local", "fe80::1", 6],
  ])("rejects a hostname resolving to %s", async (_label, address, family) => {
    const { transport } = responseTransport();
    await expect(secureRemoteResourceFetch(new URL("https://images.example.com/image.png"), {}, {
      resolver: async () => [{ address, family }],
      transports: { https: transport },
    })).rejects.toThrow(/private or reserved/);
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects a mixed DNS answer set when any address is unsafe", async () => {
    const { transport } = responseTransport();
    await expect(secureRemoteResourceFetch(new URL("https://images.example.com/image.png"), {}, {
      resolver: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "192.168.1.5", family: 4 },
      ],
      transports: { https: transport },
    })).rejects.toThrow(/private or reserved/);
    expect(transport).not.toHaveBeenCalled();
  });
});
