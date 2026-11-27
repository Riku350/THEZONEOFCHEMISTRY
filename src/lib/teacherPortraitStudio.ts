import { DEFAULT_ID_CARD_MOTIVATIONAL_MESSAGE } from '../config/defaults';
import { InstituteSettings } from '../types';
import { resolveMediaSource } from './media';

export interface BgSamplePoint {
  /** Normalized X coordinate in [0, 1] */
  x: number;
  /** Normalized Y coordinate in [0, 1] */
  y: number;
}

export interface PortraitStudioOptions {
  /** Enable local canvas background removal */
  removeBackground: boolean;
  /** Color distance tolerance (12..95) */
  tolerance: number;
  /** Soft edge feathering passes (0..4) */
  feather: number;
  /** Optional user-clicked background sample points */
  samplePoints: BgSamplePoint[];
  /** Portrait lighting brightness adjustment (-30..30) */
  brightness: number;
  /** Portrait contrast adjustment (-25..35) */
  contrast: number;
  /** Warmth / skin tone balance (-20..25) */
  warmth: number;
  /** Subtle crispness / sharpen intensity (0..100) */
  sharpen: number;
  /** Add subtle purple studio rim highlight along cutout contour */
  purpleRimGlow: boolean;
  /** Auto-crop empty transparent margins (bottom-anchored for portrait banners) */
  autoFrame: boolean;
}

export const DEFAULT_PORTRAIT_STUDIO_OPTIONS: PortraitStudioOptions = {
  removeBackground: true,
  tolerance: 42,
  feather: 2,
  samplePoints: [],
  brightness: 6,
  contrast: 10,
  warmth: 4,
  sharpen: 22,
  purpleRimGlow: true,
  autoFrame: true,
};

export interface PortraitCutoutResult {
  pngDataUrl: string;
  pngBlob: Blob;
  width: number;
  height: number;
  removedPercent: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(
        new Error(
          'Unable to load image into the local editor canvas. Try re-uploading the original image directly.'
        )
      );
    img.src = src;
  });
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Checks whether an uploaded image file already contains meaningful alpha transparency.
 */
