import * as THREE from "three";

import audioManager from "./audio/AudioManager";
import { BlockID } from "./Block";
import { getBlockDef } from "./Block/blocks";
import {
  ChunkNeighborhood,
  ChunkSize,
  NEIGHBOR_OFFSETS,
  neighborIndex,
} from "./chunk/ChunkData";
import { ChunkMaterials } from "./chunk/ChunkMaterial";
import { DataStore } from "./DataStore";
import { FluidSim, FluidWorld } from "./fluids/FluidSim";
import { Player } from "./Player";
import { WorkerPool } from "./WorkerPool";
import { WorldChunk } from "./WorldChunk";
import { WorldParams } from "./WorldParams";

type ChunkCoord = { x: number; z: number };

export class World extends THREE.Group implements FluidWorld {
  scene: THREE.Scene;
  renderDistance = 18;
  chunkSize: ChunkSize = {
    width: 16,
    height: 128,
  };
  initialLoadComplete = false;

  params: WorldParams = {
    seed: 0,
    terrain: {
      seaLevel: 62,
      continentScale: 700,
      erosionScale: 480,
      ridgeScale: 170,
      detailScale: 42,
      biomeScale: 560,
      riverScale: 420,
      rivers: true,
      amplitude: 1,
    },
    caves: {
      enabled: true,
      cheeseScale: 256,
      cheeseThreshold: 0.27,
      spaghettiScale: 128,
      spaghettiRadius: 0.0765,
      entranceThreshold: 0.5,
      lavaLevel: 10,
      ravines: true,
      entrances: true,
    },
    trees: { density: 1 },
    vegetation: { density: 1 },
    ores: { density: 1 },
  };

  // Used for persisting changes to the world
  dataStore = new DataStore();

  readonly pool = new WorkerPool();
  readonly materials: ChunkMaterials;
  readonly fluids = new FluidSim(this);

  /** Where the player is put once the first chunks are in; null = find land */
  restorePosition: THREE.Vector3 | null = null;
  /** Called once the initial chunks around the spawn are loaded and meshed */
  onInitialLoad: (() => void) | null = null;

  private chunks = new Map<string, WorldChunk>();
  private generating = 0;
  private lastCenter: ChunkCoord | null = null;
  private spawnPoint = new THREE.Vector3(32, 0, 32);
  private lastRenderDistance = -1;
  private visibleChunks: ChunkCoord[] = [];

  constructor(seed = 0, scene: THREE.Scene, materials: ChunkMaterials) {
    super();
    this.params.seed = seed;
    this.scene = scene;
    this.materials = materials;
    this.matrixAutoUpdate = false;
  }

  get wireframeMode() {
    return this.materials.uniforms.uWireframe.value;
  }

  set wireframeMode(value: boolean) {
    this.materials.wireframe = value;
  }

  /** Number of chunks currently loaded */
  get chunkCount() {
    return this.chunks.size;
  }

  get seed() {
    return this.params.seed;
  }

  set seed(value: number) {
    this.params.seed = value;
  }

  /**
   * Clears existing world data and re-generates everything around `spawn`
   */
  regenerate(player: Player, spawn = new THREE.Vector3(32, 0, 32)) {
    for (const chunk of this.chunks.values()) {
      chunk.dispose();
      this.remove(chunk);
    }
    this.chunks.clear();
    this.lastCenter = null;
    this.restorePosition = null;
    this.spawnPoint.set(spawn.x, 0, spawn.z);
    player.teleport(spawn.x, this.chunkSize.height + 10, spawn.z);
    this.initialLoadComplete = false;
    this.setLoadingScreenVisible(true);
    this.update(player);
  }

  private setLoadingScreenVisible(visible: boolean) {
    const menuScreen = document.getElementById("menu");
    const loadingScreen = document.getElementById("loading");
    if (menuScreen) menuScreen.style.display = visible ? "flex" : "none";
    if (loadingScreen) loadingScreen.style.display = visible ? "block" : "none";
  }

  /** Generates around a saved position and puts the player back there */
  restore(player: Player, position: THREE.Vector3) {
    this.restorePosition = position.clone();
    this.spawnPoint.set(position.x, 0, position.z);
    player.teleport(position.x, position.y, position.z);
  }

