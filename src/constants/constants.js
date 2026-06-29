import dotenv from "dotenv";

dotenv.config();

export const MORALIS_API_KEY = process.env.MORALIS_API_KEY;
export const RPCURL = process.env.RPC_URL;
export const EXECUTOR_RPC_URL =
  process.env.EXECUTOR_RPC_URL || process.env.RPC_URL;
export const COMMITMENT = process.env.COMMITMENT;
export const PRIVATE_KEY = process.env.PRIVATE_KEY;

export const GRPC_URL = process.env.GRPC_URL;
export const GRPC_X_TOKEN = process.env.GRPC_X_TOKEN;
export const PUMPFUN_PROGRAM_ID = process.env.PUMPFUN_PROGRAM_ID;
export const SOL_MINT = process.env.SOL_MINT;
export const RPC_URL_WS = process.env.RPC_URL_WS;

export const executeTrades = process.env.EXECUTE_TRADES === "true";
export const tradeSol = process.env.TRADE_SOL;
export const slippagePct = process.env.SLIPPAGE_PCT;
export const priorityFeeMicrolamports = process.env.PRIORITY_FEE_MICROLAMPORTS;
export const computeUnitLimit = process.env.COMPUTE_UNIT_LIMIT;
export const blockhashRefreshMs = process.env.BLOCKHASH_REFRESH_MS;

export const host = process.env.PG_HOST;
export const port = process.env.PG_PORT;
export const username = process.env.PG_USERNAME;
export const password = process.env.PG_PASSWORD;
export const database = process.env.PG_DB;
