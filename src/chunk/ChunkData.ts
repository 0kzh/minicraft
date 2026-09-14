import { BlockID } from "../Block";

export type ChunkSize = {
  width: number;
  height: number;
};

/**
 * Chunk voxel storage: one byte per block, laid out x-fastest, then z, then y.
 */
export const blockIndex = (
  size: ChunkSize,
  x: number,
  y: number,
  z: number
): number => (y * size.width + z) * size.width + x;

export const chunkVolume = (size: ChunkSize): number =>
  size.width * size.width * size.height;

export const createChunkData = (size: ChunkSize): Uint8Array =>
  new Uint8Array(chunkVolume(size));

export const inChunkBounds = (
  size: ChunkSize,
  x: number,
  y: number,
  z: number
): boolean =>
  x >= 0 &&
  x < size.width &&
  y >= 0 &&
  y < size.height &&
  z >= 0 &&
  z < size.width;

export const getBlock = (
  data: Uint8Array,
  size: ChunkSize,
  x: number,
  y: number,
  z: number
): BlockID =>
  inChunkBounds(size, x, y, z) ? data[blockIndex(size, x, y, z)] : BlockID.Air;

export const setBlock = (
  data: Uint8Array,
  size: ChunkSize,
  x: number,
  y: number,
  z: number,
  id: BlockID
) => {
  if (inChunkBounds(size, x, y, z)) {
    data[blockIndex(size, x, y, z)] = id;
  }
};

/**
 * Voxel data of a chunk and its eight horizontal neighbours (null if
 * unloaded), indexed by neighborIndex(dx, dz). The centre chunk is never null.
 */
export type ChunkNeighborhood = {
  chunks: (Uint8Array | null)[];
};

export const NEIGHBORHOOD_CENTER = 4;

export const neighborIndex = (dx: number, dz: number): number =>
  (dz + 1) * 3 + (dx + 1);

/** Offsets of the eight horizontal neighbours as [dx, dz] */
export const NEIGHBOR_OFFSETS: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];
