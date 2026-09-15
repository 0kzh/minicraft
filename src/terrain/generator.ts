import { BlockID, oreConfig } from "../Block";
import { getBlockDef } from "../Block/blocks";
import { blockIndex, ChunkSize, createChunkData } from "../chunk/ChunkData";
import { RNG } from "../RNG";
import { WorldParams } from "../WorldParams";

import { Biome, biomeDef, isOceanic } from "./biomes";
import {
  Channel,
  clamp,
  hash32,
  hashUnit,
  lerp,
  smoothstep,
  spline,
  worldNoise,
  WorldNoise,
} from "./noise";
import { placeTree, TREE_REACH } from "./trees";

/** Columns sampled beyond the chunk edge so decorations can straddle borders */
const PAD = TREE_REACH;

/** Spacing of the 3D noise lattice that caves are interpolated from */
const CAVE_STEP = 4;

/** Continentalness -> base terrain height */
const CONTINENT_SPLINE: [number, number][] = [
  [-1, 26],
  [-0.7, 33],
  [-0.5, 44],
  [-0.32, 56],
  [-0.2, 62],
  [-0.1, 66],
  [0.2, 71],
  [0.55, 82],
  [1, 94],
];

/** Erosion -> how much the ridge field is allowed to raise the terrain */
const RUGGEDNESS_SPLINE: [number, number][] = [
  [-1, 1],
  [-0.45, 0.72],
  [0.1, 0.35],
  [0.55, 0.14],
  [1, 0.05],
];

/** Per-column terrain sample, shared by shaping, filling and decorating */
export type Column = {
  height: number;
  biome: Biome;
  continent: number;
  ruggedness: number;
  temperature: number;
  humidity: number;
  /** Small-scale noise used to vary surface layers */
  surface: number;
};

const newColumn = (): Column => ({
  height: 0,
  biome: Biome.Plains,
  continent: 0,
  ruggedness: 0,
  temperature: 0,
  humidity: 0,
  surface: 0,
});

/**
 * Shapes a single column of terrain from the stacked 2D noise fields.
 */
