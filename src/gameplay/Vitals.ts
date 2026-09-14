import audioManager from "../audio/AudioManager";
import { Physics } from "../Physics";
import { Player } from "../Player";

export const MAX_HEALTH = 20;
export const MAX_AIR = 300;
/** Vanilla: blocks of falling before damage starts */
const SAFE_FALL = 3;
/** Ticks of immunity after a hit */
const HURT_COOLDOWN = 10;
/** Ticks without damage before natural regeneration starts */
const REGEN_DELAY = 60;
/** Ticks between regenerated half-hearts */
const REGEN_INTERVAL = 80;
const VOID_Y = -8;

/**
 * Survival health and air, ticked at 20 Hz alongside physics: fall damage,
 * lava, drowning, the void, and slow natural regeneration.
 */
export class Vitals {
  health = MAX_HEALTH;
  air = MAX_AIR;
  /** Seconds left on the red damage flash */
  hurtFlash = 0;
  onDeath: () => void = () => {};
  onChange: () => void = () => {};

  private cooldown = 0;
  private sinceHurt = 0;
  private lavaTimer = 0;
  private accumulator = 0;

  reset() {
    this.health = MAX_HEALTH;
    this.air = MAX_AIR;
    this.cooldown = 0;
    this.sinceHurt = 0;
    this.lavaTimer = 0;
    this.hurtFlash = 0;
    this.onChange();
  }

  get dead() {
    return this.health <= 0;
  }

  update(dt: number, player: Player) {
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.accumulator += Math.min(dt, Physics.MAX_FRAME_TIME);
    while (this.accumulator >= Physics.TICK) {
      this.accumulator -= Physics.TICK;
      if (!this.dead) this.tick(player);
    }
  }

  private tick(player: Player) {
    if (this.cooldown > 0) this.cooldown--;
    this.sinceHurt++;

    const fall = player.takeFallDistance();
    if (fall > SAFE_FALL && !player.inFluid) {
      const damage = Math.ceil(fall - SAFE_FALL);
      if (this.damage(damage, null)) {
        audioManager.play(
          damage > 4
            ? "game.player.hurt.fall.big"
            : "game.player.hurt.fall.small"
        );
      }
    }

    if (player.inLava) {
      if (this.lavaTimer-- <= 0) {
        this.lavaTimer = 9;
        this.damage(4, "game.player.hurt");
      }
    } else {
      this.lavaTimer = 0;
    }

    if (player.eyeSubmerged && !player.inLava) {
      this.air--;
      if (this.air <= -20) {
        this.air = 0;
        this.damage(2, "game.player.hurt");
      }
      this.onChange();
    } else if (this.air < MAX_AIR) {
      this.air = Math.min(MAX_AIR, this.air + 4);
      this.onChange();
    }

    if (player.pos.y < VOID_Y) this.damage(4, "game.player.hurt", true);

    if (
      this.health < MAX_HEALTH &&
      this.sinceHurt > REGEN_DELAY &&
      this.sinceHurt % REGEN_INTERVAL === 0
    ) {
      this.health++;
      this.onChange();
    }
  }

  /** Applies damage unless within the hurt cooldown; returns whether it landed */
  damage(amount: number, sound: string | null, force = false): boolean {
    if (this.dead || amount <= 0) return false;
    if (this.cooldown > 0 && !force) return false;
    this.cooldown = HURT_COOLDOWN;
    this.sinceHurt = 0;
    this.hurtFlash = 0.5;
    this.health = Math.max(0, this.health - amount);
    if (sound) audioManager.play(sound);
    this.onChange();
    if (this.dead) this.onDeath();
    return true;
  }
}
