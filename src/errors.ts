import type { BlockRange, RangeErrorKind } from "./types.js";

export class ViemChunkerError extends Error {
  readonly kind: RangeErrorKind;
  readonly range?: BlockRange;
  readonly cause: unknown;

  constructor(
    message: string,
    options: { kind: RangeErrorKind; range?: BlockRange; cause?: unknown },
  ) {
    super(message);
    this.name = "ViemChunkerError";
    this.kind = options.kind;
    this.cause = options.cause;
    if (options.range) this.range = options.range;
  }
}

export function classifyRpcRangeError(error: unknown): RangeErrorKind {
  const message = extractErrorText(error).toLowerCase();
  const code = extractErrorCode(error);

  if (code === 429 || includesAny(message, ["rate limit", "too many requests", "over rate"])) {
    return "rateLimit";
  }

  if (
    includesAny(message, [
      "block range exceeded",
      "block range is too large",
      "block range greater than",
      "query exceeds max block range",
      "exceed maximum block range",
      "block is out of range",
    ])
  ) {
    return "rangeTooLarge";
  }

  if (
    includesAny(message, ["response too large", "payload too large", "query exceeds max results"])
  ) {
    return "payloadTooLarge";
  }

  if (includesAny(message, ["timeout", "timed out", "deadline exceeded", "aborted"])) {
    return "timeout";
  }

  if (
    includesAny(message, [
      "overloaded",
      "temporarily unavailable",
      "bad gateway",
      "service unavailable",
    ])
  ) {
    return "serverOverloaded";
  }

  if (
    includesAny(message, [
      "block not found",
      "unknown block",
      "missing trie node",
      "header not found",
    ])
  ) {
    return "blockUnavailable";
  }

  return "fatal";
}

export function isRetriable(kind: RangeErrorKind): boolean {
  return kind !== "fatal";
}

export function shouldStepDown(kind: RangeErrorKind): boolean {
  return kind === "rangeTooLarge" || kind === "payloadTooLarge";
}

function includesAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function extractErrorText(error: unknown): string {
  return collectErrorText(error, new Set()).join(" ");
}

function collectErrorText(error: unknown, seen: Set<unknown>): string[] {
  if (error instanceof Error) {
    return [
      `${error.name}: ${error.message}`,
      ...collectObjectText(error as unknown as Record<string, unknown>, seen),
      ...collectErrorText(error.cause, seen),
    ];
  }
  if (typeof error === "string") return [error];
  if (typeof error !== "object" || error === null) return [String(error)];
  if (seen.has(error)) return [];
  seen.add(error);

  return collectObjectText(error as Record<string, unknown>, seen);
}

function collectObjectText(error: Record<string, unknown>, seen: Set<unknown>): string[] {
  const parts: string[] = [];
  for (const value of Object.values(error)) {
    if (typeof value === "string") parts.push(value);
    if (value instanceof Error || (typeof value === "object" && value !== null)) {
      parts.push(...collectErrorText(value, seen));
    }
  }

  return parts.length > 0 ? parts : [String(error)];
}

function extractErrorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;

  const record = error as Record<string, unknown>;
  for (const key of ["status", "statusCode", "code"]) {
    const value = record[key];
    if (typeof value === "number") return value;
  }

  const cause = record.cause;
  if (cause && cause !== error) return extractErrorCode(cause);

  return undefined;
}
