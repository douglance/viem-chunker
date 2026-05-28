# viem-chunker

Chunked, retrying block-range actions for [viem](https://viem.sh/).

`viem-chunker` lets you ask for a large block range the way you normally would with viem, while the
library handles provider limits, transient failures, retries, and chunk sizing behind the scenes.
The default experience is deliberately boring:

```ts
import { chunkerActions } from "viem-chunker";
import { createPublicClient, http, parseAbiItem } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({
  chain: mainnet,
  transport: http(process.env.RPC_URL),
}).extend(chunkerActions());

const logs = await client.getLogs({
  address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
  fromBlock: 18_000_000n,
  toBlock: 18_100_000n,
  strict: true,
});
```

That call still looks like viem. It just becomes safer for large historical ranges.

## Why

Most RPC providers put practical limits on `eth_getLogs`:

- maximum block range
- maximum response size
- rate limits
- timeouts
- occasional overloaded backends
- inconsistent transient failures during historical scans

The raw viem API is intentionally direct. If you ask for too much, the provider can reject the call.
`viem-chunker` keeps viem's ergonomics, then adds a mature range-scanning layer for the cases where
one request is not reliable enough.

## Features

- **Drop-in viem extension**: use `client.extend(chunkerActions())` and keep calling
  `client.getLogs(...)`.
- **Range-only interception**: range-based `getLogs` calls are chunked; `blockHash` and non-range
  calls are delegated back to viem.
- **Adaptive chunking**: starts with a sensible chunk size, grows after success, and steps down when
  providers reject large ranges or payloads.
- **Retry with backoff**: rate limits, timeouts, overloads, and temporary block availability issues
  are retried with exponential backoff and jitter.
- **Typed viem logs**: event and `args` inference survive the wrapper, including strict event args.
- **Sorted, deduplicated output**: logs are sorted by `blockNumber`, `transactionIndex`, and
  `logIndex`, then deduplicated by stable log identity.
- **Finality buffer**: optionally scan only up to `toBlock - finalityBuffer`.
- **Progress and checkpoints**: advanced scanner APIs emit structured progress and checkpoint
  events so callers can persist resume state in their own storage.
- **Generic scanner**: the block-range engine is not tied to logs; it can power custom viem actions
  or non-viem block-range work.
- **No storage opinion**: no SQLite, Redis, files, browser storage, or database dependency.
- **No framework dependency**: no React, wagmi, RxJS, or Node-only runtime APIs.
- **Package-safe output**: dual ESM/CJS build with generated types and clean `publint` validation.

## Installation

```sh
pnpm add viem-chunker viem
```

`viem` is a peer dependency. The package targets viem `>=2.51.3 <3`.

## Quick Start

```ts
import { chunkerActions } from "viem-chunker";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({
  chain: mainnet,
  transport: http(process.env.RPC_URL),
}).extend(chunkerActions());

const logs = await client.getLogs({
  fromBlock: 19_000_000n,
  toBlock: 19_050_000n,
});
```

The extension overrides `getLogs` on the extended client. You still pass viem-compatible
`getLogs` parameters. For block-hash lookups, the call is delegated to viem unchanged:

```ts
const logs = await client.getLogs({
  blockHash: "0x...",
});
```

## Default API

### `chunkerActions(defaults?)`

Use this for normal application code.

```ts
const client = createPublicClient({ chain, transport }).extend(
  chunkerActions({
    chunk: {
      initialSize: 2_000n,
      minSize: 1n,
      maxSize: 10_000n,
      growthFactor: 2,
    },
    retry: {
      maxRetries: 4,
      baseDelayMs: 250,
      maxDelayMs: 8_000,
      jitterRatio: 0.2,
    },
    finalityBuffer: 12n,
  }),
);
```

After extension:

```ts
const logs = await client.getLogs({
  address,
  event,
  args,
  fromBlock,
  toBlock,
  strict: true,
});
```

`viem-chunker` only chunks when both `fromBlock` and `toBlock` are present and the call is not a
`blockHash` lookup.

### `getLogsChunked(client, params, options?)`

Use this when you do not want to extend the client:

```ts
import { getLogsChunked } from "viem-chunker";

const logs = await getLogsChunked(
  client,
  {
    address,
    event,
    fromBlock: 1n,
    toBlock: 100_000n,
    strict: true,
  },
  {
    finalityBuffer: 6n,
  },
);
```

This uses the same chunking, retry, sorting, and deduplication behavior as `chunkerActions()`.

## Advanced Scanner API

The generic scanner powers `getLogsChunked`, but it is also exported for custom workflows.

### `collectBlockRange(options)`

Collects all chunk results into a final summary:

```ts
import { collectBlockRange } from "viem-chunker";

const summary = await collectBlockRange({
  fromBlock: 1n,
  toBlock: 1_000n,
  fetchChunk: async ({ fromBlock, toBlock, signal }) => {
    return client.getBlocksInRange({ fromBlock, toBlock, signal });
  },
});

console.log(summary.items);
console.log(summary.checkpoint.nextBlock);
```

### `scanBlockRange(options)`

Streams lifecycle events as an async generator:

```ts
import { scanBlockRange } from "viem-chunker";

const scanner = scanBlockRange({
  fromBlock: 1n,
  toBlock: 10_000n,
  fetchChunk: async ({ fromBlock, toBlock }) => {
    return fetchCustomData(fromBlock, toBlock);
  },
});

for await (const event of scanner) {
  if (event.type === "checkpoint") {
    await saveCheckpoint(event.checkpoint);
  }
}
```

Events include:

- `chunk:start`
- `chunk:success`
- `chunk:retry`
- `chunk:stepDown`
- `checkpoint`
- `progress`

The scanner treats ranges as inclusive. A successful scan covers every block exactly once.

## Chunking Behavior

Chunking is controlled by `ChunkPolicy`:

```ts
type ChunkPolicy = {
  initialSize: bigint;
  minSize: bigint;
  maxSize: bigint;
  growthFactor: number;
};
```

Defaults:

```ts
{
  initialSize: 2_000n,
  minSize: 1n,
  maxSize: 10_000n,
  growthFactor: 2,
}
```

The scanner:

1. Starts at `initialSize`.
2. Fetches `[fromBlock, toBlock]` inclusively for the current chunk.
3. Grows after successful chunks, capped by `maxSize`.
4. Shrinks when the provider reports range or payload pressure.
5. Stops shrinking at `minSize`.

If a single-block range still cannot be fetched after retries, the scan fails with a typed
`ViemChunkerError`.

## Retry Behavior

Retrying is controlled by `RetryPolicy`:

```ts
type RetryPolicy = {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
};
```

Defaults:

```ts
{
  maxRetries: 4,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
  jitterRatio: 0.2,
}
```

The classifier recognizes common provider and viem-wrapped failures:

- rate limits
- oversized block ranges
- oversized responses
- timeouts
- overloaded servers
- temporarily unavailable blocks
- fatal input/client errors

Fatal errors fail immediately. Retriable errors are retried or stepped down according to the policy.

## Finality Buffer

`finalityBuffer` lets you avoid the freshest blocks:

```ts
const logs = await client.getLogs({
  fromBlock: 1_000_000n,
  toBlock: 1_010_000n,
});
```

With:

```ts
chunkerActions({ finalityBuffer: 12n });
```

the effective scan ends at:

```ts
toBlock - 12n;
```

This is useful when indexing chains where very recent blocks may be reorganized or inconsistently
served by RPC infrastructure.

## Checkpoints and Resume

`viem-chunker` emits checkpoints, but does not store them. This keeps the library portable across
Node, workers, browsers, serverless functions, queues, and indexers.

A checkpoint includes:

```ts
type ScanCheckpoint = {
  fromBlock: bigint;
  toBlock: bigint;
  nextBlock: bigint;
  completedRanges: readonly BlockRange[];
};
```

To resume, persist `checkpoint.nextBlock`, then start the next scan from that block:

```ts
const checkpoint = await loadCheckpoint();

await collectBlockRange({
  fromBlock: checkpoint?.nextBlock ?? startBlock,
  toBlock,
  fetchChunk,
  onEvent: async (event) => {
    if (event.type === "checkpoint") {
      await saveCheckpoint(event.checkpoint);
    }
  },
});
```

## Abort Support

Pass an `AbortSignal` to stop a scan:

```ts
const controller = new AbortController();

const promise = getLogsChunked(client, params, {
  signal: controller.signal,
});

controller.abort();
await promise;
```

Abort signals are passed through to custom scanner `fetchChunk` calls.

## Error Handling

`ViemChunkerError` includes:

- `kind`
- `range`
- `cause`

```ts
import { ViemChunkerError } from "viem-chunker";

try {
  await client.getLogs({ fromBlock, toBlock });
} catch (error) {
  if (error instanceof ViemChunkerError) {
    console.error(error.kind, error.range, error.cause);
  }
}
```

You can classify provider errors directly:

```ts
import { classifyRpcRangeError } from "viem-chunker";

const kind = classifyRpcRangeError(error);
```

## TypeScript

The viem adapter preserves event inference:

```ts
const event = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

const logs = await client.getLogs({
  event,
  fromBlock: 1n,
  toBlock: 2n,
  strict: true,
});

logs[0]?.args.value;
```

The inferred type of `value` is `bigint`, just like viem.

## Runtime and Package Format

`viem-chunker` is designed for modern JavaScript runtimes:

- Node `>=20`
- edge workers
- serverless functions
- browser-compatible bundlers

The package ships:

- ESM
- CJS
- generated `.d.ts`
- generated `.d.cts`
- `sideEffects: false`

The runtime code avoids Node-only APIs.

## Design Principles

This project intentionally keeps a small, sharp surface:

- viem remains the client and transport layer
- `chunkerActions()` is the default user experience
- scanner internals are available, but not required
- provider quirks live in error classification, not in the scanner loop
- storage is a caller concern
- framework integrations can be built on top without entering the core package

## Development

```sh
pnpm install
pnpm verify
```

Useful scripts:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:types
pnpm build
pnpm verify
```

`pnpm verify` runs Biome, TypeScript, Vitest, type tests, the package build, and `publint`.

## License

MIT
