import { BlockID } from ".";

export abstract class Block {
  abstract id: BlockID;
  abstract material: THREE.MeshLambertMaterial | THREE.MeshLambertMaterial[];
  abstract uiTexture: string;
}
