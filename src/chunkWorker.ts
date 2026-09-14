/// <reference lib="webworker" />
import { transfer } from "comlink";
import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise";

import { BlockID, oreConfig } from "./Block";
import {
  blockIndex,
  ChunkNeighborhood,
  ChunkSize,
  createChunkData,
  getBlock,
  setBlock,
} from "./chunk/ChunkData";
import { ChunkMesh, meshChunk } from "./chunk/mesher";
import { RNG } from "./RNG";
import { WorldParams } from "./WorldParams";

type GenContext = {
  size: ChunkSize;
  params: WorldParams;
  /** World-space origin of the chunk */
  originX: number;
  originZ: number;
  /** Noise seeded from the world seed; continuous across chunks */
  noise: SimplexNoise;
  /** Per-chunk random stream for decorations */
  rng: RNG;
};

const noiseCache = new Map<number, SimplexNoise>();
const worldNoise = (seed: number) => {
  let noise = noiseCache.get(seed);
  if (!noise) {
    noise = new SimplexNoise(new RNG(seed));
    noiseCache.set(seed, noise);
  }
  return noise;
};

const hashChunkSeed = (seed: number, cx: number, cz: number) => {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (cx | 0), 0x85ebca6b);
  h = Math.imul(h ^ (cz | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  return h | 0;
};

export const generateChunk = (
  size: ChunkSize,
  params: WorldParams,
  chunkX: number,
  chunkZ: number
): Uint8Array => {
  const data = createChunkData(size);
  const ctx: GenContext = {
    size,
    params,
    originX: chunkX * size.width,
    originZ: chunkZ * size.width,
    noise: worldNoise(params.seed),
    rng: new RNG(hashChunkSeed(params.seed, chunkX, chunkZ)),
  };

  generateResources(ctx, data);
  generateTerrain(ctx, data);
  generateTrees(ctx, data);
  generateTallGrass(ctx, data);
  generateFlowers(ctx, data);

  return transfer(data, [data.buffer]);
};

export const buildChunkMesh = (
  size: ChunkSize,
  neighborhood: ChunkNeighborhood
): ChunkMesh => {
  const mesh = meshChunk(size, neighborhood);
  const buffers = [mesh.opaque, mesh.cutout].flatMap((m) => [
    m.positions.buffer,
    m.uvs.buffer,
    m.layers.buffer,
    m.flags.buffer,
    m.indices.buffer,
  ]);
  return transfer(mesh, buffers);
};

/**
 * Generates the resources (coal, iron, etc.) for the chunk
 */
const generateResources = (ctx: GenContext, data: Uint8Array) => {
  const { size, noise, originX, originZ } = ctx;
  for (const config of Object.values(oreConfig)) {
    for (let y = 0; y < size.height; y++) {
      for (let z = 0; z < size.width; z++) {
        for (let x = 0; x < size.width; x++) {
          const value = noise.noise3d(
            (originX + x) / config.scale.x,
            y / config.scale.y,
            (originZ + z) / config.scale.z
          );
          if (value > config.scarcity) {
            data[blockIndex(size, x, y, z)] = config.id;
          }
        }
      }
    }
  }
};

/**
 * Generates the terrain heightmap and fills in bedrock, stone, dirt and grass
 */
const generateTerrain = (ctx: GenContext, data: Uint8Array) => {
  const { size, params, noise, originX, originZ } = ctx;
  for (let z = 0; z < size.width; z++) {
    for (let x = 0; x < size.width; x++) {
      const wx = originX + x;
      const wz = originZ + z;
      const value = noise.noise(
        wx / params.terrain.scale,
        wz / params.terrain.scale
      );
      const scaledNoise =
        params.terrain.offset + params.terrain.magnitude * value;

      let height = Math.floor(size.height * scaledNoise);
      height = Math.max(0, Math.min(height, size.height - 1));

      const numSurfaceBlocks =
        params.surface.offset +
        Math.abs(noise.noise(wx, wz) * params.surface.magnitude);
      const numBedrockBlocks =
        params.bedrock.offset +
        Math.abs(noise.noise(wx, wz) * params.bedrock.magnitude);

      for (let y = 0; y < size.height; y++) {
        const i = blockIndex(size, x, y, z);
        if (y < height) {
          if (y < numBedrockBlocks) {
            data[i] = BlockID.Bedrock;
          } else if (y < height - numSurfaceBlocks) {
            if (data[i] === BlockID.Air) {
              data[i] = BlockID.Stone;
            }
          } else {
            data[i] = BlockID.Dirt;
          }
        } else if (y === height) {
          data[i] = BlockID.Grass;
        } else {
          data[i] = BlockID.Air;
        }
      }
    }
  }
};

/**
 * Generates trees
 */
const generateTrees = (ctx: GenContext, data: Uint8Array) => {
  const { size, params, noise, rng, originX, originZ } = ctx;
  const canopySize = params.trees.canopy.size.max;
  for (let baseX = canopySize; baseX < size.width - canopySize; baseX++) {
    for (let baseZ = canopySize; baseZ < size.width - canopySize; baseZ++) {
      const n = noise.noise(originX + baseX, originZ + baseZ) * 0.5 + 0.5;
      if (n < 1 - params.trees.frequency) {
        continue;
      }

      // Find the grass tile
      for (let y = size.height - 1; y >= 0; y--) {
        if (getBlock(data, size, baseX, y, baseZ) !== BlockID.Grass) {
          continue;
        }

        const baseY = y + 1;
        const minH = params.trees.trunkHeight.min;
        const maxH = params.trees.trunkHeight.max;
        const trunkHeight = Math.round(rng.random() * (maxH - minH)) + minH;
        const topY = baseY + trunkHeight;

        for (let i = baseY; i < topY; i++) {
          setBlock(data, size, baseX, i, baseZ, BlockID.OakLog);
        }

        const leafIfAir = (x: number, ly: number, z: number) => {
          if (getBlock(data, size, x, ly, z) === BlockID.Air) {
            setBlock(data, size, x, ly, z, BlockID.Leaves);
          }
        };
        const plus = (ly: number) => {
          setBlock(data, size, baseX, ly, baseZ, BlockID.Leaves);
          setBlock(data, size, baseX + 1, ly, baseZ, BlockID.Leaves);
          setBlock(data, size, baseX - 1, ly, baseZ, BlockID.Leaves);
          setBlock(data, size, baseX, ly, baseZ + 1, BlockID.Leaves);
          setBlock(data, size, baseX, ly, baseZ - 1, BlockID.Leaves);
        };

        // Canopy is generated in 4 layers from the top down
        for (let i = 0; i < 4; i++) {
          const ly = topY - i;
          if (i === 0) {
            plus(ly);
          } else if (i === 1) {
            plus(ly);
            const minR = params.trees.canopy.size.min;
            const maxR = params.trees.canopy.size.max;
            const R = Math.round(rng.random() * (maxR - minR)) + minR;
            for (let x = -R; x <= R; x++) {
              for (let z = -R; z <= R; z++) {
                if (x * x + z * z > R * R) continue;
                if (rng.random() > 0.5) {
                  leafIfAir(baseX + x, ly, baseZ + z);
                }
              }
            }
          } else {
            for (let x = -2; x <= 2; x++) {
              for (let z = -2; z <= 2; z++) {
                leafIfAir(baseX + x, ly, baseZ + z);
              }
            }
            for (const x of [-2, 2]) {
              for (const z of [-2, 2]) {
                if (rng.random() > 0.5) {
                  setBlock(data, size, baseX + x, ly, baseZ + z, BlockID.Air);
                }
              }
            }
          }
        }
        break;
      }
    }
  }
};

/**
 * Finds the y of the topmost grass block in a column that is not under leaves
 */
const findOpenGrass = (
  data: Uint8Array,
  size: ChunkSize,
  x: number,
  z: number
): number => {
  for (let y = size.height - 1; y >= 0; y--) {
    const id = getBlock(data, size, x, y, z);
    if (id === BlockID.Leaves) return -1;
    if (id === BlockID.Grass) {
      return getBlock(data, size, x, y + 1, z) === BlockID.Air ? y : -1;
    }
  }
  return -1;
};

/**
 * Generate random patches of tall grass across the top surface
 */
const generateTallGrass = (ctx: GenContext, data: Uint8Array) => {
  const { size, params, rng } = ctx;
  for (let z = 0; z < size.width; z++) {
    for (let x = 0; x < size.width; x++) {
      const y = findOpenGrass(data, size, x, z);
      if (y < 0 || rng.random() >= params.grass.frequency) continue;

      const baseY = y + 1;
      setBlock(data, size, x, baseY, z, BlockID.TallGrass);

      // Random walk outwards from the seed block
      let currentX = x;
      let currentZ = z;
      for (let i = 0; i < params.grass.patchSize; i++) {
        const direction = rng.random() * 2 * Math.PI;
        currentX += Math.round(Math.cos(direction));
        currentZ += Math.round(Math.sin(direction));
        if (
          getBlock(data, size, currentX, baseY, currentZ) === BlockID.Air &&
          getBlock(data, size, currentX, y, currentZ) === BlockID.Grass
        ) {
          setBlock(data, size, currentX, baseY, currentZ, BlockID.TallGrass);
        }
      }
    }
  }
};

/**
 * Generate flowers on open grass away from tall grass patches
 */
const generateFlowers = (ctx: GenContext, data: Uint8Array) => {
  const { size, params, rng } = ctx;
  for (let z = 0; z < size.width; z++) {
    for (let x = 0; x < size.width; x++) {
      const y = findOpenGrass(data, size, x, z);
      if (y < 0) continue;
      const baseY = y + 1;

      let isTallGrassNearby = false;
      for (let dx = -3; dx <= 3 && !isTallGrassNearby; dx++) {
        for (let dz = -3; dz <= 3; dz++) {
          if (
            getBlock(data, size, x + dx, baseY, z + dz) === BlockID.TallGrass
          ) {
            isTallGrassNearby = true;
            break;
          }
        }
      }
      if (isTallGrassNearby) continue;

      const flowerId =
        rng.random() < 0.5 ? BlockID.FlowerDandelion : BlockID.FlowerRose;
      if (rng.random() < params.flowers.frequency) {
        setBlock(data, size, x, baseY, z, flowerId);
      }
    }
  }
};
