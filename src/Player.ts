import TWEEN from "@tweenjs/tween.js";
import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

import audioManager from "./audio/AudioManager";
import { BlockID } from "./Block";
import { BlockFactory } from "./Block/BlockFactory";
import { World } from "./World";

function cuboid(width: number, height: number, depth: number) {
  const hw = width * 0.5;
  const hh = height * 0.5;
  const hd = depth * 0.5;

  const position = [
    [-hw, -hh, -hd],
    [-hw, hh, -hd],
    [hw, hh, -hd],
    [hw, -hh, -hd],
    [-hw, -hh, -hd],

    [-hw, -hh, hd],
    [-hw, hh, hd],
    [-hw, hh, -hd],
    [-hw, hh, hd],

    [hw, hh, hd],
    [hw, hh, -hd],
    [hw, hh, hd],

    [hw, -hh, hd],
    [hw, -hh, -hd],
    [hw, -hh, hd],
    [-hw, -hh, hd],
  ].flat();

  return position;
}

const selectionMaterial = new LineMaterial({
  color: 0x000000,
  opacity: 0.9,
  linewidth: 1,
  resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
});
const selectionLineGeometry = new LineGeometry();
selectionLineGeometry.setPositions(cuboid(1.001, 1.001, 1.001));
const CENTER_SCREEN = new THREE.Vector2(0, 0);

export class Player {
  height = 1.75;
  radius = 0.5;
  maxSpeed = 4.317;
  maxSprintSpeed = 5.612;
  // maxSpeed = 25;
  jumpSpeed = 10;
  onGround = false;

  input = new THREE.Vector3();
  velocity = new THREE.Vector3();
  #worldVelocity = new THREE.Vector3();

  initialPosition = new THREE.Vector3(32, 72, 32);

  spacePressed = false;
  wKeyPressed = false;
  lastWPressed = 0;
  isSprinting = false;

  lastStepSoundPlayed = 0;

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    5000
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
  selectedBlockSize: THREE.Vector3 | null = null;
  blockPlacementCoords: THREE.Vector3 | null = null;

  toolbar: (BlockID | null)[] = [
    BlockID.Grass,
    BlockID.Dirt,
    BlockID.Stone,
    BlockID.StoneBrick,
    BlockID.RedstoneLamp,
    BlockID.CoalOre,
    BlockID.IronOre,
    BlockID.OakLog,
    BlockID.Leaves,
  ];
  activeToolbarIndex = 0;

  constructor(scene: THREE.Scene) {
    this.camera.position.set(
      this.initialPosition.x,
      this.initialPosition.y,
      this.initialPosition.z
    );
    this.boundsHelper.visible = false;
    this.cameraHelper.visible = false;
    this.selectionHelper.visible = false;
    scene.add(this.camera);
    scene.add(this.cameraHelper);
    scene.add(this.boundsHelper);
    scene.add(this.selectionHelper);

    setTimeout(() => {
      this.controls.lock();
    }, 2000);

    document.addEventListener("keydown", this.onKeyDown.bind(this));
    document.addEventListener("keyup", this.onKeyUp.bind(this));
  }

