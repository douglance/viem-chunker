import { createClient, custom } from "viem";
import { describe, expect, it } from "vitest";
import { chunkerActions } from "../src/index.js";

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

  it("uses chunking and step-down through the extended action", async () => {
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
    }).extend(
      chunkerActions({
        chunk: { initialSize: 4n, minSize: 1n, maxSize: 4n, growthFactor: 1 },
      }),
    );

    const logs = await client.getLogs({ address, fromBlock: 1n, toBlock: 4n });

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

  it("delegates non-range calls to viem unchanged", async () => {
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

    const logs = await client.getLogs({ address, fromBlock: 1n });

    expect(calls).toHaveLength(1);
    expect(logs).toHaveLength(1);
  });

  it("resolves earliest and latest block tags before chunking", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const client = createClient({
      transport: custom(
        {
          request: async ({ method, params }) => {
            calls.push({ method, params });
            if (method === "eth_blockNumber") return "0x5";
            if (method === "eth_getLogs") return [rpcLog(1n, 0)];
            throw new Error(`unexpected method ${method}`);
          },
        },
        { retryCount: 0 },
      ),
    }).extend(chunkerActions({ chunk: { initialSize: 100n, maxSize: 100n } }));

    await client.getLogs({ address, fromBlock: "earliest", toBlock: "latest" });

    expect(calls.map((call) => call.method)).toEqual(["eth_blockNumber", "eth_getLogs"]);
    expect(calls[1]?.params).toMatchObject([
      {
        address,
        fromBlock: "0x0",
        toBlock: "0x5",
      },
    ]);
  });

  it("applies the finality buffer before scanning", async () => {
    const ranges: unknown[] = [];
    const client = createClient({
      transport: custom(
        {
          request: async ({ method, params }) => {
            if (method !== "eth_getLogs") throw new Error(`unexpected method ${method}`);
            ranges.push(params);
            return [rpcLog(10n, 0)];
          },
        },
        { retryCount: 0 },
      ),
    }).extend(chunkerActions({ chunk: { initialSize: 100n, maxSize: 100n }, finalityBuffer: 2n }));

    await client.getLogs({ address, fromBlock: 10n, toBlock: 15n });

    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject([
      {
        address,
        fromBlock: "0xa",
        toBlock: "0xd",
      },
    ]);
  });

  it("returns an empty result when the finality buffer moves toBlock before fromBlock", async () => {
    const calls: unknown[] = [];
    const client = createClient({
      transport: custom(
        {
          request: async ({ method, params }) => {
            calls.push({ method, params });
            throw new Error(`unexpected method ${method}`);
          },
        },
        { retryCount: 0 },
      ),
    }).extend(chunkerActions({ finalityBuffer: 2n }));

    const logs = await client.getLogs({ address, fromBlock: 10n, toBlock: 11n });

    expect(logs).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("rejects a negative finality buffer", async () => {
    const client = createClient({
      transport: custom(
        {
          request: async ({ method }) => {
            throw new Error(`unexpected method ${method}`);
          },
        },
        { retryCount: 0 },
      ),
    }).extend(chunkerActions({ finalityBuffer: -1n }));

    await expect(client.getLogs({ address, fromBlock: 10n, toBlock: 11n })).rejects.toThrow(
      "finalityBuffer must be non-negative",
    );
  });

  it("sorts logs and deduplicates only logs with stable identity", async () => {
    const duplicate = rpcLog(1n, 0);
    const client = createClient({
      transport: custom(
        {
          request: async ({ method }) => {
            if (method !== "eth_getLogs") throw new Error(`unexpected method ${method}`);
            return [
              rpcLog(2n, 0),
              duplicate,
              rpcLog(1n, 1),
              duplicate,
              pendingRpcLog(),
              pendingRpcLog(),
            ];
          },
        },
        { retryCount: 0 },
      ),
    }).extend(chunkerActions({ chunk: { initialSize: 100n, maxSize: 100n } }));

    const logs = await client.getLogs({ address, fromBlock: 1n, toBlock: 2n });

    expect(logs.map((log) => log.blockNumber)).toEqual([1n, 1n, 2n, null, null]);
    expect(logs.filter((log) => log.blockHash === duplicate.blockHash)).toHaveLength(1);
    expect(logs.filter((log) => log.blockHash === null)).toHaveLength(2);
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

function pendingRpcLog() {
  return {
    address,
    blockHash: null,
    blockNumber: null,
    data: "0x",
    logIndex: null,
    removed: false,
    topics: [],
    transactionHash: null,
    transactionIndex: null,
  };
}

function hexHash(value: bigint): `0x${string}` {
  return `0x${value.toString(16).padStart(64, "0")}`;
}
