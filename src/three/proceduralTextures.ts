import * as THREE from 'three';

// Fast deterministic 3D hash -> [0, 1]
function hash3(ix: number, iy: number, iz: number): number {
  let n = (ix * 374761393 + iy * 668265263 + iz * 1274126177) | 0;
  n = (n ^ (n >> 13)) | 0;
  n = Math.imul(n, 1274126177);
  n = (n ^ (n >> 16)) >>> 0;
  return n / 4294967295;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function valueNoise3D(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);

  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);
  const fz = smoothstep(z - iz);

  const c000 = hash3(ix, iy, iz);
  const c100 = hash3(ix + 1, iy, iz);
  const c010 = hash3(ix, iy + 1, iz);
  const c110 = hash3(ix + 1, iy + 1, iz);
  const c001 = hash3(ix, iy, iz + 1);
  const c101 = hash3(ix + 1, iy, iz + 1);
  const c011 = hash3(ix, iy + 1, iz + 1);
  const c111 = hash3(ix + 1, iy + 1, iz + 1);

  const x00 = lerp(c000, c100, fx);
  const x10 = lerp(c010, c110, fx);
  const x01 = lerp(c001, c101, fx);
  const x11 = lerp(c011, c111, fx);

  const y0 = lerp(x00, x10, fy);
  const y1 = lerp(x01, x11, fy);

  return lerp(y0, y1, fz);
}

function fbm3D(
  x: number,
  y: number,
  z: number,
  octaves: number,
  lacunarity = 2.05,
  gain = 0.5
): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1.0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise3D(x * freq, y * freq, z * freq);
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum / norm;
}

export interface EarthTextureSet {
  albedoMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  nightMap: THREE.CanvasTexture;
  cloudMap: THREE.CanvasTexture;
}

