import { wrap } from "comlink";
import * as THREE from "three";

import { BlockID } from "./Block";
import { BlockFactory } from "./Block/BlockFactory";

// export const workerInstance = new ComlinkWorker<typeof import("./chunkWorker")>(
//   new URL("./chunkWorker", import.meta.url)
// );

import chunkWorker from "./chunkWorker?worker&url";

const geometry = new THREE.BoxGeometry();

export type InstanceData = {
  block: BlockID;
  instanceId: number | null; // reference to mesh instanceId
};

export type WorldParams = {
  seed: number;
  terrain: {
    scale: number;
    magnitude: number;
    offset: number;
  };
  surface: {
    offset: number;
    magnitude: number;
  };
  bedrock: {
    offset: number;
    magnitude: number;
  };
};

export type WorldSize = {
  width: number;
  height: number;
};

export class WorldChunk extends THREE.Group {
  data: InstanceData[][][] = [];
  params: WorldParams;
  size: WorldSize;
  loaded: boolean;

  constructor(size: WorldSize, params: WorldParams) {
    super();
    this.size = size;
    this.params = params;
    this.loaded = false;
  }

  generate() {
    const start = performance.now();

    // workerInstance
    //   .generateChunk(this.size, this.params, this.x, this.z)
    //   .then((data: BlockID[][][]) => {
    //     console.log(`Loaded chunk in ${performance.now() - start}ms`);
    //   });
    workerInstance
      .generateChunk(this.size, this.params, this.position.x, this.position.z)
      .then((data: BlockID[][][]) => {
        requestIdleCallback(() => {
          this.initializeTerrain(data);
          this.generateMeshes(data);
          this.loaded = true;

          console.log(`Loaded chunk in ${performance.now() - start}ms`);
        });
      });
  }

  /**
   * Initializes the terrain data
   */
  initializeTerrain(data: BlockID[][][]) {
    this.data = [];
    for (let x = 0; x < this.size.width; x++) {
      const slice = [];
      for (let y = 0; y < this.size.height; y++) {
        const row: InstanceData[] = [];
        for (let z = 0; z < this.size.width; z++) {
          row.push({
            block: data[x][y][z],
            instanceId: null,
          });
        }
        slice.push(row);
      }
      this.data.push(slice);
    }
  }

  generateMeshes(data: BlockID[][][]) {
    this.clear();

    const maxCount = this.size.width * this.size.width * this.size.height;

    // Create lookup table where key is block id
    const meshes: Partial<Record<BlockID, THREE.InstancedMesh>> = {};
    const blockIDValues = Object.values(BlockID).filter(
      (value) => typeof value === "number"
    ) as BlockID[];

    for (const blockId of blockIDValues) {
      const block = BlockFactory.getBlock(blockId);
      const mesh = new THREE.InstancedMesh(geometry, block.material, maxCount);
      mesh.name = block.constructor.name;
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      meshes[block.id] = mesh;
    }

    const matrix = new THREE.Matrix4();
    for (let x = 0; x < this.size.width; x++) {
      for (let y = 0; y < this.size.height; y++) {
        for (let z = 0; z < this.size.width; z++) {
          const block = data[x][y][z];

          if (block === BlockID.Air) {
            continue;
          }

          const mesh = meshes[block];

          if (!mesh) {
            continue;
          }

          const instanceId = mesh.count;

          if (block && !this.isBlockObscured(x, y, z)) {
            matrix.setPosition(x + 0.5, y + 0.5, z + 0.5); // lower left corner
            mesh.setMatrixAt(instanceId, matrix);
            this.setBlockInstanceId(x, y, z, instanceId);
            mesh.count++;
          }
        }
      }
    }

    // Add meshes to group
    for (const mesh of Object.values(meshes)) {
      if (mesh) {
        this.add(mesh);
      }
    }
  }

  /**
   * Gets the block data at (x, y, z) for this chunk
   */
  getBlock(x: number, y: number, z: number): InstanceData | null {
    if (this.inBounds(x, y, z)) {
      return this.data[x][y][z];
    } else {
      return null;
    }
  }

  /**
   * Sets the block instance data at (x, y, z) for this chunk
   */
  setBlockInstanceId(x: number, y: number, z: number, instanceId: number) {
    if (this.inBounds(x, y, z)) {
      this.data[x][y][z].instanceId = instanceId;
    }
  }

  /**
   * Checks if the given coordinates are within the world bounds
   */
  inBounds(x: number, y: number, z: number): boolean {
    return (
      x >= 0 &&
      x < this.size.width &&
      y >= 0 &&
      y < this.size.height &&
      z >= 0 &&
      z < this.size.width
    );
  }

  isBlockObscured(x: number, y: number, z: number): boolean {
    const up = this.getBlock(x, y + 1, z);
    const down = this.getBlock(x, y - 1, z);
    const left = this.getBlock(x - 1, y, z);
    const right = this.getBlock(x + 1, y, z);
    const front = this.getBlock(x, y, z + 1);
    const back = this.getBlock(x, y, z - 1);

    // If any of the block's sides are exposed, it's not obscured
    if (
      !up ||
      !down ||
      !left ||
      !right ||
      !front ||
      !back ||
      up?.block === BlockID.Air ||
      down?.block === BlockID.Air ||
      left?.block === BlockID.Air ||
      right?.block === BlockID.Air ||
      front?.block === BlockID.Air ||
      back?.block === BlockID.Air
    ) {
      return false;
    }

    return true;
  }

  disposeChildren() {
    this.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    });
    this.clear();
  }
}

export const workerInstance = new ComlinkWorker<typeof import("./chunkWorker")>(
  new URL("./chunkWorker", import.meta.url)
);
