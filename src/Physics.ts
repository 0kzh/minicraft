import * as THREE from "three";

import { BlockID } from "./Block";
import { fluidHeight, getBlockDef } from "./Block/blocks";
import { Player } from "./Player";
import { World } from "./World";

/** Axis-aligned bounding box in world space */
export type AABB = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

const EPSILON = 1e-7;

const collisionMaterial = new THREE.MeshBasicMaterial({
  color: 0xff0000,
  transparent: true,
  opacity: 0.2,
});

/**
 * Minecraft-style player movement, integrated at a fixed 20 ticks per second
 * with the vanilla per-tick constants (Java Edition `LivingEntity.travel`):
 *
 *   ground:  v += input * 0.1 (x1.3 sprint, x0.3 sneak); v *= 0.6 * 0.91
 *   air:     v += input * 0.02;                          v *= 0.91
 *   gravity: vy = (vy - 0.08) * 0.98;  jump vy = 0.42 (+0.2 forward when sprinting)
 *   water:   v += input * 0.02; v *= 0.8; vy = vy * 0.8 - 0.005; swim up +0.04
 *
 * Movement is resolved per axis against block collision boxes with a 0.6
 * block step-up, so the 0.6 x 1.8 player fits 1-wide gaps and walks over
 * snow layers. The camera is interpolated between ticks for smooth rendering.
 */
export class Physics {
  static TICK_RATE = 20;
  static TICK = 1 / Physics.TICK_RATE;
  /** Frame time cap so a stalled tab cannot fast-forward hundreds of ticks */
  static MAX_FRAME_TIME = 0.25;

  static GRAVITY = 0.08;
  static VERTICAL_DRAG = 0.98;
  static AIR_FRICTION = 0.91;
  static GROUND_SLIPPERINESS = 0.6;
  static BASE_SPEED = 0.1;
  static SPRINT_MULTIPLIER = 1.3;
  static SNEAK_MULTIPLIER = 0.3;
  static AIR_ACCELERATION = 0.02;
  static SPRINT_AIR_ACCELERATION = 0.026;
  static JUMP_VELOCITY = 0.42;
  static SPRINT_JUMP_BOOST = 0.2;
  /** Ticks between automatic jumps while holding space */
  static JUMP_COOLDOWN = 10;
  static STEP_HEIGHT = 0.6;

  static FLUID_ACCELERATION = 0.02;
  static WATER_FRICTION = 0.8;
  static LAVA_FRICTION = 0.5;
  static FLUID_GRAVITY = 0.005;
  static SWIM_UP_ACCELERATION = 0.04;
  /** Fluid depth above the feet needed to swim rather than jump */
  static SWIM_DEPTH = 0.4;
  /** Vertical kick when swimming into a ledge the player can climb */
  static FLUID_CLIMB_VELOCITY = 0.3;

  /** Creative flight: vanilla `Abilities.flyingSpeed` (x2 when sprinting in `Player.getFlyingSpeed`) */
  static FLY_SPEED = 0.05;
  /** `LocalPlayer.aiStep`: jump/sneak add `flyingSpeed * 3` to the vertical motion each tick */
  static FLY_VERTICAL_ACCELERATION = Physics.FLY_SPEED * 3;
  /** `Player.travel`: the vertical motion is multiplied by 0.6 every tick while flying */
  static FLY_VERTICAL_FRICTION = 0.6;

  accumulator = 0;
  helpers: THREE.Group;

  constructor(scene: THREE.Scene) {
    this.helpers = new THREE.Group();
    this.helpers.visible = false;
    scene.add(this.helpers);
  }

  /** Advances the simulation by `dt` seconds in fixed ticks */
  update(dt: number, player: Player, world: World) {
    this.accumulator += Math.min(dt, Physics.MAX_FRAME_TIME);
    while (this.accumulator >= Physics.TICK) {
      this.tick(player, world);
      this.accumulator -= Physics.TICK;
    }
    player.interpolate(this.accumulator / Physics.TICK);
    player.update(dt, world);
    if (this.helpers.visible) this.updateHelpers(player, world);
  }

