import * as THREE from "three";

import { Block } from "./Block";
import { textures } from "./textures";

import { BlockID } from ".";

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