export function sampleColumn(
  noise: WorldNoise,
  params: WorldParams,
  size: ChunkSize,
  wx: number,
  wz: number,
  out: Column
): Column {
  const t = params.terrain;
  const sea = t.seaLevel;

  const c = clamp(
    noise.fbm2(
      Channel.Continent,
      wx / t.continentScale,
      wz / t.continentScale,
      4
    ) * 1.5,
    -1,
    1
  );
  const e = clamp(
    noise.fbm2(Channel.Erosion, wx / t.erosionScale, wz / t.erosionScale, 3) *
      1.5,
    -1,
    1
  );
  const ridge = noise.ridge2(
    Channel.Ridge,
    wx / t.ridgeScale,
    wz / t.ridgeScale,
    3
  );
  const detail = noise.fbm2(
    Channel.Detail,
    wx / t.detailScale,
    wz / t.detailScale,
    3
  );

  const ruggedness = spline(RUGGEDNESS_SPLINE, e);
  const landMask = smoothstep(-0.25, 0.2, c);
  let height = spline(CONTINENT_SPLINE, c);
  const mountainAmp = 58 * ruggedness * landMask * t.amplitude;
  height += (ridge - 0.3) * mountainAmp;
  height += detail * (3 + 9 * ruggedness * landMask);

  let temperature = clamp(
    noise.fbm2(Channel.Temperature, wx / t.biomeScale, wz / t.biomeScale, 2) *
      1.5,
    -1,
    1
  );
  const humidity = clamp(
    noise.fbm2(
      Channel.Humidity,
      wx / (t.biomeScale * 0.7) + 1000,
      wz / (t.biomeScale * 0.7),
      2
    ) * 1.5,
    -1,
    1
  );

  // Swamps sit right at sea level with pools wherever the ground dips
  const swampy =
    humidity > 0.42 &&
    temperature > -0.15 &&
    c > -0.15 &&
    height >= sea - 3 &&
    height <= sea + 8;
  if (swampy) {
    height = lerp(height, sea + 1, 0.75);
    if (detail < -0.22) height = sea - 1;
  }

  // Rivers: cut a channel where the river field crosses zero
  let river = false;
  if (t.rivers && c > -0.22 && !swampy) {
    const r = Math.abs(
      noise.fbm2(Channel.River, wx / t.riverScale, wz / t.riverScale, 2)
    );
    const channelW = 0.018;
    const bankW = channelW + 0.05 + Math.max(0, height - sea) / 500;
    if (r < bankW) {
      const bed = sea - 3.5 + smoothstep(0, channelW, r) * 2;
      const blend = smoothstep(channelW * 0.6, bankW, r);
      const riverHeight = lerp(bed, height, blend);
      if (riverHeight < height) {
        height = riverHeight;
        river = height < sea;
      }
    }
  }

  // Colder with altitude
  temperature -= Math.max(0, height - 78) / 55;

  height = clamp(Math.floor(height), 1, size.height - 2);

  let biome: Biome;
  if (river) {
    biome = Biome.River;
  } else if (c < -0.55 && height < sea - 10) {
    biome = Biome.DeepOcean;
  } else if (height < sea - 1) {
    biome = swampy ? Biome.Swamp : Biome.Ocean;
  } else if (swampy) {
    biome = Biome.Swamp;
  } else if (height <= sea + 2 && c < -0.05) {
    biome = temperature < -0.35 ? Biome.StonyShore : Biome.Beach;
  } else if (height > 104 || (height > 90 && ruggedness > 0.62)) {
    biome =
      height > 112 || temperature < -0.05 ? Biome.SnowyPeaks : Biome.Mountains;
  } else if (temperature < -0.55) {
    biome = humidity > 0.05 ? Biome.SnowyTaiga : Biome.SnowyTundra;
  } else if (temperature < -0.28) {
    biome = Biome.Taiga;
  } else if (temperature > 0.45) {
    biome = humidity < 0.05 ? Biome.Desert : Biome.Savanna;
  } else if (humidity > 0.3 && temperature > 0.05 && temperature < 0.3) {
    biome = Biome.BirchForest;
  } else if (humidity > 0.04) {
    biome = Biome.Forest;
  } else if (humidity < -0.3 && temperature > 0.2) {
    biome = Biome.Savanna;
  } else {
    biome = Biome.Plains;
  }

  out.height = height;
  out.biome = biome;
  out.continent = c;
  out.ruggedness = ruggedness;
  out.temperature = temperature;
  out.humidity = humidity;
  out.surface = noise.noise2(Channel.Surface, wx / 14, wz / 14);
  return out;
}

/**
 * 3D noise sampled on a coarse world-aligned lattice and trilinearly
 * interpolated, so caves stay continuous across chunk borders at a fraction
 * of the per-voxel cost.
 */
class Lattice {
  private readonly values: Float32Array;
  private readonly nx: number;
  private readonly ny: number;
  private readonly x0: number;
  private readonly z0: number;

  constructor(
    originX: number,
    originZ: number,
    span: number,
    height: number,
    sample: (wx: number, y: number, wz: number) => number
  ) {
    this.x0 = Math.floor((originX - PAD) / CAVE_STEP) * CAVE_STEP;
    this.z0 = Math.floor((originZ - PAD) / CAVE_STEP) * CAVE_STEP;
    this.nx = Math.ceil((originX + span + PAD - this.x0) / CAVE_STEP) + 1;
    const nz = Math.ceil((originZ + span + PAD - this.z0) / CAVE_STEP) + 1;
    this.ny = Math.ceil(height / CAVE_STEP) + 1;
    this.values = new Float32Array(this.nx * this.ny * nz);
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < this.ny; j++) {
        for (let i = 0; i < this.nx; i++) {
          this.values[(k * this.ny + j) * this.nx + i] = sample(
            this.x0 + i * CAVE_STEP,
            j * CAVE_STEP,
            this.z0 + k * CAVE_STEP
          );
        }
      }
    }
  }

  /** Value at world (wx, y, wz), which must lie inside the padded span */
  get(wx: number, y: number, wz: number): number {
    const fx = (wx - this.x0) / CAVE_STEP;
    const fy = y / CAVE_STEP;
    const fz = (wz - this.z0) / CAVE_STEP;
    const i = Math.floor(fx);
    const j = Math.min(Math.floor(fy), this.ny - 2);
    const k = Math.floor(fz);
    const tx = fx - i;
    const ty = fy - j;
    const tz = fz - k;
    const v = this.values;
    const nx = this.nx;
    const ny = this.ny;
    const idx = (k * ny + j) * nx + i;
    const c00 = lerp(v[idx], v[idx + 1], tx);
    const c10 = lerp(v[idx + nx], v[idx + nx + 1], tx);
    const c01 = lerp(v[idx + nx * ny], v[idx + nx * ny + 1], tx);
    const c11 = lerp(v[idx + nx * ny + nx], v[idx + nx * ny + nx + 1], tx);
    return lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz);
  }
}

