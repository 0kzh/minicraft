import {
  BlockDef,
  getBlockDef,
  RenderGeometry,
  RenderLayer,
} from "../Block/blocks";

import {
  blockIndex,
  ChunkNeighborhood,
  ChunkSize,
  NEIGHBORHOOD_CENTER,
} from "./ChunkData";
import { LitVolume, MAX_LIGHT } from "./lighting";

/**
 * Vertex layout for chunk meshes (see ChunkMaterial):
 *  position  vec3   float32  block-space position within the chunk
 *  uv        vec2   uint8    texture coordinates in tiles (repeat wrapping)
 *  layer     float  uint8    texture array layer
 *  flags     float  uint8    bits 0-2 face index (+X,-X,+Y,-Y,+Z,-Z), bit 3 emissive,
 *                            bits 4-5 ambient occlusion (0 darkest .. 3 open)
 *  light     vec2   uint8    sky and block light, 0-255 (normalized)
 */
export type MeshBuffers = {
  positions: Float32Array;
  uvs: Uint8Array;
  layers: Uint8Array;
  flags: Uint8Array;
  lights: Uint8Array;
  indices: Uint32Array;
  vertexCount: number;
  indexCount: number;
};

export type ChunkMesh = {
  opaque: MeshBuffers;
  cutout: MeshBuffers;
  translucent: MeshBuffers;
};

/** How far below the block top a liquid's exposed surface sits */
export const FLUID_SURFACE_DROP = 0.125;

export const FACE_POS_X = 0;
export const FACE_NEG_X = 1;
export const FACE_POS_Y = 2;
export const FACE_NEG_Y = 3;
export const FACE_POS_Z = 4;
export const FACE_NEG_Z = 5;

const EMISSIVE_FLAG = 8;
const AO_SHIFT = 4;

/** Scales a 0-15 light level to a normalized uint8 */
const LIGHT_SCALE = 255 / MAX_LIGHT;

/** Per-corner shading of a quad: sky, block light (0-15, may be fractional) and AO (0-3) */
type CornerShade = {
  sky: number[];
  block: number[];
  ao: number[];
};

const newShade = (): CornerShade => ({
  sky: [0, 0, 0, 0],
  block: [0, 0, 0, 0],
  ao: [0, 0, 0, 0],
});

class GeometryBuilder {
  positions = new Float32Array(3 * 1024);
  uvs = new Uint8Array(2 * 1024);
  layers = new Uint8Array(1024);
  flags = new Uint8Array(1024);
  lights = new Uint8Array(2 * 1024);
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
    this.lights = grow(this.lights, capacity * 2);
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
   * per-corner UVs and shading. The diagonal is chosen from the AO pattern so
   * occlusion interpolates without directional artefacts.
   */
  quad(
    corners: number[][],
    uvs: number[][],
    shade: CornerShade,
    layer: number,
    face: number,
    emissive: boolean
  ) {
    this.ensureVertices(4);
    this.ensureIndices(6);
    const base = this.vertexCount;
    for (let i = 0; i < 4; i++) {
      const vi = base + i;
      this.positions[vi * 3] = corners[i][0];
      this.positions[vi * 3 + 1] = corners[i][1];
      this.positions[vi * 3 + 2] = corners[i][2];
      this.uvs[vi * 2] = uvs[i][0];
      this.uvs[vi * 2 + 1] = uvs[i][1];
      this.layers[vi] = layer;
      this.flags[vi] =
        face | (emissive ? EMISSIVE_FLAG : 0) | (shade.ao[i] << AO_SHIFT);
      this.lights[vi * 2] = Math.round(shade.sky[i] * LIGHT_SCALE);
      this.lights[vi * 2 + 1] = Math.round(shade.block[i] * LIGHT_SCALE);
    }
    const ii = this.indexCount;
    // Run the diagonal through the darker pair of corners
    const flip = shade.ao[0] + shade.ao[2] > shade.ao[1] + shade.ao[3];
    if (flip) {
      this.indices[ii] = base + 1;
      this.indices[ii + 1] = base + 2;
      this.indices[ii + 2] = base + 3;
      this.indices[ii + 3] = base + 1;
      this.indices[ii + 4] = base + 3;
      this.indices[ii + 5] = base;
    } else {
      this.indices[ii] = base;
      this.indices[ii + 1] = base + 1;
      this.indices[ii + 2] = base + 2;
      this.indices[ii + 3] = base;
      this.indices[ii + 4] = base + 2;
      this.indices[ii + 5] = base + 3;
    }
    this.vertexCount += 4;
    this.indexCount += 6;
  }

