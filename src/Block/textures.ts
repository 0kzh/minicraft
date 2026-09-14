import * as THREE from "three";

import { TEXTURE_LAYERS } from "./blocks";

export const TEXTURE_SIZE = 16;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load texture ${src}`));
    img.src = src;
  });

/**
 * Loads every block texture into a single 2D texture array (one 16x16 layer
 * per texture) so all chunk geometry can be drawn with one material.
 */
export async function loadBlockTextureArray(): Promise<THREE.DataArrayTexture> {
  const images = await Promise.all(
    TEXTURE_LAYERS.map((name) => loadImage(`textures/${name}.png`))
  );

  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas context unavailable");

  const layerBytes = TEXTURE_SIZE * TEXTURE_SIZE * 4;
  const data = new Uint8Array(layerBytes * images.length);

  images.forEach((img, layer) => {
    ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    ctx.drawImage(img, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    const pixels = ctx.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE).data;
    // Flip vertically so t=1 is the top of the image, matching regular textures
    const rowBytes = TEXTURE_SIZE * 4;
    for (let row = 0; row < TEXTURE_SIZE; row++) {
      const src = row * rowBytes;
      const dst = layer * layerBytes + (TEXTURE_SIZE - 1 - row) * rowBytes;
      data.set(pixels.subarray(src, src + rowBytes), dst);
    }
  });

  const texture = new THREE.DataArrayTexture(
    data,
    TEXTURE_SIZE,
    TEXTURE_SIZE,
    images.length
  );
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
