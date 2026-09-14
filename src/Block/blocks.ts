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
}

export type SoundGroup = "grass" | "wood" | "stone";

export type BlockDef = {
  id: BlockID;
  name: string;
  geometry: RenderGeometry;
  layer: RenderLayer;
  /** Fully occludes neighbouring faces */
  opaque: boolean;
  /** Player and physics can pass through */
  passable: boolean;
  /** Rendered at full brightness regardless of lighting */
  emissive: boolean;
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
  emissive: false,
  cullSelf: true,
  faces: faces(spec),
  uiTexture,
  sound,
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
  emissive: false,
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
    emissive: false,
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
  cube(
    BlockID.Leaves,
    "leaves",
    "leaves",
    "textures/leaves_block.png",
    "grass",
    {
      layer: RenderLayer.Cutout,
      opaque: false,
      cullSelf: false,
    }
  ),
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
    { emissive: true }
  ),
  cube(
    BlockID.StoneBrick,
    "stone_brick",
    "stonebrick",
    "textures/stonebrick_block.png",
    "stone"
  ),
];

export const BLOCKS: BlockDef[] = [];
for (const def of defs) {
  BLOCKS[def.id] = def;
}

export const getBlockDef = (id: BlockID): BlockDef => BLOCKS[id] ?? BLOCKS[0];
