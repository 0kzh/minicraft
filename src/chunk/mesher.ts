import { BlockID } from "../Block";
import {
  BlockDef,
  getBlockDef,
  RenderGeometry,
  RenderLayer,
} from "../Block/blocks";

import { blockIndex, ChunkNeighborhood, ChunkSize } from "./ChunkData";

/**
 * Vertex layout for chunk meshes (see ChunkMaterial):
 *  position  vec3   float32  block-space position within the chunk
 *  uv        vec2   uint8    texture coordinates in tiles (repeat wrapping)
 *  layer     float  uint8    texture array layer
 *  flags     float  uint8    bits 0-2 face index (+X,-X,+Y,-Y,+Z,-Z), bit 3 emissive
 */
export type MeshBuffers = {
  positions: Float32Array;
  uvs: Uint8Array;
  layers: Uint8Array;
  flags: Uint8Array;
  indices: Uint32Array;
  vertexCount: number;
  indexCount: number;
};

export type ChunkMesh = {
  opaque: MeshBuffers;
  cutout: MeshBuffers;
};

export const FACE_POS_X = 0;
export const FACE_NEG_X = 1;
export const FACE_POS_Y = 2;
export const FACE_NEG_Y = 3;
export const FACE_POS_Z = 4;
export const FACE_NEG_Z = 5;

const EMISSIVE_FLAG = 8;

class GeometryBuilder {
  positions = new Float32Array(3 * 1024);
  uvs = new Uint8Array(2 * 1024);
  layers = new Uint8Array(1024);
  flags = new Uint8Array(1024);
  indices = new Uint32Array(6 * 256);
  vertexCount = 0;
  indexCount = 0;

  private ensureVertices(extra: number) {
    const needed = this.vertexCount + extra;
    if (needed <= this.layers.length) return;
    let capacity = this.layers.length;
    while (capacity < needed) capacity *= 2;
    this.positions = grow(this.positions, capacity * 3);
    this.uvs = grow(this.uvs, capacity * 2);
    this.layers = grow(this.layers, capacity);
    this.flags = grow(this.flags, capacity);
  }

  private ensureIndices(extra: number) {
    const needed = this.indexCount + extra;
    if (needed <= this.indices.length) return;
    let capacity = this.indices.length;
    while (capacity < needed) capacity *= 2;
    this.indices = grow(this.indices, capacity);
  }

  /**
   * Adds a quad given its four corners in counter-clockwise order along with
   * per-corner UVs.
   */
  quad(
    corners: number[][],
    uvs: number[][],
    layer: number,
    face: number,
    emissive: boolean
  ) {
    this.ensureVertices(4);
    this.ensureIndices(6);
    const base = this.vertexCount;
    const flag = face | (emissive ? EMISSIVE_FLAG : 0);
    for (let i = 0; i < 4; i++) {
      const vi = base + i;
      this.positions[vi * 3] = corners[i][0];
      this.positions[vi * 3 + 1] = corners[i][1];
      this.positions[vi * 3 + 2] = corners[i][2];
      this.uvs[vi * 2] = uvs[i][0];
      this.uvs[vi * 2 + 1] = uvs[i][1];
      this.layers[vi] = layer;
      this.flags[vi] = flag;
    }
    const ii = this.indexCount;
    this.indices[ii] = base;
    this.indices[ii + 1] = base + 1;
    this.indices[ii + 2] = base + 2;
    this.indices[ii + 3] = base;
    this.indices[ii + 4] = base + 2;
    this.indices[ii + 5] = base + 3;
    this.vertexCount += 4;
    this.indexCount += 6;
  }

  build(): MeshBuffers {
    return {
      positions: this.positions.slice(0, this.vertexCount * 3),
      uvs: this.uvs.slice(0, this.vertexCount * 2),
      layers: this.layers.slice(0, this.vertexCount),
      flags: this.flags.slice(0, this.vertexCount),
      indices: this.indices.slice(0, this.indexCount),
      vertexCount: this.vertexCount,
      indexCount: this.indexCount,
    };
  }
}

function grow<T extends Float32Array | Uint8Array | Uint32Array>(
  arr: T,
  capacity: number
): T {
  const next = new (arr.constructor as new (n: number) => T)(capacity);
  next.set(arr);
  return next;
}

