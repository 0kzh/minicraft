import * as THREE from "three";

import audioManager from "../audio/AudioManager";
import { BlockID } from "../Block";
import { getBlockDef } from "../Block/blocks";
import { Physics } from "../Physics";
import { Player } from "../Player";
import { World } from "../World";

import { blockStats } from "./blockStats";
import { Particles } from "./Particles";

const STAGES = 10;
/** Ticks between hit sounds / chips while mining (vanilla: every 4 ticks) */
const HIT_INTERVAL = 4;
/** Ticks after breaking a block before the next one starts (vanilla: 5) */
const BREAK_DELAY = 5;

type Target = { x: number; y: number; z: number; id: BlockID };

/**
 * Survival block breaking: holding the mouse builds up progress on the
 * targeted block, drawing vanilla's ten crack stages over it, until it
 * breaks. Releasing or looking at another block resets progress. In creative
 * mode blocks break instantly.
 */
export class BlockBreaker {
  readonly crack: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private readonly stages: THREE.MeshBasicMaterial[] = [];
  private mining = false;
  private target: Target | null = null;
  private progress = 0;
  private delay = 0;
  private hitTimer = 0;
  private accumulator = 0;

  /** Called once a block has been broken (survival drops go through here) */
  onBreak: (x: number, y: number, z: number, id: BlockID) => void = () => {};

  constructor(private readonly particles: Particles) {
    const loader = new THREE.TextureLoader();
    for (let i = 0; i < STAGES; i++) {
      const map = loader.load(`textures/destroy_stage_${i}.png`);
      map.magFilter = THREE.NearestFilter;
      map.minFilter = THREE.NearestFilter;
      map.colorSpace = THREE.SRGBColorSpace;
      // Vanilla multiplies the cracks over the block (DST_COLOR, SRC_COLOR)
      this.stages.push(
        new THREE.MeshBasicMaterial({
          map,
          transparent: true,
          alphaTest: 0.1,
          depthWrite: false,
          blending: THREE.CustomBlending,
          blendSrc: THREE.DstColorFactor,
          blendDst: THREE.SrcColorFactor,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        })
      );
    }
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.stages[0]);
    this.crack.visible = false;
  }

  get isMining() {
    return this.mining;
  }

  /** Mouse held: start (or keep) mining */
  start() {
    this.mining = true;
  }

  /** Mouse released, pointer unlocked, window blurred... */
  stop() {
    this.mining = false;
    this.reset();
  }

  private reset() {
    this.target = null;
    this.progress = 0;
    this.hitTimer = 0;
    this.crack.visible = false;
  }

  update(dt: number, player: Player, world: World, instant: boolean) {
    this.accumulator += Math.min(dt, Physics.MAX_FRAME_TIME);
    while (this.accumulator >= Physics.TICK) {
      this.accumulator -= Physics.TICK;
      this.tick(player, world, instant);
    }
  }

  private tick(player: Player, world: World, instant: boolean) {
    if (this.delay > 0) this.delay--;
    if (!this.mining) return;

    const coords = player.selectedCoords;
    const id = coords
      ? world.getBlock(coords.x, coords.y, coords.z)
      : undefined;
    if (!coords || id === undefined || id === BlockID.Air) {
      this.reset();
      return;
    }

    const t = this.target;
    if (!t || t.x !== coords.x || t.y !== coords.y || t.z !== coords.z) {
      this.reset();
      this.target = { x: coords.x, y: coords.y, z: coords.z, id };
    } else if (t.id !== id) {
      t.id = id;
      this.progress = 0;
    }
    if (this.delay > 0) return;

    const stats = blockStats(id);
    if (instant || stats.breakTime === 0) {
      this.finish(world);
      return;
    }
    if (!Number.isFinite(stats.breakTime)) {
      this.showStage(-1);
      return;
    }

    this.progress += Physics.TICK / stats.breakTime;
    if (this.hitTimer-- <= 0) {
      this.hitTimer = HIT_INTERVAL - 1;
      const def = getBlockDef(id);
      audioManager.play(`dig.${def.sound}`, 0.25, 0.5);
      const n = player.selectedNormal;
      if (n)
        this.particles.chip(coords.x, coords.y, coords.z, n.x, n.y, n.z, id);
    }
    if (this.progress >= 1) {
      this.finish(world);
    } else {
      this.showStage(Math.min(STAGES - 1, Math.floor(this.progress * STAGES)));
    }
  }

  private finish(world: World) {
    const t = this.target;
    if (!t) return;
    this.reset();
    this.delay = BREAK_DELAY;
    if (!world.removeBlock(t.x, t.y, t.z)) return;
    this.particles.burst(t.x, t.y, t.z, t.id);
    this.onBreak(t.x, t.y, t.z, t.id);
  }

  /** Draws crack stage `stage` over the target; -1 hides it */
  private showStage(stage: number) {
    const t = this.target;
    if (!t || stage < 0) {
      this.crack.visible = false;
      return;
    }
    const [x0, y0, z0, x1, y1, z1] = getBlockDef(t.id).box;
    this.crack.material = this.stages[stage];
    this.crack.position.set(
      t.x + (x0 + x1) / 2,
      t.y + (y0 + y1) / 2,
      t.z + (z0 + z1) / 2
    );
    this.crack.scale.set(x1 - x0 + 0.002, y1 - y0 + 0.002, z1 - z0 + 0.002);
    this.crack.visible = true;
  }
}
