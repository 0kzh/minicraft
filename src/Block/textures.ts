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
};