  getChunkKey(x: number, z: number) {
    return `${x},${z}`;
  }

  /**
   * Updates the visible portions of the world based on the current player position
   */
  update(player: Player) {
    const center = this.worldToChunkCoords(
      player.position.x,
      player.position.y,
      player.position.z
    ).chunk;

    if (
      !this.lastCenter ||
      this.lastCenter.x !== center.x ||
      this.lastCenter.z !== center.z ||
      this.lastRenderDistance !== this.renderDistance
    ) {
      this.lastCenter = center;
      this.lastRenderDistance = this.renderDistance;
      this.visibleChunks = this.getVisibleChunks(center);
      this.removeUnusedChunks(this.visibleChunks);
    }

    this.scheduleGeneration();
    this.scheduleMeshing(center);

    if (!this.initialLoadComplete) {
      this.updateLoadingProgress(player);
    }
  }

  /**
   * Starts generating missing visible chunks, nearest first, keeping the
   * worker pool saturated without flooding it.
   */
  private scheduleGeneration() {
    const maxInFlight = this.pool.size * 2;
    for (const coord of this.visibleChunks) {
      if (this.generating >= maxInFlight) break;
      const key = this.getChunkKey(coord.x, coord.z);
      if (this.chunks.has(key)) continue;
      this.generateChunk(coord.x, coord.z);
    }
  }

