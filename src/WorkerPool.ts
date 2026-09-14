import type { Remote } from "comlink";

type ChunkWorkerApi = typeof import("./chunkWorker");

type PooledWorker = {
  api: Remote<ChunkWorkerApi>;
  busy: number;
};

/**
 * Pool of chunk workers. Jobs are dispatched to the least busy worker.
 *
 * One worker is reserved for interactive jobs (remeshing after a player
 * edit) so they never queue behind bulk terrain generation; background jobs
 * only fall back to it when the pool has a single worker.
 */
export class WorkerPool {
  private workers: PooledWorker[] = [];
  private pending = 0;
  private static readonly INTERACTIVE = 0;

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
    return Math.max(2, Math.min(8, cores - 1));
  }

  /** Number of workers available to background jobs */
  get size() {
    return Math.max(1, this.workers.length - 1);
  }

  /** Number of jobs currently in flight */
  get inFlight() {
    return this.pending;
  }

  async run<T>(
    job: (api: Remote<ChunkWorkerApi>) => Promise<T>,
    interactive = false
  ): Promise<T> {
    let worker = this.workers[WorkerPool.INTERACTIVE];
    if (!interactive) {
      const first = this.workers.length > 1 ? 1 : 0;
      worker = this.workers[first];
      for (let i = first; i < this.workers.length; i++) {
        if (this.workers[i].busy < worker.busy) worker = this.workers[i];
      }
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