type Carver = {
  cheese: Lattice;
  spaghettiA: Lattice;
  spaghettiB: Lattice;
};

/** Cells this close to a submerged floor are never carved, keeping seas sealed */
const SEA_FLOOR_SEAL = 4;
/** Columns this close above sea level count as coast: no ravines, flooded caves */
const COAST_BAND = 6;
/** Columns within this many blocks of open sea also count as coast */
const COAST_REACH = PAD - 1;

/**
 * Whether the cell at world (wx, y, wz) in a column of the given height is
 * hollowed out by a cave or ravine.
 */
function isCarved(
  noise: WorldNoise,
  params: WorldParams,
  carver: Carver,
  wx: number,
  y: number,
  wz: number,
  col: Column
): boolean {
  const cv = params.caves;
  const sea = params.terrain.seaLevel;
  if (y < 4 || y > col.height) return false;
  const submerged = col.height < sea;
  if (submerged && y > col.height - SEA_FLOOR_SEAL) return false;

  // Large caverns, rarer near the surface
  const cheese = carver.cheese.get(wx, y, wz);
  const surfaceFade = clamp((y - 30) / 60, 0, 1);
  if (cheese > cv.cheeseThreshold + 0.22 * surfaceFade) return true;

  // Tunnels along the intersection of two noise iso-surfaces
  const a = carver.spaghettiA.get(wx, y, wz);
  const b = carver.spaghettiB.get(wx, y, wz);
  const radius = cv.spaghettiRadius * (0.7 + 0.6 * (cheese + 1) * 0.5);
  if (a * a + b * b < radius * radius) return true;

  // Ravines: deep narrow canyons open to the sky
  if (cv.ravines && !submerged && col.height > sea + COAST_BAND) {
    const gate = noise.noise2(Channel.Ravine, wx / 900 + 50, wz / 900);
    if (gate > 0.32) {
      const bottom = Math.max(12, col.height - 42);
      if (y >= bottom) {
        const r = Math.abs(noise.fbm2(Channel.Ravine, wx / 260, wz / 260, 2));
        const depth = (y - bottom) / Math.max(1, col.height - bottom);
        const width = 0.006 + 0.016 * depth;
        if (r < width) return true;
      }
    }
  }
  return false;
}

/**
 * Generates the voxel data for chunk (chunkX, chunkZ).
 *
 * Pipeline: sample padded column heights and biomes -> fill stone, surface
 * layers and sea water -> carve caves (flooding under the sea, lava at the
 * bottom) -> ore veins and underground patches -> biome decorations
 * (trees, cacti, plants) placed deterministically so they match across
 * chunk borders.
 */
