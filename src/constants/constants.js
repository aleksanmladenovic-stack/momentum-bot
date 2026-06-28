import dotenv from "dotenv";

dotenv.config();

export const MORALIS_API_KEY = process.env.MORALIS_API_KEY;
export const RPCURL = process.env.RPC_URL;
export const COMMITMENT = process.env.COMMITMENT;

export const GRPC_URL = process.env.GRPC_URL;
export const GRPC_X_TOKEN = process.env.GRPC_X_TOKEN;
export const PUMPFUN_PROGRAM_ID = process.env.PUMPFUN_PROGRAM_ID;
export const SOL_MINT = process.env.SOL_MINT;
export const RPC_URL_WS = process.env.RPC_URL_WS;