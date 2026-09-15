export type VoxelHit = {
  x: number;
  y: number;
  z: number;
  /** Unit axis normal of the face that was hit */
  normal: { x: number; y: number; z: number };
  distance: number;
};

type Vec3Like = { x: number; y: number; z: number };

/** Block-space AABB: minX, minY, minZ, maxX, maxY, maxZ */
type Box = readonly [number, number, number, number, number, number];

/**
 * Amanatides & Woo voxel traversal. Steps the ray one voxel at a time; for
 * each voxel with a shape (`getShape` returns its box, or null for empty) the
 * ray is clipped against that box like vanilla `BlockGetter.clip`, so partial
 * blocks (snow layers, plants, cactus) are only hit where they actually are.
 * `direction` must be normalized.
 */
export function raycastVoxels(
  origin: Vec3Like,
  direction: Vec3Like,
  maxDistance: number,
  getShape: (x: number, y: number, z: number) => Box | null
): VoxelHit | null {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = Math.sign(direction.x);
  const stepY = Math.sign(direction.y);
  const stepZ = Math.sign(direction.z);

  const tDeltaX = stepX !== 0 ? Math.abs(1 / direction.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / direction.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / direction.z) : Infinity;

  const boundary = (p: number, step: number) =>
    step > 0 ? Math.floor(p) + 1 - p : p - Math.floor(p);

  let tMaxX = stepX !== 0 ? boundary(origin.x, stepX) * tDeltaX : Infinity;
  let tMaxY = stepY !== 0 ? boundary(origin.y, stepY) * tDeltaY : Infinity;
  let tMaxZ = stepZ !== 0 ? boundary(origin.z, stepZ) * tDeltaZ : Infinity;

  let t = 0;

  while (t <= maxDistance) {
    const box = getShape(x, y, z);
    if (box) {
      const hit = clipBox(origin, direction, x, y, z, box);
      if (hit && hit.distance <= maxDistance) return hit;
    }

    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
    }
  }

  return null;
}

/**
 * Slab test of the ray against the block's box. Returns the entry face, or
 * null if the ray misses (a ray starting inside the box counts as a hit on
 * the face it would have entered through, so a player standing in a block
 * can still target it).
 */
function clipBox(
  origin: Vec3Like,
  dir: Vec3Like,
  bx: number,
  by: number,
  bz: number,
  box: Box
): VoxelHit | null {
  let tEnter = -Infinity;
  let tExit = Infinity;
  const normal = { x: 0, y: 0, z: 0 };

  const axes: [number, number, number, number, "x" | "y" | "z"][] = [
    [origin.x, dir.x, bx + box[0], bx + box[3], "x"],
    [origin.y, dir.y, by + box[1], by + box[4], "y"],
    [origin.z, dir.z, bz + box[2], bz + box[5], "z"],
  ];

  for (const [o, d, min, max, axis] of axes) {
    if (d === 0) {
      if (o < min || o > max) return null;
      continue;
    }
    const inv = 1 / d;
    let t0 = (min - o) * inv;
    let t1 = (max - o) * inv;
    let sign = -1;
    if (t0 > t1) {
      [t0, t1] = [t1, t0];
      sign = 1;
    }
    if (t0 > tEnter) {
      tEnter = t0;
      normal.x = normal.y = normal.z = 0;
      normal[axis] = sign;
    }
    if (t1 < tExit) tExit = t1;
    if (tEnter > tExit) return null;
  }

  if (tExit < 0) return null;
  return { x: bx, y: by, z: bz, normal, distance: Math.max(tEnter, 0) };
}