export function createEarthTextures(maxAnisotropy: number): EarthTextureSet {
  const w = 1024;
  const h = 512;

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = w;
  albedoCanvas.height = h;
  const albedoCtx = albedoCanvas.getContext('2d')!;
  const albedoImg = albedoCtx.createImageData(w, h);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = w;
  roughCanvas.height = h;
  const roughCtx = roughCanvas.getContext('2d')!;
  const roughImg = roughCtx.createImageData(w, h);

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = w;
  bumpCanvas.height = h;
  const bumpCtx = bumpCanvas.getContext('2d')!;
  const bumpImg = bumpCtx.createImageData(w, h);

  const nightCanvas = document.createElement('canvas');
  nightCanvas.width = w;
  nightCanvas.height = h;
  const nightCtx = nightCanvas.getContext('2d')!;
  const nightImg = nightCtx.createImageData(w, h);

  const cloudCanvas = document.createElement('canvas');
  cloudCanvas.width = w;
  cloudCanvas.height = h;
  const cloudCtx = cloudCanvas.getContext('2d')!;
  const cloudImg = cloudCtx.createImageData(w, h);

  const aData = albedoImg.data;
  const rData = roughImg.data;
  const bData = bumpImg.data;
  const nData = nightImg.data;
  const cData = cloudImg.data;

  for (let py = 0; py < h; py++) {
    const v = (py + 0.5) / h;
    const phi = v * Math.PI; // 0 (North pole) .. PI (South pole)
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const absLat = Math.abs(cosPhi); // 0 equator .. 1 pole

    for (let px = 0; px < w; px++) {
      const u = (px + 0.5) / w;
      const theta = u * Math.PI * 2;
      const nx = sinPhi * Math.cos(theta);
      const ny = cosPhi;
      const nz = sinPhi * Math.sin(theta);

      // Domain-warped continental plates
      const warpX = fbm3D(nx * 1.8 + 4.1, ny * 1.8 + 1.3, nz * 1.8 + 7.2, 3) - 0.5;
      const warpZ = fbm3D(nx * 1.8 + 9.4, ny * 1.8 + 5.7, nz * 1.8 + 2.8, 3) - 0.5;

      const cont = fbm3D(
        (nx + warpX * 0.42) * 2.15 + 1.7,
        (ny + warpX * 0.25) * 2.15 + 3.1,
        (nz + warpZ * 0.42) * 2.15 + 5.3,
        5
      );
      const detail = fbm3D(nx * 9.5 + 12.1, ny * 9.5 + 4.4, nz * 9.5 + 8.9, 3);
      const elevation = cont * 0.84 + detail * 0.16;

      // Sea level threshold
      const seaLevel = 0.505;
      const idx = (py * w + px) * 4;

      // Polar ice cap mask (organic jagged coastline)
      const iceThreshold = 0.89 + (detail - 0.5) * 0.08;
      const isPolarIce = absLat > iceThreshold;

      let r = 0;
      let g = 0;
      let b = 0;
      let rough = 220;
      let bump = 128;
      let cityR = 0;
      let cityG = 0;
      let cityB = 0;

      if (isPolarIce) {
        // Crisp Arctic / Antarctic ice sheets
        const iceShade = 224 + Math.floor(detail * 28);
        r = iceShade;
        g = iceShade + 4;
        b = Math.min(255, iceShade + 10);
        rough = 175;
        bump = 148 + Math.floor(detail * 24);
      } else if (elevation < seaLevel) {
        // Ocean bathymetry: deep abyssal blue to shallow turquoise continental shelf
        const depth = Math.min(1, (seaLevel - elevation) / 0.18);
        const shelf = 1 - depth;
        r = Math.floor(lerp(9, 28, shelf * shelf));
        g = Math.floor(lerp(28, 102, shelf * 0.85));
        b = Math.floor(lerp(72, 152, shelf * 0.78));
        rough = 58; // Specular ocean glint
        bump = 116;
      } else {
        // Land biomes based on elevation + latitude moisture
        const landAlt = Math.min(1, (elevation - seaLevel) / 0.26);
        const aridity = fbm3D(nx * 4.2 + 21.3, ny * 4.2 + 6.7, nz * 4.2 + 14.5, 3);
        // Subtropical desert belt around |lat| ~ 0.35 (20-32 deg)
        const desertBelt = Math.exp(-Math.pow((absLat - 0.36) / 0.22, 2));
        const dryFactor = Math.min(1, Math.max(0, desertBelt * 0.72 + (aridity - 0.45) * 1.1));

        // Coastal / temperate forest green vs arid ochre vs alpine rock/snow
        const forestR = lerp(38, 72, detail);
        const forestG = lerp(92, 128, detail);
        const forestB = lerp(46, 56, detail);

        const desertR = lerp(176, 206, detail);
        const desertG = lerp(152, 176, detail);
        const desertB = lerp(104, 126, detail);

        r = lerp(forestR, desertR, dryFactor);
        g = lerp(forestG, desertG, dryFactor);
        b = lerp(forestB, desertB, dryFactor);

        // Boreal / tundra tint near high latitudes
        if (absLat > 0.68) {
          const tTundra = Math.min(1, (absLat - 0.68) / 0.22);
          r = lerp(r, 118, tTundra * 0.6);
          g = lerp(g, 126, tTundra * 0.55);
          b = lerp(b, 108, tTundra * 0.6);
        }

        // High mountain ridges & snow peaks
        if (landAlt > 0.48) {
          const tMount = Math.min(1, (landAlt - 0.48) / 0.35);
          r = lerp(r, 124, tMount);
          g = lerp(g, 118, tMount);
          b = lerp(b, 112, tMount);
        }
        if (landAlt > 0.78) {
          const tSnow = Math.min(1, (landAlt - 0.78) / 0.18);
          r = lerp(r, 236, tSnow);
          g = lerp(g, 240, tSnow);
          b = lerp(b, 246, tSnow);
        }

        rough = 215;
        bump = Math.min(255, Math.floor(132 + landAlt * 120));

        // Procedural night-side city lights clustered in temperate coastal lowlands
        if (landAlt < 0.28 && absLat < 0.75) {
          const cluster = fbm3D(nx * 18.0 + 3.3, ny * 18.0 + 8.1, nz * 18.0 + 1.9, 2);
          const spark = hash3(px, py, 97);
          const coastalBonus = landAlt < 0.1 ? 1.25 : 0.75;
          if (cluster * coastalBonus > 0.68 && spark > 0.52) {
            const intensity = Math.min(1, (cluster * coastalBonus - 0.66) * 3.8) * spark;
            cityR = Math.floor(255 * intensity);
            cityG = Math.floor(196 * intensity);
            cityB = Math.floor(110 * intensity);
          }
        }
      }

      aData[idx] = Math.floor(r);
      aData[idx + 1] = Math.floor(g);
      aData[idx + 2] = Math.floor(b);
      aData[idx + 3] = 255;

      rData[idx] = rough;
      rData[idx + 1] = rough;
      rData[idx + 2] = rough;
      rData[idx + 3] = 255;

      bData[idx] = bump;
      bData[idx + 1] = bump;
      bData[idx + 2] = bump;
      bData[idx + 3] = 255;

      nData[idx] = cityR;
      nData[idx + 1] = cityG;
      nData[idx + 2] = cityB;
      nData[idx + 3] = 255;

      // Swirling atmospheric cloud wisps (stretched along zonal wind bands)
      const swirl = fbm3D(nx * 3.8 + 41.0, ny * 5.6 + 11.0, nz * 3.8 + 27.0, 4);
      const fineCloud = fbm3D(nx * 11.5 + swirl * 2.2, ny * 14.0, nz * 11.5 + swirl * 2.2, 3);
      const cloudVal = swirl * 0.65 + fineCloud * 0.35;
      const cloudAlpha = cloudVal > 0.53 ? Math.min(255, Math.floor((cloudVal - 0.53) * 760)) : 0;

      cData[idx] = 244;
      cData[idx + 1] = 248;
      cData[idx + 2] = 255;
      cData[idx + 3] = cloudAlpha;
    }
  }

  albedoCtx.putImageData(albedoImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);
  bumpCtx.putImageData(bumpImg, 0, 0);
  nightCtx.putImageData(nightImg, 0, 0);
  cloudCtx.putImageData(cloudImg, 0, 0);

  const albedoMap = new THREE.CanvasTexture(albedoCanvas);
  albedoMap.colorSpace = THREE.SRGBColorSpace;
  albedoMap.anisotropy = maxAnisotropy;
  albedoMap.wrapS = THREE.RepeatWrapping;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.anisotropy = maxAnisotropy;
  roughnessMap.wrapS = THREE.RepeatWrapping;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.anisotropy = maxAnisotropy;
  bumpMap.wrapS = THREE.RepeatWrapping;

  const nightMap = new THREE.CanvasTexture(nightCanvas);
  nightMap.colorSpace = THREE.SRGBColorSpace;
  nightMap.anisotropy = maxAnisotropy;
  nightMap.wrapS = THREE.RepeatWrapping;

  const cloudMap = new THREE.CanvasTexture(cloudCanvas);
  cloudMap.colorSpace = THREE.SRGBColorSpace;
  cloudMap.anisotropy = maxAnisotropy;
  cloudMap.wrapS = THREE.RepeatWrapping;

  return { albedoMap, roughnessMap, bumpMap, nightMap, cloudMap };
}

