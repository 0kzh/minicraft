import * as THREE from "three";

import { OreBlock } from "./OreBlock";
import { textures, uiTextures } from "./textures";

import { BlockID, oreConfig } from ".";

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
  uiTexture = uiTextures.coal;
};