  private tick(player: Player, world: World) {
    player.beginTick();
    player.tickSwing();
    this.sampleFluid(player, world, player.getBox());
    player.tickInput();

    if (player.flying) {
      this.travelFlying(player, world, player.moveInput());
      player.tickSprint();
      return;
    }

    if (player.jumping) {
      if (player.inFluid && player.fluidDepth > Physics.SWIM_DEPTH) {
        player.velocity.y += Physics.SWIM_UP_ACCELERATION;
      } else if (player.onGround && player.jumpCooldown === 0) {
        this.jump(player);
      }
    }
    if (player.jumpCooldown > 0) player.jumpCooldown--;

    const move = player.moveInput();
    if (player.inFluid) {
      this.travelInFluid(player, world, move);
    } else {
      this.travelOnLand(player, world, move);
    }

    player.tickSprint();
    player.tickStepSounds(this.blockUnderneath(player, world));
  }

  /** Vanilla `LivingEntity.jumpFromGround` */
  private jump(player: Player) {
    player.velocity.y = Physics.JUMP_VELOCITY;
    if (player.isSprinting) {
      const yaw = player.yaw;
      player.velocity.x -= Math.sin(yaw) * Physics.SPRINT_JUMP_BOOST;
      player.velocity.z -= Math.cos(yaw) * Physics.SPRINT_JUMP_BOOST;
    }
    player.jumpCooldown = Physics.JUMP_COOLDOWN;
  }

  /**
   * Creative flight, per tick like vanilla:
   *   aiStep:  vy += (jump - sneak) * flyingSpeed * 3
   *   travel:  v += input * flyingSpeed (x2 sprinting); move; vx,vz *= 0.91; vy *= 0.6
   * No gravity applies, and vy's 0.6 drag is what makes climbing snappy:
   * it reaches its 0.375 blocks/tick (7.5 m/s) top speed within a few ticks.
   */
  private travelFlying(player: Player, world: World, move: THREE.Vector2) {
    const v = player.velocity;
    const lift = (player.ascending ? 1 : 0) - (player.descending ? 1 : 0);
    if (lift !== 0) v.y += lift * Physics.FLY_VERTICAL_ACCELERATION;

    const speed = Physics.FLY_SPEED * (player.isSprinting ? 2 : 1);
    this.accelerate(player, move, speed);

    this.move(player, world);
    // Touching down ends flight like vanilla
    if (player.onGround && player.descending) player.flying = false;

    v.x *= Physics.AIR_FRICTION;
    v.z *= Physics.AIR_FRICTION;
    v.y *= Physics.FLY_VERTICAL_FRICTION;
  }

  private travelOnLand(player: Player, world: World, move: THREE.Vector2) {
    const onGround = player.onGround;
    let speed: number;
    if (onGround) {
      const slip = Physics.GROUND_SLIPPERINESS;
      speed =
        Physics.BASE_SPEED *
        player.speedMultiplier() *
        (0.21600002 / (slip * slip * slip));
    } else {
      speed = player.isSprinting
        ? Physics.SPRINT_AIR_ACCELERATION
        : Physics.AIR_ACCELERATION;
    }
    this.accelerate(player, move, speed);

    this.move(player, world);

    const v = player.velocity;
    v.y = (v.y - Physics.GRAVITY) * Physics.VERTICAL_DRAG;
    const friction = onGround
      ? Physics.GROUND_SLIPPERINESS * Physics.AIR_FRICTION
      : Physics.AIR_FRICTION;
    v.x *= friction;
    v.z *= friction;
  }

  private travelInFluid(player: Player, world: World, move: THREE.Vector2) {
    const friction = player.inLava
      ? Physics.LAVA_FRICTION
      : Physics.WATER_FRICTION;
    this.accelerate(player, move, Physics.FLUID_ACCELERATION);

    const startY = player.pos.y;
    this.move(player, world);

    const v = player.velocity;
    v.x *= friction;
    v.z *= friction;
    v.y = v.y * friction - Physics.FLUID_GRAVITY;

    // Swimming into a ledge: hop up if the space a step above is clear
    if (player.horizontalCollision) {
      const box = player.getBox();
      const rise = v.y - (player.pos.y - startY);
      if (
        this.isFree(world, offsetBox(box, v.x, rise + Physics.STEP_HEIGHT, v.z))
      ) {
        // At the surface, a full jump clears shores a block above the water
        const nearSurface = player.fluidDepth < Physics.SWIM_DEPTH + 0.2;
        const jumpClear =
          nearSurface && this.isFree(world, offsetBox(box, v.x, rise + 1, v.z));
        v.y = jumpClear
          ? Math.max(v.y, Physics.JUMP_VELOCITY)
          : Physics.FLUID_CLIMB_VELOCITY;
      }
    }
  }