export interface MoonTextureSet {
  albedoMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

interface CraterSpec {
  x: number;
  y: number;
  z: number;
  radius: number;
  depth: number;
}

export function createMoonTextures(maxAnisotropy: number): MoonTextureSet {
  const w = 1024;
  const h = 512;

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = w;
  albedoCanvas.height = h;
  const albedoCtx = albedoCanvas.getContext('2d')!;
  const albedoImg = albedoCtx.createImageData(w, h);

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = w;
  bumpCanvas.height = h;
  const bumpCtx = bumpCanvas.getContext('2d')!;
  const bumpImg = bumpCtx.createImageData(w, h);

  // Pre-generate deterministic impact craters distributed uniformly on the sphere
  const craters: CraterSpec[] = [];
  const craterCount = 140;
  for (let i = 0; i < craterCount; i++) {
    const u1 = hash3(i, 11, 23);
    const u2 = hash3(i, 47, 79);
    const theta = u1 * Math.PI * 2;
    const z = u2 * 2 - 1;
    const rXY = Math.sqrt(Math.max(0, 1 - z * z));
    const sizeRand = hash3(i, 91, 13);
    // Power-law crater size distribution
    const radius = 0.03 + Math.pow(sizeRand, 3.2) * 0.22;
    craters.push({
      x: rXY * Math.cos(theta),
      y: z,
      z: rXY * Math.sin(theta),
      radius,
      depth: 0.35 + sizeRand * 0.55,
    });
  }

  const aData = albedoImg.data;
  const bData = bumpImg.data;

  for (let py = 0; py < h; py++) {
    const v = (py + 0.5) / h;
    const phi = v * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    for (let px = 0; px < w; px++) {
      const u = (px + 0.5) / w;
      const theta = u * Math.PI * 2;
      const nx = sinPhi * Math.cos(theta);
      const ny = cosPhi;
      const nz = sinPhi * Math.sin(theta);

      // Lunar Maria (dark basaltic plains) vs Highlands
      const mariaNoise = fbm3D(nx * 2.1 + 5.2, ny * 2.1 + 1.8, nz * 2.1 + 9.4, 4);
      const regolithDetail = fbm3D(nx * 14.0 + 2.1, ny * 14.0 + 7.4, nz * 14.0 + 3.9, 3);
      const isMaria = smoothstep(Math.min(1, Math.max(0, (mariaNoise - 0.44) / 0.16)));

      let height = 0.55 - isMaria * 0.16 + (regolithDetail - 0.5) * 0.14;
      let albedo = lerp(178, 96, isMaria) + (regolithDetail - 0.5) * 28;

      // Apply crater bowls and raised ejecta rims
      for (let c = 0; c < craters.length; c++) {
        const cr = craters[c];
        // Quick bounding dot check before sqrt
        const dot = nx * cr.x + ny * cr.y + nz * cr.z;
        if (dot < 0.82) continue;
        const dist = Math.acos(Math.min(1, dot));
        if (dist < cr.radius * 1.45) {
          const t = dist / cr.radius;
          if (t < 0.85) {
            // Crater interior bowl
            const bowl = 1 - (t / 0.85) * (t / 0.85);
            height -= bowl * 0.22 * cr.depth;
            albedo -= bowl * 16 * cr.depth;
          } else {
            // Raised crater rim
            const rimT = (t - 0.85) / 0.6;
            const rim = Math.sin((1 - rimT) * Math.PI) * 0.45;
            height += rim * 0.14 * cr.depth;
            albedo += rim * 22 * cr.depth;
          }
        }
      }

      const clampedAlbedo = Math.min(242, Math.max(48, Math.floor(albedo)));
      const clampedBump = Math.min(255, Math.max(0, Math.floor(height * 255)));

      const idx = (py * w + px) * 4;
      aData[idx] = clampedAlbedo;
      aData[idx + 1] = Math.floor(clampedAlbedo * 0.99);
      aData[idx + 2] = Math.floor(clampedAlbedo * 0.97);
      aData[idx + 3] = 255;

      bData[idx] = clampedBump;
      bData[idx + 1] = clampedBump;
      bData[idx + 2] = clampedBump;
      bData[idx + 3] = 255;
    }
  }

  albedoCtx.putImageData(albedoImg, 0, 0);
  bumpCtx.putImageData(bumpImg, 0, 0);

  const albedoMap = new THREE.CanvasTexture(albedoCanvas);
  albedoMap.colorSpace = THREE.SRGBColorSpace;
  albedoMap.anisotropy = maxAnisotropy;
  albedoMap.wrapS = THREE.RepeatWrapping;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.anisotropy = maxAnisotropy;
  bumpMap.wrapS = THREE.RepeatWrapping;

  return { albedoMap, bumpMap };
}

export function createSunTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const data = img.data;