  build(): MeshBuffers {
    return {
      positions: this.positions.slice(0, this.vertexCount * 3),
      uvs: this.uvs.slice(0, this.vertexCount * 2),
      layers: this.layers.slice(0, this.vertexCount),
      flags: this.flags.slice(0, this.vertexCount),
      lights: this.lights.slice(0, this.vertexCount * 2),
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

const occludes = (neighbor: BlockDef, self: BlockDef): boolean =>
  neighbor.opaque || (neighbor.id === self.id && self.cullSelf);

/**
 * Mask entry: non-zero when a face exists; encodes texture layer, render
 * layer, emissive flag and whether a liquid face borders its lowered surface.
 */
const faceKey = (def: BlockDef, face: number, surface: boolean): number =>
  (def.faces[face] + 1) |
  (def.emissive ? 1 << 9 : 0) |
  (def.layer << 10) |
  (surface ? 1 << 12 : 0);

const SURFACE_BIT = 1 << 12;

/** A liquid cell is a surface cell when the block above is not the same liquid */
const isFluidSurface = (
  vol: LitVolume,
  def: BlockDef,
  x: number,
  y: number,
  z: number
): boolean => def.fluid && vol.get(x, y + 1, z) !== def.id;

/**
 * Smooth lighting and ambient occlusion for the four corners of the face of
 * block `a` that looks into cell `b`. Each corner samples the four cells
 * around it on the b side of the face (b itself, the two edge neighbours and
 * the diagonal), averaging light over the non-opaque ones. AO follows the
 * classic three-neighbour rule: two occluded edges fully darken the corner.
 *
 * Results are packed for greedy merging into `keys`: AO (2 bits per corner),
 * then sky and block light in quarter levels (8 bits per corner).
 */
function cornerShading(
  vol: LitVolume,
  b: number[],
  u: number,
  v: number,
  keys: Int32Array
) {
  let aoKey = 0;
  let skyKey = 0;
  let blockKey = 0;
  const p = [0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const su = c === 1 || c === 2 ? 1 : -1;
    const sv = c === 2 || c === 3 ? 1 : -1;

    p[0] = b[0];
    p[1] = b[1];
    p[2] = b[2];
    p[u] += su;
    const side1 = vol.isOpaque(p[0], p[1], p[2]);
    let sky = 0;
    let block = 0;
    let count = 0;
    if (!side1) {
      sky += vol.skyLight(p[0], p[1], p[2]);
      block += vol.blockLight(p[0], p[1], p[2]);
      count++;
    }

    p[u] -= su;
    p[v] += sv;
    const side2 = vol.isOpaque(p[0], p[1], p[2]);
    if (!side2) {
      sky += vol.skyLight(p[0], p[1], p[2]);
      block += vol.blockLight(p[0], p[1], p[2]);
      count++;
    }

    p[u] += su;
    const corner = side1 && side2 ? true : vol.isOpaque(p[0], p[1], p[2]);
    if (!corner) {
      sky += vol.skyLight(p[0], p[1], p[2]);
      block += vol.blockLight(p[0], p[1], p[2]);
      count++;
    }

    if (!vol.isOpaque(b[0], b[1], b[2])) {
      sky += vol.skyLight(b[0], b[1], b[2]);
      block += vol.blockLight(b[0], b[1], b[2]);
      count++;
    }

    const ao =
      side1 && side2
        ? 0
        : 3 - ((side1 ? 1 : 0) + (side2 ? 1 : 0) + (corner ? 1 : 0));
    const skyQ = count ? Math.round((sky * 4) / count) : 0;
    const blockQ = count ? Math.round((block * 4) / count) : 0;

    aoKey |= ao << (c * 2);
    skyKey |= skyQ << (c * 8);
    blockKey |= blockQ << (c * 8);
  }
  keys[0] = aoKey;
  keys[1] = skyKey;
  keys[2] = blockKey;
}

const unpackShade = (
  aoKey: number,
  skyKey: number,
  blockKey: number,
  out: CornerShade
) => {
  for (let c = 0; c < 4; c++) {
    out.ao[c] = (aoKey >> (c * 2)) & 3;
    out.sky[c] = ((skyKey >>> (c * 8)) & 0xff) / 4;
    out.block[c] = ((blockKey >>> (c * 8)) & 0xff) / 4;
  }
};

/**
 * Builds culled, greedy-merged, smooth-lit geometry for a chunk.
 */
export function meshChunk(size: ChunkSize, n: ChunkNeighborhood): ChunkMesh {
  const vol = new LitVolume(size, n);
  const builders = {
    [RenderLayer.Opaque]: new GeometryBuilder(),
    [RenderLayer.Cutout]: new GeometryBuilder(),
    [RenderLayer.Translucent]: new GeometryBuilder(),
  };

  meshCubes(size, vol, builders);
  meshCrosses(size, n.chunks[NEIGHBORHOOD_CENTER] as Uint8Array, vol, builders);

  return {
    opaque: builders[RenderLayer.Opaque].build(),
    cutout: builders[RenderLayer.Cutout].build(),
    translucent: builders[RenderLayer.Translucent].build(),
  };
}

/** Per-slice face masks: block key, AO key and light keys per cell */
type FaceMask = {
  key: Int32Array;
  ao: Int32Array;
  sky: Int32Array;
  block: Int32Array;
};

const newMask = (n: number): FaceMask => ({
  key: new Int32Array(n),
  ao: new Int32Array(n),
  sky: new Int32Array(n),
  block: new Int32Array(n),
});

function meshCubes(
  size: ChunkSize,
  vol: LitVolume,
  builders: Record<RenderLayer, GeometryBuilder>
) {
  const dims = [size.width, size.height, size.width];
  const pos = [0, 0, 0];
  const next = [0, 0, 0];
  const keys = new Int32Array(3);

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const du = dims[u];
    const dv = dims[v];
    const maskPos = newMask(du * dv);
    const maskNeg = newMask(du * dv);
    const facePos = d * 2;
    const faceNeg = d * 2 + 1;
    // X faces have u = y, v = z; swap so texture s runs horizontally
    const swapUV = d === 0;

    for (pos[d] = -1; pos[d] < dims[d]; pos[d]++) {
      let idx = 0;
      for (pos[v] = 0; pos[v] < dv; pos[v]++) {
        for (pos[u] = 0; pos[u] < du; pos[u]++, idx++) {
          next[0] = pos[0] + (d === 0 ? 1 : 0);
          next[1] = pos[1] + (d === 1 ? 1 : 0);
          next[2] = pos[2] + (d === 2 ? 1 : 0);
          const a = getBlockDef(vol.get(pos[0], pos[1], pos[2]));
          const b = getBlockDef(vol.get(next[0], next[1], next[2]));

          if (
            pos[d] >= 0 &&
            a.geometry === RenderGeometry.Cube &&
            !occludes(b, a)
          ) {
            maskPos.key[idx] = faceKey(
              a,
              facePos,
              isFluidSurface(vol, a, pos[0], pos[1], pos[2])
            );
            cornerShading(vol, next, u, v, keys);
            maskPos.ao[idx] = keys[0];
            maskPos.sky[idx] = keys[1];
            maskPos.block[idx] = keys[2];
          } else {
            maskPos.key[idx] = 0;
          }

          if (
            pos[d] < dims[d] - 1 &&
            b.geometry === RenderGeometry.Cube &&
            !occludes(a, b)
          ) {
            maskNeg.key[idx] = faceKey(
              b,
              faceNeg,
              isFluidSurface(vol, b, next[0], next[1], next[2])
            );
            cornerShading(vol, pos, u, v, keys);
            maskNeg.ao[idx] = keys[0];
            maskNeg.sky[idx] = keys[1];
            maskNeg.block[idx] = keys[2];
          } else {
            maskNeg.key[idx] = 0;
          }
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
        vol,
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
        vol,
        builders,
        pos[d] + 1
      );
    }
  }
}

const sameFace = (mask: FaceMask, a: number, b: number): boolean =>
  mask.key[a] === mask.key[b] &&
  mask.ao[a] === mask.ao[b] &&
  mask.sky[a] === mask.sky[b] &&
  mask.block[a] === mask.block[b];

function emitGreedy(
  mask: FaceMask,
  du: number,
  dv: number,
  d: number,
  u: number,
  v: number,
  plane: number,
  face: number,
  positive: boolean,
  swapUV: boolean,
  vol: LitVolume,
  builders: Record<RenderLayer, GeometryBuilder>,
  blockSlice: number
) {
  const shade = newShade();
  const reordered = newShade();

  for (let j = 0; j < dv; j++) {
    for (let i = 0; i < du; ) {
      const n = j * du + i;
      if (mask.key[n] === 0) {
        i++;
        continue;
      }

      let w = 1;
      while (i + w < du && sameFace(mask, n, n + w)) w++;

      let h = 1;
      outer: for (; j + h < dv; h++) {
        for (let k = 0; k < w; k++) {
          if (!sameFace(mask, n, n + k + h * du)) break outer;
        }
      }

      unpackShade(mask.ao[n], mask.sky[n], mask.block[n], shade);
      const surface = (mask.key[n] & SURFACE_BIT) !== 0;
      for (let hh = 0; hh < h; hh++) {
        mask.key.fill(0, n + hh * du, n + hh * du + w);
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
      const def = getBlockDef(vol.get(sample[0], sample[1], sample[2]));

      const p0 = base;
      const p1 = base.slice();
      p1[u] += w;
      const p2 = p1.slice();
      p2[v] += h;
      const p3 = base.slice();
      p3[v] += h;

      if (surface && (d !== 1 || positive)) {
        // Lower the exposed liquid surface: the whole top face, or the top
        // edge of side faces (surface quads are always one block tall)
        const top = d === 1 ? plane : base[1] + 1;
        for (const p of [p0, p1, p2, p3]) {
          if (p[1] === top) p[1] -= FLUID_SURFACE_DROP;
        }
      }

      const uv = (uOff: number, vOff: number) =>
        swapUV ? [vOff, uOff] : [uOff, vOff];
      const uv0 = uv(0, 0);
      const uv1 = uv(w, 0);
      const uv2 = uv(w, h);
      const uv3 = uv(0, h);

      // Corner c of the shading corresponds to p_c; negative faces wind 0,3,2,1
      const order = positive ? [0, 1, 2, 3] : [0, 3, 2, 1];
      const corners = order.map((c) => [p0, p1, p2, p3][c]);
      const uvs = order.map((c) => [uv0, uv1, uv2, uv3][c]);
      for (let k = 0; k < 4; k++) {
        reordered.sky[k] = shade.sky[order[k]];
        reordered.block[k] = shade.block[order[k]];
        reordered.ao[k] = shade.ao[order[k]];
      }

      builders[def.layer].quad(
        corners,
        uvs,
        reordered,
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
  vol: LitVolume,
  builders: Record<RenderLayer, GeometryBuilder>
) {
  const w = size.width;
  const shade = newShade();
  for (let y = 0; y < size.height; y++) {
    for (let z = 0; z < w; z++) {
      for (let x = 0; x < w; x++) {
        const def = getBlockDef(data[blockIndex(size, x, y, z)]);
        if (def.geometry !== RenderGeometry.Cross) continue;

        const sky = vol.skyLight(x, y, z);
        const block = vol.blockLight(x, y, z);
        shade.sky.fill(sky);
        shade.block.fill(block);
        shade.ao.fill(3);

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
          shade,
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
          shade,
          layer,
          FACE_POS_Y,
          def.emissive
        );
      }
    }
  }
}
