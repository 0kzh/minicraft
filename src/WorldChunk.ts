import { wrap } from "comlink";
import * as THREE from "three";

import { BlockID } from "./Block";
import { BlockFactory } from "./Block/BlockFactory";

// export const workerInstance = new ComlinkWorker<typeof import("./chunkWorker")>(
//   new URL("./chunkWorker", import.meta.url)
// );

import chunkWorker from "./chunkWorker?worker&url";
import { DataStore } from "./DataStore";

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
  dataStore: DataStore;

  constructor(size: WorldSize, params: WorldParams, dataStore: DataStore) {
    super();
    this.size = size;
    this.params = params;
    this.dataStore = dataStore;
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
          this.loadPlayerChanges();
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

  /**
   * Loads player changes from the data store
   */
  loadPlayerChanges() {
    for (let x = 0; x < this.size.width; x++) {
      for (let y = 0; y < this.size.height; y++) {
        for (let z = 0; z < this.size.width; z++) {
          // Overwrite with value in data store if it exists
          if (
            this.dataStore.contains(this.position.x, this.position.z, x, y, z)
          ) {
            const blockId = this.dataStore.get(
              this.position.x,
              this.position.z,
              x,
              y,
              z
            );
            console.log(`Overwriting block at ${x}, ${y}, ${z} to ${blockId}`);
            this.setBlockId(x, y, z, blockId);
          }
        }
      }
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

  setBlockId(x: number, y: number, z: number, blockId: BlockID) {
    if (this.inBounds(x, y, z)) {
      this.data[x][y][z].block = blockId;
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
   * Adds a new block at (x, y, z) for this chunk
   */
  addBlock(x: number, y: number, z: number, blockId: BlockID) {
    // Safety check that we aren't adding a block for one that already exists
    if (this.getBlock(x, y, z)?.block === BlockID.Air) {
      this.setBlockId(x, y, z, blockId);
      this.addBlockInstance(x, y, z);
      this.dataStore.set(this.position.x, this.position.z, x, y, z, blockId);
    }
  }

  /**
   * Removes the block at (x, y, z)
   */
  removeBlock(x: number, y: number, z: number) {
    const block = this.getBlock(x, y, z);
    if (block) {
      console.log("block", BlockFactory.getBlock(block.block).constructor.name);
    } else {
      console.log("no instance data");
    }
    if (block && block.block !== BlockID.Air) {
      console.log(`Removing block at ${x}, ${y}, ${z}`);
      this.deleteBlockInstance(x, y, z);
      this.setBlockId(x, y, z, BlockID.Air);
      this.dataStore.set(
        this.position.x,
        this.position.z,
        x,
        y,
        z,
        BlockID.Air
      );
    }
  }

  /**
   * Creates a new instance for the block at (x, y, z)
   */
  addBlockInstance(x: number, y: number, z: number) {
    const block = this.getBlock(x, y, z);

    // If the block is not air and doesn't have an instance id, create a new instance
    if (block && block.block !== BlockID.Air && !block.instanceId) {
      const mesh = this.children.find(
        (instanceMesh) =>
          instanceMesh.name ===
          BlockFactory.getBlock(block.block).constructor.name
      ) as THREE.InstancedMesh;

      if (mesh) {
        const instanceId = mesh.count++;
        this.setBlockInstanceId(x, y, z, instanceId);

        // Update the appropriate instanced mesh and re-compute the bounding sphere so raycasting works
        const matrix = new THREE.Matrix4();
        matrix.setPosition(x + 0.5, y + 0.5, z + 0.5);
        mesh.setMatrixAt(instanceId, matrix);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    }
  }

  /**
   * Removes the mesh instance associated with `block` by swapping it with the last instance and decrementing instance count
   */
  deleteBlockInstance(x: number, y: number, z: number) {
    const block = this.getBlock(x, y, z);

    if (block?.block === BlockID.Air || !block?.instanceId) {
      return;
    }

    // Get the mesh and instance id of the block
    const mesh = this.children.find(
      (instanceMesh) =>
        instanceMesh.name ===
        BlockFactory.getBlock(block.block).constructor.name
    ) as THREE.InstancedMesh;
    const instanceId = block.instanceId;

    // We can't remove instance directly, so we need to swap with last instance and decrement count by 1
    const lastMatrix = new THREE.Matrix4();
    mesh.getMatrixAt(mesh.count - 1, lastMatrix);

    // Also need to get block coords of instance to update instance id of the block
    const lastBlockCoords = new THREE.Vector3();
    lastBlockCoords.setFromMatrixPosition(lastMatrix);
    this.setBlockInstanceId(
      Math.floor(lastBlockCoords.x),
      Math.floor(lastBlockCoords.y),
      Math.floor(lastBlockCoords.z),
      instanceId
    );

    // Swap transformation matrices
    mesh.setMatrixAt(instanceId, lastMatrix);

    // Decrement instance count
    mesh.count--;

    // Notify the instanced mesh we updated the instance matrix
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();

    this.setBlockInstanceId(x, y, z, null);
  }

  /**
   * Sets the block instance data at (x, y, z) for this chunk
   */
  setBlockInstanceId(
    x: number,
    y: number,
    z: number,
    instanceId: number | null
  ) {
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
