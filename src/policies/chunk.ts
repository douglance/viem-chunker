import type { ChunkPolicy } from "../types.js";

export const defaultChunkPolicy: ChunkPolicy = {
  initialSize: 2_000n,
  minSize: 1n,
  maxSize: 10_000n,
  growthFactor: 2,
};

export function resolveChunkPolicy(policy: Partial<ChunkPolicy> | undefined): ChunkPolicy {
  const resolved = { ...defaultChunkPolicy, ...policy };

  if (resolved.minSize < 1n) throw new Error("chunk.minSize must be at least 1");
  if (resolved.initialSize < resolved.minSize) {
    throw new Error("chunk.initialSize must be greater than or equal to chunk.minSize");
  }
  if (resolved.maxSize < resolved.initialSize) {
    throw new Error("chunk.maxSize must be greater than or equal to chunk.initialSize");
  }
  if (resolved.growthFactor < 1) throw new Error("chunk.growthFactor must be at least 1");

  return resolved;
}

export function nextChunkRange(fromBlock: bigint, toBlock: bigint, chunkSize: bigint) {
  return {
    fromBlock,
    toBlock: minBigInt(toBlock, fromBlock + chunkSize - 1n),
  };
}

export function growChunkSize(current: bigint, policy: ChunkPolicy): bigint {
  const next = BigInt(Math.ceil(Number(current) * policy.growthFactor));
  return minBigInt(policy.maxSize, maxBigInt(policy.minSize, next));
}

export function shrinkChunkSize(current: bigint, policy: ChunkPolicy): bigint {
  if (current <= policy.minSize) return current;
  return maxBigInt(policy.minSize, current / 2n);
}

export function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
