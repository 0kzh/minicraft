import * as THREE from "three";
import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise.js";

import {
  AirBlock,
  Block,
  BlockID,
  DirtBlock,
  GrassBlock,
  StoneBlock,
  blocks,
  resources,
} from "./Block";
import { RNG } from "./RNG";

const geometry = new THREE.BoxGeometry();
const material = new THREE.MeshLambertMaterial();

type InstanceData = {
  block: Block;
  instanceId: number | null; // reference to mesh instanceId
};

export class World extends THREE.Group {
  data: InstanceData[][][] = [];
  params = {
    seed: 0,
    terrain: {
      scale: 30,
      magnitude: 0.5,
      offset: 0.2,
    },
    surface: {
      offset: 4,
      magnitude: 4,
    },
  };

  public size;

  constructor(size = { width: 64, height: 32 }) {
    super();
    this.size = size;
  }

  generate() {
    const rng = new RNG(this.params.seed);
    this.initializeTerrain();
    this.generateResources(rng);
    this.generateTerrain(rng);
    this.generateMeshes();
  }

  /**
   * Initializes the terrain data
   */
  initializeTerrain() {
    this.data = [];
    for (let x = 0; x < this.size.width; x++) {
      const slice = [];
      for (let y = 0; y < this.size.height; y++) {
        const row: InstanceData[] = [];
        for (let z = 0; z < this.size.width; z++) {
          row.push({
            block: new AirBlock(),
            instanceId: null,
          });
        }
        slice.push(row);
      }
      this.data.push(slice);
    }
  }

  /**
   * Generates the resources (coal, stone, etc.) for the world
   */
  generateResources(rng: RNG) {
    const simplex = new SimplexNoise(rng);
    for (const Resource of resources) {
      for (let x = 0; x < this.size.width; x++) {
        for (let y = 0; y < this.size.height; y++) {
          for (let z = 0; z < this.size.width; z++) {
            const block = new Resource();
            const value = simplex.noise3d(
              x / block.scale.x,
              y / block.scale.y,
              z / block.scale.z
            );

            if (value > block.scarcity) {
              this.setBlockAt(x, y, z, block);
            }
          }
        }
      }
    }
  }

  /**
   * Generates the terrain data
   */
  generateTerrain(rng: RNG) {
    const simplex = new SimplexNoise(rng);
    for (let x = 0; x < this.size.width; x++) {
      for (let z = 0; z < this.size.width; z++) {
        const value = simplex.noise(
          x / this.params.terrain.scale,
          z / this.params.terrain.scale
        );

        const scaledNoise =
          this.params.terrain.offset + this.params.terrain.magnitude * value;

        let height = Math.floor(this.size.height * scaledNoise);
        height = Math.max(0, Math.min(height, this.size.height - 1));

        const numSurfaceBlocks =
          this.params.surface.offset +
          Math.abs(simplex.noise(x, z) * this.params.surface.magnitude);

        for (let y = 0; y <= this.size.height; y++) {
          if (y < height) {
            if (y < height - numSurfaceBlocks) {
              if (this.getBlock(x, y, z)?.block.id === BlockID.Air) {
                this.setBlockAt(x, y, z, new StoneBlock());
              }
            } else {
              this.setBlockAt(x, y, z, new DirtBlock());
            }
          } else if (y === height) {
            this.setBlockAt(x, y, z, new GrassBlock());
          } else if (y > height) {
            this.setBlockAt(x, y, z, new AirBlock());
          }
        }
      }
    }
  }

  /**
   * Generated the 3D representation of the world from the world data
   */
  generateMeshes() {
    this.clear();

    const maxCount = this.size.width * this.size.width * this.size.height;

    // Create lookup table where key is block id
    const meshes: Partial<Record<BlockID, THREE.InstancedMesh>> = {};

    for (const blockType of blocks) {
      const tempBlockInstance = new blockType();
      const mesh = new THREE.InstancedMesh(
        geometry,
        tempBlockInstance.material,
        maxCount
      );
      mesh.name = tempBlockInstance.constructor.name;
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      meshes[tempBlockInstance.id] = mesh;
    }

    const matrix = new THREE.Matrix4();
    for (let x = 0; x < this.size.width; x++) {
      for (let y = 0; y < this.size.height; y++) {
        for (let z = 0; z < this.size.width; z++) {
          const block = this.getBlock(x, y, z)?.block;

          if (!block || block.id === BlockID.Air) {
            continue;
          }

          const mesh = meshes[block.id];

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

    this.add(...Object.values(meshes));
  }

  /**
   * Gets the block data at (x, y, z)
   */
  getBlock(x: number, y: number, z: number): InstanceData | null {
    if (this.inBounds(x, y, z)) {
      return this.data[x][y][z];
    } else {
      return null;
    }
  }

  /**
   * Sets the block at (x, y, z)
   */
  setBlockAt(x: number, y: number, z: number, block: Block) {
    if (this.inBounds(x, y, z)) {
      this.data[x][y][z].block = block;
    }
  }

  /**
   * Sets the block instance data at (x, y, z)
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
      up?.block.id === BlockID.Air ||
      down?.block.id === BlockID.Air ||
      left?.block.id === BlockID.Air ||
      right?.block.id === BlockID.Air ||
      front?.block.id === BlockID.Air ||
      back?.block.id === BlockID.Air
    ) {
      return false;
    }

    return true;
  }
}
