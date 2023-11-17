import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";

export class Player {
  height = 1.75;
  radius = 0.5;
  maxSpeed = 5;
  jumpSpeed = 10;
  onGround = false;

  input = new THREE.Vector3();
  velocity = new THREE.Vector3();
  #worldVelocity = new THREE.Vector3();

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    200
  );
  cameraHelper = new THREE.CameraHelper(this.camera);
  boundsHelper = new THREE.Mesh(
    new THREE.CylinderGeometry(this.radius, this.radius, this.height, 16),
    new THREE.MeshBasicMaterial({ wireframe: true })
  );
  controls = new PointerLockControls(this.camera, document.body);

  constructor(scene: THREE.Scene) {
    this.camera.position.set(32, 64, 32);
    this.boundsHelper.visible = false;
    scene.add(this.camera);
    scene.add(this.cameraHelper);
    scene.add(this.boundsHelper);

    document.addEventListener("keydown", this.onKeyDown.bind(this));
    document.addEventListener("keyup", this.onKeyUp.bind(this));
  }

  applyInputs(dt: number) {
    if (this.controls.isLocked) {
      console.log("applying inputs");
      this.velocity.x = this.input.x;
      this.velocity.z = this.input.z;
      this.controls.moveRight(this.velocity.x * dt);
      this.controls.moveForward(this.velocity.z * dt);
      this.position.y += this.velocity.y * dt;
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

  /**
   * Update the player's bounding cylinder helper
   */
  updateBoundsHelper() {
    this.boundsHelper.position.copy(this.camera.position);
    this.boundsHelper.position.y -= this.height / 2; // set to eye level
  }

  /*
   * Returns the velocity of the player in world coordinates
   */
  get worldVelocity() {
    this.#worldVelocity.copy(this.velocity);
    this.#worldVelocity.applyEuler(
      new THREE.Euler(0, this.camera.rotation.y, 0)
    );
    return this.#worldVelocity;
  }

  /**
   * Apply a world delta velocity to the player
   */
  applyWorldDeltaVelocity(dv: THREE.Vector3) {
    dv.applyEuler(new THREE.Euler(0, -this.camera.rotation.y, 0));
    this.velocity.add(dv);
  }

  get position() {
    return this.camera.position;
  }

  onKeyDown(event: KeyboardEvent) {
    const validKeys = ["KeyW", "KeyA", "KeyS", "KeyD", "KeyR"];
    if (validKeys.includes(event.code) && !this.controls.isLocked) {
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
      case "Space":
        if (this.onGround) {
          this.velocity.y = this.jumpSpeed;
        }
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