/**
 * Padded voxel lookup covering the chunk plus a one block border taken from
 * the neighbouring chunks. Unloaded neighbours and the space above the world
 * read as air; below the world reads as bedrock so the world floor is culled.
 */
class PaddedVoxels {
  private readonly pw: number;
  private readonly data: Uint8Array;

  constructor(private readonly size: ChunkSize, n: ChunkNeighborhood) {
    const w = size.width;
    const h = size.height;
    this.pw = w + 2;
    this.data = new Uint8Array(this.pw * this.pw * h);

    for (let y = 0; y < h; y++) {
      for (let z = 0; z < w; z++) {
        const rowStart = blockIndex(size, 0, y, z);
        this.data.set(
          n.center.subarray(rowStart, rowStart + w),
          this.paddedIndex(0, y, z)
        );
        if (n.negX) {
          this.data[this.paddedIndex(-1, y, z)] =
            n.negX[blockIndex(size, w - 1, y, z)];
        }
        if (n.posX) {
          this.data[this.paddedIndex(w, y, z)] =
            n.posX[blockIndex(size, 0, y, z)];
        }
      }
      for (let x = 0; x < w; x++) {
        if (n.negZ) {
          this.data[this.paddedIndex(x, y, -1)] =
            n.negZ[blockIndex(size, x, y, w - 1)];
        }
        if (n.posZ) {
          this.data[this.paddedIndex(x, y, w)] =
            n.posZ[blockIndex(size, x, y, 0)];
        }
      }
    }
  }

  private paddedIndex(x: number, y: number, z: number) {
    return (y * this.pw + z + 1) * this.pw + x + 1;
  }

  get(x: number, y: number, z: number): BlockID {
    if (y < 0) return BlockID.Bedrock;
    if (y >= this.size.height) return BlockID.Air;
    return this.data[this.paddedIndex(x, y, z)];
  }
}

const occludes = (neighbor: BlockDef, self: BlockDef): boolean =>
  neighbor.opaque || (neighbor.id === self.id && self.cullSelf);

/** Mask entry: non-zero when a face exists; encodes layer and emissive flag */
const faceKey = (def: BlockDef, face: number): number =>
  (def.faces[face] + 1) | (def.emissive ? 1 << 9 : 0) | (def.layer << 10);

/**
 * Builds culled, greedy-merged geometry for a chunk.
 */
export function meshChunk(size: ChunkSize, n: ChunkNeighborhood): ChunkMesh {
  const voxels = new PaddedVoxels(size, n);
  const builders = {
    [RenderLayer.Opaque]: new GeometryBuilder(),
    [RenderLayer.Cutout]: new GeometryBuilder(),
  };

  meshCubes(size, voxels, builders);
  meshCrosses(size, n.center, builders);

  return {
    opaque: builders[RenderLayer.Opaque].build(),
    cutout: builders[RenderLayer.Cutout].build(),
  };
}

function meshCubes(
  size: ChunkSize,
  voxels: PaddedVoxels,
  builders: Record<RenderLayer, GeometryBuilder>
) {
  const dims = [size.width, size.height, size.width];
  const pos = [0, 0, 0];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const du = dims[u];
    const dv = dims[v];
    const maskPos = new Int32Array(du * dv);
    const maskNeg = new Int32Array(du * dv);
    const facePos = d * 2;
    const faceNeg = d * 2 + 1;
    // X faces have u = y, v = z; swap so texture s runs horizontally
    const swapUV = d === 0;

    for (pos[d] = -1; pos[d] < dims[d]; pos[d]++) {
      let idx = 0;
      for (pos[v] = 0; pos[v] < dv; pos[v]++) {
        for (pos[u] = 0; pos[u] < du; pos[u]++, idx++) {
          const aId = voxels.get(pos[0], pos[1], pos[2]);
          const bId = voxels.get(
            pos[0] + (d === 0 ? 1 : 0),
            pos[1] + (d === 1 ? 1 : 0),
            pos[2] + (d === 2 ? 1 : 0)
          );
          const a = getBlockDef(aId);
          const b = getBlockDef(bId);

          maskPos[idx] =
            pos[d] >= 0 && a.geometry === RenderGeometry.Cube && !occludes(b, a)
              ? faceKey(a, facePos)
              : 0;
          maskNeg[idx] =
            pos[d] < dims[d] - 1 &&
            b.geometry === RenderGeometry.Cube &&
            !occludes(a, b)
              ? faceKey(b, faceNeg)
              : 0;
        }
      }

      const plane = pos[d] + 1;
      emitGreedy(
        maskPos,
        du,
        dv,
        d,
        u,
        v,
        plane,
        facePos,
        true,
        swapUV,
        voxels,
        builders,
        pos[d]
      );
      emitGreedy(
        maskNeg,
        du,
        dv,
        d,
        u,
        v,
        plane,
        faceNeg,
        false,
        swapUV,
        voxels,
        builders,
        pos[d] + 1
      );
    }
  }
}

