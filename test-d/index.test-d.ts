import { expectType } from "tsd";
import { createPublicClient, http, parseAbiItem } from "viem";
import { mainnet } from "viem/chains";
import { chunkerActions, getLogsChunked } from "../dist/index.js";

const client = createPublicClient({ chain: mainnet, transport: http() }).extend(chunkerActions());
const event = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const logs = await client.getLogs({
  event,
  fromBlock: 1n,
  toBlock: 2n,
  strict: true,
});

const firstLog = logs[0];
if (!firstLog) throw new Error("expected at least one log");
expectType<bigint>(firstLog.args.value);

const directLogs = await getLogsChunked(client, {
  event,
  fromBlock: 1n,
  toBlock: 2n,
  strict: true,
});

const firstDirectLog = directLogs[0];
if (!firstDirectLog) throw new Error("expected at least one direct log");
expectType<`0x${string}`>(firstDirectLog.args.from);
