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
  const rng = new RNG(params.seed);
  data = generateResources(rng, data, chunkSize, chunkPos);
  data = generateTerrain(rng, data, chunkSize, params, chunkPos);
  data = generateTrees(rng, data, chunkSize, params, chunkPos);
  data = generateTallGrass(rng, data, chunkSize, params, chunkPos);

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

/**
 * Generates trees
 */
export const generateTrees = (
  rng: RNG,
  input: BlockID[][][],
  size: WorldSize,
  params: WorldParams,
  chunkPos: THREE.Vector3
): BlockID[][][] => {
  const simplex = new SimplexNoise(rng);
  const canopySize = params.trees.canopy.size.max;
  for (let baseX = canopySize; baseX < size.width - canopySize; baseX++) {
    for (let baseZ = canopySize; baseZ < size.width - canopySize; baseZ++) {
      const n =
        simplex.noise(chunkPos.x + baseX, chunkPos.z + baseZ) * 0.5 + 0.5;
      if (n < 1 - params.trees.frequency) {
        continue;
      }

      // Find the grass tile
      for (let y = size.height - 1; y >= 0; y--) {
        if (input[baseX][y][baseZ] !== BlockID.Grass) {
          continue;
        }

        // Found grass, move one time up
        const baseY = y + 1;

        const minH = params.trees.trunkHeight.min;
        const maxH = params.trees.trunkHeight.max;
        const trunkHeight = Math.round(rng.random() * (maxH - minH)) + minH;
        const topY = baseY + trunkHeight;

        // Fill in blocks for the trunk
        for (let i = baseY; i < topY; i++) {
          input[baseX][i][baseZ] = BlockID.OakLog;
        }

        // Generate the canopy
        // generate layer by layer, 4 layers in total
        for (let i = 0; i < 4; i++) {
          if (i === 0) {
            // first layer above the height of tree and has 5 leaves in a + shape
            input[baseX][topY][baseZ] = BlockID.Leaves;
            input[baseX + 1][topY][baseZ] = BlockID.Leaves;
            input[baseX - 1][topY][baseZ] = BlockID.Leaves;
            input[baseX][topY][baseZ + 1] = BlockID.Leaves;
            input[baseX][topY][baseZ - 1] = BlockID.Leaves;
          } else if (i === 1) {
            // base layer
            input[baseX][topY - i][baseZ] = BlockID.Leaves;
            input[baseX + 1][topY - i][baseZ] = BlockID.Leaves;
            input[baseX - 1][topY - i][baseZ] = BlockID.Leaves;
            input[baseX][topY - i][baseZ + 1] = BlockID.Leaves;
            input[baseX][topY - i][baseZ - 1] = BlockID.Leaves;

            // diagonal leaf blocks grow min of 1 and max of 3 blocks away from the trunk
            const minR = params.trees.canopy.size.min;
            const maxR = params.trees.canopy.size.max;
            const R = Math.round(rng.random() * (maxR - minR)) + minR;

            // grow leaves in a diagonal shape
            for (let x = -R; x <= R; x++) {
              for (let z = -R; z <= R; z++) {
                if (x * x + z * z > R * R) {
                  continue;
                }

                if (input[baseX + x][topY - i][baseZ + z] !== BlockID.Air) {
                  continue;
                }

                if (rng.random() > 0.5) {
                  input[baseX + x][topY - i][baseZ + z] = BlockID.Leaves;
                }
              }
            }
          } else if (i === 2 || i == 3) {
            for (let x = -2; x <= 2; x++) {
              for (let z = -2; z <= 2; z++) {
                if (input[baseX + x][topY - i][baseZ + z] !== BlockID.Air) {
                  continue;
                }

                input[baseX + x][topY - i][baseZ + z] = BlockID.Leaves;
              }
            }

            // remove 4 corners randomly
            for (const x of [-2, 2]) {
              for (const z of [-2, 2]) {
                if (rng.random() > 0.5) {
                  input[baseX + x][topY - i][baseZ + z] = BlockID.Air;
                }
              }
            }
          }
        }
      }
    }
  }

  return input;
};

/**
 * Generate random patches of tall grass across the top surface
 */

export const generateTallGrass = (
  rng: RNG,
  input: BlockID[][][],
  size: WorldSize,
  params: WorldParams,
  chunkPos: THREE.Vector3
): BlockID[][][] => {
  const simplex = new SimplexNoise(rng);

  for (let x = 0; x < size.width; x++) {
    for (let z = 0; z < size.width; z++) {
      // starting from the top of the chunk, find the first grass block
      // if come in contact with leaves, stop since grass doesn't grow under trees
      for (let y = size.height - 1; y >= 0; y--) {
        if (input[x][y][z] === BlockID.Leaves) {
          break;
        }

        if (input[x][y][z] === BlockID.Grass) {
          // found grass, move one time up
          const baseY = y + 1;

          if (input[x][baseY][z] !== BlockID.Air) {
            continue;
          }

          if (rng.random() < params.grass.frequency) {
            input[x][baseY][z] = BlockID.TallGrass;

            // Define the maximum distance from the center
            const maxDistance = params.grass.patchSize;

            // Random walk algorithm
            let currentX = x;
            let currentZ = z;
            for (let i = 0; i < maxDistance; i++) {
              const direction = rng.random() * 2 * Math.PI; // Random direction
              currentX += Math.round(Math.cos(direction));
              currentZ += Math.round(Math.sin(direction));

              // Check if the new position is within the chunk boundaries and is air
              if (
                currentX >= 0 &&
                currentX < size.width &&
                currentZ >= 0 &&
                currentZ < size.width &&
                input[currentX][baseY][currentZ] === BlockID.Air &&
                input[currentX][y][currentZ] === BlockID.Grass
              ) {
                input[currentX][baseY][currentZ] = BlockID.TallGrass;
              }
            }
          }
        }
      }
    }
  }

  return input;
};
