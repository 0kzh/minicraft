import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";

export class Player {
  maxSpeed = 15;
  input = new THREE.Vector3();
  velocity = new THREE.Vector3();

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    200
  );
  cameraHelper = new THREE.CameraHelper(this.camera);
  controls = new PointerLockControls(this.camera, document.body);

  constructor(scene: THREE.Scene) {
    this.camera.position.set(32, 64, 32);
    scene.add(this.camera);
    scene.add(this.cameraHelper);

    document.addEventListener("keydown", this.onKeyDown.bind(this));
    document.addEventListener("keyup", this.onKeyUp.bind(this));
  }

  applyInputs(dt: number) {
    if (this.controls.isLocked) {
      this.velocity.x = this.input.x;
      this.velocity.z = this.input.z;
      this.controls.moveRight(this.velocity.x * dt);
      this.controls.moveForward(this.velocity.z * dt);
    }

    const posX = document.getElementById("player-pos-x");
    if (posX) {
      posX.innerHTML = `x: ${this.position.x.toFixed(3)}`;
    }

    const posY = document.getElementById("player-pos-y");
    if (posY) {
      posY.innerHTML = `y: ${this.position.y.toFixed(3)}`;
    }

    const posZ = document.getElementById("player-pos-z");
    if (posZ) {
      posZ.innerHTML = `z: ${this.position.z.toFixed(3)}`;
    }
  }

  get position() {
    return this.camera.position;
  }

  onKeyDown(event: KeyboardEvent) {
    if (!this.controls.isLocked) {
      this.controls.lock();
    }

    switch (event.code) {
      case "KeyW":
        this.input.z = this.maxSpeed;
        break;
      case "KeyA":
        this.input.x = -this.maxSpeed;
        break;
      case "KeyS":
        this.input.z = -this.maxSpeed;
        break;
      case "KeyD":
        this.input.x = this.maxSpeed;
        break;
      case "KeyR":
        this.position.set(32, 64, 32);
        this.velocity.set(0, 0, 0);
        break;
    }
  }

  onKeyUp(event: KeyboardEvent) {
    switch (event.code) {
      case "KeyW":
        this.input.z = 0;
        break;
      case "KeyA":
        this.input.x = 0;
        break;
      case "KeyS":
        this.input.z = 0;
        break;
      case "KeyD":
        this.input.x = 0;
        break;
    }
  }
}
