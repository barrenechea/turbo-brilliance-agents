type Waiter = { holderID: string; resolve: () => void };

type Slots = {
  acquire(holderID: string): Promise<void>;
  release(holderID: string): void;
};

/** Creates a first-come queue that lets at most `limit` holders run at once; release passes a slot straight to the next waiter. */
export function createSlots(limit: number): Slots {
  const waiting: Waiter[] = [];
  const holders = new Set<string>();
  return {
    async acquire(holderID) {
      if (holders.size < limit) holders.add(holderID);
      else
        await new Promise<void>((resolve) =>
          waiting.push({ holderID, resolve }),
        );
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
