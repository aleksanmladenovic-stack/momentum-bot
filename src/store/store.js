const storeState = {
  mintAddresses: [],
};

/** Add a mint once when a new token is created. Returns true if newly added. */
export function addMintAddress(mint) {
  if (!mint || storeState.mintAddresses.includes(mint)) return false;
  storeState.mintAddresses.push(mint);
  return true;
}

export default storeState;
