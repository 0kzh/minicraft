import * as THREE from "three";

import audioManager from "./audio/AudioManager";
import { BlockID } from "./Block";
import { RenderGeometry } from "./Block/Block";
import { BlockFactory } from "./Block/BlockFactory";
import { DataStore } from "./DataStore";

const geometry = new THREE.BoxGeometry();
const crossGeometry = new THREE.PlaneGeometry();

export type InstanceData = {
  block: BlockID;
  instanceIds: number[]; // reference to mesh instanceId
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
  trees: {
    frequency: number;
    trunkHeight: {
      min: number;
      max: number;
    };
    canopy: {
      size: {
        min: number;
        max: number;
      };
    };
  };
  grass: {
    frequency: number;
    patchSize: number;
  };
  flowers: {
    frequency: number;
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
  wireframeMode = false;

  constructor(
    size: WorldSize,
    params: WorldParams,
    dataStore: DataStore,
    wireframeMode = false
  ) {
    super();
    this.size = size;
    this.params = params;
    this.dataStore = dataStore;
    this.loaded = false;
    this.wireframeMode = wireframeMode;
  }

  async generate() {
    // const start = performance.now();

    const data: BlockID[][][] = await workerInstance.generateChunk(
      this.size,
      this.params,
      this.position.x,
      this.position.z
    );

    requestIdleCallback(
      () => {
        this.initializeTerrain(data);
        this.loadPlayerChanges();
        this.generateMeshes(data);
        this.loaded = true;

        // console.log(`Loaded chunk in ${performance.now() - start}ms`);
      },
      { timeout: 1000 }
    );
  }

  /**
   * Initializes the terrain data
   */
  initializeTerrain(data: BlockID[][][]) {
    this.data = [];
    for (let x = 0; x < this.size.width; x++) {
      const slice: InstanceData[][] = [];
      for (let y = 0; y < this.size.height; y++) {
        const row: InstanceData[] = [];
        for (let z = 0; z < this.size.width; z++) {
          row.push({
            block: data[x][y][z],
            instanceIds: [],
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
            // console.log(`Overwriting block at ${x}, ${y}, ${z} to ${blockId}`);
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
      const blockGeometry = block.geometry;

      const mesh = new THREE.InstancedMesh(
        blockGeometry === RenderGeometry.Cube ? geometry : crossGeometry,
        this.wireframeMode
          ? new THREE.MeshBasicMaterial({ wireframe: true })
          : block.material,
        maxCount
      );

      mesh.name = block.constructor.name;
      mesh.count = 0;
      mesh.castShadow = !block.canPassThrough;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      meshes[block.id] = mesh;
    }

    for (let x = 0; x < this.size.width; x++) {
      for (let y = 0; y < this.size.height; y++) {
        for (let z = 0; z < this.size.width; z++) {
          const block = data[x][y][z];
          const blockClass = BlockFactory.getBlock(block);

          if (block === BlockID.Air) {
            continue;
          }

          const mesh = meshes[block];

          if (!mesh) {
            continue;
          }

          if (
            block &&
            !this.isBlockObscured(x, y, z) &&
            !this.isBorderBlock(x, y, z)
          ) {
            if (blockClass.geometry == RenderGeometry.Cube) {
              const instanceId = mesh.count++;
              this.setBlockInstanceIds(x, y, z, [instanceId]);

              const matrix = new THREE.Matrix4();
              matrix.setPosition(x + 0.5, y + 0.5, z + 0.5);
              mesh.setMatrixAt(instanceId, matrix);
            } else if (blockClass.geometry == RenderGeometry.Cross) {
              const instanceId1 = mesh.count++;
              const instanceId2 = mesh.count++;
              this.setBlockInstanceIds(x, y, z, [instanceId1, instanceId2]);

              const matrix1 = new THREE.Matrix4();
              matrix1.makeRotationY(Math.PI / 4);
              matrix1.setPosition(x + 0.5, y + 0.5, z + 0.5);
              mesh.setMatrixAt(instanceId1, matrix1);

              const matrix2 = new THREE.Matrix4();
              matrix2.makeRotationY(-Math.PI / 4);
              matrix2.setPosition(x + 0.5, y + 0.5, z + 0.5);
              mesh.setMatrixAt(instanceId2, matrix2);
            }
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
    // console.log(`Removing block at ${x}, ${y}, ${z}`);
    const block = this.getBlock(x, y, z);
    if (block && block.block !== BlockID.Air) {
      this.playBlockSound(block.block);
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

  async playBlockSound(blockId: BlockID) {
    switch (blockId) {
      case BlockID.Grass:
      case BlockID.Dirt:
      case BlockID.Leaves:
      case BlockID.TallGrass:
      case BlockID.FlowerDandelion:
      case BlockID.FlowerRose:
        audioManager.play("dig.grass");
        break;
      case BlockID.OakLog:
        audioManager.play("dig.wood");
        break;
      default:
        audioManager.play("dig.stone");
        break;
    }
  }

  /**
   * Creates a new instance for the block at (x, y, z)
   */
  addBlockInstance(x: number, y: number, z: number) {
    const block = this.getBlock(x, y, z);

    // If the block is not air and doesn't have an instance id, create a new instance
    if (
      block &&
      block.block !== BlockID.Air &&
      block.instanceIds.length === 0
    ) {
      const blockClass = BlockFactory.getBlock(block.block);
      const mesh = this.children.find(
        (instanceMesh) => instanceMesh.name === blockClass.constructor.name
      ) as THREE.InstancedMesh;

      if (mesh) {
        this.playBlockSound(block.block);
        if (blockClass.geometry == RenderGeometry.Cube) {
          const instanceId = mesh.count++;
          this.setBlockInstanceIds(x, y, z, [instanceId]);

          // Update the appropriate instanced mesh and re-compute the bounding sphere so raycasting works
          const matrix = new THREE.Matrix4();
          matrix.setPosition(x + 0.5, y + 0.5, z + 0.5);
          mesh.setMatrixAt(instanceId, matrix);
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
        } else if (blockClass.geometry == RenderGeometry.Cross) {
          const instanceId1 = mesh.count++;
          const instanceId2 = mesh.count++;
          this.setBlockInstanceIds(x, y, z, [instanceId1, instanceId2]);

          const matrix1 = new THREE.Matrix4();
          matrix1.makeRotationY(Math.PI / 4);
          matrix1.setPosition(x + 0.5, y + 0.5, z + 0.5);
          mesh.setMatrixAt(instanceId1, matrix1);

          const matrix2 = new THREE.Matrix4();
          matrix2.makeRotationY(-Math.PI / 4);
          matrix2.setPosition(x + 0.5, y + 0.5, z + 0.5);
          mesh.setMatrixAt(instanceId2, matrix2);

          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
        }
      }
    }
  }

  /**
   * Removes the mesh instance associated with `block` by swapping it with the last instance and decrementing instance count
   */
  deleteBlockInstance(x: number, y: number, z: number) {
    const block = this.getBlock(x, y, z);

    if (block?.block === BlockID.Air || !block?.instanceIds.length) {
      return;
    }

    // Get the mesh of the block
    const mesh = this.children.find(
      (instanceMesh) =>
        instanceMesh.name ===
        BlockFactory.getBlock(block.block).constructor.name
    ) as THREE.InstancedMesh;

    // We can't remove instances directly, so we need to swap each with the last instance and decrement count by 1
    block.instanceIds.forEach((instanceId) => {
      const lastMatrix = new THREE.Matrix4();
      mesh.getMatrixAt(mesh.count - 1, lastMatrix);

      // Also need to get block coords of instance to update instance id of the block
      const lastBlockCoords = new THREE.Vector3();
      lastBlockCoords.setFromMatrixPosition(lastMatrix);
      this.setBlockInstanceIds(
        Math.floor(lastBlockCoords.x),
        Math.floor(lastBlockCoords.y),
        Math.floor(lastBlockCoords.z),
        [instanceId]
      );

      // Swap transformation matrices
      mesh.setMatrixAt(instanceId, lastMatrix);

      // Decrement instance count
      mesh.count--;

      // Notify the instanced mesh we updated the instance matrix
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });

    this.setBlockInstanceIds(x, y, z, []);
  }

  /**
   * Sets the block instance data at (x, y, z) for this chunk
   */
  setBlockInstanceIds(x: number, y: number, z: number, instanceIds: number[]) {
    if (this.inBounds(x, y, z)) {
      this.data[x][y][z].instanceIds = instanceIds;
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

    const getBlockClass = (blockId: BlockID) => BlockFactory.getBlock(blockId);

    // If any of the block's sides are exposed, it's not obscured
    if (
      !up ||
      !down ||
      !left ||
      !right ||
      !front ||
      !back ||
      getBlockClass(up.block).transparent ||
      getBlockClass(down.block).transparent ||
      getBlockClass(left.block).transparent ||
      getBlockClass(right.block).transparent ||
      getBlockClass(front.block).transparent ||
      getBlockClass(back.block).transparent
    ) {
      return false;
    }

    return true;
  }

  isBorderBlock(x: number, y: number, z: number): boolean {
    const up = this.getBlock(x, y + 1, z);
    const upBlockClass = up ? BlockFactory.getBlock(up.block) : null;
    if (upBlockClass?.canPassThrough) {
      return false;
    }

    return (
      x === 0 ||
      x === this.size.width - 1 ||
      y === 0 ||
      y === this.size.height - 1 ||
      z === 0 ||
      z === this.size.width - 1
    );
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
