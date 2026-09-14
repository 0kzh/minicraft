import { BlockID } from "../Block";
import { BLOCKS } from "../Block/blocks";

import {
  blockIndex,
  ChunkNeighborhood,
  ChunkSize,
  neighborIndex,
} from "./ChunkData";

export const MAX_LIGHT = 15;

const opacityTable = new Uint8Array(256);
const emissionTable = new Uint8Array(256);
const opaqueTable = new Uint8Array(256);
for (let id = 0; id < 256; id++) {
  const def = BLOCKS[id];
  if (!def) continue;
  opacityTable[id] = def.lightOpacity;
  emissionTable[id] = def.lightEmission;
  opaqueTable[id] = def.opaque ? 1 : 0;
}

/**
 * A chunk's voxels plus a border of up to 16 blocks copied from the
 * neighbouring chunks, with flood-filled sky and block light. Light travels
 * at most 15 blocks so the border is wide enough for sources in neighbours
 * to reach the chunk correctly.
 *
 * Unloaded neighbours and the space above the world read as air lit by full
 * sky light; below the world reads as bedrock.
 */
export class LitVolume {
  readonly pad: number;
  readonly pw: number;
  readonly height: number;
  readonly blocks: Uint8Array;
  /** Per-cell light: sky level in the high nibble, block level in the low nibble */
  readonly light: Uint8Array;

  constructor(readonly size: ChunkSize, n: ChunkNeighborhood) {
    const w = size.width;
    const h = size.height;
    this.pad = Math.min(w, 16);
    this.pw = w + 2 * this.pad;
    this.height = h;
    this.blocks = new Uint8Array(this.pw * this.pw * h);
    this.light = new Uint8Array(this.blocks.length);

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const data = n.chunks[neighborIndex(dx, dz)];
        if (!data) continue;
        this.copyChunk(data, dx, dz);
      }
    }

    this.computeSkyLight();
    this.computeBlockLight();
  }

  private copyChunk(data: Uint8Array, dx: number, dz: number) {
    const w = this.size.width;
    const p = this.pad;
    // Range of the neighbour's local coordinates that fall inside the padding
    const x0 = dx < 0 ? w - p : 0;
    const x1 = dx > 0 ? p : w;
    const z0 = dz < 0 ? w - p : 0;
    const z1 = dz > 0 ? p : w;
    const ox = dx * w;
    const oz = dz * w;
    for (let y = 0; y < this.height; y++) {
      for (let z = z0; z < z1; z++) {
        const src = blockIndex(this.size, x0, y, z);
        this.blocks.set(
          data.subarray(src, src + (x1 - x0)),
          this.index(x0 + ox, y, z + oz)
        );
      }
    }
  }

  /** Index into the padded arrays; x/z range over [-pad, width + pad) */
  index(x: number, y: number, z: number): number {
    return (y * this.pw + z + this.pad) * this.pw + x + this.pad;
  }

  inBounds(x: number, y: number, z: number): boolean {
    const p = this.pad;
    const w = this.size.width;
    return (
      y >= 0 && y < this.height && x >= -p && x < w + p && z >= -p && z < w + p
    );
  }

  get(x: number, y: number, z: number): BlockID {
    if (y < 0) return BlockID.Bedrock;
    if (y >= this.height || !this.inBounds(x, y, z)) return BlockID.Air;
    return this.blocks[this.index(x, y, z)];
  }

  isOpaque(x: number, y: number, z: number): boolean {
    return opaqueTable[this.get(x, y, z)] === 1;
  }

  /** Sky light level 0-15 at a cell (full sky outside the volume) */
  skyLight(x: number, y: number, z: number): number {
    if (y < 0) return 0;
    if (y >= this.height || !this.inBounds(x, y, z)) return MAX_LIGHT;
    return this.light[this.index(x, y, z)] >> 4;
  }

  /** Block light level 0-15 at a cell */
  blockLight(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return 0;
    return this.light[this.index(x, y, z)] & 15;
  }

  private computeSkyLight() {
    const { pw, height, blocks, light } = this;
    const slice = pw * pw;

    // Direct sunlight: walk each column down until something blocks it
    for (let z = 0; z < pw; z++) {
      for (let x = 0; x < pw; x++) {
        let level = MAX_LIGHT;
        for (let y = height - 1; y >= 0 && level > 0; y--) {
          const i = y * slice + z * pw + x;
          level = Math.max(0, level - opacityTable[blocks[i]]);
          light[i] = level << 4;
        }
      }
    }

    this.propagate(true);
  }

  private computeBlockLight() {
    const { blocks, light } = this;
    for (let i = 0; i < blocks.length; i++) {
      const e = emissionTable[blocks[i]];
      if (e > 0) light[i] = (light[i] & 0xf0) | e;
    }
    this.propagate(false);
  }

  /**
   * Breadth-first flood fill of one light channel from every cell that is
   * brighter than a neighbour could be lit by it.
   */
  private propagate(sky: boolean) {
    const { pw, height, blocks, light } = this;
    const slice = pw * pw;
    const shift = sky ? 4 : 0;
    const mask = sky ? 0x0f : 0xf0;
    const total = blocks.length;

    let queue = new Int32Array(total);
    let head = 0;
    let tail = 0;
    const push = (i: number) => {
      if (tail === queue.length) {
        const next = new Int32Array(queue.length * 2);
        next.set(queue);
        queue = next;
      }
      queue[tail++] = i;
    };

    const level = (i: number) => (light[i] >> shift) & 15;
    const setLevel = (i: number, l: number) => {
      light[i] = (light[i] & mask) | (l << shift);
    };

    const neighbors = [1, -1, pw, -pw, slice, -slice];

    // Seed with cells that can brighten at least one neighbour
    for (let i = 0; i < total; i++) {
      const l = level(i);
      if (l <= 1) continue;
      const x = i % pw;
      const z = ((i - x) / pw) % pw;
      const y = (i - x - z * pw) / slice;
      for (let k = 0; k < 6; k++) {
        if (k === 0 && x === pw - 1) continue;
        if (k === 1 && x === 0) continue;
        if (k === 2 && z === pw - 1) continue;
        if (k === 3 && z === 0) continue;
        if (k === 4 && y === height - 1) continue;
        if (k === 5 && y === 0) continue;
        const j = i + neighbors[k];
        if (l - 1 - opacityTable[blocks[j]] > level(j)) {
          push(i);
          break;
        }
      }
    }

    while (head < tail) {
      const i = queue[head++];
      const l = level(i);
      if (l <= 1) continue;
      const x = i % pw;
      const z = ((i - x) / pw) % pw;
      const y = (i - x - z * pw) / slice;

      for (let k = 0; k < 6; k++) {
        if (k === 0 && x === pw - 1) continue;
        if (k === 1 && x === 0) continue;
        if (k === 2 && z === pw - 1) continue;
        if (k === 3 && z === 0) continue;
        if (k === 4 && y === height - 1) continue;
        if (k === 5 && y === 0) continue;
        const j = i + neighbors[k];
        const next = l - 1 - opacityTable[blocks[j]];
        if (next > level(j)) {
          setLevel(j, next);
          if (next > 1) push(j);
        }
      }
    }
  }
}
