import { BlockID } from "../Block";

export enum Biome {
  DeepOcean,
  Ocean,
  Beach,
  StonyShore,
  River,
  Plains,
  Forest,
  BirchForest,
  Swamp,
  Desert,
  Savanna,
  Taiga,
  SnowyTundra,
  SnowyTaiga,
  Mountains,
  SnowyPeaks,
  Count,
}

export type TreeKind = "oak" | "birch" | "spruce" | "bigOak";

export type BiomeDef = {
  name: string;
  /** Block on the surface (above sea level) */
  top: BlockID;
  /** Blocks directly beneath the surface */
  filler: BlockID;
  /** Blocks beneath the filler until stone; undefined = stone */
  deepFiller?: BlockID;
  /** Depth of the filler layer */
  fillerDepth: number;
  /** Chance per column of a tree */
  treeChance: number;
  trees: { kind: TreeKind; weight: number }[];
  /** Chance per column of tall grass */
  grassChance: number;
  flowerChance: number;
  /** Desert plants */
  cactusChance: number;
  deadBushChance: number;
  /** Whether the top block is replaced by a snow variant */
  snowy: boolean;
};

const base: BiomeDef = {
  name: "plains",
  top: BlockID.Grass,
  filler: BlockID.Dirt,
  fillerDepth: 3,
  treeChance: 0,
  trees: [],
  grassChance: 0,
  flowerChance: 0,
  cactusChance: 0,
  deadBushChance: 0,
  snowy: false,
};

const def = (overrides: Partial<BiomeDef>): BiomeDef => ({
  ...base,
  ...overrides,
});

export const BIOMES: BiomeDef[] = [];

BIOMES[Biome.DeepOcean] = def({
  name: "deep_ocean",
  top: BlockID.Gravel,
  filler: BlockID.Gravel,
  fillerDepth: 2,
});
BIOMES[Biome.Ocean] = def({
  name: "ocean",
  top: BlockID.Sand,
  filler: BlockID.Sand,
  deepFiller: BlockID.Gravel,
  fillerDepth: 3,
});
BIOMES[Biome.Beach] = def({
  name: "beach",
  top: BlockID.Sand,
  filler: BlockID.Sand,
  deepFiller: BlockID.Sandstone,
  fillerDepth: 3,
  deadBushChance: 0.002,
});
BIOMES[Biome.StonyShore] = def({
  name: "stony_shore",
  top: BlockID.Stone,
  filler: BlockID.Gravel,
  fillerDepth: 2,
});
BIOMES[Biome.River] = def({
  name: "river",
  top: BlockID.Sand,
  filler: BlockID.Sand,
  deepFiller: BlockID.Gravel,
  fillerDepth: 2,
});
BIOMES[Biome.Plains] = def({
  name: "plains",
  treeChance: 0.0025,
  trees: [{ kind: "oak", weight: 1 }],
  grassChance: 0.09,
  flowerChance: 0.02,
});
BIOMES[Biome.Forest] = def({
  name: "forest",
  treeChance: 0.045,
  trees: [
    { kind: "oak", weight: 4 },
    { kind: "birch", weight: 1 },
    { kind: "bigOak", weight: 0.5 },
  ],
  grassChance: 0.04,
  flowerChance: 0.012,
});
BIOMES[Biome.BirchForest] = def({
  name: "birch_forest",
  treeChance: 0.045,
  trees: [{ kind: "birch", weight: 1 }],
  grassChance: 0.04,
  flowerChance: 0.02,
});
BIOMES[Biome.Swamp] = def({
  name: "swamp",
  treeChance: 0.012,
  trees: [{ kind: "oak", weight: 1 }],
  grassChance: 0.12,
  flowerChance: 0.004,
});
BIOMES[Biome.Desert] = def({
  name: "desert",
  top: BlockID.Sand,
  filler: BlockID.Sand,
  deepFiller: BlockID.Sandstone,
  fillerDepth: 4,
  cactusChance: 0.006,
  deadBushChance: 0.01,
});
BIOMES[Biome.Savanna] = def({
  name: "savanna",
  treeChance: 0.003,
  trees: [{ kind: "oak", weight: 1 }],
  grassChance: 0.14,
  deadBushChance: 0.004,
});
BIOMES[Biome.Taiga] = def({
  name: "taiga",
  treeChance: 0.04,
  trees: [{ kind: "spruce", weight: 1 }],
  grassChance: 0.03,
  flowerChance: 0.003,
});
BIOMES[Biome.SnowyTundra] = def({
  name: "snowy_tundra",
  snowy: true,
  treeChance: 0.001,
  trees: [{ kind: "spruce", weight: 1 }],
});
BIOMES[Biome.SnowyTaiga] = def({
  name: "snowy_taiga",
  snowy: true,
  treeChance: 0.035,
  trees: [{ kind: "spruce", weight: 1 }],
  grassChance: 0.01,
});
BIOMES[Biome.Mountains] = def({
  name: "mountains",
  top: BlockID.Stone,
  filler: BlockID.Stone,
  fillerDepth: 0,
  treeChance: 0.004,
  trees: [{ kind: "spruce", weight: 1 }],
});
BIOMES[Biome.SnowyPeaks] = def({
  name: "snowy_peaks",
  top: BlockID.Snow,
  filler: BlockID.Stone,
  fillerDepth: 0,
  snowy: true,
});

export const biomeDef = (b: Biome): BiomeDef => BIOMES[b];

/** Whether the biome is covered by the sea */
export const isOceanic = (b: Biome): boolean =>
  b === Biome.Ocean || b === Biome.DeepOcean || b === Biome.River;