  /**
   * Remeshes dirty chunks, nearest to the player first
   */
  private scheduleMeshing(center: ChunkCoord) {
    const maxInFlight = this.pool.size * 2;
    let inFlight = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.isMeshing) inFlight++;
    }
    if (inFlight >= maxInFlight) return;

    const dirty: WorldChunk[] = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.loaded && chunk.meshDirty && this.neighborsReady(chunk, center))
        dirty.push(chunk);
    }
    if (dirty.length === 0) return;

    dirty.sort(
      (a, b) =>
        Math.hypot(a.chunkX - center.x, a.chunkZ - center.z) -
        Math.hypot(b.chunkX - center.x, b.chunkZ - center.z)
    );
    for (const chunk of dirty) {
      if (inFlight >= maxInFlight) break;
      chunk.remesh(this.getNeighborhood(chunk));
      inFlight++;
    }
  }

  private updateLoadingProgress(player: Player) {
    const totalChunks = this.visibleChunks.length;
    let loadedChunks = 0;
    let pending = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.loaded) loadedChunks++;
      if (!chunk.loaded || chunk.meshDirty || chunk.isMeshing) pending++;
    }

    const progressBar = document.getElementById("loading-progress-bar");
    if (progressBar) {
      const percentLoaded = Math.round((loadedChunks / totalChunks) * 100);
      progressBar.style.width = `${percentLoaded}%`;
    }

    if (this.chunks.size < totalChunks || pending > 0) return;

    this.initialLoadComplete = true;
    this.setLoadingScreenVisible(false);

    if (this.restorePosition) {
      const p = this.restorePosition;
      player.teleport(p.x, p.y, p.z);
    } else {
      const spawn = this.findSpawn(this.spawnPoint);
      player.placeFeet(spawn.x, spawn.y + 1, spawn.z);
    }
    this.onInitialLoad?.();
  }

  /**
   * Picks a spawn column near `around`: the nearest dry land above sea level,
   * falling back to whatever ground is under the requested point.
   */
  private findSpawn(around: THREE.Vector3): THREE.Vector3 {
    const sea = this.params.terrain.seaLevel;
    const groundAt = (x: number, z: number): number => {
      for (let y = this.chunkSize.height - 1; y > 0; y--) {
        const id = this.getBlock(x, y, z);
        if (id === undefined || id === BlockID.Air) continue;
        const def = getBlockDef(id);
        if (def.fluid) return -1;
        if (!def.passable) return y;
      }
      return -1;
    };

    const cx = Math.floor(around.x);
    const cz = Math.floor(around.z);
    const maxRadius = this.renderDistance * this.chunkSize.width;
    for (let r = 0; r <= maxRadius; r += 2) {
      for (let dx = -r; dx <= r; dx += 2) {
        for (const dz of r === 0 ? [0] : [-r, r]) {
          for (const [x, z] of [
            [cx + dx, cz + dz],
            [cx + dz, cz + dx],
          ]) {
            const y = groundAt(x, z);
            if (y >= sea) return new THREE.Vector3(x + 0.5, y, z + 0.5);
          }
        }
      }
    }
    return new THREE.Vector3(
      around.x,
      Math.max(groundAt(cx, cz), sea),
      around.z
    );
  }

  getBlockUnderneath(position: THREE.Vector3, playerHeight: number) {
    return this.getBlock(
      Math.floor(position.x),
      Math.floor(position.y - playerHeight / 2 - 1),
      Math.floor(position.z)
    );
  }

  /**
   * Returns the coordinates of the chunks within render distance of `center`,
   * sorted nearest first
   */
  getVisibleChunks(center: ChunkCoord): ChunkCoord[] {
    const visibleChunks: ChunkCoord[] = [];
    for (let dx = -this.renderDistance; dx <= this.renderDistance; dx++) {
      for (let dz = -this.renderDistance; dz <= this.renderDistance; dz++) {
        visibleChunks.push({ x: center.x + dx, z: center.z + dz });
      }
    }
    visibleChunks.sort(
      (a, b) =>
        Math.hypot(a.x - center.x, a.z - center.z) -
        Math.hypot(b.x - center.x, b.z - center.z)
    );
    return visibleChunks;
  }

  /**
   * Removes current loaded chunks that are no longer visible
   */
  removeUnusedChunks(visibleChunks: ChunkCoord[]) {
    const visible = new Set(
      visibleChunks.map((c) => this.getChunkKey(c.x, c.z))
    );
    for (const [key, chunk] of this.chunks) {
      if (visible.has(key)) continue;
      chunk.dispose();
      this.remove(chunk);
      this.chunks.delete(key);
    }
  }

  /**
   * Generates the chunk at (x, z) coordinates
   */
  async generateChunk(x: number, z: number) {
    const chunk = new WorldChunk(
      x,
      z,
      { ...this.chunkSize },
      this.params,
      this.dataStore,
      this.pool,
      this.materials
    );
    chunk.onNeighborsAffected = (mask) => {
      for (const [dx, dz] of NEIGHBOR_OFFSETS) {
        if (!(mask & (1 << neighborIndex(dx, dz)))) continue;
        const c = this.getChunk(x + dx, z + dz);
        if (c?.loaded) c.meshDirty = true;
      }
    };
    this.chunks.set(this.getChunkKey(x, z), chunk);
    this.add(chunk);

    this.generating++;
    try {
      await chunk.generate();
    } finally {
      this.generating--;
    }
    if (chunk.disposed) return;

    // Neighbours can now cull faces and light against this chunk's data
    for (const neighbor of this.neighbors(chunk)) {
      if (neighbor?.loaded) neighbor.meshDirty = true;
    }
  }

  /**
   * True when every neighbour inside render distance has voxel data, so the
   * chunk can be meshed once with correct border culling and lighting.
   */
  private neighborsReady(chunk: WorldChunk, center: ChunkCoord) {
    const rd = this.renderDistance;
    for (const [dx, dz] of NEIGHBOR_OFFSETS) {
      const nx = chunk.chunkX + dx;
      const nz = chunk.chunkZ + dz;
      const inRange =
        Math.abs(nx - center.x) <= rd && Math.abs(nz - center.z) <= rd;
      if (inRange && !this.getChunk(nx, nz)?.loaded) return false;
    }
    return true;
  }

  /** The eight horizontally adjacent chunks (undefined where not created) */
  private neighbors(chunk: WorldChunk) {
    return NEIGHBOR_OFFSETS.map(([dx, dz]) =>
      this.getChunk(chunk.chunkX + dx, chunk.chunkZ + dz)
    );
  }

  private getNeighborhood(chunk: WorldChunk): ChunkNeighborhood {
    const chunks: (Uint8Array | null)[] = new Array(9).fill(null);
    chunks[neighborIndex(0, 0)] = chunk.data as Uint8Array;
    for (const [dx, dz] of NEIGHBOR_OFFSETS) {
      const c = this.getChunk(chunk.chunkX + dx, chunk.chunkZ + dz);
      chunks[neighborIndex(dx, dz)] = c?.loaded ? c.data : null;
    }
    return { chunks };
  }

  /**
   * Sets the block at world (x, y, z) and remeshes the affected chunk(s)
   */
  setBlock(x: number, y: number, z: number, id: BlockID): boolean {
    return this.writeBlock(x, y, z, id, true);
  }

  /** Sets a block, leaving the remesh to the next scheduled update */
  setBlockDeferred(x: number, y: number, z: number, id: BlockID): boolean {
    return this.writeBlock(x, y, z, id, false);
  }

  private writeBlock(
    x: number,
    y: number,
    z: number,
    id: BlockID,
    immediate: boolean
  ): boolean {
    const coords = this.worldToChunkCoords(x, y, z);
    const chunk = this.getChunk(coords.chunk.x, coords.chunk.z);
    if (!chunk?.loaded) return false;

    const { x: bx, y: by, z: bz } = coords.block;
    if (!chunk.setBlock(bx, by, bz, id)) return false;

    // Remesh the edited chunk right away on the interactive worker so edits
    // feel instant; the worker reports which neighbours the change actually
    // reached (culling, AO or light) and only those are remeshed afterwards
    if (immediate) chunk.remesh(this.getNeighborhood(chunk), true);
    return true;
  }

  /**
   * Adds a new block at (x, y, z)
   */
  addBlock(x: number, y: number, z: number, block: BlockID): boolean {
    const existing = this.getBlock(x, y, z);
    if (existing === undefined) return false;
    if (!getBlockDef(existing).replaceable) return false;
    if (!this.setBlock(x, y, z, block)) return false;
    audioManager.playPlace(getBlockDef(block).sound);
    this.fluids.scheduleAround(x, y, z);
    return true;
  }

  removeBlock(x: number, y: number, z: number): boolean {
    const id = this.getBlock(x, y, z);
    if (id === undefined || id === BlockID.Air || id === BlockID.Bedrock) {
      return false;
    }

    const removed = this.setBlock(x, y, z, BlockID.Air);
    if (removed) {
      audioManager.playBreak(getBlockDef(id).sound);
      this.fluids.scheduleAround(x, y, z);
    }

    // Plants above lose their support
    const above = this.getBlock(x, y + 1, z);
    const aboveDef = above === undefined ? undefined : getBlockDef(above);
    if (
      aboveDef &&
      above !== BlockID.Air &&
      ((aboveDef.passable && !aboveDef.fluid) || above === BlockID.SnowLayer)
    ) {
      this.removeBlock(x, y + 1, z);
    }
    return removed;
  }

  /** Nearest dry land to the world spawn, for respawning */
  getSpawn(): THREE.Vector3 {
    return this.findSpawn(this.spawnPoint);
  }

  /**
   * Gets the block id at world (x, y, z), or undefined if the chunk isn't loaded
   */
  getBlock(x: number, y: number, z: number): BlockID | undefined {
    const coords = this.worldToChunkCoords(x, y, z);
    const chunk = this.getChunk(coords.chunk.x, coords.chunk.z);
    if (!chunk?.loaded) return undefined;
    return chunk.getBlock(coords.block.x, coords.block.y, coords.block.z);
  }

  /**
   * Returns the chunk and local coordinates of the block at world (x, y, z)
   */
  worldToChunkCoords(
    x: number,
    y: number,
    z: number
  ): {
    chunk: ChunkCoord;
    block: { x: number; y: number; z: number };
  } {
    const chunkX = Math.floor(x / this.chunkSize.width);
    const chunkZ = Math.floor(z / this.chunkSize.width);

    return {
      chunk: { x: chunkX, z: chunkZ },
      block: {
        x: x - chunkX * this.chunkSize.width,
        y,
        z: z - chunkZ * this.chunkSize.width,
      },
    };
  }

  /**
   * Returns the WorldChunk at chunk coordinates (x, z)
   */
  getChunk(x: number, z: number): WorldChunk | undefined {
    return this.chunks.get(this.getChunkKey(x, z));
  }
}
