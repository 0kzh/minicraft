import * as THREE from "three";

import { OreBlock } from "./OreBlock";
import { textures } from "./textures";

import { BlockID, oreConfig } from ".";

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
