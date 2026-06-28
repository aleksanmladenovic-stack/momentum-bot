import dotenv from "dotenv";

dotenv.config();

export const MORALIS_API_KEY = process.env.MORALIS_API_KEY;
export const RPCURL = process.env.RPC_URL;
export const COMMITMENT = process.env.COMMITMENT;
export const PRIVATE_KEY = process.env.PRIVATE_KEY;

export const GRPC_URL = process.env.GRPC_URL;
export const GRPC_X_TOKEN = process.env.GRPC_X_TOKEN;
export const PUMPFUN_PROGRAM_ID = process.env.PUMPFUN_PROGRAM_ID;
export const SOL_MINT = process.env.SOL_MINT;
export const RPC_URL_WS = process.env.RPC_URL_WS;

export const EXECUTE_TRADES = process.env.EXECUTE_TRADES === "true";
export const TRADE_SOL = process.env.TRADE_SOL;
export const SLIPPAGE_PCT = process.env.SLIPPAGE_PCT;
export const PRIORITY_FEE_MICROLAMPORTS = process.env.PRIORITY_FEE_MICROLAMPORTS;
export const COMPUTE_UNIT_LIMIT = process.env.COMPUTE_UNIT_LIMIT;
export const BLOCKHASH_REFRESH_MS = process.env.BLOCKHASH_REFRESH_MS;