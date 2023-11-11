import * as THREE from 'three';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';

const geometry = new THREE.BoxGeometry();
const material = new THREE.MeshLambertMaterial({ color: 0x00d000 });

type InstanceData = {
    id: number;
    instanceId: number | null; // reference to mesh instanceId
};

export class World extends THREE.Group {
    data: InstanceData[][][] = [];
    params = {
        terrain: {
            scale: 30,
            magnitude: 0.5,
            offset: 0.2
        }
    };

	public size; 

	constructor(size = { width: 64, height: 32 }) {
		super();
		this.size = size;
	}

    generate() {
        this.initializeTerrain();
        this.generateTerrain();
        this.generateMeshes();
    }

    /**
     * Initializes the terrain data
     */
    initializeTerrain() {
        this.data = [];
        for (let x = 0; x < this.size.width; x++) {
            const slice = [];
            for (let y = 0; y < this.size.height; y++) {
                const row: InstanceData[] = [];
                for (let z = 0; z < this.size.width; z++) {
                    row.push({
                        id: 0,
                        instanceId: null
                    });
                }
                slice.push(row);
            }
            this.data.push(slice);
        }
    }

    /**
     * Generates the terrain data
     */
    generateTerrain() {
        const simplex = new SimplexNoise();
        for (let x = 0; x < this.size.width; x++) {
            for (let z = 0; z < this.size.width; z++) {
                const value = simplex.noise(
                    x / this.params.terrain.scale, 
                    z / this.params.terrain.scale
                );

                const scaledNoise = this.params.terrain.offset + this.params.terrain.magnitude * value;

                let height = Math.floor(this.size.height * scaledNoise);
                height = Math.max(0, Math.min(height, this.size.height - 1));

                for (let y = 0; y <= height; y++) {
                    this.setBlockId(x, y, z, 1);
                }
            }
        }
    }

    /**
     * Generated the 3D representation of the world from the world data
     */
	generateMeshes() {
        this.clear();

		const maxCount = this.size.width * this.size.width * this.size.height;
		const mesh = new THREE.InstancedMesh(geometry, material, maxCount);
		mesh.count = 0;

		const matrix = new THREE.Matrix4();
		for (let x = 0; x < this.size.width; x++) {
			for (let y = 0; y < this.size.height; y++) {
				for (let z = 0; z < this.size.width; z++) {
                    const blockId = this.getBlock(x, y, z)?.id;
                    const instanceId = mesh.count;

                    if (blockId && blockId > 0) {
                        matrix.setPosition(x + 0.5, y + 0.5, z + 0.5); // lower left corner
                        mesh.setMatrixAt(instanceId, matrix);
                        this.setBlockInstanceId(x, y, z, instanceId);
                        mesh.count++;
                    }
				}
			}
		}

		this.add(mesh);
	}

    /**
     * Gets the block data at (x, y, z)
     */
    getBlock(x: number, y: number, z: number): InstanceData | null {
        if (this.inBounds(x, y, z)) {
            return this.data[x][y][z];
        } else {
            return null;
        }
    }

    /**
     * Sets the block id at (x, y, z)
     */
    setBlockId(x: number, y: number, z: number, id: number) {
        if (this.inBounds(x, y, z)) {
            this.data[x][y][z].id = id;
        }
    }

    /**
     * Sets the block instance data at (x, y, z)
     */
    setBlockInstanceId(x: number, y: number, z: number, instanceId: number) {
        if (this.inBounds(x, y, z)) {
            this.data[x][y][z].instanceId = instanceId;
        }
    }

    /**
     * Checks if the given coordinates are within the world bounds
     */
    inBounds(x: number, y: number, z: number): boolean {
        return x >= 0 && x < this.size.width && y >= 0 && y < this.size.height && z >= 0 && z < this.size.width;
    }
}