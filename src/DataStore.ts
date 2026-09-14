import { BlockID } from "./Block";

/** One packed edit: block index within the chunk in the high bits, id below */
const ID_BITS = 8;

/**
 * Player edits to the generated world, grouped per chunk and keyed by the
 * block's index within that chunk. Chunks touched since the last `takeDirty`
 * are tracked so persistence only rewrites what changed.
 */
export class DataStore {
  private chunks = new Map<string, Map<number, BlockID>>();
  private dirty = new Set<string>();

  static key(chunkX: number, chunkZ: number) {
    return `${chunkX},${chunkZ}`;
  }

  clear() {
    this.chunks.clear();
    this.dirty.clear();
  }

  /** Edits of a chunk (block index -> id), or undefined when it has none */
  getChunk(chunkX: number, chunkZ: number) {
    return this.chunks.get(DataStore.key(chunkX, chunkZ));
  }

  set(chunkX: number, chunkZ: number, index: number, value: BlockID) {
    const key = DataStore.key(chunkX, chunkZ);
    let edits = this.chunks.get(key);
    if (!edits) {
      edits = new Map();
      this.chunks.set(key, edits);
    }
    edits.set(index, value);
    this.dirty.add(key);
  }

  get editCount() {
    let n = 0;
    for (const edits of this.chunks.values()) n += edits.size;
    return n;
  }

  get hasDirty() {
    return this.dirty.size > 0;
  }

  /** Packed edits of every chunk changed since the last call */
  takeDirty(): [string, Uint32Array][] {
    const out: [string, Uint32Array][] = [];
    for (const key of this.dirty) {
      out.push([key, this.pack(this.chunks.get(key))]);
    }
    this.dirty.clear();
    return out;
  }

  /** Replaces all edits with previously packed chunks */
  load(saved: Map<string, Uint32Array>) {
    this.clear();
    for (const [key, packed] of saved) {
      const edits = new Map<number, BlockID>();
      for (const v of packed) {
        edits.set(v >>> ID_BITS, (v & ((1 << ID_BITS) - 1)) as BlockID);
      }
      this.chunks.set(key, edits);
    }
  }

  private pack(edits: Map<number, BlockID> | undefined): Uint32Array {
    if (!edits) return new Uint32Array(0);
    const out = new Uint32Array(edits.size);
    let i = 0;
    for (const [index, id] of edits) out[i++] = (index << ID_BITS) | id;
    return out;
  }
}