  applyInputs(dt: number, blockUnderneath: BlockID) {
    // Normalize the input vector if more than one key is pressed
    if (this.input.length() > 1) {
      this.input
        .normalize()
        .multiplyScalar(this.isSprinting ? this.maxSprintSpeed : this.maxSpeed);
    }

    this.velocity.x = this.input.x;
    this.velocity.z = this.input.z;

    // play step sound
    if (this.onGround && this.input.length() > 0) {
      const minTimeout = this.isSprinting ? 300 : 400;
      if (performance.now() - this.lastStepSoundPlayed > minTimeout) {
        this.playWalkSound(blockUnderneath);
        this.lastStepSoundPlayed = performance.now();
      }
    }

    if (this.spacePressed && this.onGround) {
      this.velocity.y = this.jumpSpeed;
    }

    this.controls.moveRight(this.velocity.x * dt);
    this.controls.moveForward(this.velocity.z * dt);
    this.position.y += this.velocity.y * dt;

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

  async playWalkSound(blockUnderneath: BlockID) {
    switch (blockUnderneath) {
      case BlockID.Grass:
      case BlockID.Dirt:
      case BlockID.Leaves:
        audioManager.play("step.grass");
        break;
      case BlockID.OakLog:
        audioManager.play("step.wood");
        break;
      case BlockID.Stone:
      case BlockID.CoalOre:
      case BlockID.IronOre:
      case BlockID.Bedrock:
        audioManager.play("step.stone");
        break;
    }
  }

  update(world: World) {
    this.updateBoundsHelper();
    this.updateRaycaster(world);
    this.updateToolbar();
    this.updateCameraFOV();

    // prevent player from falling through
    if (this.position.y < 0) {
      this.position.set(
        this.initialPosition.x,
        this.initialPosition.y,
        this.initialPosition.z
      );
      this.velocity.set(0, 0, 0);
    }
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

      if (intersection.instanceId == null || !chunk) {
        this.selectionHelper.visible = false;
        return;
      }

      // Get the transformation matrix for the selected block
      const blockMatrix = new THREE.Matrix4();
      (intersection.object as THREE.InstancedMesh).getMatrixAt(
        intersection.instanceId,
        blockMatrix
      );

      // Undo rotation from block matrix
      const rotationMatrix = new THREE.Matrix4().extractRotation(blockMatrix);
      const inverseRotationMatrix = rotationMatrix.invert();
      blockMatrix.multiply(inverseRotationMatrix);

      // Set the selected coordinates to origin of chunk
      // Then apply transformation matrix of block to get block coords
      this.selectedCoords = chunk.position.clone();
      this.selectedCoords.applyMatrix4(blockMatrix);

      // Get the bounding box of the selected block
      const boundingBox = new THREE.Box3().setFromObject(intersection.object);
      this.selectedBlockSize = boundingBox.getSize(new THREE.Vector3());

      if (this.activeBlockId !== BlockID.Air && intersection.normal) {
        // Update block placement coords to be 1 block over in the direction of the normal
        this.blockPlacementCoords = this.selectedCoords
          .clone()
          .add(intersection.normal);
      }

      this.selectionHelper.position.copy(this.selectedCoords);
      this.selectionHelper.visible = true;
    } else {
      this.selectedCoords = null;
      this.selectionHelper.visible = false;
    }
  }

  /**
   * Updates the toolbar UI
   */
  updateToolbar() {
    for (let i = 1; i <= 9; i++) {
      const slot = document.getElementById(`toolbar-slot-${i}`);
      if (slot) {
        const blockId = this.toolbar[i - 1];
        if (blockId != null && blockId !== BlockID.Air) {
          slot.style.backgroundImage = `url('${
            BlockFactory.getBlock(blockId).uiTexture
          }')`;
        }
      }
    }
  }

  updateCameraFOV() {
    const currentFov = { fov: this.camera.fov };
    const targetFov = this.isSprinting ? 80 : 70;
    const update = () => {
      this.camera.fov = currentFov.fov;
      this.camera.updateProjectionMatrix();
    };
    new TWEEN.Tween(currentFov)
      .to({ fov: targetFov }, 30)
      .easing(TWEEN.Easing.Quadratic.Out)
      .onUpdate(update)
      .start();
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
        if (!this.wKeyPressed && performance.now() - this.lastWPressed < 200) {
          this.isSprinting = true;
          this.input.z = this.maxSprintSpeed;
        } else {
          this.input.z = this.maxSpeed;
        }
        this.wKeyPressed = true;
        this.lastWPressed = performance.now();
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
        this.position.set(
          this.initialPosition.x,
          this.initialPosition.y,
          this.initialPosition.z
        );
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
        this.wKeyPressed = false;
        this.isSprinting = false;
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
