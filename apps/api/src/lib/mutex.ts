/** Serializa chamadas assincronas: cada uma so comeca depois que a anterior termina (sucesso ou erro). */
export function createMutex() {
  let queue: Promise<unknown> = Promise.resolve();
  return function lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn);
    queue = run;
    return run;
  };
}
