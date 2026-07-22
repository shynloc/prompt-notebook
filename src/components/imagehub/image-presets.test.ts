import { describe, expect, it } from "vitest";

import { imageAspectRatios, imageResolutionTiers, imageSizeFor } from "./image-presets";

describe("ImageHub image presets", () => {
  it("includes common widescreen and portrait ratios", () => {
    expect(imageAspectRatios.map(({ id }) => id)).toEqual(expect.arrayContaining(["16:9", "9:16"]));
  });

  it("uses the documented GPT Image 2 4K canvases", () => {
    expect(imageSizeFor("16:9", "4k")).toEqual({ width: 3840, height: 2160 });
    expect(imageSizeFor("9:16", "4k")).toEqual({ width: 2160, height: 3840 });
  });

  it("keeps every preset inside the GPT Image 2 size contract", () => {
    for (const { id: resolution } of imageResolutionTiers) {
      for (const { id: ratio } of imageAspectRatios) {
        const { width, height } = imageSizeFor(ratio, resolution);
        expect(width % 16).toBe(0);
        expect(height % 16).toBe(0);
        expect(Math.max(width, height)).toBeLessThanOrEqual(3840);
        expect(Math.max(width, height) / Math.min(width, height)).toBeLessThanOrEqual(3);
        expect(width * height).toBeGreaterThanOrEqual(655_360);
        expect(width * height).toBeLessThanOrEqual(8_294_400);
      }
    }
  });
});
