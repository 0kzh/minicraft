export enum BlockID {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  CoalOre = 4,
  IronOre = 5,
  Bedrock = 6,
  OakLog = 7,
  Leaves = 8,
  TallGrass = 9,
  FlowerRose = 10,
  FlowerDandelion = 11,
  RedstoneLamp = 12,
  StoneBrick = 13,
  Water = 14,
  Lava = 15,
  Sand = 16,
  Sandstone = 17,
  Gravel = 18,
  SnowGrass = 19,
  Snow = 20,
  SpruceLog = 21,
  SpruceLeaves = 22,
  BirchLog = 23,
  BirchLeaves = 24,
  Cactus = 25,
  DeadBush = 26,
  GoldOre = 27,
  DiamondOre = 28,
  /** Thin snow cover (1/8 block) that sits on top of the ground */
  SnowLayer = 29,
  /**
   * Flowing liquids occupy 16 ids each: FlowingWater + (level - 1) for
   * levels 1-7 (thinner as the level rises), + FLUID_FALLING for columns
   * fed from above. Water/Lava themselves are level-0 sources.
   */
  FlowingWater = 200,
  FlowingLava = 216,
}

export const FLUID_FALLING = 8;
export const FLUID_MAX_LEVEL = 7;

export type OreHeight = {
  /** `uniform` picks any y in range; `trapezoid` peaks at the middle */
  kind: "uniform" | "trapezoid";
  min: number;
  max: number;
};

export type OreFeature = {
  id: BlockID;
  /** Veins per chunk; a fraction is a per-chunk chance (vanilla `rarity_filter`) */
  count: number;
  /** Vein size, as in vanilla's `ore` configured feature */
  size: number;
  /** `discard_chance_on_air_exposure`: chance to skip an ore touching air */
  discard: number;
  height: OreHeight;
};

/**
 * Vanilla 1.18+ overworld ore placed features (`ore_coal_upper`,
 * `ore_coal_lower`, `ore_iron_upper/middle/small`, `ore_gold`,
 * `ore_diamond`, `ore_diamond_large/buried/medium`) mapped onto this 128
 * tall world: vanilla y -64..63 is compressed 2:1 onto 0..62 and 63..320 is
 * compressed 4:1 onto 62..126, and each count is scaled by the same factor
 * as its height band so the density of veins per stone block matches.
 */
export const oreFeatures: OreFeature[] = [
  // ore_coal_upper: 30 x ore_coal, uniform 136..top
  {
    id: BlockID.CoalOre,
    count: 8,
    size: 17,
    discard: 0,
    height: { kind: "uniform", min: 80, max: 126 },
  },
  // ore_coal_lower: 20 x ore_coal_buried, trapezoid 0..192
  {
    id: BlockID.CoalOre,
    count: 7,
    size: 17,
    discard: 0.5,
    height: { kind: "trapezoid", min: 31, max: 94 },
  },
  // ore_iron_upper: 90 x ore_iron, trapezoid 80..384
  {
    id: BlockID.IronOre,
    count: 22,
    size: 9,
    discard: 0,
    height: { kind: "trapezoid", min: 66, max: 142 },
  },
  // ore_iron_middle: 10 x ore_iron, trapezoid -24..56
  {
    id: BlockID.IronOre,
    count: 5,
    size: 9,
    discard: 0,
    height: { kind: "trapezoid", min: 18, max: 58 },
  },
  // ore_iron_small: 10 x ore_iron_small, uniform bottom..72
  {
    id: BlockID.IronOre,
    count: 5,
    size: 4,
    discard: 0,
    height: { kind: "uniform", min: 1, max: 64 },
  },
  // ore_gold: 4 x ore_gold_buried, trapezoid -64..32
  {
    id: BlockID.GoldOre,
    count: 2,
    size: 9,
    discard: 0.5,
    height: { kind: "trapezoid", min: 0, max: 46 },
  },
  // ore_diamond: 7 x ore_diamond_small, trapezoid bottom-80..bottom+80
  {
    id: BlockID.DiamondOre,
    count: 4,
    size: 4,
    discard: 0.5,
    height: { kind: "trapezoid", min: -41, max: 38 },
  },
  // ore_diamond_large: 1/9 chance x ore_diamond_large
  {
    id: BlockID.DiamondOre,
    count: 0.06,
    size: 12,
    discard: 0.7,
    height: { kind: "trapezoid", min: -41, max: 38 },
  },
  // ore_diamond_buried: 4 x ore_diamond_buried
  {
    id: BlockID.DiamondOre,
    count: 2,
    size: 8,
    discard: 1,
    height: { kind: "trapezoid", min: -41, max: 38 },
  },
  // ore_diamond_medium: 2 x ore_diamond_medium, uniform -64..-4
  {
    id: BlockID.DiamondOre,
    count: 1,
    size: 8,
    discard: 0.5,
    height: { kind: "uniform", min: 1, max: 28 },
  },
];

export const blockIdToKey = {
  [BlockID.Air]: "air",
  [BlockID.Grass]: "grass",
  [BlockID.Dirt]: "dirt",
  [BlockID.Stone]: "stone",
  [BlockID.CoalOre]: "coal",
  [BlockID.IronOre]: "iron",
  [BlockID.Bedrock]: "bedrock",
  [BlockID.OakLog]: "oak_log",
  [BlockID.Leaves]: "leaves",
  [BlockID.TallGrass]: "tall_grass",
  [BlockID.FlowerRose]: "flower_rose",
  [BlockID.FlowerDandelion]: "flower_dandelion",
  [BlockID.RedstoneLamp]: "redstone_lamp",
  [BlockID.StoneBrick]: "stone_brick",
  [BlockID.Water]: "water",
  [BlockID.Lava]: "lava",
  [BlockID.Sand]: "sand",
  [BlockID.Sandstone]: "sandstone",
  [BlockID.Gravel]: "gravel",
  [BlockID.SnowGrass]: "snow_grass",
  [BlockID.Snow]: "snow",
  [BlockID.SpruceLog]: "spruce_log",
  [BlockID.SpruceLeaves]: "spruce_leaves",
  [BlockID.BirchLog]: "birch_log",
  [BlockID.BirchLeaves]: "birch_leaves",
  [BlockID.Cactus]: "cactus",
  [BlockID.DeadBush]: "dead_bush",
  [BlockID.GoldOre]: "gold_ore",
  [BlockID.DiamondOre]: "diamond_ore",
  [BlockID.SnowLayer]: "snow_layer",
};
