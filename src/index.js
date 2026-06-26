import {
  fetchSolPriceUsd,
  fetchDexPair,
  fetchHolders,
  fetchMarketSnapshot,
  fetchMarketCapFromSupply,
} from "./lib/market-data.js";
import { pollMint } from "./scripts/poll-scanner.js";
// import { pollMint } from "./scripts/poll-scanner.js";
// const pUSD = await fetchSolPriceUsd();

// const res = await fetchDexPair("382YojVQdcb5DV1QCj1KdN4XPVZebS22XAfDr1EMpump");
// console.log(res);

// const res = await fetchHolders("CKLYeqdriFdYGLMVN3pUqt874du6HBcApBnjrddopump");
// console.log(res);

// const res = await fetchMarketSnapshot(
//   "CKLYeqdriFdYGLMVN3pUqt874du6HBcApBnjrddopump",
// );
// console.log(res);

// const res = await fetchMarketCapFromSupply(
//   "CKLYeqdriFdYGLMVN3pUqt874du6HBcApBnjrddopump",
//   pUSD,
// );
// console.log(res);
const res = pollMint("9Cn7or8TVicZYjSUEmgRk4A9XdXFzkBS8vn1ebt6pump");
console.log(res);
