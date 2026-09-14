import * as THREE from "three";

import { BlockID } from "./Block";
import { fluidHeight, getBlockDef } from "./Block/blocks";
import { Player } from "./Player";
import { World } from "./World";

type Candidate = {
  block: BlockID;
  x: number;
  y: number;
  z: number;
};

type Collision = {
  candidate: Candidate;
  contactPoint: THREE.Vector3;
  normal: THREE.Vector3;
  overlap: number;
};

const collisionMaterial = new THREE.MeshBasicMaterial({
  color: 0xff0000,
  transparent: true,
  opacity: 0.2,
});
const collisionGeometry = new THREE.BoxGeometry(1.001, 1.001, 1.001);

const contactMaterial = new THREE.MeshBasicMaterial({
  wireframe: true,
  color: 0x00ff00,
});
const contactGeometry = new THREE.SphereGeometry(0.05, 6, 6);

export class Physics {
  // Acceleration due to gravity
  static GRAVITY = -32;
  // Gravity while submerged, before drag
  static FLUID_GRAVITY = -6;
  // Velocity damping per second in fluids
  static FLUID_DRAG = 3.5;
  static FLUID_SINK_SPEED = -2.5;
  // Upward kick when swimming against a block whose top is within reach,
  // letting the player climb out of water (Minecraft's 0.3 blocks/tick)
  static FLUID_CLIMB_SPEED = 7;

  // Physics simulation rate
  simulationRate = 250;
  stepSize = 1 / this.simulationRate;
  // Accumulator to keep track of leftover dt
  accumulator = 0;

  helpers: THREE.Group;

  constructor(scene: THREE.Scene) {
    this.helpers = new THREE.Group();
    this.helpers.visible = false;
    scene.add(this.helpers);
  }

  update(dt: number, player: Player, world: World) {
    this.accumulator += dt;
    const blockUnderneath =
      this.getBlockUnderneath(player, world) ?? BlockID.Air;

    player.inFluid = this.isInFluid(player, world);

    while (this.accumulator >= this.stepSize) {
      if (player.inFluid) {
        player.velocity.y += Physics.FLUID_GRAVITY * this.stepSize;
        player.velocity.y -=
          player.velocity.y * Physics.FLUID_DRAG * this.stepSize;
        if (player.velocity.y < Physics.FLUID_SINK_SPEED)
          player.velocity.y = Physics.FLUID_SINK_SPEED;
      } else {
        player.velocity.y += Physics.GRAVITY * this.stepSize;
      }
      player.applyInputs(this.stepSize, blockUnderneath);
      this.detectCollisions(player, world);
      if (player.inFluid && player.horizontalCollision) {
        this.climbOutOfFluid(player, world);
      }
      this.accumulator -= this.stepSize;
    }

    player.update(world);
  }

  /**
   * True when the player's feet or torso are inside water or lava, taking
   * the liquid's surface height into account so shallow puddles don't swim.
   */
  isInFluid(player: Player, world: World) {
    const x = Math.floor(player.position.x);
    const z = Math.floor(player.position.z);
    const feet = player.position.y - player.height + 0.1;
    const torso = player.position.y - player.height * 0.5;
    return this.fluidAt(world, x, feet, z) || this.fluidAt(world, x, torso, z);
  }

  private fluidAt(world: World, x: number, y: number, z: number) {
    const by = Math.floor(y);
    const id = world.getBlock(x, by, z);
    if (id === undefined) return false;
    const def = getBlockDef(id);
    if (!def.fluid) return false;
    const above = world.getBlock(x, by + 1, z);
    if (
      above !== undefined &&
      getBlockDef(above).fluidSource === def.fluidSource
    )
      return true;
    return y - by < fluidHeight(def);
  }

  /**
   * Swimming into a block whose top is just above the water: hop up if the
   * space one block higher is free, like Minecraft's liquid edge climb.
   */
  private climbOutOfFluid(player: Player, world: World) {
    if (player.input.lengthSq() === 0) return;
    const feet = player.position.y - player.height;
    const x = Math.floor(player.position.x);
    const z = Math.floor(player.position.z);
    const top = Math.floor(feet) + 1;
    for (let y = top; y < top + Math.ceil(player.height); y++) {
      if (world.isSolid(x, y, z)) return;
    }
    player.velocity.y = Math.max(player.velocity.y, Physics.FLUID_CLIMB_SPEED);
  }

  getBlockUnderneath(player: Player, world: World) {
    return world.getBlock(
      Math.floor(player.position.x),
      Math.floor(player.position.y - player.height / 2 - 1),
      Math.floor(player.position.z)
    );
  }

  detectCollisions(player: Player, world: World) {
    player.onGround = false;
    player.horizontalCollision = false;
    this.helpers.clear();

    const candidates = this.broadPhase(player, world);
    const collisions = this.narrowPhase(candidates, player);

    if (collisions.length > 0) {
      this.resolveCollisions(collisions, player);
    }
  }

