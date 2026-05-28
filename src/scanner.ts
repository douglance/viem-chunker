import { classifyRpcRangeError, isRetriable, shouldStepDown, ViemChunkerError } from "./errors.js";
import {
  growChunkSize,
  nextChunkRange,
  resolveChunkPolicy,
  shrinkChunkSize,
} from "./policies/chunk.js";
import { resolveRetryPolicy, retryDelayMs, wait } from "./policies/retry.js";
import type { BlockRange, ScanCheckpoint, ScanEvent, ScanOptions, ScanSummary } from "./types.js";

export async function* scanBlockRange<T>(
  options: ScanOptions<T>,
): AsyncGenerator<ScanEvent<T>, ScanSummary<T>, void> {
  validateRange(options.fromBlock, options.toBlock);

  const chunkPolicy = resolveChunkPolicy(options.chunk);
  const retryPolicy = resolveRetryPolicy(options.retry);
  const completedRanges: BlockRange[] = [];
  const items: T[] = [];
  const totalBlocks = options.toBlock - options.fromBlock + 1n;

  let nextBlock = options.fromBlock;
  let chunkSize = chunkPolicy.initialSize;
  let chunksCompleted = 0;

  while (nextBlock <= options.toBlock) {
    throwIfAborted(options.signal);

    const range = nextChunkRange(nextBlock, options.toBlock, chunkSize);
    let attempt = 1;

    for (;;) {
      const startEvent = { type: "chunk:start" as const, range, attempt, chunkSize };
      emit(options, startEvent);
      yield startEvent;

      try {
        const chunkItems = await options.fetchChunk({
          ...range,
          attempt,
          ...(options.signal ? { signal: options.signal } : {}),
        });

        items.push(...chunkItems);
        completedRanges.push(range);
        chunksCompleted += 1;
        nextBlock = range.toBlock + 1n;
        chunkSize = growChunkSize(chunkSize, chunkPolicy);

        const successEvent = { type: "chunk:success" as const, range, attempt, items: chunkItems };
        emit(options, successEvent);
        yield successEvent;

        const checkpoint = buildCheckpoint(
          options.fromBlock,
          options.toBlock,
          nextBlock,
          completedRanges,
        );
        const checkpointEvent = { type: "checkpoint" as const, checkpoint };
        emit(options, checkpointEvent);
        yield checkpointEvent;

        const progress = {
          ...checkpoint,
          blocksCompleted: nextBlock - options.fromBlock,
          blocksTotal: totalBlocks,
        };
        const progressEvent = { type: "progress" as const, progress };
        emit(options, progressEvent);
        yield progressEvent;

        break;
      } catch (cause) {
        throwIfAborted(options.signal);

        const kind = classifyRpcRangeError(cause);
        if (!isRetriable(kind)) {
          throw new ViemChunkerError("Block range scan failed with a fatal RPC error", {
            kind,
            range,
            cause,
          });
        }

        if (shouldStepDown(kind)) {
          const nextChunkSize = shrinkChunkSize(chunkSize, chunkPolicy);
          if (nextChunkSize < chunkSize) {
            chunkSize = nextChunkSize;
            const stepDownEvent = {
              type: "chunk:stepDown",
              range,
              attempt,
              error: cause,
              nextChunkSize,
            } as const;
            emit(options, stepDownEvent);
            yield stepDownEvent;
            break;
          }
        }

        if (attempt > retryPolicy.maxRetries) {
          throw new ViemChunkerError("Block range scan exhausted retries", {
            kind,
            range,
            cause,
          });
        }

        const delayMs = retryDelayMs(attempt, retryPolicy);
        const retryEvent = { type: "chunk:retry" as const, range, attempt, error: cause, delayMs };
        emit(options, retryEvent);
        yield retryEvent;
        await wait(delayMs, options.signal);
        attempt += 1;
      }
    }
  }

  return {
    fromBlock: options.fromBlock,
    toBlock: options.toBlock,
    items,
    chunksCompleted,
    checkpoint: buildCheckpoint(options.fromBlock, options.toBlock, nextBlock, completedRanges),
  };
}

export async function collectBlockRange<T>(options: ScanOptions<T>): Promise<ScanSummary<T>> {
  const scanner = scanBlockRange(options);
  let cursor = await scanner.next();

  while (!cursor.done) {
    cursor = await scanner.next();
  }

  return cursor.value;
}

function validateRange(fromBlock: bigint, toBlock: bigint): void {
  if (fromBlock < 0n) throw new Error("fromBlock must be non-negative");
  if (toBlock < fromBlock) throw new Error("toBlock must be greater than or equal to fromBlock");
}

function buildCheckpoint(
  fromBlock: bigint,
  toBlock: bigint,
  nextBlock: bigint,
  completedRanges: readonly BlockRange[],
): ScanCheckpoint {
  return {
    fromBlock,
    toBlock,
    nextBlock,
    completedRanges: completedRanges.slice(),
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Scan aborted");
}

function emit<T>(options: ScanOptions<T>, scanEvent: ScanEvent<T>): void {
  options.onEvent?.(scanEvent);
}
