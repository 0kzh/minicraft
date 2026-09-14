import { BlockID, FLUID_MAX_LEVEL } from "../Block";
import { BlockDef, fluidBlockId, getBlockDef } from "../Block/blocks";

/** The voxel access a fluid simulation needs; World implements this */
export interface FluidWorld {
  getBlock(x: number, y: number, z: number): BlockID | undefined;
  /** Writes a block without an immediate remesh; returns false if unloaded */
  setBlockDeferred(x: number, y: number, z: number, id: BlockID): boolean;
}

/** Per-liquid behaviour, matching Minecraft's overworld values */
type FluidRules = {
  /** Seconds between updates (water 5 ticks, lava 30 ticks) */
  interval: number;
  /** Level lost per block of horizontal spread */
  dropOff: number;
  /** How far to look for a drop when choosing spread directions */
  slopeDistance: number;
  /** Two adjacent sources over a solid floor create a new source */
  infinite: boolean;
};

const RULES: Record<number, FluidRules> = {
  [BlockID.Water]: {
    interval: 0.25,
    dropOff: 1,
    slopeDistance: 4,
    infinite: true,
  },
  [BlockID.Lava]: {
    interval: 1.5,
    dropOff: 2,
    slopeDistance: 2,
    infinite: false,
  },
};

const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const FULL = FLUID_MAX_LEVEL + 1;
const NO_SLOPE = 1000;

/** Liquid "amount": sources and falling columns are full, levels drain it */
const amountOf = (def: BlockDef): number =>
  def.fluidFalling || def.fluidLevel === 0 ? FULL : FULL - def.fluidLevel;

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

/**
 * Finite-level liquid spreading in the spirit of Minecraft's FlowingFluid:
 * liquids fall first, otherwise spread sideways losing a level per block,
 * preferring directions that lead to a drop within a few blocks. Flowing
 * blocks recompute their level from their neighbours and dry up when cut
 * off. Cells are only simulated after something near them changes.
 */
export class FluidSim {
  private pending = new Map<number, Set<string>>();
  private timers = new Map<number, number>();
  /** Cells processed per liquid per update, bounding the main-thread cost */
  budget = 4096;

  constructor(private readonly world: FluidWorld) {
    for (const source of Object.keys(RULES)) {
      this.pending.set(Number(source), new Set());
      this.timers.set(Number(source), 0);
    }
  }

  get pendingCount() {
    let n = 0;
    for (const set of this.pending.values()) n += set.size;
    return n;
  }

  /** Schedules the cell and its six neighbours for their liquid's next tick */
  scheduleAround(x: number, y: number, z: number) {
    this.schedule(x, y, z);
    this.schedule(x + 1, y, z);
    this.schedule(x - 1, y, z);
    this.schedule(x, y + 1, z);
    this.schedule(x, y - 1, z);
    this.schedule(x, y, z + 1);
    this.schedule(x, y, z - 1);
  }

  schedule(x: number, y: number, z: number) {
    const id = this.world.getBlock(x, y, z);
    if (id === undefined) return;
    const def = getBlockDef(id);
    if (!def.fluid) return;
    this.pending.get(def.fluidSource)?.add(key(x, y, z));
  }

  update(dt: number) {
    for (const [source, rules] of Object.entries(RULES)) {
      const id = Number(source);
      const t = (this.timers.get(id) ?? 0) + dt;
      if (t < rules.interval) {
        this.timers.set(id, t);
        continue;
      }
      this.timers.set(id, 0);
      this.tick(id, rules);
    }
  }

  private tick(source: BlockID, rules: FluidRules) {
    const queue = this.pending.get(source);
    if (!queue || queue.size === 0) return;
    // Cells scheduled during this tick run on the next one
    const cells = [...queue].slice(0, this.budget);
    for (const c of cells) queue.delete(c);
    for (const c of cells) {
      const [x, y, z] = c.split(",").map(Number);
      this.tickCell(x, y, z, source, rules);
    }
  }

  private tickCell(
    x: number,
    y: number,
    z: number,
    source: BlockID,
    rules: FluidRules
  ) {
    const id = this.world.getBlock(x, y, z);
    if (id === undefined) return;
    let def = getBlockDef(id);
    if (!def.fluid || def.fluidSource !== source) return;

    if (def.fluidLevel > 0 || def.fluidFalling) {
      const next = this.computeLevel(x, y, z, source, rules);
      if (next !== id) {
        this.set(x, y, z, next);
        if (next === BlockID.Air) return;
        def = getBlockDef(next);
      }
    }

    const below = this.world.getBlock(x, y - 1, z);
    if (below !== undefined && this.canFlowInto(below, source, true)) {
      this.flowInto(x, y - 1, z, below, source, fluidBlockId(source, 1, true));
    }

    const isSource = def.fluidLevel === 0 && !def.fluidFalling;
    const belowIsHole = below !== undefined && this.isHole(below, source);
    if (!isSource && belowIsHole) return;

    const spreadAmount = amountOf(def) - rules.dropOff;
    if (spreadAmount <= 0) return;
    const spreadLevel = FULL - spreadAmount;
    const flowing = fluidBlockId(source, spreadLevel);

    for (const [dx, dz] of this.spreadDirections(x, y, z, source, rules)) {
      const nx = x + dx;
      const nz = z + dz;
      const n = this.world.getBlock(nx, y, nz);
      if (n === undefined || !this.canFlowInto(n, source, false)) continue;
      const nDef = getBlockDef(n);
      // Only raise neighbours that are shallower than what we'd give them
      if (nDef.fluid && amountOf(nDef) >= spreadAmount) continue;
      this.flowInto(nx, y, nz, n, source, flowing);
    }
  }

