import { transfer } from "comlink";
import * as THREE from "three";

import { BlockID } from "./Block";
import {
  blockIndex,
  ChunkNeighborhood,
  ChunkSize,
  inChunkBounds,
} from "./chunk/ChunkData";
import { ChunkMaterials } from "./chunk/ChunkMaterial";
import { ChunkMesh, MeshBuffers } from "./chunk/mesher";
import { DataStore } from "./DataStore";
import { WorkerPool } from "./WorkerPool";
import { WorldParams } from "./WorldParams";

export type { ChunkSize as WorldSize } from "./chunk/ChunkData";

/**
 * A single column of the world. Owns flat voxel data and up to three meshes
 * (opaque, cutout, translucent) that are rebuilt on a worker whenever the
 * data changes.
 */
export class WorldChunk extends THREE.Group {
  readonly chunkX: number;
  readonly chunkZ: number;
  readonly size: ChunkSize;
  params: WorldParams;
  dataStore: DataStore;

  data: Uint8Array | null = null;
  /** Voxel data has been generated */
  loaded = false;
  /** Mesh matches the current data */
  meshDirty = false;
  disposed = false;

  private opaqueMesh: THREE.Mesh | null = null;
  private cutoutMesh: THREE.Mesh | null = null;
  private translucentMesh: THREE.Mesh | null = null;
  private meshing = false;
  private meshVersion = 0;

  constructor(
    chunkX: number,
    chunkZ: number,
    size: ChunkSize,
    params: WorldParams,
    dataStore: DataStore,
    private readonly pool: WorkerPool,
    private readonly materials: ChunkMaterials
  ) {
    super();
    this.chunkX = chunkX;
    this.chunkZ = chunkZ;
    this.size = size;
    this.params = params;
    this.dataStore = dataStore;
    this.position.set(chunkX * size.width, 0, chunkZ * size.width);
    this.matrixAutoUpdate = false;
    this.updateMatrix();
  }

  /**
   * Generates voxel data on a worker and applies persisted player edits
   */
  async generate() {
    const data = await this.pool.run((api) =>
      api.generateChunk(this.size, this.params, this.chunkX, this.chunkZ)
    );
    if (this.disposed) return;

    this.data = data;
    this.loadPlayerChanges();
    this.loaded = true;
    this.meshDirty = true;
  }

  /**
   * Loads player changes from the data store
   */
  loadPlayerChanges() {
    if (!this.data) return;
    const edits = this.dataStore.getChunk(this.chunkX, this.chunkZ);
    if (!edits) return;
    for (const [index, id] of edits) {
      if (index < this.data.length) this.data[index] = id;
    }
  }

  /**
   * Rebuilds the chunk geometry on a worker. Safe to call while a previous
   * build is in flight; the stale result is discarded.
   */
  async remesh(neighborhood: ChunkNeighborhood) {
    if (!this.data) return;
    this.meshDirty = false;
    this.meshing = true;
    const version = ++this.meshVersion;

    // Copy so the worker owns its own snapshot of the voxel data
    const snapshot: ChunkNeighborhood = {
      chunks: neighborhood.chunks.map((d) => d?.slice() ?? null),
    };
    const buffers = snapshot.chunks.flatMap((d) => (d ? [d.buffer] : []));
    const mesh = await this.pool.run((api) =>
      api.buildChunkMesh(this.size, transfer(snapshot, buffers))
    );

    if (version !== this.meshVersion || this.disposed) return;
    this.meshing = false;
    this.applyMesh(mesh);
  }

  get isMeshing() {
    return this.meshing;
  }

  private applyMesh(mesh: ChunkMesh) {
    this.opaqueMesh = this.swapMesh(
      this.opaqueMesh,
      mesh.opaque,
      this.materials.opaque
    );
    this.cutoutMesh = this.swapMesh(
      this.cutoutMesh,
      mesh.cutout,
      this.materials.cutout
    );
    this.translucentMesh = this.swapMesh(
      this.translucentMesh,
      mesh.translucent,
      this.materials.translucent
    );
  }

  private swapMesh(
    current: THREE.Mesh | null,
    buffers: MeshBuffers,
    material: THREE.Material
  ): THREE.Mesh | null {
    if (current) {
      this.remove(current);
      current.geometry.dispose();
    }
    if (buffers.indexCount === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(buffers.positions, 3)
    );
    geometry.setAttribute("uv", new THREE.BufferAttribute(buffers.uvs, 2));
    geometry.setAttribute(
      "aLayer",
      new THREE.BufferAttribute(buffers.layers, 1)
    );
    geometry.setAttribute(
      "aFlags",
      new THREE.BufferAttribute(buffers.flags, 1)
    );
    geometry.setAttribute(
      "aLight",
      new THREE.BufferAttribute(buffers.lights, 2, true)
    );
    geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(
        this.size.width / 2,
        this.size.height / 2,
        this.size.width / 2
      ),
      Math.hypot(this.size.width, this.size.height, this.size.width) / 2
    );

    const object = new THREE.Mesh(geometry, material);
    object.matrixAutoUpdate = false;
    this.add(object);
    return object;
  }

  /**
   * Gets the block id at local (x, y, z), or undefined when out of bounds
   */
  getBlock(x: number, y: number, z: number): BlockID | undefined {
    if (!this.data || !inChunkBounds(this.size, x, y, z)) return undefined;
    return this.data[blockIndex(this.size, x, y, z)];
  }

  /**
   * Sets the block id at local (x, y, z) and persists the change.
   * Returns true if the data changed.
   */
  setBlock(x: number, y: number, z: number, id: BlockID): boolean {
    if (!this.data || !inChunkBounds(this.size, x, y, z)) return false;
    const i = blockIndex(this.size, x, y, z);
    if (this.data[i] === id) return false;
    this.data[i] = id;
    this.dataStore.set(this.chunkX, this.chunkZ, i, id);
    this.meshDirty = true;
    return true;
  }

  dispose() {
    this.disposed = true;
    this.meshVersion++;
    for (const mesh of [
      this.opaqueMesh,
      this.cutoutMesh,
      this.translucentMesh,
    ]) {
      if (mesh) {
        this.remove(mesh);
        mesh.geometry.dispose();
      }
    }
    this.opaqueMesh = null;
    this.cutoutMesh = null;
    this.translucentMesh = null;
  }
}
