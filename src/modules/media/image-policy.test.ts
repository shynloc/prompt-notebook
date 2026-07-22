// @vitest-environment node

import { describe, expect, it } from "vitest";
import { assertSafeRemoteUrl, inspectImage } from "./image-policy";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

describe("image security policy", () => {
  it("reads valid raster metadata", async () => {
    await expect(inspectImage(PNG)).resolves.toMatchObject({ mimeType: "image/png", width: 1, height: 1 });
  });

  it("rejects scripts and private network imports", async () => {
    await expect(inspectImage(Buffer.from("<svg><script>alert(1)</script></svg>"))).rejects.toThrow(/JPEG/);
    await expect(assertSafeRemoteUrl("http://127.0.0.1/private.png")).rejects.toThrow(/内网/);
    await expect(assertSafeRemoteUrl("file:///etc/passwd")).rejects.toThrow(/HTTP/);
  });
});
