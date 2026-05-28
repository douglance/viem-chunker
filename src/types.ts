export type BlockRange = {
  fromBlock: bigint;
  toBlock: bigint;
};

export type ScanCheckpoint = {
  fromBlock: bigint;
  toBlock: bigint;
  nextBlock: bigint;
  completedRanges: readonly BlockRange[];
};

export type ScanProgress = ScanCheckpoint & {
  blocksCompleted: bigint;
  blocksTotal: bigint;
};

export type RangeErrorKind =
  | "rateLimit"
  | "rangeTooLarge"
  | "payloadTooLarge"
  | "timeout"
  | "serverOverloaded"
  | "blockUnavailable"
  | "fatal";

export type ScanEvent<T> =
  | { type: "chunk:start"; range: BlockRange; attempt: number; chunkSize: bigint }
  | { type: "chunk:success"; range: BlockRange; attempt: number; items: readonly T[] }
  | { type: "chunk:retry"; range: BlockRange; attempt: number; error: unknown; delayMs: number }
  | {
      type: "chunk:stepDown";
      range: BlockRange;
      attempt: number;
      error: unknown;
      nextChunkSize: bigint;
    }
  | { type: "progress"; progress: ScanProgress }
  | { type: "checkpoint"; checkpoint: ScanCheckpoint };

export type ScanSummary<T> = {
  fromBlock: bigint;
  toBlock: bigint;
  items: readonly T[];
  chunksCompleted: number;
  checkpoint: ScanCheckpoint;
};

export type FetchChunkContext = BlockRange & {
  attempt: number;
  signal?: AbortSignal;
};

export type RetryPolicy = {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
};

export type ChunkPolicy = {
  initialSize: bigint;
  minSize: bigint;
  maxSize: bigint;
  growthFactor: number;
};

export type ScanOptions<T> = {
  fromBlock: bigint;
  toBlock: bigint;
  fetchChunk: (context: FetchChunkContext) => Promise<readonly T[]>;
  chunk?: Partial<ChunkPolicy>;
  retry?: Partial<RetryPolicy>;
  signal?: AbortSignal;
  onEvent?: (event: ScanEvent<T>) => void;
};

export type ViemChunkerOptions = {
  chunk?: Partial<ChunkPolicy>;
  retry?: Partial<RetryPolicy>;
  finalityBuffer?: bigint;
  signal?: AbortSignal;
};

export type ChunkerActionDefaults = ViemChunkerOptions;
