import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

import { BlockID } from "./Block";
import { World } from "./World";

function cube(size: number) {
  const h = size * 0.5;

  const position = [
    [-h, -h, -h],
    [-h, h, -h],
    [h, h, -h],
    [h, -h, -h],
    [-h, -h, -h],

    [-h, -h, h],
    [-h, h, h],
    [-h, h, -h],
    [-h, h, h],

    [h, h, h],
    [h, h, -h],
    [h, h, h],

    [h, -h, h],
    [h, -h, -h],
    [h, -h, h],
    [-h, -h, h],
  ].flat();

  return position;
}

const selectionMaterial = new LineMaterial({
  color: 0x000000,
  opacity: 0.8,
  linewidth: 2,
  resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
});
const selectionLineGeometry = new LineGeometry();
selectionLineGeometry.setPositions(cube(1.001));
const CENTER_SCREEN = new THREE.Vector2(0, 0);

export class Player {
  height = 1.75;
  radius = 0.5;
  maxSpeed = 4.2;
  // maxSpeed = 25;
  jumpSpeed = 10;
  onGround = false;

  input = new THREE.Vector3();
  velocity = new THREE.Vector3();
  #worldVelocity = new THREE.Vector3();

  spacePressed = false;

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
  selectionHelper = new Line2(selectionLineGeometry, selectionMaterial);
  controls = new PointerLockControls(this.camera, document.body);
  raycaster = new THREE.Raycaster(
    new THREE.Vector3(),
    new THREE.Vector3(),
    0,
    5
  );
  selectedCoords: THREE.Vector3 | null = null;

  toolbar: (BlockID | null)[] = [];
  activeToolbarIndex = 0;

  constructor(scene: THREE.Scene) {
    this.camera.position.set(32, 72, 32);
    this.controls.lock();
    this.boundsHelper.visible = false;
    this.cameraHelper.visible = false;
    this.selectionHelper.visible = false;
    scene.add(this.camera);
    scene.add(this.cameraHelper);
    scene.add(this.boundsHelper);
    scene.add(this.selectionHelper);

    document.addEventListener("keydown", this.onKeyDown.bind(this));
    document.addEventListener("keyup", this.onKeyUp.bind(this));
  }

  applyInputs(dt: number) {
    if (this.controls.isLocked) {
      // Normalize the input vector if more than one key is pressed
      if (this.input.length() > 1) {
        this.input.normalize().multiplyScalar(this.maxSpeed);
      }

      this.velocity.x = this.input.x;
      this.velocity.z = this.input.z;
      if (this.spacePressed && this.onGround) {
        this.velocity.y = this.jumpSpeed;
      }

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

  update(world: World) {
    this.updateBoundsHelper();
    this.updateRaycaster(world);
  }

  /**
   * Update the player's bounding cylinder helper
   */
  updateBoundsHelper() {
    this.boundsHelper.position.copy(this.camera.position);
    this.boundsHelper.position.y -= this.height / 2; // set to eye level
  }

  /**
   * Updates the raycaster used for block selection
   */
  updateRaycaster(world: World) {
    this.raycaster.setFromCamera(CENTER_SCREEN, this.camera);
    const intersections = this.raycaster.intersectObjects(world.children, true);

    if (intersections.length > 0) {
      const intersection = intersections[0];

      // Get the chunk associated with the seclected block
      const chunk = intersection.object.parent;

      if (!intersection.instanceId || !chunk) {
        this.selectionHelper.visible = false;
        return;
      }

      // Get the transformation matrix for the selected block
      const blockMatrix = new THREE.Matrix4();
      (intersection.object as THREE.InstancedMesh).getMatrixAt(
        intersection.instanceId,
        blockMatrix
      );

      // Set the selected coordinates to origin of chunk
      // Then apply transformation matrix of block to get block coords
      this.selectedCoords = chunk.position.clone();
      this.selectedCoords.applyMatrix4(blockMatrix);

      this.selectionHelper.position.copy(this.selectedCoords);
      this.selectionHelper.visible = true;
    } else {
      this.selectedCoords = null;
      this.selectionHelper.visible = false;
    }
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

  get activeBlockId() {
    return this.toolbar[this.activeToolbarIndex];
  }

  onKeyDown(event: KeyboardEvent) {
    const validKeys = ["KeyW", "KeyA", "KeyS", "KeyD", "KeyR"];
    if (validKeys.includes(event.code) && !this.controls.isLocked) {
      this.controls.lock();
    }

    switch (event.code) {
      case "Digit1":
      case "Digit2":
      case "Digit3":
      case "Digit4":
      case "Digit5":
      case "Digit6":
      case "Digit7":
      case "Digit8":
      case "Digit9":
        this.activeToolbarIndex = Number(event.key) - 1;
        document
          ?.getElementById("toolbar-active-border")
          ?.setAttribute("style", `left: ${this.activeToolbarIndex * 11}%`);
        break;
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
        this.position.set(32, 72, 32);
        this.velocity.set(0, 0, 0);
        break;
      case "Space":
        this.spacePressed = true;
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
      case "Space":
        this.spacePressed = false;
        break;
    }
  }
}
