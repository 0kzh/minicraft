import * as THREE from "three";

import { Block } from "./Block";
import { textures } from "./textures";

import { BlockID } from ".";

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
