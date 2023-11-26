import { BlockID } from ".";

export abstract class Block {
  abstract id: BlockID;
  abstract material: THREE.MeshLambertMaterial[];
  abstract uiTexture: string;
}
