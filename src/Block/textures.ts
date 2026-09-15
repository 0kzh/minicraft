import * as THREE from "three";

import {
  BLOCKS,
  BlockDef,
  RenderGeometry,
  TEXTURE_LAYERS,
  TextureName,
} from "./blocks";

export const TEXTURE_SIZE = 16;

/** Vanilla animation speed: frametime 2 ticks */
const ANIM_FPS = 10;

/** Animated layer: frames live in consecutive layers starting at `first` */
export type LayerAnimation = {
  layer: number;
  first: number;
  frames: number;
  fps: number;
};

export type BlockTextures = {
  array: THREE.DataArrayTexture;
  animations: LayerAnimation[];
  /** 16x16 RGBA pixels of every base layer, for UI icons */
  icons: Map<TextureName, ImageData>;
};

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
 * Vertical strips (animated textures) are split into frames that are
 * appended after the base layers and cycled by the shader.
 */
export async function loadBlockTextures(): Promise<BlockTextures> {
  const loaded = await Promise.all(
    TEXTURE_LAYERS.map((name) => loadImage(`textures/${name}.png`))
  );

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas context unavailable");

  const frameSets: ImageData[][] = loaded.map((img) => {
    const scale = img.width / TEXTURE_SIZE;
    const frames = Math.max(1, Math.floor(img.height / img.width));
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE * frames;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, img.width / scale, img.height / scale);
    const out: ImageData[] = [];
    for (let f = 0; f < frames; f++) {
      out.push(
        ctx.getImageData(0, f * TEXTURE_SIZE, TEXTURE_SIZE, TEXTURE_SIZE)
      );
    }
    return out;
  });

  const animations: LayerAnimation[] = [];
  const layers: ImageData[] = frameSets.map((f) => f[0]);
  frameSets.forEach((frames, layer) => {
    if (frames.length < 2) return;
    animations.push({
      layer,
      first: layers.length,
      frames: frames.length,
      fps: ANIM_FPS,
    });
    layers.push(...frames);
  });

  const layerBytes = TEXTURE_SIZE * TEXTURE_SIZE * 4;
  const data = new Uint8Array(layerBytes * layers.length);
  const rowBytes = TEXTURE_SIZE * 4;
  layers.forEach((px, layer) => {
    // Flip vertically so t=1 is the top of the image, matching regular textures
    for (let row = 0; row < TEXTURE_SIZE; row++) {
      const src = row * rowBytes;
      const dst = layer * layerBytes + (TEXTURE_SIZE - 1 - row) * rowBytes;
      data.set(px.data.subarray(src, src + rowBytes), dst);
    }
  });

  const array = new THREE.DataArrayTexture(
    data,
    TEXTURE_SIZE,
    TEXTURE_SIZE,
    layers.length
  );
  array.format = THREE.RGBAFormat;
  array.type = THREE.UnsignedByteType;
  array.colorSpace = THREE.SRGBColorSpace;
  array.wrapS = THREE.RepeatWrapping;
  array.wrapT = THREE.RepeatWrapping;
  array.magFilter = THREE.NearestFilter;
  array.minFilter = THREE.NearestMipmapLinearFilter;
  array.generateMipmaps = true;
  array.needsUpdate = true;

  const icons = new Map<TextureName, ImageData>();
  TEXTURE_LAYERS.forEach((name, i) => icons.set(name, frameSets[i][0]));
  return { array, animations, icons };
}

const ICON_SIZE = 64;

/**
 * Draws an isometric icon for a block from its own textures so the toolbar
 * always matches whatever texture pack is loaded.
 */
export function renderBlockIcon(
  def: BlockDef,
  icons: Map<TextureName, ImageData>
): string {
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.imageSmoothingEnabled = false;

  const face = (layer: number, shade: number): HTMLCanvasElement => {
    const px = icons.get(TEXTURE_LAYERS[layer]);
    const c = document.createElement("canvas");
    c.width = TEXTURE_SIZE;
    c.height = TEXTURE_SIZE;
    const cc = c.getContext("2d");
    if (!cc || !px) return c;
    const shaded = new ImageData(new Uint8ClampedArray(px.data), TEXTURE_SIZE);
    for (let i = 0; i < shaded.data.length; i += 4) {
      shaded.data[i] *= shade;
      shaded.data[i + 1] *= shade;
      shaded.data[i + 2] *= shade;
    }
    cc.putImageData(shaded, 0, 0);
    return c;
  };

  if (def.geometry === RenderGeometry.Cross) {
    ctx.drawImage(face(def.faces[0], 1), 4, 4, ICON_SIZE - 8, ICON_SIZE - 8);
    return canvas.toDataURL();
  }

  // Cube seen like vanilla's GUI item transform (rotated 30 deg down, 45 deg
  // around): edge L projects to half-width L/sqrt2, top rhombus half-height
  // L/(2 sqrt2) and vertical side height L cos30
  const L = ICON_SIZE / (Math.SQRT2 / 2 + Math.cos(Math.PI / 6));
  const w = L / Math.SQRT2;
  const h = w / 2;
  const side = L * Math.cos(Math.PI / 6);
  const cx = ICON_SIZE / 2;
  const top = (ICON_SIZE - 2 * h - side) / 2;
  const s = TEXTURE_SIZE;

  // Top face: parallelogram from (cx, top) right to (cx+w, top+h), down to (cx, top+2h), left to (cx-w, top+h)
  ctx.save();
  ctx.setTransform(w / s, h / s, -w / s, h / s, cx, top);
  ctx.drawImage(face(def.faces[2], 1), 0, 0);
  ctx.restore();

  // Left face (-X side)
  ctx.save();
  ctx.setTransform(w / s, h / s, 0, side / s, cx - w, top + h);
  ctx.drawImage(face(def.faces[1], 0.8), 0, 0);
  ctx.restore();

  // Right face (+Z side)
  ctx.save();
  ctx.setTransform(w / s, -h / s, 0, side / s, cx, top + 2 * h);
  ctx.drawImage(face(def.faces[4], 0.6), 0, 0);
  ctx.restore();

  return canvas.toDataURL();
}

/** Replaces every block's `uiTexture` with an icon rendered from its textures */
export function buildBlockIcons(icons: Map<TextureName, ImageData>) {
  for (const def of BLOCKS) {
    if (!def || def.geometry === RenderGeometry.None) continue;
    if (def.fluidLevel > 0 || def.fluidFalling) continue;
    def.uiTexture = renderBlockIcon(def, icons);
  }
}
