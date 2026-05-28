import { describe, expect, it } from "vitest";
import { classifyRpcRangeError } from "../src/index.js";

describe("classifyRpcRangeError", () => {
  it.each([
    ["rate limit exceeded", "rateLimit"],
    ["query exceeds max block range", "rangeTooLarge"],
    ["backend response too large", "payloadTooLarge"],
    ["deadline exceeded", "timeout"],
    ["service unavailable", "serverOverloaded"],
    ["block not found", "blockUnavailable"],
    ["invalid params", "fatal"],
  ] as const)("classifies %s as %s", (message, kind) => {
    expect(classifyRpcRangeError(new Error(message))).toBe(kind);
  });
});
