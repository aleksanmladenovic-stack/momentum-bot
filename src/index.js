import {
  fetchSolPriceUsd,
  fetchDexPair,
  fetchHolders,
} from "./lib/market-data.js";

// const res = await fetchSolPriceUsd();
// console.log(res);

// const res = await fetchDexPair("382YojVQdcb5DV1QCj1KdN4XPVZebS22XAfDr1EMpump");
// console.log(res);

const res = await fetchHolders("CKLYeqdriFdYGLMVN3pUqt874du6HBcApBnjrddopump");
console.log(res);
