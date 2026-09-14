import { BlockID } from ".";

/**
 * Texture layers of the block texture array. The index of a name in this list
 * is the layer index sampled by the chunk shader.
 */
export const TEXTURE_LAYERS = [
  "grass_side",
  "grass",
  "dirt",
  "stone",
  "coal_ore",
  "iron_ore",
  "bedrock",
  "oak_log_side",
  "oak_log_top",
  "leaves",
  "tall_grass",
  "flower_rose",
  "flower_dandelion",
  "redstone_lamp",
  "stonebrick",
  "sand",
  "snow",
  "water",
  "lava",
  "sandstone_top",
  "sandstone_side",
  "gravel",
  "snow_grass_side",
  "spruce_log_side",
  "spruce_log_top",
  "spruce_leaves",
  "birch_log_side",
  "birch_log_top",
  "birch_leaves",
  "cactus_side",
  "cactus_top",
  "dead_bush",
  "gold_ore",
  "diamond_ore",
] as const;

export type TextureName = typeof TEXTURE_LAYERS[number];

export const textureLayer = (name: TextureName): number =>
  TEXTURE_LAYERS.indexOf(name);

export enum RenderGeometry {
  None,
  Cube,
  Cross,
}

export enum RenderLayer {
  Opaque,
  Cutout,
  Translucent,
}

export type SoundGroup =
  | "grass"
  | "wood"
  | "stone"
  | "sand"
  | "snow"
  | "gravel";

export type BlockDef = {
  id: BlockID;
  name: string;
  geometry: RenderGeometry;
  layer: RenderLayer;
  /** Fully occludes neighbouring faces */
  opaque: boolean;
  /** Player and physics can pass through */
  passable: boolean;
  /** Liquid: slows and buoys the player, tints the view when submerged */
  fluid: boolean;
  /** Rendered at full brightness regardless of lighting */
  emissive: boolean;
  /** Block light emitted (0-15) */
  lightEmission: number;
  /** Light lost when passing through this block (0 = clear, 15 = opaque) */
  lightOpacity: number;
  /** Skip faces between two blocks of this same type (e.g. glass, water) */
  cullSelf: boolean;
  /** Texture layer per face: +X, -X, +Y, -Y, +Z, -Z */
  faces: [number, number, number, number, number, number];
  uiTexture: string;
  sound: SoundGroup;
};

type FaceSpec =
  | TextureName
  | { side: TextureName; top: TextureName; bottom?: TextureName };

const faces = (
  spec: FaceSpec
): [number, number, number, number, number, number] => {
  if (typeof spec === "string") {
    const l = textureLayer(spec);
    return [l, l, l, l, l, l];
  }
  const side = textureLayer(spec.side);
  const top = textureLayer(spec.top);
  const bottom = textureLayer(spec.bottom ?? spec.top);
  return [side, side, top, bottom, side, side];
};

const cube = (
  id: BlockID,
  name: string,
  spec: FaceSpec,
  uiTexture: string,
  sound: SoundGroup,
  overrides: Partial<BlockDef> = {}
): BlockDef => ({
  id,
  name,
  geometry: RenderGeometry.Cube,
  layer: RenderLayer.Opaque,
  opaque: true,
  passable: false,
  fluid: false,
  emissive: false,
  lightEmission: 0,
  lightOpacity: 15,
  cullSelf: true,
  faces: faces(spec),
  uiTexture,
  sound,
  ...overrides,
});

const leaves = (
  id: BlockID,
  name: string,
  texture: TextureName,
  uiTexture: string
): BlockDef =>
  cube(id, name, texture, uiTexture, "grass", {
    layer: RenderLayer.Cutout,
    opaque: false,
    lightOpacity: 1,
    cullSelf: false,
  });

const fluid = (
  id: BlockID,
  name: string,
  texture: TextureName,
  uiTexture: string,
  overrides: Partial<BlockDef> = {}
): BlockDef =>
  cube(id, name, texture, uiTexture, "stone", {
    layer: RenderLayer.Translucent,
    opaque: false,
    passable: true,
    fluid: true,
    lightOpacity: 2,
    cullSelf: true,
    ...overrides,
  });

const cross = (
  id: BlockID,
  name: string,
  texture: TextureName,
  uiTexture: string
): BlockDef => ({
  id,
  name,
  geometry: RenderGeometry.Cross,
  layer: RenderLayer.Cutout,
  opaque: false,
  passable: true,
  fluid: false,
  emissive: false,
  lightEmission: 0,
  lightOpacity: 0,
  cullSelf: false,
  faces: faces(texture),
  uiTexture,
  sound: "grass",
});

