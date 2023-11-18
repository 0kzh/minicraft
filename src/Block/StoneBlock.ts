import * as THREE from "three";

import { Block } from "./Block";
import { textures } from "./textures";

import { BlockID } from ".";

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
