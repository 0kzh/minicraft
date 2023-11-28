import * as THREE from "three";

const textureLoader = new THREE.TextureLoader();

function loadTexture(path: string) {
  // TODO: make async
  const texture = textureLoader.load(path);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = true;
  return texture;
}

export const textures = {
  grassSide: loadTexture("textures/grass_side.png"),
  grassTop: loadTexture("textures/grass.png"),
  dirt: loadTexture("textures/dirt.png"),
  stone: loadTexture("textures/stone.png"),
  coal: loadTexture("textures/coal_ore.png"),
  iron: loadTexture("textures/iron_ore.png"),
  bedrock: loadTexture("textures/bedrock.png"),
  oakLogSide: loadTexture("textures/oak_log_side.png"),
  oakLogTop: loadTexture("textures/oak_log_top.png"),
  leaves: loadTexture("textures/leaves.png"),
  tallGrass: loadTexture("textures/tall_grass.png"),
  flowerRose: loadTexture("textures/flower_rose.png"),
  flowerDandelion: loadTexture("textures/flower_dandelion.png"),
  redstoneLamp: loadTexture("textures/redstone_lamp.png"),
};

export const uiTextures = {
  grass: "textures/grass_block.png",
  dirt: "textures/dirt_block.png",
  stone: "textures/stone_block.png",
  coal: "textures/coal_block.png",
  iron: "textures/iron_block.png",
  bedrock: "textures/bedrock_block.png",
  oakLog: "textures/oak_log_block.png",
  leaves: "textures/leaves_block.png",
  tallGrass: "textures/tall_grass_block.png",
  flowerRose: "textures/flower_rose.png",
  flowerDandelion: "textures/flower_dandelion.png",
  redstoneLamp: "textures/redstone_lamp_block.png",
};
