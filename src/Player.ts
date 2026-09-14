import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

import audioManager from "./audio/AudioManager";
import { BlockID } from "./Block";
import { getBlockDef } from "./Block/blocks";
import { raycastVoxels } from "./chunk/raycast";
import { AABB, intersects, Physics } from "./Physics";
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
const REACH = 5;

/** Vanilla player dimensions */
const WIDTH = 0.6;
const HEIGHT = 1.8;
const EYE_HEIGHT = 1.62;
const SNEAK_HEIGHT = 1.5;
const SNEAK_EYE_HEIGHT = 1.27;

const BASE_FOV = 70;
/** Sprinting widens the view by (1.3 + 1) / 2 like vanilla */
const SPRINT_FOV_MULTIPLIER = 1.15;
const UNDERWATER_FOV_MULTIPLIER = 0.857;
/** Double-tapping forward within this window starts sprinting (7 ticks) */
const SPRINT_DOUBLE_TAP_MS = 350;
/** Vanilla damps keyboard impulse slightly, giving the 4.317 b/s walk speed */
const INPUT_IMPULSE = 0.98;
/** Horizontal distance walked between footsteps */
const STEP_DISTANCE = 1 / 0.6;

/**
 * Player state: a 0.6 x 1.8 box at `pos` (feet centre) moved by `Physics`
 * at 20 ticks/s, with the camera at eye height interpolated between ticks.
 */
export class Player {
  /** Feet position at the end of the last tick */
  pos = new THREE.Vector3();
  /** Feet position at the end of the tick before, for interpolation */
  prevPos = new THREE.Vector3();
  /** Blocks per tick */
  velocity = new THREE.Vector3();

  onGround = false;
  horizontalCollision = false;
  inFluid = false;
  inLava = false;
  /** How far the liquid surface sits above the feet */
  fluidDepth = 0;
  eyeSubmerged = false;
  jumpCooldown = 0;

  isSprinting = false;
  isSneaking = false;

  /** Held movement keys */
  #forward = false;
  #back = false;
  #left = false;
  #right = false;
  #jump = false;
  #sneak = false;
  #sprintKey = false;
  #lastForwardPress = 0;
  #forwardPressCount = 0;

  #walkDistance = 0;
  #nextStep = STEP_DISTANCE;

  #fovMultiplier = 1;
  #eyeHeight = EYE_HEIGHT;

  camera = new THREE.PerspectiveCamera(
    BASE_FOV,
    window.innerWidth / window.innerHeight,
    0.1,
    5000
  );

  cameraHelper = new THREE.CameraHelper(this.camera);
  boundsHelper = new THREE.Mesh(
    new THREE.BoxGeometry(WIDTH, HEIGHT, WIDTH),
    new THREE.MeshBasicMaterial({ wireframe: true })
  );
  selectionHelper = new Line2(selectionLineGeometry, selectionMaterial);
  controls = new PointerLockControls(this.camera, document.body);
  #lookDirection = new THREE.Vector3();
  #euler = new THREE.Euler(0, 0, 0, "YXZ");
  #moveInput = new THREE.Vector2();
  /** Integer world coordinates of the targeted block */
  selectedCoords: THREE.Vector3 | null = null;
  /** Integer world coordinates of the block that would be placed */
  blockPlacementCoords: THREE.Vector3 | null = null;

  toolbar: (BlockID | null)[] = [
    BlockID.Grass,
    BlockID.Dirt,
    BlockID.Stone,
    BlockID.StoneBrick,
    BlockID.RedstoneLamp,
    BlockID.OakLog,
    BlockID.Leaves,
    BlockID.Sand,
    BlockID.Water,
  ];
  activeToolbarIndex = 0;

  constructor(scene: THREE.Scene) {
    this.teleport(32, 72 + EYE_HEIGHT, 32);
    this.boundsHelper.visible = false;
    this.cameraHelper.visible = false;
    this.selectionHelper.visible = false;
    scene.add(this.camera);
    scene.add(this.cameraHelper);
    scene.add(this.boundsHelper);
    scene.add(this.selectionHelper);

    document.addEventListener("keydown", this.onKeyDown.bind(this));
    document.addEventListener("keyup", this.onKeyUp.bind(this));
    document.addEventListener("pointerlockchange", () => {
      if (!this.controls.isLocked) this.releaseKeys();
    });
  }

  /** Eye position, as rendered this frame */
  get position() {
    return this.camera.position;
  }

