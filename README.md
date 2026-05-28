# viem-chunker

Chunked, retrying block-range actions for viem.

```ts
import { chunkerActions } from "viem-chunker";
import { createPublicClient, http, parseAbiItem } from "viem";

const client = createPublicClient({ chain, transport: http() }).extend(chunkerActions());

const logs = await client.getLogs({
  event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
  fromBlock: 1n,
  toBlock: 1_000_000n,
});
```

By default, `chunkerActions()` makes range-based `getLogs` resilient without exposing retry
internals at each call site. Advanced users can pass defaults to `chunkerActions()` or use
`getLogsChunked` and `scanBlockRange` directly.
