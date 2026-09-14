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

/**
 * Ore veins per chunk: vein attempts, blob size and inclusive y range.
 * The world is 128 tall with bedrock at y=0, so the vanilla 1.18+ Java bands
 * (which span y=-64..320) are compressed rather than copied: vanilla puts
 * diamond deepest (peak at -64, none above 16), gold below 32 (peak -16),
 * iron peaking at 16 and coal throughout the upper world (peak 96). Vein
 * sizes follow vanilla's 17/9/9/4 order of magnitude.
 */
export const oreConfig = {
  coal: { id: BlockID.CoalOre, attempts: 12, size: 12, minY: 5, maxY: 120 },
  iron: { id: BlockID.IronOre, attempts: 10, size: 7, minY: 2, maxY: 64 },
  gold: { id: BlockID.GoldOre, attempts: 2, size: 6, minY: 2, maxY: 32 },
  diamond: { id: BlockID.DiamondOre, attempts: 1, size: 5, minY: 1, maxY: 16 },
};

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
