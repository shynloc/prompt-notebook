export interface WindowRateLimiter {
  consume(userId: string): boolean;
}

export class FixedWindowRateLimiter implements WindowRateLimiter {
  private readonly windows = new Map<string, { count: number; startedAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now = () => Date.now(),
  ) {}

  consume(userId: string) {
    const currentTime = this.now();
    const current = this.windows.get(userId);
    if (!current || currentTime - current.startedAt >= this.windowMs) {
      this.windows.set(userId, { count: 1, startedAt: currentTime });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    if (this.windows.size > 10_000) {
      for (const [key, value] of this.windows) {
        if (currentTime - value.startedAt >= this.windowMs) this.windows.delete(key);
      }
    }
    return true;
  }
}