export function generateChunkData(
  size: ChunkSize,
  params: WorldParams,
  chunkX: number,
  chunkZ: number
): Uint8Array {
  const data = createChunkData(size);
  const noise = worldNoise(params.seed);
  const w = size.width;
  const originX = chunkX * w;
  const originZ = chunkZ * w;
  const sea = params.terrain.seaLevel;
  const pw = w + PAD * 2;

  const columns: Column[] = new Array(pw * pw);
  for (let lz = -PAD; lz < w + PAD; lz++) {
    for (let lx = -PAD; lx < w + PAD; lx++) {
      columns[(lz + PAD) * pw + (lx + PAD)] = sampleColumn(
        noise,
        params,
        size,
        originX + lx,
        originZ + lz,
        newColumn()
      );
    }
  }
  const column = (lx: number, lz: number) =>
    columns[(lz + PAD) * pw + (lx + PAD)];

  const put = (lx: number, y: number, lz: number, id: BlockID) => {
    if (lx < 0 || lx >= w || lz < 0 || lz >= w || y < 0 || y >= size.height)
      return;
    data[blockIndex(size, lx, y, lz)] = id;
  };
  const at = (lx: number, y: number, lz: number): BlockID =>
    lx < 0 || lx >= w || lz < 0 || lz >= w || y < 0 || y >= size.height
      ? BlockID.Air
      : data[blockIndex(size, lx, y, lz)];

  fillColumns(size, params, columns, pw, originX, originZ, data);

  let carver: Carver | null = null;
  if (params.caves.enabled) {
    const cv = params.caves;
    carver = {
      cheese: new Lattice(originX, originZ, w, size.height, (x, y, z) =>
        noise.fbm3(
          Channel.Cheese,
          x / cv.cheeseScale,
          y / (cv.cheeseScale * 0.55),
          z / cv.cheeseScale,
          2
        )
      ),
      spaghettiA: new Lattice(originX, originZ, w, size.height, (x, y, z) =>
        noise.noise3(
          Channel.SpaghettiA,
          x / cv.spaghettiScale,
          y / (cv.spaghettiScale * 0.7),
          z / cv.spaghettiScale
        )
      ),
      spaghettiB: new Lattice(originX, originZ, w, size.height, (x, y, z) =>
        noise.noise3(
          Channel.SpaghettiB,
          x / cv.spaghettiScale,
          y / (cv.spaghettiScale * 0.7),
          z / cv.spaghettiScale
        )
      ),
    };
    carveCaves(
      size,
      params,
      noise,
      carver,
      columns,
      pw,
      originX,
      originZ,
      data
    );
  }

  const rng = new RNG(hash32(params.seed, chunkX, chunkZ, 0x0e5));
  placePatches(size, params, rng, data);
  placeOres(size, params, rng, data);

  // Decorations: every padded column rolls its own dice from a position hash
  // so neighbouring chunks agree on trees that cross the border
  for (let lz = -PAD; lz < w + PAD; lz++) {
    for (let lx = -PAD; lx < w + PAD; lx++) {
      const col = column(lx, lz);
      const wx = originX + lx;
      const wz = originZ + lz;
      const y = col.height;
      if (y < sea || y + 2 >= size.height) continue;
      if (carver && isCarved(noise, params, carver, wx, y, wz, col)) continue;

      const def = biomeDef(col.biome);
      const surface = surfaceBlock(col, sea);
      const grassy = surface === BlockID.Grass || surface === BlockID.SnowGrass;

      const roll = hashUnit(params.seed, wx, wz, 11);
      if (
        grassy &&
        def.trees.length &&
        roll < def.treeChance * params.trees.density
      ) {
        placeTree(
          def,
          params.seed,
          wx,
          wz,
          lx,
          y + 1,
          lz,
          put,
          at,
          col.biome === Biome.Swamp
        );
        continue;
      }

      // Single-block plants only matter inside the chunk
      if (lx < 0 || lx >= w || lz < 0 || lz >= w) continue;
      const plant = hashUnit(params.seed, wx, wz, 12);
      const veg = params.vegetation.density;
      if (def.snowy) {
        // Cold biomes are dusted with a thin snow layer rather than full blocks
        if (surface !== BlockID.Snow && at(lx, y + 1, lz) === BlockID.Air)
          put(lx, y + 1, lz, BlockID.SnowLayer);
      } else if (surface === BlockID.Sand) {
        if (plant < def.cactusChance * veg) {
          const h = 1 + Math.floor(hashUnit(params.seed, wx, wz, 13) * 3);
          for (let i = 0; i < h; i++) put(lx, y + 1 + i, lz, BlockID.Cactus);
        } else if (plant < (def.cactusChance + def.deadBushChance) * veg) {
          put(lx, y + 1, lz, BlockID.DeadBush);
        }
      } else if (grassy && at(lx, y + 1, lz) === BlockID.Air) {
        const flowers = def.flowerChance * veg;
        const grass = def.grassChance * veg;
        if (plant < flowers) {
          put(
            lx,
            y + 1,
            lz,
            hashUnit(params.seed, wx, wz, 14) < 0.5
              ? BlockID.FlowerDandelion
              : BlockID.FlowerRose
          );
        } else if (plant < flowers + grass && surface === BlockID.Grass) {
          // Cluster grass with a low-frequency mask so it comes in patches
          const patch = noise.noise2(Channel.Surface, wx / 9 + 300, wz / 9);
          if (patch > -0.35) put(lx, y + 1, lz, BlockID.TallGrass);
        }
      }
    }
  }

  return data;
}

