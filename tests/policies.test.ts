import { describe, expect, it } from "vitest";
import { resolveChunkPolicy } from "../src/policies/chunk.js";
import { resolveRetryPolicy } from "../src/policies/retry.js";

describe("policy validation", () => {
  it("rejects invalid chunk growth factors", () => {
    expect(() => resolveChunkPolicy({ growthFactor: Number.NaN })).toThrow(
      "chunk.growthFactor must be a finite number at least 1",
    );
    expect(() => resolveChunkPolicy({ growthFactor: Number.POSITIVE_INFINITY })).toThrow(
      "chunk.growthFactor must be a finite number at least 1",
    );
    expect(() => resolveChunkPolicy({ growthFactor: 0.99 })).toThrow(
      "chunk.growthFactor must be a finite number at least 1",
    );
  });

  it("rejects invalid retry policy numbers", () => {
    expect(() => resolveRetryPolicy({ maxRetries: 1.5 })).toThrow(
      "retry.maxRetries must be a non-negative integer",
    );
    expect(() => resolveRetryPolicy({ baseDelayMs: Number.NaN })).toThrow(
      "retry.baseDelayMs must be a finite number at least 0",
    );
    expect(() => resolveRetryPolicy({ maxDelayMs: Number.POSITIVE_INFINITY })).toThrow(
      "retry.maxDelayMs must be a finite number",
    );
    expect(() => resolveRetryPolicy({ jitterRatio: Number.NaN })).toThrow(
      "retry.jitterRatio must be between 0 and 1",
    );
  });
});
