import { BlockID, OreHeight, oreFeatures } from "../Block";
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
  /** Preferred y of the wide horizontal cave passages under this column */
  caveElevation: number;
  /** 0..1, how much the large cave families (caverns, passages) may carve */
  caveRegion: number;
};

const newColumn = (): Column => ({
  height: 0,
  biome: Biome.Plains,
  continent: 0,
  ruggedness: 0,
  temperature: 0,
  humidity: 0,
  surface: 0,
  caveElevation: 0,
  caveRegion: 0,
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
  out.caveElevation =
    SPAGHETTI_2D_MIN_Y +
    (noise.noise2(Channel.Spaghetti2DElevation, wx / 256, wz / 256) + 1) *
      0.5 *
      (SPAGHETTI_2D_MAX_Y - SPAGHETTI_2D_MIN_Y);
  out.caveRegion = smoothstep(
    CAVE_REGION_EDGE,
    CAVE_REGION_CORE,
    noise.noise2(
      Channel.CaveRegion,
      wx / CAVE_REGION_SCALE,
      wz / CAVE_REGION_SCALE
    )
  );
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
  /** Slowly varying tunnel thickness so passages swell and pinch */
  thickness: Lattice;
  /** Sheet noise for the tall 2D spaghetti passages */
  spaghetti2d: Lattice;
  /** Small-scale roughness that breaks up smooth cave walls */
  roughness: Lattice;
  /** Blob caves that open onto the surface */
  entrance: Lattice;
  noodleA: Lattice;
  noodleB: Lattice;
  noodleGate: Lattice;
};

/** Measured standard deviation of a single `noise3` octave */
const NOISE_SD = 0.427;
/**
 * Vanilla `NormalNoise` scales each of its two octave sums to an expected
 * deviation of 1/6 (`valueFactor = 0.1666 / expectedDeviation`), so every
 * cave noise has a deviation of about 0.24 regardless of octave count. The
 * carver noises are rescaled to that so vanilla's thresholds keep their
 * meaning.
 */
const VANILLA_SD = 0.24;

/**
 * Vanilla `PerlinNoise` octave sum: amplitude i is weighted by
 * 2^(n-1-i) / (2^n - 1) at twice the previous frequency, then rescaled to
 * VANILLA_SD like `NormalNoise`.
 */
function normalNoise(
  noise: WorldNoise,
  ch: Channel,
  amplitudes: number[],
  x: number,
  y: number,
  z: number
): number {
  const n = amplitudes.length;
  let sum = 0;
  let variance = 0;
  let freq = 1;
  for (let i = 0; i < n; i++) {
    const w = (amplitudes[i] * 2 ** (n - 1 - i)) / (2 ** n - 1);
    sum += w * noise.noise3(ch, x * freq, y * freq, z * freq);
    variance += w * w;
    freq *= 2;
  }
  return (sum * VANILLA_SD) / (NOISE_SD * Math.sqrt(variance));
}

/**
 * `weird_scaled_sampler` rarity mappers: rarer regions sample the tunnel
 * noise at a longer wavelength and scale the value up by the same factor,
 * so tunnels keep their width but there are fewer of them.
 */
const rarityType1 = (v: number) =>
  v < -0.5 ? 0.75 : v < 0 ? 1 : v < 0.4 ? 1.5 : 2;
const rarityType2 = (v: number) =>
  v < -0.75 ? 0.5 : v < -0.5 ? 0.75 : v < 0.5 ? 1 : v < 0.75 ? 2 : 3;

/**
 * Added to the spaghetti_3d_rarity field before the tier lookup: pushes
 * regions toward the sparse tiers so there are fewer tunnels of the same
 * size (0 is vanilla).
 */
const SPAGHETTI_RARITY_BIAS = 0.25;

/** cave_cheese amplitude modifiers for successive octaves */
const CHEESE_AMPLITUDES = [0.5, 1, 2, 1, 2];
/** cave_entrance amplitude modifiers */
const ENTRANCE_AMPLITUDES = [0.4, 0.5, 1];

/**
 * Large cave systems (cheese caverns and 2D passages) only form in cave
 * regions: a slow 2D field, fully open above CAVE_REGION_CORE and closed
 * below CAVE_REGION_EDGE. Elsewhere the rock only has tunnels and noodles,
 * so most caves are small and a few areas hold the big systems.
 */
const CAVE_REGION_SCALE = 768;
const CAVE_REGION_EDGE = 0.2;
const CAVE_REGION_CORE = 0.55;
/** Density added to the large families outside cave regions */
const CAVE_REGION_PENALTY = 1;

/** Band of heights the 2D spaghetti passages wander through */
const SPAGHETTI_2D_MIN_Y = 12;
const SPAGHETTI_2D_MAX_Y = 56;
/** Blocks below the surface where only entrances and tunnels may carve */
const SURFACE_SHELL = 10;
/** Extra density a cave must reach to open the surface, tapering over MOUTH_DEPTH */
const MOUTH_MARGIN = 0.03;
const MOUTH_DEPTH = 4;
/** Entrance blobs fade out below this height (vanilla gradient -10..30) */
const ENTRANCE_FADE_TOP = 44;
const ENTRANCE_FADE_BOTTOM = 18;
/** Ravine profile: depth below the rim and half-width in path-noise units */
const RAVINE_DEPTH = 52;
const RAVINE_WIDTH_TOP = 0.05;
const RAVINE_WIDTH_BOTTOM = 0.012;

/** Cells this close to a submerged floor are never carved, keeping seas sealed */
const SEA_FLOOR_SEAL = 4;
/** Columns this close above sea level count as coast: no ravines, flooded caves */
const COAST_BAND = 6;
/** Columns within this many blocks of open sea also count as coast */
const COAST_REACH = PAD - 1;

/**
 * Whether the cell at world (wx, y, wz) in a column of the given height is
 * hollowed out by a cave or ravine.
 *
 * Mirrors the structure of vanilla's `overworld/final_density`: a thin shell
 * under the surface is only reached by `entrances` (blob caves and the 3D
 * spaghetti tunnels), while deeper rock is additionally hollowed by cheese
 * caverns, 2D spaghetti passages and noodles. Every term is a "density":
 * negative means air, and `spaghetti_roughness_function` is added to the
 * tunnel families so their walls are never smooth iso-surfaces.
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
  const inland = !submerged && col.height > sea + COAST_BAND;
  const depthBelow = col.height - y;
  // Openings need a margin of density right at the surface so a cave only
  // breaks through where its body is wide, never as a shallow scratch
  const mouth = MOUTH_MARGIN * clamp(1 - depthBelow / MOUTH_DEPTH, 0, 1);

  // spaghetti_roughness_function = (-0.05 - 0.05 * mod) * (|rough| - 0.4)
  const rough = carver.roughness.get(wx, y, wz);
  const roughness =
    (-0.05 -
      0.05 *
        normalNoise(noise, Channel.CaveRoughness, [1], wx / 256, 0, wz / 256)) *
    (Math.abs(rough) - 0.4);

  // 3D spaghetti: max(|a|, |b|) - thickness, thickness in [0.065, 0.088]
  // (`spaghetti_3d_thickness`, vanilla 0.0765 + 0.0115 * noise) scaled by
  // the user radius
  const thick = carver.thickness.get(wx, y, wz);
  const a = Math.abs(carver.spaghettiA.get(wx, y, wz));
  const b = Math.abs(carver.spaghettiB.get(wx, y, wz));
  const spaghetti3d =
    Math.max(a, b) - (cv.spaghettiRadius + 0.0115 * thick) + roughness;
  if (spaghetti3d < -mouth) return true;

  // Entrances: cave_entrance + 0.37 + gradient. Blobs that are full size
  // right at the surface so they read as cave mouths, not pits, and fade
  // out below ENTRANCE_FADE_TOP so they hand over to the deep systems
  if (cv.entrances && inland) {
    const fade = clamp(
      (ENTRANCE_FADE_TOP - y) / (ENTRANCE_FADE_TOP - ENTRANCE_FADE_BOTTOM),
      0,
      1
    );
    const entrance =
      carver.entrance.get(wx, y, wz) + cv.entranceThreshold + 0.3 * fade;
    if (entrance < -2 * mouth) return true;
  }

  // Ravines: canyons open to the sky, widest at the rim with rugged walls
  if (cv.ravines && inland) {
    const gate = noise.noise2(Channel.Ravine, wx / 900 + 50, wz / 900);
    if (gate > 0.5) {
      const bottom = Math.max(
        cv.lavaLevel + 1,
        col.height - RAVINE_DEPTH + 6 * rough
      );
      if (y >= bottom) {
        const r = Math.abs(noise.fbm2(Channel.Ravine, wx / 260, wz / 260, 2));
        const depth = (y - bottom) / Math.max(1, col.height - bottom);
        // Bulge along the length so the canyon opens into wider chambers,
        // and taper to nothing at the edge of the gated region
        const bulge =
          (1 + 0.25 * thick + 0.12 * rough) * smoothstep(0.5, 0.62, gate);
        const width =
          (RAVINE_WIDTH_BOTTOM +
            (RAVINE_WIDTH_TOP - RAVINE_WIDTH_BOTTOM) * Math.sqrt(depth)) *
          bulge;
        if (r < width) return true;
      }
    }
  }

  // Everything below only exists under the surface shell
  if (depthBelow < SURFACE_SHELL) return false;

  // Cheese: cave_cheese + 0.27 + 4 * cave_layer^2 + near-surface penalty,
  // air where negative. `cheeseThreshold` replaces vanilla's 0.27 offset.
  // cave_layer is a per-block noise (wavelength 8, y_scale 8) so its square
  // only roughens the cavern walls; it is sampled after the cheap terms
  // since it can only make the density more positive.
  const shellFade = clamp((depthBelow - SURFACE_SHELL) / 24, 0, 1);
  const regionPenalty = CAVE_REGION_PENALTY * (1 - col.caveRegion);
  const cheese =
    carver.cheese.get(wx, y, wz) +
    cv.cheeseThreshold +
    0.5 * (1 - shellFade) +
    regionPenalty;
  if (cheese < 0) {
    const layer = normalNoise(noise, Channel.CaveLayer, [1], wx / 8, y, wz / 8);
    if (cheese + 4 * layer * layer < 0) return true;
  }

  // 2D spaghetti: a sheet of noise clipped to a slab around the column's
  // preferred elevation. thickness2d in [-1.3, -0.6] (units of 8 blocks)
  // sets both the slab half-height and the sheet thickness, like vanilla.
  const thickness2d = -0.95 - 0.35 * thick;
  const sheet = Math.abs(carver.spaghetti2d.get(wx, y, wz));
  const slab = Math.abs(y - col.caveElevation) / 8 + thickness2d;
  const spaghetti2d =
    Math.max(sheet + 0.083 * thickness2d, slab * slab * slab) +
    roughness +
    regionPenalty;
  if (spaghetti2d < 0) return true;

  // Noodles: thin winding tunnels that stitch the systems together
  if (carver.noodleGate.get(wx, y, wz) < 0) {
    const na = Math.abs(carver.noodleA.get(wx, y, wz));
    const nb = Math.abs(carver.noodleB.get(wx, y, wz));
    const noodle = 1.5 * Math.max(na, nb) - 0.075 - 0.025 * thick;
    if (noodle < 0) return true;
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
    // spaghetti_3d_rarity picks the tunnel wavelength per region
    const spaghetti = (ch: Channel) => (x: number, y: number, z: number) => {
      const r = rarityType1(
        normalNoise(
          noise,
          Channel.SpaghettiRarity,
          [1],
          x / 1024,
          0,
          z / 1024
        ) + SPAGHETTI_RARITY_BIAS
      );
      const s = cv.spaghettiScale * r;
      return normalNoise(noise, ch, [1], x / s, y / s, z / s) * r;
    };
    // cave_cheese: octaves at 1, 1/2, 1/4, 1/8, 1/16 of the wavelength with
    // vanilla's amplitude modifiers [0.5, 1, 2, 1, 2], y_scale 2/3
    const cheese = (x: number, y: number, z: number) =>
      normalNoise(
        noise,
        Channel.Cheese,
        CHEESE_AMPLITUDES,
        x / cv.cheeseScale,
        (y * 2) / 3 / cv.cheeseScale,
        z / cv.cheeseScale
      );
    // spaghetti_2d: rarity from `spaghetti_2d_modulator` (xz_scale 2 of a
    // 1024 wavelength), same width but longer, sparser sheets when rare
    const spaghetti2d = (x: number, y: number, z: number) => {
      const r = rarityType2(
        normalNoise(
          noise,
          Channel.Spaghetti2DModulator,
          [1],
          x / 512,
          0,
          z / 512
        )
      );
      const s = 128 * r;
      return (
        normalNoise(noise, Channel.Spaghetti2D, [1], x / s, y / s, z / s) * r
      );
    };
    // cave_entrance: octaves with modifiers [0.4, 0.5, 1], xz_scale 0.75
    // and y_scale 0.5 so the blobs are tall
    const entrance = (x: number, y: number, z: number) =>
      normalNoise(
        noise,
        Channel.Entrance,
        ENTRANCE_AMPLITUDES,
        x / 170,
        y / 256,
        z / 170
      );
    const lattice = (sample: (x: number, y: number, z: number) => number) =>
      new Lattice(originX, originZ, w, size.height, sample);
    carver = {
      cheese: lattice(cheese),
      spaghettiA: lattice(spaghetti(Channel.SpaghettiA)),
      spaghettiB: lattice(spaghetti(Channel.SpaghettiB)),
      thickness: lattice((x, y, z) =>
        normalNoise(
          noise,
          Channel.SpaghettiThickness,
          [1],
          x / 256,
          y / 256,
          z / 256
        )
      ),
      spaghetti2d: lattice(spaghetti2d),
      roughness: lattice((x, y, z) =>
        normalNoise(noise, Channel.CaveRoughness, [1], x / 32, y / 32, z / 32)
      ),
      entrance: lattice(entrance),
      noodleA: lattice((x, y, z) =>
        normalNoise(noise, Channel.NoodleA, [1], x / 48, y / 48, z / 48)
      ),
      noodleB: lattice((x, y, z) =>
        normalNoise(noise, Channel.NoodleB, [1], x / 48, y / 48, z / 48)
      ),
      noodleGate: lattice((x, y, z) =>
        normalNoise(noise, Channel.Noodle, [1], x / 128, y / 128, z / 128)
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

/**
 * Vanilla `OreFeature.doPlace`: `size` spheres strung along a short random
 * line, each with radius ((sin(pi t) + 1) * rand * size / 16 + 1) / 2, so
 * `size` bounds the vein's extent rather than its block count (a size-4
 * diamond vein is usually 1-3 blocks). Spheres fully inside another are
 * dropped, and with a discard chance an ore next to air is skipped.
 */
function placeVein(
  size: ChunkSize,
  rng: RNG,
  data: Uint8Array,
  cx: number,
  cy: number,
  cz: number,
  veinSize: number,
  id: BlockID,
  discardOnAir: number
) {
  const angle = rng.random() * Math.PI;
  const half = veinSize / 8;
  const x0 = cx + Math.sin(angle) * half;
  const x1 = cx - Math.sin(angle) * half;
  const z0 = cz + Math.cos(angle) * half;
  const z1 = cz - Math.cos(angle) * half;
  const y0 = cy + Math.floor(rng.random() * 3) - 2;
  const y1 = cy + Math.floor(rng.random() * 3) - 2;
  const spheres = new Float64Array(veinSize * 4);
  for (let k = 0; k < veinSize; k++) {
    const t = k / veinSize;
    const scale = (rng.random() * veinSize) / 16;
    spheres[k * 4] = lerp(x0, x1, t);
    spheres[k * 4 + 1] = lerp(y0, y1, t);
    spheres[k * 4 + 2] = lerp(z0, z1, t);
    spheres[k * 4 + 3] = ((Math.sin(Math.PI * t) + 1) * scale + 1) / 2;
  }
  for (let k = 0; k < veinSize; k++) {
    const rk = spheres[k * 4 + 3];
    if (rk < 0) continue;
    for (let l = k + 1; l < veinSize; l++) {
      const rl = spheres[l * 4 + 3];
      if (rl < 0) continue;
      const dx = spheres[k * 4] - spheres[l * 4];
      const dy = spheres[k * 4 + 1] - spheres[l * 4 + 1];
      const dz = spheres[k * 4 + 2] - spheres[l * 4 + 2];
      if ((rk - rl) * (rk - rl) > dx * dx + dy * dy + dz * dz) {
        if (rk > rl) spheres[l * 4 + 3] = -1;
        else spheres[k * 4 + 3] = -1;
      }
    }
  }
  const w = size.width;
  for (let k = 0; k < veinSize; k++) {
    const r = spheres[k * 4 + 3];
    if (r < 0) continue;
    const sx = spheres[k * 4];
    const sy = spheres[k * 4 + 1];
    const sz = spheres[k * 4 + 2];
    const xMin = Math.max(0, Math.floor(sx - r));
    const xMax = Math.min(w - 1, Math.floor(sx + r));
    const yMin = Math.max(1, Math.floor(sy - r));
    const yMax = Math.min(size.height - 1, Math.floor(sy + r));
    const zMin = Math.max(0, Math.floor(sz - r));
    const zMax = Math.min(w - 1, Math.floor(sz + r));
    for (let x = xMin; x <= xMax; x++) {
      const fx = (x + 0.5 - sx) / r;
      if (fx * fx >= 1) continue;
      for (let y = yMin; y <= yMax; y++) {
        const fy = (y + 0.5 - sy) / r;
        if (fx * fx + fy * fy >= 1) continue;
        for (let z = zMin; z <= zMax; z++) {
          const fz = (z + 0.5 - sz) / r;
          if (fx * fx + fy * fy + fz * fz >= 1) continue;
          const i = blockIndex(size, x, y, z);
          if (!isStone(data[i])) continue;
          if (
            discardOnAir > 0 &&
            (discardOnAir >= 1 || rng.random() < discardOnAir) &&
            touchesAir(size, data, x, y, z)
          )
            continue;
          data[i] = id;
        }
      }
    }
  }
}

/** Whether any of the six neighbours inside this chunk is air */
function touchesAir(
  size: ChunkSize,
  data: Uint8Array,
  x: number,
  y: number,
  z: number
): boolean {
  const w = size.width;
  return (
    (x > 0 && data[blockIndex(size, x - 1, y, z)] === BlockID.Air) ||
    (x < w - 1 && data[blockIndex(size, x + 1, y, z)] === BlockID.Air) ||
    (y > 0 && data[blockIndex(size, x, y - 1, z)] === BlockID.Air) ||
    (y < size.height - 1 &&
      data[blockIndex(size, x, y + 1, z)] === BlockID.Air) ||
    (z > 0 && data[blockIndex(size, x, y, z - 1)] === BlockID.Air) ||
    (z < w - 1 && data[blockIndex(size, x, y, z + 1)] === BlockID.Air)
  );
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

/** Samples a vanilla `height_range`: uniform, or trapezoid (sum of two uniforms) */
function sampleHeight(rng: RNG, h: OreHeight): number {
  const span = h.max - h.min + 1;
  if (h.kind === "uniform") return h.min + Math.floor(rng.random() * span);
  const a = Math.floor(rng.random() * span);
  const b = Math.floor(rng.random() * span);
  return h.min + Math.floor((a + b) / 2);
}

function placeOres(
  size: ChunkSize,
  params: WorldParams,
  rng: RNG,
  data: Uint8Array
) {
  const w = size.width;
  for (const ore of oreFeatures) {
    const scaled = ore.count * params.ores.density;
    const attempts =
      scaled < 1 ? (rng.random() < scaled ? 1 : 0) : Math.round(scaled);
    for (let i = 0; i < attempts; i++) {
      const x = Math.floor(rng.random() * w);
      const z = Math.floor(rng.random() * w);
      const y = sampleHeight(rng, ore.height);
      if (y < 1 || y >= size.height) continue;
      placeVein(size, rng, data, x, y, z, ore.size, ore.id, ore.discard);
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
