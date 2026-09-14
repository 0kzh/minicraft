import type { Remote } from "comlink";

type ChunkWorkerApi = typeof import("./chunkWorker");

type PooledWorker = {
  api: Remote<ChunkWorkerApi>;
  busy: number;
};

/**
 * Pool of chunk workers. Jobs are dispatched to the least busy worker.
 */
export class WorkerPool {
  private workers: PooledWorker[] = [];
  private pending = 0;

  constructor(size = WorkerPool.defaultSize()) {
    for (let i = 0; i < size; i++) {
      this.workers.push({
        api: new ComlinkWorker<ChunkWorkerApi>(
          new URL("./chunkWorker", import.meta.url)
        ),
        busy: 0,
      });
    }
  }

  static defaultSize() {
    const cores = navigator.hardwareConcurrency || 4;
    return Math.max(1, Math.min(8, cores - 1));
  }

  get size() {
    return this.workers.length;
  }

  /** Number of jobs currently in flight */
  get inFlight() {
    return this.pending;
  }

  async run<T>(job: (api: Remote<ChunkWorkerApi>) => Promise<T>): Promise<T> {
    let worker = this.workers[0];
    for (const w of this.workers) {
      if (w.busy < worker.busy) worker = w;
    }
    worker.busy++;
    this.pending++;
    try {
      return await job(worker.api);
    } finally {
      worker.busy--;
      this.pending--;
    }
  }
}
