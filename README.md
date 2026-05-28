# viem-chunker

Chunked, retrying block-range `getLogs` for [viem](https://viem.sh/).

Extend your viem client with `chunkerActions()`, then keep calling `client.getLogs(...)`.

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
- overloaded backends
- temporarily unavailable historical blocks
- inconsistent provider-specific error messages

Viem gives you a clear low-level action. If you ask an RPC for too much at once, the provider can
reject it. `viem-chunker` keeps viem's ergonomics and makes large historical log ranges behave like
normal viem calls.

## Features

- **Viem-native extension**: add resilient range behavior with `client.extend(chunkerActions())`.
- **Range-only interception**: calls with both `fromBlock` and `toBlock` are chunked; `blockHash`
  and non-range calls are delegated to viem unchanged.
- **Adaptive chunking**: starts with a sensible chunk size, grows after successful chunks, and steps
  down when providers reject large ranges or payloads.
- **Retry with backoff**: rate limits, timeouts, overloaded servers, and temporarily unavailable
  blocks are retried with exponential backoff and jitter.
- **Provider-pressure classification**: common viem-wrapped JSON-RPC and provider errors are
  classified at the boundary so retry decisions stay predictable.
- **Typed viem logs**: event and `args` inference survive the extension, including `strict: true`.
- **Sorted, deduplicated output**: results are sorted by `blockNumber`, `transactionIndex`, and
  `logIndex`, then deduplicated by stable log identity.
- **Finality buffer**: optionally avoid the freshest blocks by scanning only through
  `toBlock - finalityBuffer`.
- **Abort support**: pass an `AbortSignal` in the extension defaults.
- **Runtime portability**: works in modern Node, edge, serverless, and browser-bundled runtimes.
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

The extended client still uses viem's `getLogs` parameters. Existing range-based call sites can stay
shaped like viem.

## Wagmi

Install the extension when creating your Wagmi config by returning an extended viem client from
Wagmi's `client` option:

```ts
import { chunkerActions } from "viem-chunker";
import { createClient, http } from "viem";
import { createConfig } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";

export const config = createConfig({
  chains: [mainnet, sepolia],
  client({ chain }) {
    return createClient({
      chain,
      transport: http(process.env.RPC_URL),
    }).extend(chunkerActions());
  },
});
```

Code that receives Wagmi's public client can keep using `client.getLogs(...)`:

```ts
import { getPublicClient } from "@wagmi/core";

const client = getPublicClient(config);

const logs = await client.getLogs({
  fromBlock: 19_000_000n,
  toBlock: 19_050_000n,
});
```

The same setup works for React apps that read the public client from Wagmi hooks. The important part
is that the client is extended at config creation, so log range behavior is installed before app code
uses `getLogs`.

## Use Cases

### Backfills

Fetch historical logs across a large range:

```ts
const logs = await client.getLogs({
  address,
  event,
  fromBlock: deploymentBlock,
  toBlock: latestIndexedBlock,
  strict: true,
});
```

### Indexers

Keep scans behind a finality buffer while the chain is still moving:

```ts
const client = createPublicClient({ chain, transport }).extend(
  chunkerActions({
    finalityBuffer: 12n,
  }),
);

const logs = await client.getLogs({
  address,
  event,
  fromBlock: lastIndexedBlock + 1n,
  toBlock: latestObservedBlock,
});
```

### Provider-Friendly Range Reads

Start conservatively for providers with strict limits:

```ts
const client = createPublicClient({ chain, transport }).extend(
  chunkerActions({
    chunk: {
      initialSize: 500n,
      minSize: 1n,
      maxSize: 2_000n,
      growthFactor: 1.5,
    },
  }),
);

const logs = await client.getLogs({
  fromBlock,
  toBlock,
});
```

### User-Cancelable Requests

Attach an `AbortSignal` at the client boundary:

```ts
const controller = new AbortController();

const client = createPublicClient({ chain, transport }).extend(
  chunkerActions({
    signal: controller.signal,
  }),
);

const logsPromise = client.getLogs({
  fromBlock,
  toBlock,
});

controller.abort();
await logsPromise;
```

## Configuration

Configure behavior once when extending the client:

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

Then use the client normally:

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

## What Gets Chunked

`viem-chunker` chunks only range scans:

```ts
const logs = await client.getLogs({
  fromBlock: 1n,
  toBlock: 100_000n,
});
```

Calls that are not range scans delegate to viem unchanged:

```ts
const logs = await client.getLogs({
  blockHash: "0x...",
});
```

This keeps the extension narrow. It improves the path that needs chunking without changing unrelated
viem behavior.

## Chunking Behavior

Chunking is controlled by `chunk` defaults:

```ts
const client = createPublicClient({ chain, transport }).extend(
  chunkerActions({
    chunk: {
      initialSize: 2_000n,
      minSize: 1n,
      maxSize: 10_000n,
      growthFactor: 2,
    },
  }),
);
```

Default policy:

```ts
{
  initialSize: 2_000n,
  minSize: 1n,
  maxSize: 10_000n,
  growthFactor: 2,
}
```

The internal scanner:

1. Starts at `initialSize`.
2. Fetches each block range inclusively.
3. Grows chunk size after successful chunks.
4. Shrinks when the provider reports range or payload pressure.
5. Stops shrinking at `minSize`.

If a single-block range still cannot be fetched after retries, the call fails with a typed
`ViemChunkerError`.

## Retry Behavior

Retrying is controlled by `retry` defaults:

```ts
const client = createPublicClient({ chain, transport }).extend(
  chunkerActions({
    retry: {
      maxRetries: 4,
      baseDelayMs: 250,
      maxDelayMs: 8_000,
      jitterRatio: 0.2,
    },
  }),
);
```

Default policy:

```ts
{
  maxRetries: 4,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
  jitterRatio: 0.2,
}
```

Retriable failures include:

- rate limits
- oversized block ranges
- oversized responses
- timeouts
- overloaded servers
- temporarily unavailable blocks

Fatal input or client errors fail immediately.

## Finality Buffer

Use `finalityBuffer` to avoid scanning the freshest blocks:

```ts
const client = createPublicClient({ chain, transport }).extend(
  chunkerActions({
    finalityBuffer: 12n,
  }),
);

const logs = await client.getLogs({
  fromBlock: 1_000_000n,
  toBlock: 1_010_000n,
});
```

The effective scan ends at:

```ts
toBlock - 12n;
```

This is useful when indexing chains where recent blocks may be reorganized or inconsistently served
by RPC infrastructure.

## Abort Support

Pass an `AbortSignal` when extending the client:

```ts
const controller = new AbortController();

const client = createPublicClient({ chain, transport }).extend(
  chunkerActions({
    signal: controller.signal,
  }),
);

const promise = client.getLogs({
  fromBlock,
  toBlock,
});

controller.abort();
await promise;
```

## Error Handling

`ViemChunkerError` is exported for callers that want structured handling while still using the
extended `client.getLogs(...)` path:

```ts
import { ViemChunkerError, chunkerActions } from "viem-chunker";

const client = createPublicClient({ chain, transport }).extend(chunkerActions());

try {
  await client.getLogs({ fromBlock, toBlock });
} catch (error) {
  if (error instanceof ViemChunkerError) {
    console.error(error.kind, error.range, error.cause);
  }
}
```

The error includes:

- `kind`
- `range`
- `cause`

## TypeScript

The extension preserves viem event inference:

```ts
import { chunkerActions } from "viem-chunker";
import { createPublicClient, http, parseAbiItem } from "viem";

const client = createPublicClient({ chain, transport: http() }).extend(chunkerActions());

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
- `chunkerActions()` keeps the library aligned with viem's extension model
- retry and chunking behavior is configured once at the client boundary
- provider quirks are handled through boundary classification
- storage is a caller concern
- framework integrations can wrap the extended client rather than entering the core package

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