/** The block that ends up on top of a column's ground */
function surfaceBlock(col: Column, sea: number): BlockID {
  const def = biomeDef(col.biome);
  if (col.height < sea) {
    if (isOceanic(col.biome)) {
      return sea - col.height > 14 ? BlockID.Gravel : def.top;
    }
    return BlockID.Dirt;
  }
  let top = def.top;
  if (col.biome === Biome.Mountains) {
    // Grass clings to the gentler lower slopes
    if (col.height < 98 && col.surface > 0.25) top = BlockID.Grass;
  }
  if (col.biome === Biome.SnowyPeaks) {
    // Peaks are bare stone under the snow cover; full snow blocks only
    // build up in patches on the gentler ground (vanilla `jagged_peaks`
    // keeps stone on steep faces)
    if (col.surface > 0.45) top = BlockID.Snow;
  }
  if (def.snowy && top === BlockID.Grass) top = BlockID.SnowGrass;
  return top;
}

function fillColumns(
  size: ChunkSize,
  params: WorldParams,
  columns: Column[],
  pw: number,
  originX: number,
  originZ: number,
  data: Uint8Array
) {
  const w = size.width;
  const sea = params.terrain.seaLevel;
  for (let z = 0; z < w; z++) {
    for (let x = 0; x < w; x++) {
      const col = columns[(z + PAD) * pw + (x + PAD)];
      const def = biomeDef(col.biome);
      const wx = originX + x;
      const wz = originZ + z;
      const height = col.height;
      const top = surfaceBlock(col, sea);

      let filler = def.filler;
      let deepFiller = def.deepFiller;
      let fillerDepth = Math.max(
        0,
        def.fillerDepth + Math.round(col.surface * 1.5)
      );
      if (height < sea && !isOceanic(col.biome)) {
        filler = BlockID.Dirt;
        deepFiller = undefined;
        fillerDepth = 3;
      } else if (top === BlockID.Grass && col.biome === Biome.Mountains) {
        filler = BlockID.Dirt;
        fillerDepth = 2;
      }

      const bedrockTop = 1 + Math.floor(hashUnit(params.seed, wx, wz, 3) * 3);
      const base = blockIndex(size, x, 0, z);
      const stride = w * w;

      for (let y = 0; y < size.height; y++) {
        let id: BlockID;
        if (y === 0 || y < bedrockTop) {
          id = BlockID.Bedrock;
        } else if (y < height - fillerDepth - 4) {
          id = BlockID.Stone;
        } else if (y < height - fillerDepth) {
          id = deepFiller ?? BlockID.Stone;
        } else if (y < height) {
          id = filler;
        } else if (y === height) {
          id = top;
        } else if (y <= sea) {
          id = BlockID.Water;
        } else {
          id = BlockID.Air;
        }
        data[base + y * stride] = id;
      }
    }
  }
}

function carveCaves(
  size: ChunkSize,
  params: WorldParams,
  noise: WorldNoise,
  carver: Carver,
  columns: Column[],
  pw: number,
  originX: number,
  originZ: number,
  data: Uint8Array
) {
  const w = size.width;
  const sea = params.terrain.seaLevel;
  const lava = params.caves.lavaLevel;
  const stride = w * w;
  // A cave or canyon cell below sea level that could open onto the sea
  // (steep cliffs put deep water right next to tall columns) is water,
  // like Minecraft's aquifers, so the sea never has an unsupported side
  const nearSea = (x: number, z: number) => {
    for (let dz = -COAST_REACH; dz <= COAST_REACH; dz++) {
      for (let dx = -COAST_REACH; dx <= COAST_REACH; dx++) {
        if (columns[(z + dz + PAD) * pw + (x + dx + PAD)].height < sea) {
          return true;
        }
      }
    }
    return false;
  };
  // Flood state per column, one ring past the chunk so border cells can see
  // their neighbours
  const fw = w + 2;
  const flooded = new Uint8Array(fw * fw);
  for (let z = -1; z <= w; z++) {
    for (let x = -1; x <= w; x++) {
      const col = columns[(z + PAD) * pw + (x + PAD)];
      flooded[(z + 1) * fw + (x + 1)] =
        col.height <= sea + COAST_BAND || nearSea(x, z) ? 1 : 0;
    }
  }
  const isFlooded = (x: number, z: number) => flooded[(z + 1) * fw + (x + 1)];
  for (let z = 0; z < w; z++) {
    for (let x = 0; x < w; x++) {
      const col = columns[(z + PAD) * pw + (x + PAD)];
      const wx = originX + x;
      const wz = originZ + z;
      const base = blockIndex(size, x, 0, z);
      const wet = isFlooded(x, z) === 1;
      // Aquifer barrier (`Aquifer.computeSubstance`): a dry cave cell whose
      // neighbouring column is flooded keeps its stone so water never stands
      // against open air
      const barrier =
        !wet &&
        (isFlooded(x - 1, z) === 1 ||
          isFlooded(x + 1, z) === 1 ||
          isFlooded(x, z - 1) === 1 ||
          isFlooded(x, z + 1) === 1);
      const top = Math.min(col.height, size.height - 1);
      for (let y = 4; y <= top; y++) {
        if (!isCarved(noise, params, carver, wx, y, wz, col)) continue;
        let id = BlockID.Air;
        if (y <= lava) id = BlockID.Lava;
        else if (y <= sea) {
          if (wet) id = BlockID.Water;
          else if (barrier) continue;
        }
        data[base + y * stride] = id;
      }
    }
  }
}

