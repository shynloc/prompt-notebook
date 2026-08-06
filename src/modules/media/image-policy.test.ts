// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { AddressResolver } from "@/modules/ai/outbound-url-policy";

import {
  assertSafeRemoteUrl,
  fetchRemoteResource,
  inspectImage,
} from "./image-policy";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const publicAddress = [{ address: "93.184.216.34", family: 4 }];

describe("image security policy", () => {
  it("reads valid raster metadata", async () => {
    await expect(inspectImage(PNG)).resolves.toMatchObject({ mimeType: "image/png", width: 1, height: 1 });
  });

  it("rejects scripts, private networks, metadata services, and IPv4-mapped loopback", async () => {
    await expect(inspectImage(Buffer.from("<svg><script>alert(1)</script></svg>"))).rejects.toThrow(/JPEG/);
    await expect(assertSafeRemoteUrl("http://127.0.0.1/private.png")).rejects.toThrow(/内网|保留地址/);
    await expect(assertSafeRemoteUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/内网|保留地址/);
    await expect(assertSafeRemoteUrl("https://[::ffff:7f00:1]/private.png")).rejects.toThrow(/内网|保留地址/);
    await expect(assertSafeRemoteUrl("file:///etc/passwd")).rejects.toThrow(/HTTP/);
  });

  it("rejects DNS rebinding before any socket can connect", async () => {
    const resolver = vi.fn<AddressResolver>()
      .mockResolvedValueOnce(publicAddress)
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);

    await expect(fetchRemoteResource("https://rebind.example/image.png", {
      accept: "image/png",
      maxBytes: 1024,
      resolver,
    })).rejects.toThrow(/内网|保留地址/);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("revalidates every redirect and never requests a private redirect target", async () => {
    const resolver: AddressResolver = vi.fn(async (hostname) => hostname === "private.example"
      ? [{ address: "192.168.1.20", family: 4 }]
      : publicAddress);
    const request = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://private.example/secret.png" },
    }));

    await expect(fetchRemoteResource("https://public.example/page", {
      accept: "image/png",
      maxBytes: 1024,
      resolver,
      request,
    })).rejects.toThrow(/内网|保留地址/);
    expect(request).toHaveBeenCalledOnce();
  });
});
