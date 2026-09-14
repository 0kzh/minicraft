import audioManager from "../audio/AudioManager";
import { Physics } from "../Physics";
import { Player } from "../Player";

export const MAX_HEALTH = 20;
export const MAX_FOOD = 20;
/** Vanilla `Player.TOTAL_AIR_SUPPLY` */
export const MAX_AIR = 300;
/** Vanilla `LivingEntity.hurt`: invulnerableTime is set to 20 and damage only lands while it is <= 10 */
const INVULNERABLE_TICKS = 20;
const INVULNERABLE_ACTIVE = 10;
/** Vanilla `hurtTime` / `maxHurtTime`: the camera-tilt duration */
const HURT_TICKS = 10;
/** Vanilla `Attributes.SAFE_FALL_DISTANCE` default */
const SAFE_FALL = 3;
/** Vanilla `FoodData`: exhaustion needed to spend a saturation/food point, and its cap */
const EXHAUSTION_PER_POINT = 4;
const MAX_EXHAUSTION = 40;
/** Vanilla starvation/regen timers (ticks) */
const REGEN_TICKS = 80;
const FAST_REGEN_TICKS = 10;
const STARVE_TICKS = 80;
/** Vanilla `Entity.checkBelowWorld`: 64 blocks under the bottom of the world */
const VOID_Y = -64;

/**
 * Survival health, hunger and air, ticked at 20 Hz alongside physics.
 * Mirrors vanilla `LivingEntity` / `Player` / `FoodData`: fall, lava,
 * drowning and void damage, exhaustion-driven hunger, natural regeneration
 * and starvation (normal difficulty).
 */
export class Vitals {
  health = MAX_HEALTH;
  food = MAX_FOOD;
  saturation = 5;
  air = MAX_AIR;
  /** Ticks left of the vanilla `invulnerableTime` counter */
  invulnerableTime = 0;
  /** Ticks left of the vanilla `hurtTime` counter (camera tilt) */
  hurtTime = 0;
  /** Whether the eyes are under water this tick (drives the air bar) */
  underwater = false;
  onDeath: () => void = () => {};
  onChange: () => void = () => {};

  private exhaustion = 0;
  private foodTimer = 0;
  private healthAccumulator = 0;
  private accumulator = 0;

  reset() {
    this.health = MAX_HEALTH;
    this.food = MAX_FOOD;
    this.saturation = 5;
    this.exhaustion = 0;
    this.foodTimer = 0;
    this.healthAccumulator = 0;
    this.air = MAX_AIR;
    this.invulnerableTime = 0;
    this.hurtTime = 0;
    this.onChange();
  }

  get dead() {
    return this.health <= 0;
  }

  /** Vanilla `LocalPlayer`: sprinting needs more than 6 food points */
  get canSprint() {
    return this.food > 6;
  }

  update(dt: number, player: Player) {
    this.accumulator += Math.min(dt, Physics.MAX_FRAME_TIME);
    while (this.accumulator >= Physics.TICK) {
      this.accumulator -= Physics.TICK;
      if (!this.dead) this.tick(player);
    }
  }

  /**
   * Vanilla `GameRenderer.bobHurt`: camera roll in radians for this frame,
   * `sin((hurtTime / maxHurtTime)^4 * PI) * 14` degrees
   */
  get hurtRoll() {
    if (this.hurtTime <= 0) return 0;
    const f = (this.hurtTime - this.accumulator / Physics.TICK) / HURT_TICKS;
    return Math.sin(f * f * f * f * Math.PI) * 14 * (Math.PI / 180);
  }

  /** Vanilla `Player.causeFoodExhaustion` */
  addExhaustion(amount: number) {
    this.exhaustion = Math.min(this.exhaustion + amount, MAX_EXHAUSTION);
  }

  private tick(player: Player) {
    if (this.invulnerableTime > 0) this.invulnerableTime--;
    if (this.hurtTime > 0) this.hurtTime--;

    // LivingEntity.calculateFallDamage: ceil(fallDistance - safeFallDistance)
    const fall = player.takeFallDistance();
    if (fall > SAFE_FALL && !player.inFluid) {
      // epsilon absorbs float drift in the per-tick fall accumulation
      const damage = Math.ceil(fall - SAFE_FALL - 1e-4);
      if (damage > 0 && this.damage(damage, null)) {
        audioManager.play(
          damage > 4
            ? "game.player.hurt.fall.big"
            : "game.player.hurt.fall.small"
        );
      }
    }

    // Entity.lavaHurt: 4 damage every tick, throttled by invulnerability
    if (player.inLava) this.damage(4, "game.player.hurt");

    // LivingEntity.baseTick: air drains 1/tick under water and refills 4/tick
    this.underwater = player.eyeSubmerged && !player.inLava;
    if (this.underwater) {
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

    this.tickFood();
  }

  /** Vanilla `FoodData.tick` at normal difficulty */
  private tickFood() {
    if (this.exhaustion > EXHAUSTION_PER_POINT) {
      this.exhaustion -= EXHAUSTION_PER_POINT;
      if (this.saturation > 0) {
        this.saturation = Math.max(this.saturation - 1, 0);
      } else {
        this.food = Math.max(this.food - 1, 0);
      }
      this.onChange();
    }

    const hurt = this.health < MAX_HEALTH;
    if (this.saturation > 0 && hurt && this.food >= MAX_FOOD) {
      if (++this.foodTimer >= FAST_REGEN_TICKS) {
        const f = Math.min(this.saturation, 6);
        this.heal(f / 6);
        this.addExhaustion(f);
        this.foodTimer = 0;
      }
    } else if (this.food >= 18 && hurt) {
      if (++this.foodTimer >= REGEN_TICKS) {
        this.heal(1);
        this.addExhaustion(6);
        this.foodTimer = 0;
      }
    } else if (this.food <= 0) {
      if (++this.foodTimer >= STARVE_TICKS) {
        if (this.health > 1) this.damage(1, "game.player.hurt", true, 0);
        this.foodTimer = 0;
      }
    } else {
      this.foodTimer = 0;
    }
  }

  /** Health is integer here; fractional heals accumulate like vanilla's float health rounds up */
  private heal(amount: number) {
    this.healthAccumulator += amount;
    const whole = Math.floor(this.healthAccumulator);
    if (whole <= 0) return;
    this.healthAccumulator -= whole;
    this.health = Math.min(MAX_HEALTH, this.health + whole);
    this.onChange();
  }

  /**
   * Vanilla `LivingEntity.hurt` / `Player.actuallyHurt`: rejected during the
   * active half of invulnerableTime unless the source bypasses it; damage
   * costs `exhaustion` food exhaustion (0.1 for most sources). Returns
   * whether it landed.
   */
  damage(
    amount: number,
    sound: string | null,
    bypassInvulnerability = false,
    exhaustion = 0.1
  ): boolean {
    if (this.dead || amount <= 0) return false;
    if (this.invulnerableTime > INVULNERABLE_ACTIVE && !bypassInvulnerability) {
      return false;
    }
    this.invulnerableTime = INVULNERABLE_TICKS;
    this.hurtTime = HURT_TICKS;
    this.addExhaustion(exhaustion);
    this.health = Math.max(0, this.health - amount);
    if (sound) audioManager.play(sound);
    this.onChange();
    if (this.dead) this.onDeath();
    return true;
  }
}
