/// <reference lib="webworker" />
import * as THREE from "three";
import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise";

import { BlockID, oreConfig } from "./Block";
import { RNG } from "./RNG";
import { WorldParams, WorldSize } from "./WorldChunk";

declare const self: DedicatedWorkerGlobalScope;

export const generateChunk = async (
  chunkSize: WorldSize,
  params: WorldParams,
  x: number,
  z: number
) => {
  const chunkPos = new THREE.Vector3(x, 0, z);
  let data = initEmptyChunk(chunkSize);
  data = generateResources(new RNG(params.seed), data, chunkSize, chunkPos);
  data = generateTerrain(
    new RNG(params.seed),
    data,
    chunkSize,
    params,
    chunkPos
  );

  return data;
};

const initEmptyChunk = (chunkSize: WorldSize) => {
  const data = new Array(chunkSize.width);
  for (let x = 0; x < chunkSize.width; x++) {
    data[x] = new Array(chunkSize.height);
    for (let y = 0; y < chunkSize.height; y++) {
      data[x][y] = new Array(chunkSize.width);
      for (let z = 0; z < chunkSize.width; z++) {
        data[x][y][z] = BlockID.Air;
      }
    }
  }
  return data;
};

/**
 * Generates the resources (coal, stone, etc.) for the world
 */
export const generateResources = (
  rng: RNG,
  input: BlockID[][][],
  size: WorldSize,
  chunkPos: THREE.Vector3
): BlockID[][][] => {
  const simplex = new SimplexNoise(rng);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const [_, config] of Object.entries(oreConfig)) {
    for (let x = 0; x < size.width; x++) {
      for (let y = 0; y < size.height; y++) {
        for (let z = 0; z < size.width; z++) {
          const value = simplex.noise3d(
            (chunkPos.x + x) / config.scale.x,
            (chunkPos.y + y) / config.scale.y,
            (chunkPos.z + z) / config.scale.z
          );

          if (value > config.scarcity) {
            input[x][y][z] = config.id;
          }
        }
      }
    }
  }

  return input;
};

/**
 * Generates the terrain data
 */
export const generateTerrain = (
  rng: RNG,
  input: BlockID[][][],
  size: WorldSize,
  params: WorldParams,
  chunkPos: THREE.Vector3
): BlockID[][][] => {
  const simplex = new SimplexNoise(rng);
  for (let x = 0; x < size.width; x++) {
    for (let z = 0; z < size.width; z++) {
      const value = simplex.noise(
        (chunkPos.x + x) / params.terrain.scale,
        (chunkPos.z + z) / params.terrain.scale
      );

      const scaledNoise =
        params.terrain.offset + params.terrain.magnitude * value;

      let height = Math.floor(size.height * scaledNoise);
      height = Math.max(0, Math.min(height, size.height - 1));

      const numSurfaceBlocks =
        params.surface.offset +
        Math.abs(simplex.noise(x, z) * params.surface.magnitude);

      const numBedrockBlocks =
        params.bedrock.offset +
        Math.abs(simplex.noise(x, z) * params.bedrock.magnitude);

      for (let y = 0; y < size.height; y++) {
        if (y < height) {
          if (y < numBedrockBlocks) {
            input[x][y][z] = BlockID.Bedrock;
          } else if (y < height - numSurfaceBlocks) {
            if (input[x][y][z] === BlockID.Air) {
              input[x][y][z] = BlockID.Stone;
            }
          } else {
            input[x][y][z] = BlockID.Dirt;
          }
        } else if (y === height) {
          input[x][y][z] = BlockID.Grass;
        } else if (y > height) {
          input[x][y][z] = BlockID.Air;
        }
      }
    }
  }

  return input;
};
