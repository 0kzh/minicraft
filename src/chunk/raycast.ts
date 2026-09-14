export type VoxelHit = {
  x: number;
  y: number;
  z: number;
  /** Unit axis normal of the face that was hit */
  normal: { x: number; y: number; z: number };
  distance: number;
};

type Vec3Like = { x: number; y: number; z: number };

/**
 * Amanatides & Woo voxel traversal. Steps the ray one voxel at a time and
 * returns the first voxel for which `isSolid` is true, along with the face
 * that was entered. `direction` must be normalized.
 */
export function raycastVoxels(
  origin: Vec3Like,
  direction: Vec3Like,
  maxDistance: number,
  isSolid: (x: number, y: number, z: number) => boolean
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

  let normal = { x: 0, y: 0, z: 0 };
  let t = 0;

  while (t <= maxDistance) {
    if (isSolid(x, y, z)) {
      return { x, y, z, normal, distance: t };
    }

    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      normal = { x: -stepX, y: 0, z: 0 };
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      normal = { x: 0, y: -stepY, z: 0 };
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      normal = { x: 0, y: 0, z: -stepZ };
    }
  }

  return null;
}