  /** Adds camera-relative input scaled by `speed` to the velocity */
  private accelerate(player: Player, move: THREE.Vector2, speed: number) {
    let lenSq = move.lengthSq();
    if (lenSq < 1e-7) return;
    if (lenSq > 1) {
      move.normalize();
      lenSq = 1;
    }
    const yaw = player.yaw;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    // Forward is -Z at yaw 0, strafe right is +X
    player.velocity.x += (move.x * cos - move.y * sin) * speed;
    player.velocity.z += (-move.x * sin - move.y * cos) * speed;
  }

  /**
   * Moves the player by its velocity, resolving collisions per axis with
   * step-up and sneak edge protection, and updates the contact flags.
   */
  private move(player: Player, world: World) {
    const v = player.velocity;
    let dx = v.x;
    const dy = v.y;
    let dz = v.z;
    const box = player.getBox();

    if (player.isSneaking && player.onGround && dy <= 0) {
      const backed = this.backOffFromEdge(world, box, dx, dz);
      dx = backed.x;
      dz = backed.y;
    }

    let result = this.collide(world, box, dx, dy, dz);
    const wasOnGround = player.onGround || (dy !== result.dy && dy < 0);
    const blockedHorizontally =
      (dx !== 0 && dx !== result.dx) || (dz !== 0 && dz !== result.dz);

    if (blockedHorizontally && wasOnGround) {
      // Try the move again from up to STEP_HEIGHT higher, then settle back down
      const step = Physics.STEP_HEIGHT;
      let stepped = this.collide(world, box, dx, step, dz);
      const up = this.collide(world, box, 0, step, 0);
      if (up.dy < step) {
        const across = this.collide(
          world,
          offsetBox(box, 0, up.dy, 0),
          dx,
          0,
          dz
        );
        const candidate = { dx: across.dx, dy: up.dy, dz: across.dz };
        if (horizontalDistSq(candidate) > horizontalDistSq(stepped)) {
          stepped = candidate;
        }
      }
      if (horizontalDistSq(stepped) > horizontalDistSq(result)) {
        const settle = this.collide(
          world,
          offsetBox(box, stepped.dx, stepped.dy, stepped.dz),
          0,
          dy - stepped.dy,
          0
        );
        result = {
          dx: stepped.dx,
          dy: stepped.dy + settle.dy,
          dz: stepped.dz,
        };
      }
    }

    player.pos.x += result.dx;
    player.pos.y += result.dy;
    player.pos.z += result.dz;

    player.horizontalCollision =
      (dx !== 0 && Math.abs(dx - result.dx) > EPSILON) ||
      (dz !== 0 && Math.abs(dz - result.dz) > EPSILON);
    const verticalCollision = dy !== result.dy;
    player.onGround = verticalCollision && dy < 0;

    if (player.horizontalCollision) {
      if (dx !== result.dx) v.x = 0;
      if (dz !== result.dz) v.z = 0;
    }
    if (verticalCollision) v.y = 0;
  }

  /** Shrinks horizontal motion while sneaking so the player stays on the ledge */
  private backOffFromEdge(
    world: World,
    box: AABB,
    dx: number,
    dz: number
  ): THREE.Vector2 {
    const step = 0.05;
    const supported = (x: number, z: number) =>
      !this.isFree(world, offsetBox(box, x, -Physics.STEP_HEIGHT, z));
    const shrink = (d: number) =>
      Math.abs(d) < step ? 0 : d - Math.sign(d) * step;

    while (dx !== 0 && !supported(dx, 0)) dx = shrink(dx);
    while (dz !== 0 && !supported(0, dz)) dz = shrink(dz);
    while (dx !== 0 && dz !== 0 && !supported(dx, dz)) {
      dx = shrink(dx);
      dz = shrink(dz);
    }
    return new THREE.Vector2(dx, dz);
  }

