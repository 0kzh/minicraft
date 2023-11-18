import * as THREE from "three";

import { Block } from "./Block";
import { textures } from "./textures";

import { BlockID } from ".";

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
