import { describe, expect, it } from "vitest";
import type { ViemChunkerError } from "../src/errors.js";
import { collectBlockRange, scanBlockRange } from "../src/scanner.js";

describe("scanBlockRange", () => {
  it("covers an inclusive range exactly once", async () => {
    const summary = await collectBlockRange({
      fromBlock: 10n,
      toBlock: 15n,
      chunk: { initialSize: 2n, maxSize: 2n },
      fetchChunk: async ({ fromBlock, toBlock }) => {
        const blocks: bigint[] = [];
        for (let block = fromBlock; block <= toBlock; block += 1n) blocks.push(block);
        return blocks;
      },
    });

    expect(summary.items).toEqual([10n, 11n, 12n, 13n, 14n, 15n]);
    expect(summary.checkpoint.nextBlock).toBe(16n);
    expect(summary.chunksCompleted).toBe(3);
  });

  it("steps down chunk size for provider range pressure", async () => {
    const attempts: string[] = [];

    const summary = await collectBlockRange({
      fromBlock: 1n,
      toBlock: 4n,
      chunk: { initialSize: 4n, minSize: 1n, maxSize: 4n, growthFactor: 1 },
      retry: { baseDelayMs: 0, maxDelayMs: 0 },
      fetchChunk: async ({ fromBlock, toBlock }) => {
        attempts.push(`${fromBlock}-${toBlock}`);
        if (toBlock - fromBlock + 1n > 2n) throw new Error("block range is too large");
        return [`${fromBlock}-${toBlock}`];
      },
    });

    expect(attempts).toEqual(["1-4", "1-2", "3-4"]);
    expect(summary.items).toEqual(["1-2", "3-4"]);
  });

  it("retries transient errors before succeeding", async () => {
    let calls = 0;

    const summary = await collectBlockRange({
      fromBlock: 1n,
      toBlock: 1n,
      retry: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 },
      fetchChunk: async () => {
        calls += 1;
        if (calls === 1) throw new Error("rate limit exceeded");
        return ["ok"];
      },
    });

    expect(summary.items).toEqual(["ok"]);
    expect(calls).toBe(2);
  });

  it("yields visible lifecycle events", async () => {
    const eventTypes: string[] = [];

    for await (const event of scanBlockRange({
      fromBlock: 1n,
      toBlock: 1n,
      fetchChunk: async () => ["ok"],
    })) {
      eventTypes.push(event.type);
    }

    expect(eventTypes).toEqual(["chunk:start", "chunk:success", "checkpoint", "progress"]);
  });

  it("throws typed errors after retries are exhausted", async () => {
    await expect(
      collectBlockRange({
        fromBlock: 1n,
        toBlock: 1n,
        retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },
        fetchChunk: async () => {
          throw new Error("rate limit exceeded");
        },
      }),
    ).rejects.toMatchObject({
      name: "ViemChunkerError",
      kind: "rateLimit",
    } satisfies Partial<ViemChunkerError>);
  });

  it("honors an already-aborted signal before fetching a chunk", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));

    await expect(
      collectBlockRange({
        fromBlock: 1n,
        toBlock: 1n,
        signal: controller.signal,
        fetchChunk: async () => {
          throw new Error("fetch should not run");
        },
      }),
    ).rejects.toThrow("stop");
  });
});
