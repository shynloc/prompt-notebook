// @vitest-environment node

import { describe, expect, it } from "vitest";

import { FixedWindowRateLimiter } from "./fixed-window-rate-limiter";

function bucketCount(limiter: FixedWindowRateLimiter) {
  return (Reflect.get(limiter, "windows") as Map<string, unknown>).size;
}

describe("shared fixed-window limiter", () => {
  it("cleans expired single-request users before accepting a new user", () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter(6, 60_000, () => now);
    for (let index = 0; index < 10_001; index += 1) expect(limiter.consume(`user-${index}`)).toBe(true);
    now = 60_000;
    expect(limiter.consume("new-user")).toBe(true);
    expect(bucketCount(limiter)).toBe(1);
  });

  it("preserves active quotas while cleaning old users", () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter(2, 500, () => now);
    for (let index = 0; index < 10_000; index += 1) limiter.consume(`old-${index}`);
    now = 100;
    expect(limiter.consume("active-user")).toBe(true);
    expect(limiter.consume("active-user")).toBe(true);
    now = 500;
    expect(limiter.consume("new-user")).toBe(true);
    expect(bucketCount(limiter)).toBe(2);
    expect(limiter.consume("active-user")).toBe(false);
    now = 600;
    expect(limiter.consume("active-user")).toBe(true);
    expect(limiter.consume("active-user")).toBe(true);
    expect(limiter.consume("active-user")).toBe(false);
  });

  it("keeps user quotas independent and resets at the exact window boundary", () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter(1, 500, () => now);
    expect(limiter.consume("a")).toBe(true);
    expect(limiter.consume("a")).toBe(false);
    expect(limiter.consume("b")).toBe(true);
    now = 1_499;
    expect(limiter.consume("a")).toBe(false);
    now = 1_500;
    expect(limiter.consume("a")).toBe(true);
  });
});
