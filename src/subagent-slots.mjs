/** Creates a first-come queue that lets at most `limit` holders run at once; release passes a slot straight to the next waiter. */
export function createSlots(limit) {
  const waiting = [];
  const holders = new Set();
  return {
    async acquire(holderID) {
      if (holders.size < limit) holders.add(holderID);
      else await new Promise((resolve) => waiting.push({ holderID, resolve }));
    },
    release(holderID) {
      if (!holders.delete(holderID)) return;
      const next = waiting.shift();
      if (!next) return;
      holders.add(next.holderID);
      next.resolve();
    },
  };
}
