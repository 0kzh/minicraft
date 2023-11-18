export enum BlockID {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  CoalOre = 4,
  IronOre = 5,
  Bedrock = 6,
}

export const oreConfig = {
  coal: {
    id: BlockID.CoalOre,
    scale: { x: 8, y: 8, z: 8 },
    scarcity: 0.75,
  },
  iron: {
    id: BlockID.IronOre,
    scale: { x: 5, y: 5, z: 5 },
    scarcity: 0.8,
  },
};

export const blockIdToKey = {
  [BlockID.Air]: "air",
  [BlockID.Grass]: "grass",
  [BlockID.Dirt]: "dirt",
  [BlockID.Stone]: "stone",
  [BlockID.CoalOre]: "coal",
  [BlockID.IronOre]: "iron",
  [BlockID.Bedrock]: "bedrock",
};
