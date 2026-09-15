/// <reference lib="webworker" />
import { transfer } from "comlink";

import { ChunkNeighborhood, ChunkSize } from "./chunk/ChunkData";
import { ChunkEdits } from "./chunk/lighting";
import { ChunkMesh, meshChunk } from "./chunk/mesher";
import { generateChunkData } from "./terrain/generator";
import { WorldParams } from "./WorldParams";

export const generateChunk = (
  size: ChunkSize,
  params: WorldParams,
  chunkX: number,
  chunkZ: number
): Uint8Array => {
  const data = generateChunkData(size, params, chunkX, chunkZ);
  return transfer(data, [data.buffer]);
};

export const buildChunkMesh = (
  size: ChunkSize,
  neighborhood: ChunkNeighborhood,
  edits?: ChunkEdits
): ChunkMesh => {
  const mesh = meshChunk(size, neighborhood, edits);
  const buffers = [mesh.opaque, mesh.cutout, mesh.translucent].flatMap((m) => [
    m.positions.buffer,
    m.uvs.buffer,
    m.layers.buffer,
    m.flags.buffer,
    m.lights.buffer,
    m.indices.buffer,
  ]);
  return transfer(mesh, buffers);
};
