import { createClient, custom } from "viem";
import { describe, expect, it } from "vitest";
import { chunkerActions, getLogsChunked } from "../src/index.js";

const address = "0x0000000000000000000000000000000000000001" as const;
const blockHash = "0x000000000000000000000000000000000000000000000000000000000000000a" as const;

describe("viem getLogs adapter", () => {
  it("plugs into viem by overriding range getLogs on an extended client", async () => {
    const calls: unknown[] = [];
    const client = createClient({
      transport: custom(
        {
          request: async ({ method, params }) => {
            calls.push(params);
            if (method !== "eth_getLogs") throw new Error(`unexpected method ${method}`);
            const filter = Array.isArray(params) ? params[0] : undefined;
            return [rpcLog(BigInt(filter?.fromBlock ?? 1), 0)];
          },
        },
        { retryCount: 0 },
      ),
    }).extend(chunkerActions({ chunk: { initialSize: 1n, maxSize: 1n } }));

    const logs = await client.getLogs({ address, fromBlock: 1n, toBlock: 2n });

    expect(calls).toHaveLength(2);
    expect(logs.map((log) => log.blockNumber)).toEqual([1n, 2n]);
  });

  it("uses chunking and step-down when called directly", async () => {
    const ranges: unknown[] = [];
    const client = createClient({
      transport: custom(
        {
          request: async ({ method, params }) => {
            if (method !== "eth_getLogs") throw new Error(`unexpected method ${method}`);
            ranges.push(params);
            const filter = Array.isArray(params) ? params[0] : undefined;
            if (filter?.fromBlock === "0x1" && filter.toBlock === "0x4") {
              throw new Error("query exceeds max block range");
            }
            return [rpcLog(BigInt(filter?.fromBlock ?? 1), 0)];
          },
        },
        { retryCount: 0 },
      ),
    });

    const logs = await getLogsChunked(
      client,
      { address, fromBlock: 1n, toBlock: 4n },
      { chunk: { initialSize: 4n, minSize: 1n, maxSize: 4n, growthFactor: 1 } },
    );

    expect(ranges).toHaveLength(3);
    expect(logs).toHaveLength(2);
  });

  it("delegates blockHash calls to viem without chunking", async () => {
    const calls: unknown[] = [];
    const client = createClient({
      transport: custom(
        {
          request: async ({ method, params }) => {
            if (method !== "eth_getLogs") throw new Error(`unexpected method ${method}`);
            calls.push(params);
            return [rpcLog(1n, 0)];
          },
        },
        { retryCount: 0 },
      ),
    }).extend(chunkerActions({ chunk: { initialSize: 1n, maxSize: 1n } }));

    const logs = await client.getLogs({ address, blockHash });

    expect(calls).toHaveLength(1);
    expect(logs).toHaveLength(1);
  });
});

function rpcLog(blockNumber: bigint, logIndex: number) {
  const uniqueHash = hexHash(blockNumber + BigInt(logIndex));

  return {
    address,
    blockHash: uniqueHash,
    blockNumber: `0x${blockNumber.toString(16)}`,
    data: "0x",
    logIndex: `0x${logIndex.toString(16)}`,
    removed: false,
    topics: [],
    transactionHash: uniqueHash,
    transactionIndex: "0x0",
  };
}

function hexHash(value: bigint): `0x${string}` {
  return `0x${value.toString(16).padStart(64, "0")}`;
}