  /**
   * Sweeps `box` by (dx, dy, dz) against block collision boxes, Y first then
   * the dominant horizontal axis, returning the allowed displacement.
   */
  private collide(
    world: World,
    box: AABB,
    dx: number,
    dy: number,
    dz: number
  ): { dx: number; dy: number; dz: number } {
    const boxes = this.collisionBoxes(world, sweptBounds(box, dx, dy, dz));
    let b = box;
    if (dy !== 0) {
      dy = clipAxis(boxes, b, dy, 1);
      b = offsetBox(b, 0, dy, 0);
    }
    const zFirst = Math.abs(dz) > Math.abs(dx);
    if (zFirst && dz !== 0) {
      dz = clipAxis(boxes, b, dz, 2);
      b = offsetBox(b, 0, 0, dz);
    }
    if (dx !== 0) {
      dx = clipAxis(boxes, b, dx, 0);
      b = offsetBox(b, dx, 0, 0);
    }
    if (!zFirst && dz !== 0) {
      dz = clipAxis(boxes, b, dz, 2);
    }
    return { dx, dy, dz };
  }

  /** Collision boxes of every solid block overlapping `bounds` */
  private collisionBoxes(world: World, bounds: AABB): AABB[] {
    const out: AABB[] = [];
    const x0 = Math.floor(bounds.minX);
    const x1 = Math.floor(bounds.maxX);
    const y0 = Math.floor(bounds.minY);
    const y1 = Math.floor(bounds.maxY);
    const z0 = Math.floor(bounds.minZ);
    const z1 = Math.floor(bounds.maxZ);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const id = world.getBlock(x, y, z);
          if (id === undefined) {
            // Unloaded chunks are solid so the player never falls through
            if (y >= 0 && y < world.chunkSize.height) {
              out.push(unitBox(x, y, z));
            }
            continue;
          }
          const def = getBlockDef(id);
          if (def.passable) continue;
          const [bx0, by0, bz0, bx1, by1, bz1] = def.box;
          out.push({
            minX: x + bx0,
            minY: y + by0,
            minZ: z + bz0,
            maxX: x + bx1,
            maxY: y + by1,
            maxZ: z + bz1,
          });
        }
      }
    }
    return out;
  }

  private isFree(world: World, box: AABB): boolean {
    const boxes = this.collisionBoxes(world, box);
    for (const b of boxes) if (intersects(b, box)) return false;
    return true;
  }

  /**
   * Whether the player's box overlaps liquid and how deep the liquid surface
   * sits above the feet (Minecraft's fluid height).
   */
  private sampleFluid(player: Player, world: World, box: AABB) {
    const shrunk = offsetBox(box, 0, 0, 0);
    shrunk.minX += 0.001;
    shrunk.minY += 0.001;
    shrunk.minZ += 0.001;
    shrunk.maxX -= 0.001;
    shrunk.maxY -= 0.001;
    shrunk.maxZ -= 0.001;

    let depth = 0;
    let lava = false;
    let water = false;
    for (let y = Math.floor(shrunk.minY); y <= Math.floor(shrunk.maxY); y++) {
      for (let z = Math.floor(shrunk.minZ); z <= Math.floor(shrunk.maxZ); z++) {
        for (
          let x = Math.floor(shrunk.minX);
          x <= Math.floor(shrunk.maxX);
          x++
        ) {
          const id = world.getBlock(x, y, z);
          if (id === undefined) continue;
          const def = getBlockDef(id);
          if (!def.fluid) continue;
          const above = world.getBlock(x, y + 1, z);
          const filled =
            above !== undefined &&
            getBlockDef(above).fluid &&
            getBlockDef(above).fluidSource === def.fluidSource;
          const surface = y + (filled ? 1 : fluidHeight(def));
          if (surface < shrunk.minY) continue;
          depth = Math.max(depth, surface - shrunk.minY);
          if (def.fluidSource === BlockID.Lava) lava = true;
          else water = true;
        }
      }
    }
    player.inFluid = water || lava;
    player.inLava = lava;
    player.fluidDepth = depth;

    const eye = player.pos.y + player.eyeHeight;
    const eyeBlock = world.getBlock(
      Math.floor(player.pos.x),
      Math.floor(eye),
      Math.floor(player.pos.z)
    );
    if (eyeBlock !== undefined && getBlockDef(eyeBlock).fluid) {
      const def = getBlockDef(eyeBlock);
      const above = world.getBlock(
        Math.floor(player.pos.x),
        Math.floor(eye) + 1,
        Math.floor(player.pos.z)
      );
      const filled = above !== undefined && getBlockDef(above).fluid;
      const surface = Math.floor(eye) + (filled ? 1 : fluidHeight(def));
      player.eyeSubmerged = eye < surface;
    } else {
      player.eyeSubmerged = false;
    }
  }

  /** The block the player stands on (for step sounds) */
  private blockUnderneath(player: Player, world: World): BlockID {
    const id = world.getBlock(
      Math.floor(player.pos.x),
      Math.floor(player.pos.y - 0.01),
      Math.floor(player.pos.z)
    );
    return id ?? BlockID.Air;
  }

  /** Debug: highlights the blocks the player currently touches */
  private updateHelpers(player: Player, world: World) {
    this.helpers.clear();
    const box = player.getBox();
    const probe = offsetBox(box, 0, -0.05, 0);
    probe.minX -= 0.05;
    probe.minZ -= 0.05;
    probe.maxX += 0.05;
    probe.maxZ += 0.05;
    for (const b of this.collisionBoxes(world, probe)) {
      if (!intersects(b, probe)) continue;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(
          b.maxX - b.minX + 0.002,
          b.maxY - b.minY + 0.002,
          b.maxZ - b.minZ + 0.002
        ),
        collisionMaterial
      );
      mesh.position.set(
        (b.minX + b.maxX) / 2,
        (b.minY + b.maxY) / 2,
        (b.minZ + b.maxZ) / 2
      );
      this.helpers.add(mesh);
    }
  }
}

