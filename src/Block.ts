import * as THREE from "three";

const textureLoader = new THREE.TextureLoader();

function loadTexture(path: string) {
  // TODO: make async
  const texture = textureLoader.load(path);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

const textures = {
  grassSide: loadTexture("textures/grass_side.png"),
  grassTop: loadTexture("textures/grass.png"),
  dirt: loadTexture("textures/dirt.png"),
  stone: loadTexture("textures/stone.png"),
  coal: loadTexture("textures/coal_ore.png"),
  iron: loadTexture("textures/iron_ore.png"),
  bedrock: loadTexture("textures/bedrock.png"),
};

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
    scale: { x: 8, y: 8, z: 8 },
    scarcity: 0.75,
  },
  iron: {
    scale: { x: 5, y: 5, z: 5 },
    scarcity: 0.8,
  },
};

export abstract class Block {
  abstract id: BlockID;
  abstract material: THREE.MeshLambertMaterial[];
}

export abstract class OreBlock extends Block {
  abstract scale: { x: number; y: number; z: number };
  abstract scarcity: number;
}

export class AirBlock extends Block {
  id = BlockID.Air;
  material = [];
}

export class GrassBlock extends Block {
  id = BlockID.Grass;
  material = [
    new THREE.MeshLambertMaterial({ map: textures.grassSide }), // right
    new THREE.MeshLambertMaterial({ map: textures.grassSide }), // left
    new THREE.MeshLambertMaterial({ map: textures.grassTop }), // top
    new THREE.MeshLambertMaterial({ map: textures.dirt }), // bottom
    new THREE.MeshLambertMaterial({ map: textures.grassSide }), // front
    new THREE.MeshLambertMaterial({ map: textures.grassSide }), // back
  ];
}

export class DirtBlock extends Block {
  id = BlockID.Dirt;
  material = [
    new THREE.MeshLambertMaterial({ map: textures.dirt }), // right
    new THREE.MeshLambertMaterial({ map: textures.dirt }), // left
    new THREE.MeshLambertMaterial({ map: textures.dirt }), // top
    new THREE.MeshLambertMaterial({ map: textures.dirt }), // bottom
    new THREE.MeshLambertMaterial({ map: textures.dirt }), // front
    new THREE.MeshLambertMaterial({ map: textures.dirt }), // back
  ];
}

export class StoneBlock extends Block {
  id = BlockID.Stone;
  material = [
    new THREE.MeshLambertMaterial({ map: textures.stone }), // right
    new THREE.MeshLambertMaterial({ map: textures.stone }), // left
    new THREE.MeshLambertMaterial({ map: textures.stone }), // top
    new THREE.MeshLambertMaterial({ map: textures.stone }), // bottom
    new THREE.MeshLambertMaterial({ map: textures.stone }), // front
    new THREE.MeshLambertMaterial({ map: textures.stone }), // back
  ];
}

export class BedrockBlock extends Block {
  id = BlockID.Bedrock;
  material = [
    new THREE.MeshLambertMaterial({ map: textures.bedrock }), // right
    new THREE.MeshLambertMaterial({ map: textures.bedrock }), // left
    new THREE.MeshLambertMaterial({ map: textures.bedrock }), // top
    new THREE.MeshLambertMaterial({ map: textures.bedrock }), // bottom
    new THREE.MeshLambertMaterial({ map: textures.bedrock }), // front
    new THREE.MeshLambertMaterial({ map: textures.bedrock }), // back
  ];
}

export const CoalOreBlock = class extends OreBlock {
  id = BlockID.CoalOre;
  scale = oreConfig["coal"].scale;
  scarcity = oreConfig["coal"].scarcity;
  material = [
    new THREE.MeshLambertMaterial({ map: textures.coal }), // right
    new THREE.MeshLambertMaterial({ map: textures.coal }), // left
    new THREE.MeshLambertMaterial({ map: textures.coal }), // top
    new THREE.MeshLambertMaterial({ map: textures.coal }), // bottom
    new THREE.MeshLambertMaterial({ map: textures.coal }), // front
    new THREE.MeshLambertMaterial({ map: textures.coal }), // back
  ];
};

export const IronOreBlock = class extends OreBlock {
  id = BlockID.IronOre;
  scale = oreConfig["iron"].scale;
  scarcity = oreConfig["iron"].scarcity;
  material = [
    new THREE.MeshLambertMaterial({ map: textures.iron }), // right
    new THREE.MeshLambertMaterial({ map: textures.iron }), // left
    new THREE.MeshLambertMaterial({ map: textures.iron }), // top
    new THREE.MeshLambertMaterial({ map: textures.iron }), // bottom
    new THREE.MeshLambertMaterial({ map: textures.iron }), // front
    new THREE.MeshLambertMaterial({ map: textures.iron }), // back
  ];
};

export const blocks = [
  AirBlock,
  GrassBlock,
  DirtBlock,
  StoneBlock,
  CoalOreBlock,
  IronOreBlock,
  BedrockBlock,
];

export const resources = [CoalOreBlock, IronOreBlock];
