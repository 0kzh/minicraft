/** Camera state restored on the next visit */
export type SavedPlayer = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
};

export type GameMode = "survival" | "creative";

export type SavedStack = { id: number; count: number };

/** Survival progress, kept even while playing the same world in creative */
export type SavedSurvival = {
  health: number;
  inventory: (SavedStack | null)[];
};

export type WorldMeta = {
  version: number;
  seed: number;
  createdAt: number;
  updatedAt: number;
  player?: SavedPlayer;
  mode?: GameMode;
  survival?: SavedSurvival;
};

const RENDER_DISTANCE_KEY = "minicraft.renderDistance";

/** Render distance is a client preference, so it lives outside the world save */
export function loadRenderDistance(fallback: number): number {
  try {
    const v = Number(localStorage.getItem(RENDER_DISTANCE_KEY));
    return Number.isInteger(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

export function saveRenderDistance(value: number) {
  try {
    localStorage.setItem(RENDER_DISTANCE_KEY, String(value));
  } catch {
    // Storage unavailable (private mode, quota); the setting just won't stick
  }
}

/** Bump when the generator changes enough that old edits no longer line up */
export const SAVE_VERSION = 1;

const DB_NAME = "minicraft";
const META_STORE = "meta";
const CHUNK_STORE = "chunks";
const META_KEY = "world";

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

/**
 * IndexedDB persistence for the single local world: metadata (seed, player)
 * plus one record of packed block edits per chunk. All methods resolve even
 * when storage is unavailable so the game keeps working without saves.
 */
export class WorldStorage {
  private constructor(private readonly db: IDBDatabase | null) {}

  static async open(): Promise<WorldStorage> {
    if (typeof indexedDB === "undefined") return new WorldStorage(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE);
        }
        if (!db.objectStoreNames.contains(CHUNK_STORE)) {
          db.createObjectStore(CHUNK_STORE);
        }
      };
      return new WorldStorage(await request(req));
    } catch (e) {
      console.warn("World storage unavailable, progress will not be saved", e);
      return new WorldStorage(null);
    }
  }

  get available() {
    return this.db !== null;
  }

  async loadMeta(): Promise<WorldMeta | null> {
    if (!this.db) return null;
    try {
      const tx = this.db.transaction(META_STORE, "readonly");
      const meta = await request<unknown>(
        tx.objectStore(META_STORE).get(META_KEY)
      );
      return isWorldMeta(meta) ? meta : null;
    } catch (e) {
      console.warn("Failed to load world metadata", e);
      return null;
    }
  }

  async saveMeta(meta: WorldMeta): Promise<void> {
    if (!this.db) return;
    try {
      const tx = this.db.transaction(META_STORE, "readwrite");
      tx.objectStore(META_STORE).put(meta, META_KEY);
      await done(tx);
    } catch (e) {
      console.warn("Failed to save world metadata", e);
    }
  }

  /** Every saved chunk's packed edits keyed by "chunkX,chunkZ" */
  async loadChunks(): Promise<Map<string, Uint32Array>> {
    const out = new Map<string, Uint32Array>();
    if (!this.db) return out;
    try {
      const tx = this.db.transaction(CHUNK_STORE, "readonly");
      const store = tx.objectStore(CHUNK_STORE);
      const [keys, values] = await Promise.all([
        request(store.getAllKeys()),
        request<unknown[]>(store.getAll()),
      ]);
      keys.forEach((k, i) => {
        const v = values[i];
        if (typeof k === "string" && v instanceof Uint32Array) out.set(k, v);
      });
    } catch (e) {
      console.warn("Failed to load saved chunks", e);
    }
    return out;
  }

  async saveChunks(chunks: Iterable<[string, Uint32Array]>): Promise<void> {
    if (!this.db) return;
    try {
      const tx = this.db.transaction(CHUNK_STORE, "readwrite");
      const store = tx.objectStore(CHUNK_STORE);
      for (const [key, edits] of chunks) {
        if (edits.length === 0) store.delete(key);
        else store.put(edits, key);
      }
      await done(tx);
    } catch (e) {
      console.warn("Failed to save chunks", e);
    }
  }

  async clear(): Promise<void> {
    if (!this.db) return;
    try {
      const tx = this.db.transaction([META_STORE, CHUNK_STORE], "readwrite");
      tx.objectStore(META_STORE).clear();
      tx.objectStore(CHUNK_STORE).clear();
      await done(tx);
    } catch (e) {
      console.warn("Failed to clear world storage", e);
    }
  }
}

const isWorldMeta = (v: unknown): v is WorldMeta => {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  return (
    m.version === SAVE_VERSION &&
    typeof m.seed === "number" &&
    Number.isFinite(m.seed)
  );
};

/** A fresh 31-bit seed, shown to the player so worlds can be shared */
export const randomSeed = (): number => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] >>> 1;
};