/** Places an irregular blob of `id` replacing stone around a centre */
function placeBlob(
  size: ChunkSize,
  rng: RNG,
  data: Uint8Array,
  cx: number,
  cy: number,
  cz: number,
  volume: number,
  id: BlockID,
  replace: (existing: BlockID) => boolean
) {
  const r = Math.cbrt((volume * 3) / (4 * Math.PI)) + 0.4;
  const rx = r * (0.7 + rng.random() * 0.8);
  const ry = r * (0.6 + rng.random() * 0.6);
  const rz = r * (0.7 + rng.random() * 0.8);
  const R = Math.ceil(Math.max(rx, ry, rz));
  for (let dy = -R; dy <= R; dy++) {
    const y = cy + dy;
    if (y < 1 || y >= size.height) continue;
    for (let dz = -R; dz <= R; dz++) {
      const z = cz + dz;
      if (z < 0 || z >= size.width) continue;
      for (let dx = -R; dx <= R; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= size.width) continue;
        const d =
          (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) + (dz * dz) / (rz * rz);
        if (d > 1 - rng.random() * 0.35) continue;
        const i = blockIndex(size, x, y, z);
        if (replace(data[i])) data[i] = id;
      }
    }
  }
}

const isStone = (id: BlockID) => id === BlockID.Stone;

/** Dirt and gravel pockets inside the stone */
function placePatches(
  size: ChunkSize,
  params: WorldParams,
  rng: RNG,
  data: Uint8Array
) {
  const w = size.width;
  const patches: [BlockID, number, number][] = [
    [BlockID.Dirt, 4, 28],
    [BlockID.Gravel, 3, 24],
  ];
  for (const [id, attempts, volume] of patches) {
    for (let i = 0; i < attempts; i++) {
      const x = Math.floor(rng.random() * w);
      const z = Math.floor(rng.random() * w);
      const y = 4 + Math.floor(rng.random() * (params.terrain.seaLevel + 40));
      placeBlob(size, rng, data, x, y, z, volume, id, isStone);
    }
  }
}

function placeOres(
  size: ChunkSize,
  params: WorldParams,
  rng: RNG,
  data: Uint8Array
) {
  const w = size.width;
  for (const ore of Object.values(oreConfig)) {
    const attempts = Math.round(ore.attempts * params.ores.density);
    const maxY = Math.min(ore.maxY, size.height - 1);
    for (let i = 0; i < attempts; i++) {
      const x = Math.floor(rng.random() * w);
      const z = Math.floor(rng.random() * w);
      const y = ore.minY + Math.floor(rng.random() * (maxY - ore.minY + 1));
      placeBlob(size, rng, data, x, y, z, ore.size, ore.id, isStone);
    }
  }
}

/** Highest non-air block in a chunk column, or -1 */
export const columnTop = (
  data: Uint8Array,
  size: ChunkSize,
  x: number,
  z: number
): number => {
  for (let y = size.height - 1; y >= 0; y--) {
    if (data[blockIndex(size, x, y, z)] !== BlockID.Air) return y;
  }
  return -1;
};

export const isSolidGround = (id: BlockID) => {
  const def = getBlockDef(id);
  return !def.passable && !def.fluid;
};
