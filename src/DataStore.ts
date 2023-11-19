import { BlockID } from "./Block";

export class DataStore {
  data: Record<string, BlockID>;

  constructor() {
    this.data = {};
  }

  clear() {
    this.data = {};
  }

  contains(
    chunkX: number,
    chunkZ: number,
    blockX: number,
    blockY: number,
    blockZ: number
  ) {
    const key = this.#getKey(chunkX, chunkZ, blockX, blockY, blockZ);
    return this.data[key] !== undefined;
  }

  get(
    chunkX: number,
    chunkZ: number,
    blockX: number,
    blockY: number,
    blockZ: number
  ) {
    const key = this.#getKey(chunkX, chunkZ, blockX, blockY, blockZ);
    const blockId = this.data[key];
    console.log(`getting value ${blockId} at key ${key}`);
    return blockId;
  }

  set(
    chunkX: number,
    chunkZ: number,
    blockX: number,
    blockY: number,
    blockZ: number,
    value: BlockID
  ) {
    const key = this.#getKey(chunkX, chunkZ, blockX, blockY, blockZ);
    console.log(`setting value ${value} at key ${key}`);
    this.data[key] = value;
  }

  #getKey(
    chunkX: number,
    chunkZ: number,
    blockX: number,
    blockY: number,
    blockZ: number
  ) {
    return `${chunkX},${chunkZ},${blockX},${blockY},${blockZ}`;
  }
}