export async function detectImageHasTransparency(fileOrUrl: File | string): Promise<boolean> {
  let objectUrl = '';
  try {
    const src =
      typeof fileOrUrl === 'string'
        ? fileOrUrl
        : ((objectUrl = URL.createObjectURL(fileOrUrl)), objectUrl);
    const img = await loadImage(src);
    const w = Math.min(180, img.naturalWidth || img.width || 1);
    const h = Math.min(180, img.naturalHeight || img.height || 1);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let transparentPixels = 0;
    const total = w * h;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 235) transparentPixels++;
    }
    return transparentPixels / total > 0.03;
  } catch {
    return false;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

function colorDistSq(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  // Perceptually weighted RGB distance
  const rMean = (r1 + r2) * 0.5;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db;
}

/**
 * Builds a compact palette of representative background colors from outer borders
 * and any user-clicked background sample points.
 */
function sampleBackgroundPalette(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  samplePoints: BgSamplePoint[]
): RGB[] {
  const rawSamples: RGB[] = [];

  const pushAt = (x: number, y: number) => {
    const cx = Math.max(0, Math.min(w - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(h - 1, Math.round(y)));
    const idx = (cy * w + cx) * 4;
    if (data[idx + 3] > 20) {
      rawSamples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  };

  // Sample top border and upper 75% of left & right edges (avoids cutting torso at bottom center)
  const stepX = Math.max(1, Math.floor(w / 24));
  for (let x = 0; x < w; x += stepX) {
    pushAt(x, 1);
    pushAt(x, Math.min(h - 1, 5));
  }
  const sideMaxY = Math.floor(h * 0.78);
  const stepY = Math.max(1, Math.floor(sideMaxY / 18));
  for (let y = 0; y < sideMaxY; y += stepY) {
    pushAt(1, y);
    pushAt(w - 2, y);
  }
  // Corners
  pushAt(2, 2);
  pushAt(w - 3, 2);
  pushAt(2, h - 3);
  pushAt(w - 3, h - 3);

  // Explicit user-clicked points (sample 3x3 neighborhood)
  for (const pt of samplePoints) {
    const px = Math.round(pt.x * (w - 1));
    const py = Math.round(pt.y * (h - 1));
    for (let dy = -2; dy <= 2; dy += 2) {
      for (let dx = -2; dx <= 2; dx += 2) {
        pushAt(px + dx, py + dy);
      }
    }
  }

  // Greedy clustering to keep <= 14 distinct background tones
  const clusters: { r: number; g: number; b: number; count: number }[] = [];
  const mergeThreshSq = 32 * 32 * 4;
  for (const s of rawSamples) {
    let matched = false;
    for (const c of clusters) {
      if (colorDistSq(s.r, s.g, s.b, c.r, c.g, c.b) < mergeThreshSq) {
        const n = c.count + 1;
        c.r = (c.r * c.count + s.r) / n;
        c.g = (c.g * c.count + s.g) / n;
        c.b = (c.b * c.count + s.b) / n;
        c.count = n;
        matched = true;
        break;
      }
    }
    if (!matched && clusters.length < 18) {
      clusters.push({ r: s.r, g: s.g, b: s.b, count: 1 });
    }
  }

  return clusters
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map((c) => ({ r: c.r, g: c.g, b: c.b }));
}

function minPaletteDistSq(r: number, g: number, b: number, palette: RGB[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const d = colorDistSq(r, g, b, p.r, p.g, p.b);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Local on-device HTML5 Canvas background removal & portrait lighting studio.
 * Never replaces or alters the teacher's real facial identity — operates strictly
 * on the pixels of the uploaded teacher photograph.
 */
export async function processTeacherPortraitCutout(
  sourceUrl: string,
  options: PortraitStudioOptions
): Promise<PortraitCutoutResult> {
  const img = await loadImage(sourceUrl);
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;

  const maxDim = 680;
  let w = natW;
  let h = natH;
  if (w > maxDim || h > maxDim) {
    const scale = maxDim / Math.max(w, h);
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const pixelCount = w * h;

  let removedCount = 0;

  if (options.removeBackground) {
    const palette = sampleBackgroundPalette(data, w, h, options.samplePoints);
    const tol = Math.max(10, Math.min(95, options.tolerance));
    // Weighted RGB distance scales roughly 3x Euclidean RGB
    const hardThreshSq = (tol * 2.35) * (tol * 2.35);
    const softThreshSq = (tol * 3.15) * (tol * 3.15);
    const neighborStepSq = (tol * 1.15) * (tol * 1.15);

    const visited = new Uint8Array(pixelCount);
    const isBg = new Uint8Array(pixelCount);
    const queue = new Int32Array(pixelCount);
    let qHead = 0;
    let qTail = 0;

    const enqueueIfBg = (x: number, y: number, forceSeed = false) => {
      if (x < 0 || x >= w || y < 0 || y >= h) return;
      const pIdx = y * w + x;
      if (visited[pIdx]) return;
      const dIdx = pIdx * 4;
      const a = data[dIdx + 3];
      if (a < 12) {
        visited[pIdx] = 1;
        isBg[pIdx] = 1;
        queue[qTail++] = pIdx;
        return;
      }
      const distSq = minPaletteDistSq(data[dIdx], data[dIdx + 1], data[dIdx + 2], palette);
      if (forceSeed || distSq <= hardThreshSq) {
        visited[pIdx] = 1;
        isBg[pIdx] = 1;
        queue[qTail++] = pIdx;
      }
    };

    // Seed border pixels (top edge, left/right edges, bottom corners)
    for (let x = 0; x < w; x++) {
      enqueueIfBg(x, 0, false);
    }
    for (let y = 0; y < h; y++) {
      enqueueIfBg(0, y, false);
      enqueueIfBg(w - 1, y, false);
    }
    // Bottom outer 12% corners only (protect torso at bottom center)
    const cornerSpan = Math.floor(w * 0.14);
    for (let x = 0; x < cornerSpan; x++) {
      enqueueIfBg(x, h - 1, false);
      enqueueIfBg(w - 1 - x, h - 1, false);
    }

    // Seed explicit user-clicked background points forcefully
    for (const pt of options.samplePoints) {
      const px = Math.max(0, Math.min(w - 1, Math.round(pt.x * (w - 1))));
      const py = Math.max(0, Math.min(h - 1, Math.round(pt.y * (h - 1))));
      enqueueIfBg(px, py, true);
    }

    // Connected-component BFS flood-fill (4-connected)
    while (qHead < qTail) {
      const curr = queue[qHead++];
      const cx = curr % w;
      const cy = (curr - cx) / w;
      const cOff = curr * 4;
      const cr = data[cOff];
      const cg = data[cOff + 1];
      const cb = data[cOff + 2];

      const neighbors = [
        cx > 0 ? curr - 1 : -1,
        cx < w - 1 ? curr + 1 : -1,
        cy > 0 ? curr - w : -1,
        cy < h - 1 ? curr + w : -1,
      ];

      for (let i = 0; i < 4; i++) {
        const nIdx = neighbors[i];
        if (nIdx < 0 || visited[nIdx]) continue;
        const nOff = nIdx * 4;
        const na = data[nOff + 3];
        if (na < 12) {
          visited[nIdx] = 1;
          isBg[nIdx] = 1;
          queue[qTail++] = nIdx;
          continue;
        }
        const nr = data[nOff];
        const ng = data[nOff + 1];
        const nb = data[nOff + 2];

        const palDist = minPaletteDistSq(nr, ng, nb, palette);
        if (palDist <= hardThreshSq) {
          visited[nIdx] = 1;
          isBg[nIdx] = 1;
          queue[qTail++] = nIdx;
        } else if (palDist <= softThreshSq) {
          // Only step into soft-tolerance zones if smooth gradient from current background pixel
          const stepDist = colorDistSq(cr, cg, cb, nr, ng, nb);
          if (stepDist <= neighborStepSq) {
            visited[nIdx] = 1;
            isBg[nIdx] = 1;
            queue[qTail++] = nIdx;
          }
        }
      }
    }

    // Build initial alpha mask (0 for background, original alpha for foreground)
    const alpha = new Float32Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      if (isBg[i]) {
        alpha[i] = 0;
        removedCount++;
      } else {
        alpha[i] = data[i * 4 + 3];
      }
    }

    // Soft transition on 1-px fringe pixels touching background + feathering
    const featherPasses = Math.max(0, Math.min(4, Math.round(options.feather)));
    if (featherPasses > 0) {
      let srcA = alpha;
      let dstA = new Float32Array(pixelCount);
      for (let pass = 0; pass < featherPasses; pass++) {
        for (let y = 0; y < h; y++) {
          const row = y * w;
          for (let x = 0; x < w; x++) {
            const idx = row + x;
            const cur = srcA[idx];
            // Only soften pixels on or adjacent to the cutout boundary
            const left = x > 0 ? srcA[idx - 1] : 0;
            const right = x < w - 1 ? srcA[idx + 1] : 0;
            const top = y > 0 ? srcA[idx - w] : 0;
            const bottom = y < h - 1 ? srcA[idx + w] : 0;

            const isBoundary =
              (cur > 0 && (left < 240 || right < 240 || top < 240 || bottom < 240)) ||
              (cur === 0 && (left > 30 || right > 30 || top > 30 || bottom > 30));

            if (isBoundary) {
              const avg = (cur * 2 + left + right + top + bottom) / 6;
              // Gently trim outer halo while keeping solid interior crisp
              dstA[idx] = cur === 0 ? Math.min(avg * 0.45, 70) : avg;
            } else {
              dstA[idx] = cur;
            }
          }
        }
        const tmp = srcA;
        srcA = dstA;
        dstA = tmp;
      }

      for (let i = 0; i < pixelCount; i++) {
        data[i * 4 + 3] = clampByte(srcA[i]);
      }
    } else {
      for (let i = 0; i < pixelCount; i++) {
        data[i * 4 + 3] = clampByte(alpha[i]);
      }
    }
  }

  // Portrait Lighting, Contrast, Warmth & Subtle Purple Rim Highlight on Foreground
  const brightOffset = (options.brightness / 100) * 75;
  const contrastFactor =
    (259 * ((options.contrast / 100) * 110 + 255)) /
    (255 * (259 - (options.contrast / 100) * 110));
  const warmShift = (options.warmth / 100) * 28;

  for (let i = 0; i < pixelCount; i++) {
    const off = i * 4;
    const a = data[off + 3];
    if (a < 5) continue;

    let r = data[off];
    let g = data[off + 1];
    let b = data[off + 2];

    r = contrastFactor * (r - 128) + 128 + brightOffset + warmShift;
    g = contrastFactor * (g - 128) + 128 + brightOffset + warmShift * 0.25;
    b = contrastFactor * (b - 128) + 128 + brightOffset - warmShift * 0.65;

    // Gentle purple studio rim-light along semi-transparent edges if enabled
    if (options.purpleRimGlow && a > 12 && a < 240) {
      const edgeWeight = (1 - a / 255) * 0.35;
      r = r * (1 - edgeWeight) + 167 * edgeWeight;
      g = g * (1 - edgeWeight) + 139 * edgeWeight;
      b = b * (1 - edgeWeight) + 250 * edgeWeight;
    }

    data[off] = clampByte(r);
    data[off + 1] = clampByte(g);
    data[off + 2] = clampByte(b);
  }

  // Mild Unsharp / Clarity pass for crisp portrait detail
  if (options.sharpen > 0) {
    const amount = (options.sharpen / 100) * 0.55;
    const copy = new Uint8ClampedArray(data);
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const idx = (row + x) * 4;
        if (copy[idx + 3] < 180) continue;
        for (let c = 0; c < 3; c++) {
          const center = copy[idx + c];
          const avg =
            (copy[idx - 4 + c] +
              copy[idx + 4 + c] +
              copy[idx - w * 4 + c] +
              copy[idx + w * 4 + c]) *
            0.25;
          data[idx + c] = clampByte(center + (center - avg) * amount);
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // Auto-frame: trim empty transparent margins cleanly while preserving natural portrait breathing room
  let outCanvas = canvas;
  if (options.autoFrame && options.removeBackground) {
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (data[(row + x) * 4 + 3] > 28) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX > minX + 20 && maxY > minY + 20) {
      const padX = Math.round((maxX - minX) * 0.06);
      const padTop = Math.round((maxY - minY) * 0.05);
      const cropX = Math.max(0, minX - padX);
      const cropY = Math.max(0, minY - padTop);
      const cropW = Math.min(w - cropX, maxX - minX + padX * 2);
      const cropH = Math.min(h - cropY, maxY - cropY + 2);

      const trimmed = document.createElement('canvas');
      trimmed.width = cropW;
      trimmed.height = cropH;
      const tCtx = trimmed.getContext('2d');
      if (tCtx) {
        tCtx.clearRect(0, 0, cropW, cropH);
        tCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        outCanvas = trimmed;
      }
    }
  }

  const pngDataUrl = outCanvas.toDataURL('image/png');
  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    outCanvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Failed to export transparent PNG.'));
    }, 'image/png');
  });

  return {
    pngDataUrl,
    pngBlob,
    width: outCanvas.width,
    height: outCanvas.height,
    removedPercent: Math.round((removedCount / Math.max(1, pixelCount)) * 100),
  };
}

function drawHexagon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) {
        lines.push(current);
        if (lines.length >= maxLines) return lines;
      }
      current = word;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

/**
 * Renders a standalone 1200x640 Teacher Profile Promotional Banner Preview
 * (Purple & White chemistry theme featuring the real uploaded photo of SONU SIR #BABA).
 */
export async function renderTeacherBannerPreviewDataUrl(
  settings: InstituteSettings,
  overridePortraitUrl?: string,
  overrideIsCutout?: boolean
): Promise<string> {
  const W = 1200;
  const H = 640;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable.');

  // Crisp White Base
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // Left Purple Chemistry Studio Stage
  const stageW = 460;
  const grad = ctx.createLinearGradient(0, 0, stageW, H);
  grad.addColorStop(0, '#5B21B6');
  grad.addColorStop(0.55, '#6D28D9');
  grad.addColorStop(1, '#4C1D95');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, stageW, H);

  // Subtle decorative molecule geometry on purple backdrop
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 2;
  drawHexagon(ctx, 90, 110, 74);
  drawHexagon(ctx, 210, 178, 52);
  drawHexagon(ctx, 380, 115, 66);
  drawHexagon(ctx, 84, 520, 88);
  ctx.strokeStyle = 'rgba(124, 58, 237, 0.06)';
  drawHexagon(ctx, W - 110, 100, 84);
  drawHexagon(ctx, W - 210, 180, 56);
  ctx.restore();

  // Soft radiant studio halo behind teacher portrait
  const halo = ctx.createRadialGradient(stageW / 2, H * 0.48, 30, stageW / 2, H * 0.48, 250);
  halo.addColorStop(0, 'rgba(237, 233, 254, 0.42)');
  halo.addColorStop(0.6, 'rgba(167, 139, 250, 0.16)');
  halo.addColorStop(1, 'rgba(109, 40, 217, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, stageW, H);

  // Resolve real teacher photo
  const portraitSrc =
    overridePortraitUrl ||
    (await resolveMediaSource(settings.teacherPhotoUrl, settings.teacherPhotoMediaId, false));
  const isCutout =
    typeof overrideIsCutout === 'boolean'
      ? overrideIsCutout
      : Boolean(settings.teacherPhotoIsCutout);

  if (portraitSrc) {
    try {
      const img = await loadImage(portraitSrc);
      if (isCutout) {
        // Bottom-anchored prominent cutout composition
        const maxDrawW = stageW - 44;
        const maxDrawH = H - 54;
        const scale = Math.min(maxDrawW / img.width, maxDrawH / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const dx = (stageW - drawW) / 2;
        const dy = H - drawH;
        ctx.save();
        ctx.shadowColor = 'rgba(30, 10, 68, 0.32)';
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 8;
        ctx.drawImage(img, dx, dy, drawW, drawH);
        ctx.restore();
      } else {
        const frameX = 56;
        const frameY = 74;
        const frameW = stageW - 112;
        const frameH = H - 148;
        ctx.save();
        drawRoundedRect(ctx, frameX, frameY, frameW, frameH, 24);
        ctx.clip();
        const scale = Math.max(frameW / img.width, frameH / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        ctx.drawImage(
          img,
          frameX + (frameW - drawW) / 2,
          frameY + (frameH - drawH) / 2,
          drawW,
          drawH
        );
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.65)';
        ctx.lineWidth = 4;
        drawRoundedRect(ctx, frameX, frameY, frameW, frameH, 24);
        ctx.stroke();
      }
    } catch {
      // ignore if unloadable
    }
  } else {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#EDE9FE';
    ctx.font = '700 22px "Outfit", sans-serif';
    ctx.fillText('UPLOAD TEACHER PHOTO', stageW / 2, H / 2 - 8);
    ctx.fillStyle = '#C4B5FD';
    ctx.font = '500 16px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('Actual photo appears here', stageW / 2, H / 2 + 24);
    ctx.textAlign = 'left';
  }

  // Right Content Panel
  const rx = stageW + 52;
  const rw = W - rx - 48;

  // Top Institute Eyebrow
  ctx.fillStyle = '#6D28D9';
  ctx.font = '700 15px "JetBrains Mono", monospace';
  ctx.fillText((settings.instituteName || 'THE ZONE OF CHEMISTRY').toUpperCase(), rx, 76);

  // Teacher Name
  ctx.fillStyle = '#111827';
  ctx.font = '800 46px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.fillText(settings.teacherName || 'SONU SIR #BABA', rx, 134);

  // Designation Chip
  const designation = (settings.teacherDesignation || 'Chemistry Teacher').trim();
  ctx.font = '700 17px "Plus Jakarta Sans", sans-serif';
  const desigW = Math.min(rw, ctx.measureText(designation).width + 34);
  drawRoundedRect(ctx, rx, 154, desigW, 38, 10);
  ctx.fillStyle = '#F5F3FF';
  ctx.fill();
  ctx.strokeStyle = '#DDD6FE';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#6D28D9';
  ctx.fillText(designation, rx + 17, 179);

  // Specialization / Experience
  const meta = [settings.teacherSpecialization?.trim(), settings.teacherExperience?.trim()]
    .filter(Boolean)
    .join('  ·  ');
  let y = 228;
  if (meta) {
    ctx.fillStyle = '#4B5563';
    ctx.font = '600 17px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(meta.slice(0, 72), rx, y);
    y += 32;
  }

  // Bio
  const bio =
    (settings.teacherBio || '').trim() ||
    `Dedicated Chemistry mentor at ${settings.instituteName || 'THE ZONE OF CHEMISTRY'} guiding Board, NEET & JEE students.`;
  ctx.fillStyle = '#374151';
  ctx.font = '500 18px "Plus Jakarta Sans", sans-serif';
  const bioLines = wrapText(ctx, bio, rw, 3);
  bioLines.forEach((line) => {
    ctx.fillText(line, rx, y);
    y += 27;
  });

  // Contact Box (Verified Admin-Entered Only)
  const contacts: { label: string; value: string }[] = [];
  if (settings.teacherContactNumber?.trim()) {
    contacts.push({ label: 'CALL', value: settings.teacherContactNumber.trim() });
  }
  if (settings.teacherWhatsappNumber?.trim()) {
    contacts.push({ label: 'WHATSAPP', value: settings.teacherWhatsappNumber.trim() });
  }
  if (settings.teacherEmail?.trim()) {
    contacts.push({ label: 'EMAIL', value: settings.teacherEmail.trim() });
  }

  y = Math.max(y + 18, 360);
  if (contacts.length > 0) {
    drawRoundedRect(ctx, rx, y, rw, 72, 14);
    ctx.fillStyle = '#F9FAFB';
    ctx.fill();
    ctx.strokeStyle = '#E5E7EB';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const slotW = rw / contacts.length;
    contacts.forEach((c, idx) => {
      const sx = rx + idx * slotW + 16;
      ctx.fillStyle = '#6D28D9';
      ctx.font = '700 12px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(c.label, sx, y + 26);
      ctx.fillStyle = '#111827';
      ctx.font = '600 15px "JetBrains Mono", monospace';
      ctx.fillText(c.value.slice(0, 26), sx, y + 52);
    });
    y += 92;
  }

  // Motivational Message Card
  const quote = (settings.idCardMotivationalMessage || '').trim() || DEFAULT_ID_CARD_MOTIVATIONAL_MESSAGE;
  const qH = H - y - 34;
  if (qH >= 90) {
    drawRoundedRect(ctx, rx, y, rw, qH, 16);
    ctx.fillStyle = '#F5F3FF';
    ctx.fill();
    ctx.strokeStyle = '#DDD6FE';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#7C3AED';
    drawRoundedRect(ctx, rx + 14, y + 16, 6, qH - 32, 3);
    ctx.fill();

    ctx.fillStyle = '#1F2937';
    ctx.font = '600 16px "Plus Jakarta Sans", sans-serif';
    const qLines = wrapText(ctx, quote, rw - 52, Math.max(2, Math.floor((qH - 28) / 24)));
    let qy = y + 36;
    qLines.forEach((l) => {
      ctx.fillText(l, rx + 34, qy);
      qy += 24;
    });
  }

  // Crisp outer border
  ctx.strokeStyle = '#E5E7EB';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  return canvas.toDataURL('image/png', 1.0);
}