const defs: BlockDef[] = [
  {
    id: BlockID.Air,
    name: "air",
    geometry: RenderGeometry.None,
    layer: RenderLayer.Opaque,
    opaque: false,
    passable: true,
    fluid: false,
    emissive: false,
    lightEmission: 0,
    lightOpacity: 0,
    cullSelf: true,
    faces: [0, 0, 0, 0, 0, 0],
    uiTexture: "",
    sound: "stone",
  },
  cube(
    BlockID.Grass,
    "grass",
    { side: "grass_side", top: "grass", bottom: "dirt" },
    "textures/grass_block.png",
    "grass"
  ),
  cube(BlockID.Dirt, "dirt", "dirt", "textures/dirt_block.png", "grass"),
  cube(BlockID.Stone, "stone", "stone", "textures/stone_block.png", "stone"),
  cube(
    BlockID.CoalOre,
    "coal_ore",
    "coal_ore",
    "textures/coal_block.png",
    "stone"
  ),
  cube(
    BlockID.IronOre,
    "iron_ore",
    "iron_ore",
    "textures/iron_block.png",
    "stone"
  ),
  cube(
    BlockID.Bedrock,
    "bedrock",
    "bedrock",
    "textures/bedrock_block.png",
    "stone"
  ),
  cube(
    BlockID.OakLog,
    "oak_log",
    { side: "oak_log_side", top: "oak_log_top" },
    "textures/oak_log_block.png",
    "wood"
  ),
  leaves(BlockID.Leaves, "leaves", "leaves", "textures/leaves_block.png"),
  cross(
    BlockID.TallGrass,
    "tall_grass",
    "tall_grass",
    "textures/tall_grass_block.png"
  ),
  cross(
    BlockID.FlowerRose,
    "flower_rose",
    "flower_rose",
    "textures/flower_rose.png"
  ),
  cross(
    BlockID.FlowerDandelion,
    "flower_dandelion",
    "flower_dandelion",
    "textures/flower_dandelion.png"
  ),
  cube(
    BlockID.RedstoneLamp,
    "redstone_lamp",
    "redstone_lamp",
    "textures/redstone_lamp_block.png",
    "stone",
    { emissive: true, lightEmission: 15 }
  ),
  cube(
    BlockID.StoneBrick,
    "stone_brick",
    "stonebrick",
    "textures/stonebrick_block.png",
    "stone"
  ),
  fluid(BlockID.Water, "water", "water", "textures/water_block.png"),
  fluid(BlockID.Lava, "lava", "lava", "textures/lava_block.png", {
    emissive: true,
    lightEmission: 15,
    lightOpacity: 15,
  }),
  cube(BlockID.Sand, "sand", "sand", "textures/sand_block.png", "sand"),
  cube(
    BlockID.Sandstone,
    "sandstone",
    { side: "sandstone_side", top: "sandstone_top" },
    "textures/sandstone_block.png",
    "stone"
  ),
  cube(
    BlockID.Gravel,
    "gravel",
    "gravel",
    "textures/gravel_block.png",
    "gravel"
  ),
  cube(
    BlockID.SnowGrass,
    "snow_grass",
    { side: "snow_grass_side", top: "snow", bottom: "dirt" },
    "textures/snow_grass_block.png",
    "snow"
  ),
  cube(BlockID.Snow, "snow", "snow", "textures/snow_block.png", "snow"),
  cube(
    BlockID.SpruceLog,
    "spruce_log",
    { side: "spruce_log_side", top: "spruce_log_top" },
    "textures/spruce_log_block.png",
    "wood"
  ),
  leaves(
    BlockID.SpruceLeaves,
    "spruce_leaves",
    "spruce_leaves",
    "textures/spruce_leaves_block.png"
  ),
  cube(
    BlockID.BirchLog,
    "birch_log",
    { side: "birch_log_side", top: "birch_log_top" },
    "textures/birch_log_block.png",
    "wood"
  ),
  leaves(
    BlockID.BirchLeaves,
    "birch_leaves",
    "birch_leaves",
    "textures/birch_leaves_block.png"
  ),
  cube(
    BlockID.Cactus,
    "cactus",
    { side: "cactus_side", top: "cactus_top" },
    "textures/cactus_block.png",
    "grass"
  ),
  cross(
    BlockID.DeadBush,
    "dead_bush",
    "dead_bush",
    "textures/dead_bush_block.png"
  ),
  cube(
    BlockID.GoldOre,
    "gold_ore",
    "gold_ore",
    "textures/gold_block.png",
    "stone"
  ),
  cube(
    BlockID.DiamondOre,
    "diamond_ore",
    "diamond_ore",
    "textures/diamond_block.png",
    "stone"
  ),
];

export const BLOCKS: BlockDef[] = [];
for (const def of defs) {
  BLOCKS[def.id] = def;
}

export const getBlockDef = (id: BlockID): BlockDef => BLOCKS[id] ?? BLOCKS[0];
