import type { RetryPolicy } from "../types.js";

export const defaultRetryPolicy: RetryPolicy = {
  maxRetries: 4,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
  jitterRatio: 0.2,
};

export function resolveRetryPolicy(policy: Partial<RetryPolicy> | undefined): RetryPolicy {
  const resolved = { ...defaultRetryPolicy, ...policy };

  if (resolved.maxRetries < 0) throw new Error("retry.maxRetries must be at least 0");
  if (resolved.baseDelayMs < 0) throw new Error("retry.baseDelayMs must be at least 0");
  if (resolved.maxDelayMs < resolved.baseDelayMs) {
    throw new Error("retry.maxDelayMs must be greater than or equal to retry.baseDelayMs");
  }
  if (resolved.jitterRatio < 0 || resolved.jitterRatio > 1) {
    throw new Error("retry.jitterRatio must be between 0 and 1");
  }

  return resolved;
}

export function retryDelayMs(attempt: number, policy: RetryPolicy): number {
  const exponential = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(policy.maxDelayMs, exponential);
  const jitter = capped * policy.jitterRatio * Math.random();
  return Math.round(capped + jitter);
}

export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(signal.reason);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(done, ms);

    function done() {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }

    function aborted() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", aborted);
      reject(signal?.reason);
    }

    signal?.addEventListener("abort", aborted, { once: true });
  });
}
