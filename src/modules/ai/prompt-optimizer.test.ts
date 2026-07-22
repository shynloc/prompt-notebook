// @vitest-environment node

import { describe, expect, it } from "vitest";

import { FixedWindowPromptOptimizationRateLimiter } from "./prompt-optimizer";

describe("prompt optimization rate limiter", () => {
  it("bounds requests per user and resets after the window", () => {
    let now = 1_000;
    const limiter = new FixedWindowPromptOptimizationRateLimiter(2, 500, () => now);
    expect(limiter.consume("user-a")).toBe(true);
    expect(limiter.consume("user-a")).toBe(true);
    expect(limiter.consume("user-a")).toBe(false);
    expect(limiter.consume("user-b")).toBe(true);
    now += 500;
    expect(limiter.consume("user-a")).toBe(true);
  });
});
