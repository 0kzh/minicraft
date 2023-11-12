import * as THREE from 'three';

export enum BlockID {
    Air = 0,
    Grass = 1,
    Dirt = 2
}

export abstract class Block {
    abstract id: number;
    abstract color: THREE.Color;
}

export class AirBlock extends Block {
    id = BlockID.Air;
    color = new THREE.Color(0x000000);
}

export class GrassBlock extends Block {
    id = BlockID.Grass;
    color = new THREE.Color(0x559020);
}

export class DirtBlock extends Block {
    id = BlockID.Dirt;
    color = new THREE.Color(0x807020);
}
