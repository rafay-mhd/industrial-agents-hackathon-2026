import * as THREE from "three";

/** Original, deterministic material maps. No image downloads or canvas dependency. */
export function exteriorTexture(kind: "timber" | "metal" | "stone" | "glass") {
  const size = 128,
    pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      const noise = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      const n = noise - Math.floor(noise) - 0.5;
      let rgb: number[];
      if (kind === "timber") {
        const wave = u + Math.sin(v * Math.PI * 2) * 0.013;
        const grain =
          Math.sin(wave * Math.PI * 54) * 6 +
          Math.sin(wave * Math.PI * 138 + Math.sin(v * Math.PI * 4)) * 3;
        const board = Math.floor(u * 4) % 2 ? 4 : -3;
        const groove = (u * 4) % 1 < 0.025 ? -24 : 0;
        const value = grain + n * 5 + board + groove;
        rgb = [139 + value, 90 + value * 0.8, 48 + value * 0.55];
      } else if (kind === "metal") {
        const seam = x < 3 ? 20 : x < 6 ? -14 : 0;
        const value = seam + Math.sin(u * Math.PI) * 5 + n * 1.5;
        rgb = [49 + value, 60 + value, 65 + value];
      } else if (kind === "glass") {
        const sky = v * 24,
          glow = Math.max(0, 1 - Math.abs(u - 0.72) * 8) * 12;
        rgb = [54 + sky + glow, 67 + sky + glow, 69 + sky + glow];
      } else {
        const value = n * 12 + Math.sin(x * 0.6 + Math.sin(y * 0.12)) * 2;
        rgb = [190 + value, 180 + value, 161 + value];
      }
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++)
        pixels[i + c] = Math.max(0, Math.min(255, rgb[c]));
      pixels[i + 3] = 255;
    }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.name = `Architectural ${kind}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