  broadPhase(player: Player, world: World): Candidate[] {
    const candidates: Candidate[] = [];

    // Get the block extents of the player
    const minX = Math.floor(player.position.x - player.radius);
    const maxX = Math.ceil(player.position.x + player.radius);
    const minY = Math.floor(player.position.y - player.height);
    const maxY = Math.ceil(player.position.y);
    const minZ = Math.floor(player.position.z - player.radius);
    const maxZ = Math.ceil(player.position.z + player.radius);

    // Iterate over the player's AABB
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          // If the block is solid, add it to the list of candidates
          if (world.isSolid(x, y, z)) {
            const candidate: Candidate = {
              block: world.getBlock(x, y, z) as BlockID,
              x: x + 0.5,
              y: y + 0.5,
              z: z + 0.5,
            };
            candidates.push(candidate);
            if (this.helpers.visible) this.addCollisionHelper(candidate);
          }
        }
      }
    }

    return candidates;
  }

  narrowPhase(candidates: Candidate[], player: Player): Collision[] {
    const collisions: Collision[] = [];

    for (const candidate of candidates) {
      // Get the point of the block closest to the center of the player's bounding cylinder
      const closestPoint = new THREE.Vector3(
        Math.max(
          candidate.x - 0.5,
          Math.min(player.position.x, candidate.x + 0.5)
        ),
        Math.max(
          candidate.y - 0.5,
          Math.min(player.position.y - player.height / 2, candidate.y + 0.5)
        ),
        Math.max(
          candidate.z - 0.5,
          Math.min(player.position.z, candidate.z + 0.5)
        )
      );

      // Get distance along each exist between closest point and center
      const dx = closestPoint.x - player.position.x;
      const dy = closestPoint.y - (player.position.y - player.height / 2);
      const dz = closestPoint.z - player.position.z;

      if (this.pointInPlayerBoundingCylinder(closestPoint, player)) {
        const overlapY = player.height / 2 - Math.abs(dy);
        const overlapXZ = player.radius - Math.sqrt(dx * dx + dz * dz);

        // Compute the normal of the collision (pointing away from content point)
        // As well as overlap between the point and the player's bounding cylinder
        let normal: THREE.Vector3;
        let overlap: number;
        if (overlapY < overlapXZ) {
          normal = new THREE.Vector3(0, -Math.sign(dy), 0);
          overlap = overlapY;
          player.onGround = true;
        } else {
          normal = new THREE.Vector3(-dx, 0, -dz).normalize();
          overlap = overlapXZ;
        }

        collisions.push({
          candidate,
          contactPoint: closestPoint,
          normal,
          overlap,
        });

        if (this.helpers.visible) this.addContactPointerHelper(closestPoint);
      }
    }

    return collisions;
  }

  pointInPlayerBoundingCylinder(p: THREE.Vector3, player: Player) {
    const dx = p.x - player.position.x;
    const dy = p.y - (player.position.y - player.height / 2);
    const dz = p.z - player.position.z;
    const r_sq = dx * dx + dz * dz;

    // Check if contact point is inside the player's bounding cylinder
    return (
      Math.abs(dy) < player.height / 2 && r_sq < player.radius * player.radius
    );
  }

  resolveCollisions(collisions: Collision[], player: Player) {
    // Resolve collisions in order of smallest overlap to largest
    collisions.sort((a, b) => a.overlap - b.overlap);

    for (const collision of collisions) {
      // re-check if contact player is inside the player's bounding cylinder
      // since the player position is updated after each collision is resolved
      if (!this.pointInPlayerBoundingCylinder(collision.contactPoint, player)) {
        continue;
      }

      // Adjust position of player so that block and player are no longer overlapping
      const deltaPosition = collision.normal.clone();
      deltaPosition.multiplyScalar(collision.overlap);

      // Don't apply vertical change if player is not on ground
      if (!player.onGround && deltaPosition.y !== 0) {
        deltaPosition.y = 0;
      }
      player.position.add(deltaPosition);

      // If player is stuck underneath a block, boost him up
      if (collision.normal.y < 0) {
        player.velocity.y += 10;
      }
      if (collision.normal.y === 0) {
        player.horizontalCollision = true;
      }

      // Get the magnitude of player's velocity along collision normal
      const magnitude = player.worldVelocity.dot(collision.normal);
      // remove that part of velocity from the player's velocity
      const velocityAdj = collision.normal.clone().multiplyScalar(magnitude);
      player.applyWorldDeltaVelocity(velocityAdj.negate());
    }
  }

  // visualizes the block the player is colliding with
  addCollisionHelper(candidate: Candidate) {
    const blockMesh = new THREE.Mesh(collisionGeometry, collisionMaterial);
    blockMesh.position.copy(
      new THREE.Vector3(candidate.x, candidate.y, candidate.z)
    );
    this.helpers.add(blockMesh);
  }

  /**
   * Visualizes the contact at the point 'p'
   */
  addContactPointerHelper(p: THREE.Vector3) {
    const contactMesh = new THREE.Mesh(contactGeometry, contactMaterial);
    contactMesh.position.copy(new THREE.Vector3(p.x, p.y, p.z));
    this.helpers.add(contactMesh);
  }
}