  /** Moves the player so its eyes are at (x, y, z), resetting motion */
  teleport(x: number, y: number, z: number) {
    this.pos.set(x, y - this.#eyeHeight, z);
    this.prevPos.copy(this.pos);
    this.velocity.set(0, 0, 0);
    this.camera.position.set(x, y, z);
  }

  get eyeHeight() {
    return this.isSneaking ? SNEAK_EYE_HEIGHT : EYE_HEIGHT;
  }

  get height() {
    return this.isSneaking ? SNEAK_HEIGHT : HEIGHT;
  }

  /** Camera yaw in radians (0 faces -Z) */
  get yaw() {
    this.#euler.setFromQuaternion(this.camera.quaternion);
    return this.#euler.y;
  }

  get jumping() {
    return this.#jump;
  }

  getBox(): AABB {
    const half = WIDTH / 2;
    return {
      minX: this.pos.x - half,
      minY: this.pos.y,
      minZ: this.pos.z - half,
      maxX: this.pos.x + half,
      maxY: this.pos.y + this.height,
      maxZ: this.pos.z + half,
    };
  }

  /** Whether the player's box overlaps the block cell at (x, y, z) */
  intersectsBlock(x: number, y: number, z: number) {
    return intersects(this.getBox(), {
      minX: x,
      minY: y,
      minZ: z,
      maxX: x + 1,
      maxY: y + 1,
      maxZ: z + 1,
    });
  }

  beginTick() {
    this.prevPos.copy(this.pos);
  }

  /** Resolves held keys into sneak/sprint state for this tick */
  tickInput() {
    const wasSneaking = this.isSneaking;
    this.isSneaking = this.#sneak && !this.inFluid;
    if (this.isSneaking && !wasSneaking) this.isSprinting = false;

    const forward = this.#forward && !this.#back;
    const canSprint = forward && !this.isSneaking && !this.inFluid;
    if (canSprint && this.#sprintKey) this.isSprinting = true;
    if (!canSprint) this.isSprinting = false;
  }

  /** Sprinting stops when running into a wall */
  tickSprint() {
    if (this.horizontalCollision) this.isSprinting = false;
  }

  /** Strafe (x, right positive) and forward (y) input, each -1..1 */
  moveInput(): THREE.Vector2 {
    this.#moveInput.set(
      (this.#right ? 1 : 0) - (this.#left ? 1 : 0),
      (this.#forward ? 1 : 0) - (this.#back ? 1 : 0)
    );
    if (this.#moveInput.lengthSq() > 1) this.#moveInput.normalize();
    this.#moveInput.multiplyScalar(
      this.isSneaking ? INPUT_IMPULSE * Physics.SNEAK_MULTIPLIER : INPUT_IMPULSE
    );
    return this.#moveInput;
  }

  /** Ground speed relative to walking */
  speedMultiplier() {
    return this.isSprinting ? Physics.SPRINT_MULTIPLIER : 1;
  }

  /** Plays a footstep for roughly every block walked on the ground */
  tickStepSounds(blockUnderneath: BlockID) {
    if (!this.onGround || this.inFluid) return;
    const dx = this.pos.x - this.prevPos.x;
    const dz = this.pos.z - this.prevPos.z;
    this.#walkDistance += Math.sqrt(dx * dx + dz * dz);
    if (this.#walkDistance >= this.#nextStep) {
      this.#nextStep = this.#walkDistance + STEP_DISTANCE;
      if (blockUnderneath !== BlockID.Air) {
        audioManager.play(`step.${getBlockDef(blockUnderneath).sound}`);
      }
    }
  }

  /** Places the camera between the last two ticks (alpha 0..1) */
  interpolate(alpha: number) {
    this.camera.position.lerpVectors(this.prevPos, this.pos, alpha);
    this.camera.position.y += this.#eyeHeight;
  }

  update(dt: number, world: World) {
    this.updateEyeHeight(dt);
    this.updateCameraFOV(dt);
    this.updateBoundsHelper();
    this.updateRaycaster(world);
    this.updateToolbar();
    this.updateDebugPosition();

    // prevent player from falling through
    if (this.pos.y < -8) {
      this.teleport(
        this.pos.x,
        world.chunkSize.height + 10 + this.#eyeHeight,
        this.pos.z
      );
    }
  }

  /** Camera yaw/pitch in radians, as PointerLockControls applies them */
  getLook() {
    const e = new THREE.Euler().setFromQuaternion(
      this.camera.quaternion,
      "YXZ"
    );
    return { yaw: e.y, pitch: e.x };
  }

  setLook(yaw: number, pitch: number) {
    this.camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
  }

  /** Eases the eye towards its sneaking/standing height */
  private updateEyeHeight(dt: number) {
    const target = this.eyeHeight;
    const t = 1 - Math.pow(0.001, dt);
    this.#eyeHeight += (target - this.#eyeHeight) * t;
  }

  private updateBoundsHelper() {
    this.boundsHelper.position.set(
      this.pos.x,
      this.pos.y + this.height / 2,
      this.pos.z
    );
    this.boundsHelper.scale.y = this.height / HEIGHT;
  }

  /**
   * Steps a ray from the camera through the voxel grid to find the targeted block
   */
  private updateRaycaster(world: World) {
    this.camera.getWorldDirection(this.#lookDirection);
    const hit = raycastVoxels(
      this.position,
      this.#lookDirection,
      REACH,
      (x, y, z) => {
        const id = world.getBlock(x, y, z);
        return id !== undefined && id !== BlockID.Air && !getBlockDef(id).fluid;
      }
    );

    if (!hit) {
      this.selectedCoords = null;
      this.blockPlacementCoords = null;
      this.selectionHelper.visible = false;
      return;
    }

    this.selectedCoords = new THREE.Vector3(hit.x, hit.y, hit.z);
    this.blockPlacementCoords = new THREE.Vector3(
      hit.x + hit.normal.x,
      hit.y + hit.normal.y,
      hit.z + hit.normal.z
    );

    const hitDef = getBlockDef(
      world.getBlock(hit.x, hit.y, hit.z) ?? BlockID.Air
    );
    const [x0, y0, z0, x1, y1, z1] = hitDef.box;
    this.selectionHelper.position.set(
      hit.x + (x0 + x1) / 2,
      hit.y + (y0 + y1) / 2,
      hit.z + (z0 + z1) / 2
    );
    this.selectionHelper.scale.set(x1 - x0, y1 - y0, z1 - z0);
    this.selectionHelper.visible = true;
  }

  private updateToolbar() {
    for (let i = 1; i <= 9; i++) {
      const slot = document.getElementById(`toolbar-slot-${i}`);
      if (slot) {
        const blockId = this.toolbar[i - 1];
        if (blockId != null && blockId !== BlockID.Air) {
          slot.style.backgroundImage = `url('${
            getBlockDef(blockId).uiTexture
          }')`;
        }
      }
    }
  }

  private updateDebugPosition() {
    const posX = document.getElementById("player-pos-x");
    if (posX) posX.innerHTML = `x: ${this.pos.x.toFixed(3)}`;
    const posY = document.getElementById("player-pos-y");
    if (posY) posY.innerHTML = `y: ${this.pos.y.toFixed(3)}`;
    const posZ = document.getElementById("player-pos-z");
    if (posZ) posZ.innerHTML = `z: ${this.pos.z.toFixed(3)}`;
  }

  /**
   * Sprint zoom eases at vanilla's half-per-tick rate; the view narrows
   * while the eyes are under water.
   */
  private updateCameraFOV(dt: number) {
    const target = this.isSprinting ? SPRINT_FOV_MULTIPLIER : 1;
    const t = 1 - Math.pow(0.5, dt * Physics.TICK_RATE);
    this.#fovMultiplier += (target - this.#fovMultiplier) * t;
    let fov = BASE_FOV * this.#fovMultiplier;
    if (this.eyeSubmerged) fov *= UNDERWATER_FOV_MULTIPLIER;
    if (Math.abs(fov - this.camera.fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  get activeBlockId() {
    return this.toolbar[this.activeToolbarIndex];
  }

  private releaseKeys() {
    this.#forward = false;
    this.#back = false;
    this.#left = false;
    this.#right = false;
    this.#jump = false;
    this.#sneak = false;
    this.#sprintKey = false;
  }

  onKeyDown(event: KeyboardEvent) {
    const validKeys = ["KeyW", "KeyA", "KeyS", "KeyD"];
    if (validKeys.includes(event.code) && !this.controls.isLocked) {
      this.controls.lock();
    }
    if (event.repeat) return;

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
      case "KeyW": {
        const now = performance.now();
        if (
          now - this.#lastForwardPress < SPRINT_DOUBLE_TAP_MS &&
          this.#forwardPressCount > 0 &&
          !this.#sneak
        ) {
          this.isSprinting = true;
        }
        this.#lastForwardPress = now;
        this.#forwardPressCount++;
        this.#forward = true;
        break;
      }
      case "KeyA":
        this.#left = true;
        break;
      case "KeyS":
        this.#back = true;
        break;
      case "KeyD":
        this.#right = true;
        break;
      case "Space":
        this.#jump = true;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.#sneak = true;
        break;
      case "ControlLeft":
      case "ControlRight":
        this.#sprintKey = true;
        break;
    }
  }

  onKeyUp(event: KeyboardEvent) {
    switch (event.code) {
      case "KeyW":
        this.#forward = false;
        break;
      case "KeyA":
        this.#left = false;
        break;
      case "KeyS":
        this.#back = false;
        break;
      case "KeyD":
        this.#right = false;
        break;
      case "Space":
        this.#jump = false;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.#sneak = false;
        break;
      case "ControlLeft":
      case "ControlRight":
        this.#sprintKey = false;
        break;
    }
  }
}
