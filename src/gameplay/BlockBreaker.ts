import { BlockID } from "../Block";
import { Physics } from "../Physics";
import { Player } from "../Player";
import { World } from "../World";

import { Particles } from "./Particles";

/** Ticks after breaking a block before the next one goes (`MultiPlayerGameMode.destroyDelay`) */
const BREAK_DELAY = 5;

/**
 * Creative block breaking like `MultiPlayerGameMode.startDestroyBlock`: the
 * targeted block is destroyed the instant the mouse goes down and, while it
 * stays held, every five ticks after that.
 */
export class BlockBreaker {
  private mining = false;
  private delay = 0;
  private accumulator = 0;

  constructor(private readonly particles: Particles) {}

  /** Mouse held: start (or keep) mining */
  start() {
    this.mining = true;
  }

  /** Mouse released, pointer unlocked, window blurred... */
  stop() {
    this.mining = false;
  }

  update(dt: number, player: Player, world: World) {
    this.accumulator += Math.min(dt, Physics.MAX_FRAME_TIME);
    while (this.accumulator >= Physics.TICK) {
      this.accumulator -= Physics.TICK;
      this.tick(player, world);
    }
  }

  private tick(player: Player, world: World) {
    if (this.delay > 0) this.delay--;
    if (!this.mining) return;

    const coords = player.selectedCoords;
    const id = coords
      ? world.getBlock(coords.x, coords.y, coords.z)
      : undefined;
    if (!coords || id === undefined || id === BlockID.Air) return;
    // Minecraft.continueAttack swings the arm every tick a block is being hit
    player.swing();
    if (this.delay > 0) return;

    this.delay = BREAK_DELAY;
    // `Level.destroyBlock` -> `levelEvent(2001)`: break sound + ParticleEngine.destroy
    if (!world.removeBlock(coords.x, coords.y, coords.z)) return;
    this.particles.burst(coords.x, coords.y, coords.z, id);
  }
}