const horizontalDistSq = (d: { dx: number; dz: number }) =>
  d.dx * d.dx + d.dz * d.dz;

/** Largest |d| <= |delta| that moves `box` along `axis` without entering any of `boxes` */
function clipAxis(boxes: AABB[], box: AABB, delta: number, axis: number) {
  for (const b of boxes) {
    if (
      axis !== 0 &&
      !(b.maxX > box.minX + EPSILON && b.minX < box.maxX - EPSILON)
    )
      continue;
    if (
      axis !== 1 &&
      !(b.maxY > box.minY + EPSILON && b.minY < box.maxY - EPSILON)
    )
      continue;
    if (
      axis !== 2 &&
      !(b.maxZ > box.minZ + EPSILON && b.minZ < box.maxZ - EPSILON)
    )
      continue;
    const [bMin, bMax, min, max] =
      axis === 0
        ? [b.minX, b.maxX, box.minX, box.maxX]
        : axis === 1
        ? [b.minY, b.maxY, box.minY, box.maxY]
        : [b.minZ, b.maxZ, box.minZ, box.maxZ];
    if (delta > 0 && bMin >= max - EPSILON) {
      delta = Math.min(delta, bMin - max);
    } else if (delta < 0 && bMax <= min + EPSILON) {
      delta = Math.max(delta, bMax - min);
    }
    if (Math.abs(delta) < EPSILON) return 0;
  }
  return delta;
}

export function offsetBox(b: AABB, dx: number, dy: number, dz: number): AABB {
  return {
    minX: b.minX + dx,
    minY: b.minY + dy,
    minZ: b.minZ + dz,
    maxX: b.maxX + dx,
    maxY: b.maxY + dy,
    maxZ: b.maxZ + dz,
  };
}

function sweptBounds(b: AABB, dx: number, dy: number, dz: number): AABB {
  return {
    minX: Math.min(b.minX, b.minX + dx),
    minY: Math.min(b.minY, b.minY + dy),
    minZ: Math.min(b.minZ, b.minZ + dz),
    maxX: Math.max(b.maxX, b.maxX + dx),
    maxY: Math.max(b.maxY, b.maxY + dy),
    maxZ: Math.max(b.maxZ, b.maxZ + dz),
  };
}

function unitBox(x: number, y: number, z: number): AABB {
  return { minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 };
}

export function intersects(a: AABB, b: AABB): boolean {
  return (
    a.minX < b.maxX - EPSILON &&
    a.maxX > b.minX + EPSILON &&
    a.minY < b.maxY - EPSILON &&
    a.maxY > b.minY + EPSILON &&
    a.minZ < b.maxZ - EPSILON &&
    a.maxZ > b.minZ + EPSILON
  );
}