function emitGreedy(
  mask: Int32Array,
  du: number,
  dv: number,
  d: number,
  u: number,
  v: number,
  plane: number,
  face: number,
  positive: boolean,
  swapUV: boolean,
  voxels: PaddedVoxels,
  builders: Record<RenderLayer, GeometryBuilder>,
  blockSlice: number
) {
  for (let j = 0; j < dv; j++) {
    for (let i = 0; i < du; ) {
      const n = j * du + i;
      const key = mask[n];
      if (key === 0) {
        i++;
        continue;
      }

      let w = 1;
      while (i + w < du && mask[n + w] === key) w++;

      let h = 1;
      outer: for (; j + h < dv; h++) {
        for (let k = 0; k < w; k++) {
          if (mask[n + k + h * du] !== key) break outer;
        }
      }

      for (let hh = 0; hh < h; hh++) {
        mask.fill(0, n + hh * du, n + hh * du + w);
      }

      const base = [0, 0, 0];
      base[d] = plane;
      base[u] = i;
      base[v] = j;

      // Sample the block owning this face to pick its render layer
      const sample = [0, 0, 0];
      sample[d] = blockSlice;
      sample[u] = i;
      sample[v] = j;
      const def = getBlockDef(voxels.get(sample[0], sample[1], sample[2]));

      const p0 = base;
      const p1 = base.slice();
      p1[u] += w;
      const p2 = p1.slice();
      p2[v] += h;
      const p3 = base.slice();
      p3[v] += h;

      const uv = (uOff: number, vOff: number) =>
        swapUV ? [vOff, uOff] : [uOff, vOff];
      const uv0 = uv(0, 0);
      const uv1 = uv(w, 0);
      const uv2 = uv(w, h);
      const uv3 = uv(0, h);

      const corners = positive ? [p0, p1, p2, p3] : [p0, p3, p2, p1];
      const uvs = positive ? [uv0, uv1, uv2, uv3] : [uv0, uv3, uv2, uv1];

      builders[def.layer].quad(
        corners,
        uvs,
        def.faces[face],
        face,
        def.emissive
      );

      i += w;
    }
  }
}

// Half the diagonal extent of a cross-shaped plant quad so it spans one block
const CROSS_HALF = Math.SQRT1_2 * 0.5;

function meshCrosses(
  size: ChunkSize,
  data: Uint8Array,
  builders: Record<RenderLayer, GeometryBuilder>
) {
  const w = size.width;
  for (let y = 0; y < size.height; y++) {
    for (let z = 0; z < w; z++) {
      for (let x = 0; x < w; x++) {
        const def = getBlockDef(data[blockIndex(size, x, y, z)]);
        if (def.geometry !== RenderGeometry.Cross) continue;

        const cx = x + 0.5;
        const cz = z + 0.5;
        const r = CROSS_HALF;
        const layer = def.faces[FACE_POS_Y];
        const uvs = [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ];
        const builder = builders[def.layer];
        builder.quad(
          [
            [cx - r, y, cz - r],
            [cx + r, y, cz + r],
            [cx + r, y + 1, cz + r],
            [cx - r, y + 1, cz - r],
          ],
          uvs,
          layer,
          FACE_POS_Y,
          def.emissive
        );
        builder.quad(
          [
            [cx - r, y, cz + r],
            [cx + r, y, cz - r],
            [cx + r, y + 1, cz - r],
            [cx - r, y + 1, cz + r],
          ],
          uvs,
          layer,
          FACE_POS_Y,
          def.emissive
        );
      }
    }
  }
}
