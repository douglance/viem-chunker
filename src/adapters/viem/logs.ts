import type {
  AbiEvent,
  BlockNumber,
  BlockTag,
  Chain,
  Client,
  GetLogsParameters,
  GetLogsReturnType,
  PublicActions,
  Transport,
} from "viem";
import { getBlock, getBlockNumber, getLogs } from "viem/actions";
import { collectBlockRange } from "../../scanner.js";
import type { ChunkerActionDefaults, ViemChunkerOptions } from "../../types.js";

type AnyGetLogsParameters = GetLogsParameters<
  AbiEvent | undefined,
  readonly AbiEvent[] | readonly unknown[] | undefined,
  boolean | undefined,
  BlockNumber | BlockTag | undefined,
  BlockNumber | BlockTag | undefined
>;

export type ChunkerActions = {
  getLogs: PublicActions["getLogs"];
};

export function chunkerActions(defaults: ChunkerActionDefaults = {}) {
  return (client: Client<Transport, Chain | undefined>): ChunkerActions => ({
    getLogs: ((parameters) =>
      getLogsWithChunking(client, parameters, defaults)) as PublicActions["getLogs"],
  });
}

export async function getLogsChunked<
  const abiEvent extends AbiEvent | undefined = undefined,
  const abiEvents extends
    | readonly AbiEvent[]
    | readonly unknown[]
    | undefined = abiEvent extends AbiEvent ? [abiEvent] : undefined,
  strict extends boolean | undefined = undefined,
  fromBlock extends BlockNumber | BlockTag | undefined = undefined,
  toBlock extends BlockNumber | BlockTag | undefined = undefined,
>(
  client: Client<Transport, Chain | undefined>,
  parameters?: GetLogsParameters<abiEvent, abiEvents, strict, fromBlock, toBlock>,
  options: ViemChunkerOptions = {},
): Promise<GetLogsReturnType<abiEvent, abiEvents, strict, fromBlock, toBlock>> {
  return getLogsWithChunking(client, parameters, options) as Promise<
    GetLogsReturnType<abiEvent, abiEvents, strict, fromBlock, toBlock>
  >;
}

async function getLogsWithChunking(
  client: Client<Transport, Chain | undefined>,
  parameters: AnyGetLogsParameters | undefined,
  options: ViemChunkerOptions,
): Promise<readonly unknown[]> {
  if (shouldDelegate(parameters)) {
    return getLogs(client, parameters);
  }

  const fromBlock = await resolveBoundary(client, parameters.fromBlock, "fromBlock");
  let toBlock = await resolveBoundary(client, parameters.toBlock, "toBlock");

  if (options.finalityBuffer) {
    toBlock -= options.finalityBuffer;
  }

  if (toBlock < fromBlock) {
    return [];
  }

  const summary = await collectBlockRange({
    fromBlock,
    toBlock,
    ...(options.chunk ? { chunk: options.chunk } : {}),
    ...(options.retry ? { retry: options.retry } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    fetchChunk: async ({ fromBlock: chunkFromBlock, toBlock: chunkToBlock }) => {
      return getLogs(client, {
        ...parameters,
        fromBlock: chunkFromBlock,
        toBlock: chunkToBlock,
      } as AnyGetLogsParameters);
    },
  });

  return dedupeLogs(sortLogs(summary.items as readonly SortableLog[]));
}

function shouldDelegate(parameters: AnyGetLogsParameters | undefined): parameters is undefined {
  if (!parameters) return true;
  if ("blockHash" in parameters && parameters.blockHash) return true;
  return parameters.fromBlock === undefined || parameters.toBlock === undefined;
}

async function resolveBoundary(
  client: Client<Transport, Chain | undefined>,
  value: bigint | BlockTag | undefined,
  name: "fromBlock" | "toBlock",
): Promise<bigint> {
  if (typeof value === "bigint") return value;
  if (value === "earliest") return 0n;
  if (value === "latest" || value === undefined) return getBlockNumber(client);

  const block = await getBlock(client, { blockTag: value });
  if (block.number === null)
    throw new Error(`${name} resolved to a pending block without a number`);
  return block.number;
}

type SortableLog = {
  blockNumber?: bigint | null;
  transactionIndex?: number | null;
  logIndex?: number | null;
};

function sortLogs<T extends SortableLog>(logs: readonly T[]): T[] {
  return logs.slice().sort((left, right) => {
    return (
      compareNullableBigInt(left.blockNumber, right.blockNumber) ||
      compareNullableNumber(left.transactionIndex, right.transactionIndex) ||
      compareNullableNumber(left.logIndex, right.logIndex)
    );
  });
}

function dedupeLogs<
  T extends SortableLog & { blockHash?: string | null; transactionHash?: string | null },
>(logs: readonly T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const log of logs) {
    const key = `${log.blockHash ?? ""}:${log.transactionHash ?? ""}:${log.logIndex ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(log);
  }

  return deduped;
}

function compareNullableBigInt(
  left: bigint | null | undefined,
  right: bigint | null | undefined,
): number {
  if (left === right) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left < right ? -1 : 1;
}

function compareNullableNumber(
  left: number | null | undefined,
  right: number | null | undefined,
): number {
  if (left === right) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}
