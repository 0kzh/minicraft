import { BlockID } from "../Block";
import { RNG } from "../RNG";

import { BiomeDef, TreeKind } from "./biomes";
import { hash32 } from "./noise";

/** Largest horizontal distance a tree reaches from its trunk */
export const TREE_REACH = 4;

type Put = (lx: number, y: number, lz: number, id: BlockID) => void;
type At = (lx: number, y: number, lz: number) => BlockID;

const pickKind = (def: BiomeDef, u: number): TreeKind => {
  let total = 0;
  for (const t of def.trees) total += t.weight;
  let acc = 0;
  for (const t of def.trees) {
    acc += t.weight;
    if (u * total < acc) return t.kind;
  }
  return def.trees[def.trees.length - 1].kind;
};

/**
 * Grows a tree with its trunk base at local (lx, y, lz). All randomness comes
 * from the tree's world position so the same tree is produced by every chunk
 * it overlaps.
 */
export function placeTree(
  def: BiomeDef,
  seed: number,
  wx: number,
  wz: number,
  lx: number,
  y: number,
  lz: number,
  put: Put,
  at: At,
  swamp: boolean
) {
  const rng = new RNG(hash32(seed, wx, wz, 0x7ee));
  const kind = pickKind(def, rng.random());

  const leafIfAir = (x: number, ly: number, z: number, leaf: BlockID) => {
    if (at(x, ly, z) === BlockID.Air) put(x, ly, z, leaf);
  };
  const disc = (
    cy: number,
    radius: number,
    leaf: BlockID,
    trimCorners: boolean
  ) => {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
        if (corner && (trimCorners || rng.random() < 0.5)) continue;
        leafIfAir(lx + dx, cy, lz + dz, leaf);
      }
    }
  };

  switch (kind) {
    case "oak":
    case "birch": {
      const log = kind === "oak" ? BlockID.OakLog : BlockID.BirchLog;
      const leaf = kind === "oak" ? BlockID.Leaves : BlockID.BirchLeaves;
      const trunk = (kind === "oak" ? 4 : 5) + Math.floor(rng.random() * 3);
      const top = y + trunk;
      // Canopy: two wide layers then two narrow ones, plus the crown
      disc(top - 2, 2, leaf, false);
      disc(top - 1, 2, leaf, false);
      disc(top, 1, leaf, true);
      disc(top + 1, 1, leaf, true);
      for (let i = 0; i < trunk; i++) put(lx, y + i, lz, log);
      if (swamp) {
        // Vines-ish drape: extra leaves hanging under the canopy edge
        for (const [dx, dz] of [
          [2, 0],
          [-2, 0],
          [0, 2],
          [0, -2],
        ]) {
          if (rng.random() < 0.6) leafIfAir(lx + dx, top - 3, lz + dz, leaf);
        }
      }
      break;
    }
    case "bigOak": {
      const trunk = 7 + Math.floor(rng.random() * 3);
      const top = y + trunk;
      // Rounded crown built from overlapping spheres
      const blobs: [number, number, number, number][] = [
        [0, -1, 0, 3.2],
        [2, 0, 1, 2.2],
        [-2, 0, -1, 2.2],
        [1, 1, -2, 2],
        [-1, 1, 2, 2],
      ];
      for (const [bx, by, bz, r] of blobs) {
        const R = Math.ceil(r);
        for (let dx = -R; dx <= R; dx++) {
          for (let dy = -R; dy <= R; dy++) {
            for (let dz = -R; dz <= R; dz++) {
              const d = Math.hypot(dx, dy * 1.3, dz);
              if (d > r - rng.random() * 0.4) continue;
              leafIfAir(
                lx + bx + dx,
                top + by + dy,
                lz + bz + dz,
                BlockID.Leaves
              );
            }
          }
        }
      }
      for (let i = 0; i < trunk; i++) put(lx, y + i, lz, BlockID.OakLog);
      // Short branches into the crown
      for (const [bx, bz] of [
        [1, 0],
        [-1, 1],
      ]) {
        put(lx + bx, top - 2, lz + bz, BlockID.OakLog);
      }
      break;
    }
    case "spruce": {
      const trunk = 6 + Math.floor(rng.random() * 5);
      const top = y + trunk;
      const leaf = BlockID.SpruceLeaves;
      // Conical crown: rings alternating between radius 1 and 2 down the
      // upper two-thirds of the trunk, capped by a spike
      leafIfAir(lx, top + 1, lz, leaf);
      const crownBottom = y + Math.floor(trunk / 3);
      let wide = false;
      for (let ly = top; ly >= crownBottom; ly--) {
        const fromTop = top - ly;
        let radius: number;
        if (fromTop === 0) radius = 1;
        else if (fromTop === 1) radius = 1;
        else radius = wide ? 2 : 1;
        if (fromTop >= 1) wide = !wide;
        disc(ly, radius, leaf, radius === 2);
      }
      for (let i = 0; i < trunk; i++) put(lx, y + i, lz, BlockID.SpruceLog);
      break;
    }
  }
}
