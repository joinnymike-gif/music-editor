import { GatewayError } from "./errors.js";
import type { GenerationUsage } from "./types.js";

export interface LimitClock {
  nowMs(): number;
}

const systemClock: LimitClock = { nowMs: () => Date.now() };

interface AccountUsage {
  requestTimesMs: number[];
  dailyKey: string;
  dailyCount: number;
}

/**
 * Process-local limiter used for local development. Production must replace it
 * with a shared atomic store so multiple gateway instances share the same cap.
 */
export class MemoryGenerationLimiter {
  private readonly usageByAccount = new Map<string, AccountUsage>();

  constructor(
    private readonly requestsPerMinute: number,
    private readonly dailyLimit: number,
    private readonly clock: LimitClock = systemClock,
  ) {}

  consume(accountId: string): void {
    const now = this.clock.nowMs();
    const usage = this.resolveUsage(accountId, now);
    if (usage.requestTimesMs.length >= this.requestsPerMinute) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((usage.requestTimesMs[0] + 60_000 - now) / 1_000),
      );
      throw new GatewayError(
        429,
        "rate_limited",
        "生成请求过于频繁，请稍后重试。",
        retryAfterSeconds,
      );
    }
    if (usage.dailyCount >= this.dailyLimit) {
      throw new GatewayError(
        429,
        "daily_limit_reached",
        "今日生成次数已用完，请明天再试。",
      );
    }
    usage.requestTimesMs.push(now);
    usage.dailyCount += 1;
    this.usageByAccount.set(accountId, usage);
  }

  getUsage(accountId: string): GenerationUsage {
    const usage = this.resolveUsage(accountId, this.clock.nowMs());
    return {
      dailyUsed: usage.dailyCount,
      dailyLimit: this.dailyLimit,
      minuteUsed: usage.requestTimesMs.length,
      minuteLimit: this.requestsPerMinute,
    };
  }

  private resolveUsage(accountId: string, now: number): AccountUsage {
    const minuteAgo = now - 60_000;
    const dailyKey = new Date(now).toISOString().slice(0, 10);
    const usage = this.usageByAccount.get(accountId) ?? {
      requestTimesMs: [],
      dailyKey,
      dailyCount: 0,
    };
    usage.requestTimesMs = usage.requestTimesMs.filter(
      (timestamp) => timestamp > minuteAgo,
    );
    if (usage.dailyKey !== dailyKey) {
      usage.dailyKey = dailyKey;
      usage.dailyCount = 0;
    }
    this.usageByAccount.set(accountId, usage);
    return usage;
  }
}
