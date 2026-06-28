import {
  GRPC_URL,
  GRPC_X_TOKEN,
  PUMPFUN_PROGRAM_ID,
} from "../constants/constants.js";
import Client, { CommitmentLevel } from "@triton-one/yellowstone-grpc";
import { parseTxData } from "../lib/parser.js";
import bs58 from "bs58";
import storeState, { addMintAddress } from "../store/store.js";

if (!GRPC_URL || !PUMPFUN_PROGRAM_ID) {
  console.error("Set GRPC_URL and PUMPFUN_PROGRAM_ID in .env");
  process.exit(1);
}

const client = new Client(GRPC_URL, GRPC_X_TOKEN);

function log(event, data) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

function isCreateEvent(event) {
  return event.type === "create" || event.type === "create_v2";
}

function grpcTxToParserFormat(data) {
  const slot = data.transaction.slot;
  const txInfo = data.transaction.transaction;
  const message = txInfo.transaction.message;

  const signature =
    typeof txInfo.signature === "string"
      ? txInfo.signature
      : bs58.encode(txInfo.signature);

  const accountKeys = (message.accountKeys ?? []).map(
    (key) => new Uint8Array(key),
  );
  const instructions = (message.instructions ?? []).map((ix) => ({
    programIdIndex: ix.programIdIndex,
    accounts: Array.from(ix.accounts),
    data: new Uint8Array(ix.data ?? []),
  }));

  const meta = txInfo.meta;
  const loadedWritable = (meta?.loadedWritableAddresses ?? []).map(
    (k) => new Uint8Array(k),
  );
  const loadedReadonly = (meta?.loadedReadonlyAddresses ?? []).map(
    (k) => new Uint8Array(k),
  );

  const innerInstructions = (meta?.innerInstructions ?? []).map((group) => ({
    index: group.index ?? 0,
    instructions: (group.instructions ?? []).map((ix) => ({
      programIdIndex: ix.programIdIndex ?? 0,
      accounts: Array.from(ix.accounts),
      data: new Uint8Array(ix.data ?? []),
    })),
  }));

  return {
    signature,
    slot,
    message: {
      accountKeys,
      instructions,
      innerInstructions,
      versioned: message.versioned,
      loadedWritableAddresses: loadedWritable,
      loadedReadonlyAddresses: loadedReadonly,
    },
    logs: meta?.logMessages ?? [],
  };
}

function handleCreate(event) {
  if (!event.mint) return;

  const added = addMintAddress(event.mint);
  if (!added) return;

  log("token_created", {
    mint: event.mint,
    type: event.type,
    name: event.name,
    symbol: event.symbol,
    uri: event.uri,
    creator: event.creator,
    bondingCurve: event.bondingCurve,
    user: event.user,
    signature: event.signature,
    slot: event.slot,
    watchlistSize: storeState.mintAddresses.length,
  });
  console.log(storeState.mintAddresses);

}

async function main() {
  const stream = await client.subscribe();

  stream.on("data", (data) => {
    if (!data.transaction) return;

    const txInfo = data.transaction.transaction;
    if (!txInfo?.transaction?.message) return;

    const txData = grpcTxToParserFormat(data);
    const creates = parseTxData(txData, PUMPFUN_PROGRAM_ID).filter(isCreateEvent);

    for (const event of creates) {
      handleCreate(event);
    }
  });

  stream.on("error", (error) => {
    log("stream_error", { message: error.message || String(error) });
  });

  stream.write({
    accounts: {},
    slots: {},
    transactions: {
      pumpfun: {
        vote: false,
        failed: false,
        accountInclude: [PUMPFUN_PROGRAM_ID],
        accountExclude: [],
        accountRequired: [],
      },
    },
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    accountsDataSlice: [],
    commitment: CommitmentLevel.PROCESSED,
  });

  log("listening", {
    program: PUMPFUN_PROGRAM_ID,
    filter: "create_only",
  });
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
