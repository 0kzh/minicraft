import * as THREE from "three";

import { Block, RenderGeometry } from "./Block";
import { textures, uiTextures } from "./textures";

import { BlockID } from ".";

const oakLogSideMaterial = new THREE.MeshLambertMaterial({
  map: textures.oakLogSide,
});
const oakLogTopMaterial = new THREE.MeshLambertMaterial({
  map: textures.oakLogTop,
});

export class OakLogBlock extends Block {
  id = BlockID.OakLog;
  material = [
    oakLogSideMaterial, // right
    oakLogSideMaterial, // left
    oakLogTopMaterial, // top
    oakLogTopMaterial, // bottom
    oakLogSideMaterial, // front
    oakLogSideMaterial, // back
  ];
  uiTexture = uiTextures.oakLog;
  geometry = RenderGeometry.Cube;
  transparent = false;
  canPassThrough = false;
}