  /** Level a flowing cell should have given its neighbours, or Air if none feed it */
  private computeLevel(
    x: number,
    y: number,
    z: number,
    source: BlockID,
    rules: FluidRules
  ): BlockID {
    const above = this.world.getBlock(x, y + 1, z);
    if (above !== undefined && this.isSame(above, source)) {
      return fluidBlockId(source, 1, true);
    }

    let best = 0;
    let sources = 0;
    for (const [dx, dz] of DIRS) {
      const n = this.world.getBlock(x + dx, y, z + dz);
      if (n === undefined || !this.isSame(n, source)) continue;
      const nDef = getBlockDef(n);
      if (nDef.fluidLevel === 0 && !nDef.fluidFalling) sources++;
      best = Math.max(best, amountOf(nDef));
    }

    if (rules.infinite && sources >= 2) {
      const below = this.world.getBlock(x, y - 1, z);
      const belowDef = below === undefined ? undefined : getBlockDef(below);
      if (
        belowDef &&
        (!belowDef.passable ||
          (belowDef.fluidSource === source && belowDef.fluidLevel === 0))
      ) {
        return source;
      }
    }

    const amount = best - rules.dropOff;
    if (amount <= 0) return BlockID.Air;
    return fluidBlockId(source, FULL - amount);
  }

  /**
   * Directions to spread in: those reaching a drop within `slopeDistance`
   * blocks soonest, or every open direction when there is no drop nearby.
   */
  private spreadDirections(
    x: number,
    y: number,
    z: number,
    source: BlockID,
    rules: FluidRules
  ): [number, number][] {
    let min = NO_SLOPE;
    const dists: number[] = [];
    for (const [dx, dz] of DIRS) {
      const nx = x + dx;
      const nz = z + dz;
      const n = this.world.getBlock(nx, y, nz);
      if (n === undefined || !this.canPassThrough(n, source)) {
        dists.push(NO_SLOPE);
        continue;
      }
      const below = this.world.getBlock(nx, y - 1, nz);
      const d =
        below !== undefined && this.isHole(below, source)
          ? 0
          : this.slopeDistance(nx, y, nz, 1, dx, dz, source, rules);
      dists.push(d);
      min = Math.min(min, d);
    }
    return DIRS.filter((_, i) => min === NO_SLOPE || dists[i] === min);
  }

  private slopeDistance(
    x: number,
    y: number,
    z: number,
    depth: number,
    fromDx: number,
    fromDz: number,
    source: BlockID,
    rules: FluidRules
  ): number {
    let min = NO_SLOPE;
    for (const [dx, dz] of DIRS) {
      if (dx === -fromDx && dz === -fromDz) continue;
      const nx = x + dx;
      const nz = z + dz;
      const n = this.world.getBlock(nx, y, nz);
      if (n === undefined || !this.canPassThrough(n, source)) continue;
      const below = this.world.getBlock(nx, y - 1, nz);
      if (below !== undefined && this.isHole(below, source)) {
        return depth;
      }
      if (depth < rules.slopeDistance) {
        min = Math.min(
          min,
          this.slopeDistance(nx, y, nz, depth + 1, dx, dz, source, rules)
        );
      }
    }
    return min;
  }

  private isSame(id: BlockID, source: BlockID) {
    const def = getBlockDef(id);
    return def.fluid && def.fluidSource === source;
  }

  /** Air, plants, or the same liquid: a cell liquid can occupy or path through */
  private canPassThrough(id: BlockID, source: BlockID) {
    const def = getBlockDef(id);
    if (def.fluid) return def.fluidSource === source && def.fluidLevel > 0;
    return def.passable;
  }

  /** A cell below that liquid would fall into */
  private isHole(id: BlockID, source: BlockID) {
    const def = getBlockDef(id);
    if (def.fluid) return def.fluidSource === source;
    return def.passable;
  }

  private canFlowInto(id: BlockID, source: BlockID, down: boolean) {
    const def = getBlockDef(id);
    if (def.fluid) {
      // Meeting another liquid solidifies it; same liquid may be deepened
      if (def.fluidSource !== source) return true;
      if (def.fluidLevel === 0 && !def.fluidFalling) return false;
      return down ? !def.fluidFalling : true;
    }
    return def.passable;
  }

  private flowInto(
    x: number,
    y: number,
    z: number,
    existing: BlockID,
    source: BlockID,
    id: BlockID
  ) {
    const def = getBlockDef(existing);
    if (def.fluid && def.fluidSource !== source) {
      this.set(x, y, z, BlockID.Stone);
      return;
    }
    this.set(x, y, z, id);
  }

  private set(x: number, y: number, z: number, id: BlockID) {
    if (!this.world.setBlockDeferred(x, y, z, id)) return;
    this.scheduleAround(x, y, z);
  }
}