  for (let py = 0; py < h; py++) {
    const phi = ((py + 0.5) / h) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    for (let px = 0; px < w; px++) {
      const theta = ((px + 0.5) / w) * Math.PI * 2;
      const nx = sinPhi * Math.cos(theta);
      const ny = cosPhi;
      const nz = sinPhi * Math.sin(theta);

      const cells = fbm3D(nx * 6.5 + 3.2, ny * 6.5 + 8.1, nz * 6.5 + 4.9, 4);
      const gran = fbm3D(nx * 18.0, ny * 18.0, nz * 18.0, 2);
      const v = cells * 0.72 + gran * 0.28;

      // Occasional darker sunspots near solar mid-latitudes
      const spotNoise = fbm3D(nx * 5.0 + 21.0, ny * 5.0 + 2.0, nz * 5.0 + 13.0, 3);
      const spotMask = Math.abs(ny) < 0.55 && spotNoise > 0.71 ? Math.min(1, (spotNoise - 0.71) * 10) : 0;

      const idx = (py * w + px) * 4;
      const r = lerp(255, 185, spotMask);
      const g = lerp(140 + v * 95, 65, spotMask);
      const b = lerp(25 + v * 75, 10, spotMask);

      data[idx] = Math.floor(r);
      data[idx + 1] = Math.floor(g);
      data[idx + 2] = Math.floor(b);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createStarSpriteTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.22, 'rgba(255, 255, 255, 0.85)');
  grad.addColorStop(0.55, 'rgba(220, 235, 255, 0.22)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
