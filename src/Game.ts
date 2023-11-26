import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import Stats from "three/examples/jsm/libs/stats.module";

import { createUI } from "./GUI";
import { Physics } from "./Physics";
import { Player } from "./Player";
import { World } from "./World";

export default class Game {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private orbitCamera!: THREE.PerspectiveCamera;

  private controls!: OrbitControls;
  private stats!: any;

  private world!: World;
  private player!: Player;
  private physics!: Physics;

  private previousTime = 0;

  constructor() {
    this.previousTime = performance.now();

    this.initScene();
    this.initStats();
    this.initListeners();
    // workerInstance.add(1, 2).then((result) => {
    //   console.log(result);
    // });
  }

  initStats() {
    this.stats = new (Stats as any)();
    document.body.appendChild(this.stats.dom);
  }

  initScene() {
    this.scene = new THREE.Scene();

    this.orbitCamera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight
    );
    this.orbitCamera.position.set(-32, 64, -32);

    this.renderer = new THREE.WebGLRenderer();
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x80abfe);

    document.body.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(
      this.orbitCamera,
      this.renderer.domElement
    );
    this.controls.target.set(16, 0, 16);
    this.controls.update();

    const sun = new THREE.DirectionalLight();
    sun.intensity = 1.5;
    sun.position.set(50, 50, 50);
    sun.castShadow = true;

    // Set the size of the sun's shadow box
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 250;
    sun.shadow.bias = -0.005;
    sun.shadow.mapSize = new THREE.Vector2(512, 512);
    this.scene.add(sun);
    this.scene.add(sun.target);

    this.scene.fog = new THREE.Fog(0x80a0e0, 50, 100);

    const ambient = new THREE.AmbientLight();
    ambient.intensity = 0.2;
    this.scene.add(ambient);

    this.world = new World();
    this.scene.add(this.world);

    this.player = new Player(this.scene);
    this.physics = new Physics(this.scene);

    createUI(this.world, this.player, this.physics);

    this.draw();
  }

  onMouseDown(event: MouseEvent) {
    if (this.player.controls.isLocked) {
      if (event.button === 0 && this.player.selectedCoords) {
        // Left click
        this.world.removeBlock(
          this.player.selectedCoords.x - 0.5,
          this.player.selectedCoords.y - 0.5,
          this.player.selectedCoords.z - 0.5
        );
      } else if (event.button === 2 && this.player.blockPlacementCoords) {
        console.log("adding block", this.player.activeBlockId);
        if (this.player.activeBlockId != null) {
          this.world.addBlock(
            this.player.blockPlacementCoords.x - 0.5,
            this.player.blockPlacementCoords.y - 0.5,
            this.player.blockPlacementCoords.z - 0.5,
            this.player.activeBlockId
          );
        }
      }
    }
  }

  initListeners() {
    window.addEventListener("resize", this.onWindowResize.bind(this), false);
    document.addEventListener("mousedown", this.onMouseDown.bind(this), false);
  }

  onWindowResize() {
    this.orbitCamera.aspect = window.innerWidth / window.innerHeight;
    this.orbitCamera.updateProjectionMatrix();
    this.player.camera.aspect = window.innerWidth / window.innerHeight;
    this.player.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  draw() {
    const currentTime = performance.now();
    const deltaTime = (currentTime - this.previousTime) / 1000;

    requestAnimationFrame(() => {
      this.draw();
    });

    this.physics.update(deltaTime, this.player, this.world);
    this.world.update(this.player);

    if (this.controls) {
      this.controls.autoRotate = false;
      this.controls.autoRotateSpeed = 2.0;
    }

    if (this.stats) this.stats.update();

    if (this.controls) this.controls.update();

    this.renderer.render(
      this.scene,
      this.player.controls.isLocked ? this.player.camera : this.orbitCamera
    );

    this.previousTime = currentTime;
  }
}
