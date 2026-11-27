import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { DEFAULT_ID_CARD_MOTIVATIONAL_MESSAGE } from '../config/defaults';
import { InstituteSettings, PaymentRecord, StudentRecord } from '../types';
import { resolveMediaSource } from './media';

// Standard ISO/IEC 7810 ID-1 (CR80) physical ID card dimensions in millimeters
export const CR80_WIDTH_MM = 85.6;
export const CR80_HEIGHT_MM = 53.98;

// High-resolution 400 DPI canvas dimensions matching exact CR80 aspect ratio (1.5858)
const CARD_PX_W = 1348;
const CARD_PX_H = 850;

function loadImageSafe(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
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

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  const clean = (text || '').trim();
  if (!clean) return '—';
  if (ctx.measureText(clean).width <= maxWidth) return clean;
  let out = clean;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

function wrapParagraphs(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((p) => p.trim());
  const lines: string[] = [];

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const para = paragraphs[pIdx];
    if (!para) {
      if (lines.length > 0 && lines[lines.length - 1] !== '' && lines.length < maxLines) {
        lines.push('');
      }
      continue;
    }

    const words = para.split(/\s+/);
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
    if (current && lines.length < maxLines) {
      lines.push(current);
    }
    if (lines.length >= maxLines) return lines;
  }

  // Trim trailing empty line
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function drawMoleculeEmblem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  strokeColor: string,
  innerColor: string,
  dotColor: string
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 3;
  drawHexagon(ctx, 0, 0, radius);
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.46, 0, Math.PI * 2);
  ctx.strokeStyle = innerColor;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = dotColor;
  for (let i = 0; i < 3; i++) {
    const a = (Math.PI * 2 * i) / 3 - Math.PI / 6;
    ctx.beginPath();
    ctx.arc(radius * Math.cos(a), radius * Math.sin(a), 4.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHeaderLogoOrEmblem(
  ctx: CanvasRenderingContext2D,
  logoImg: HTMLImageElement | null,
  cx: number,
  cy: number,
  radius: number
) {
  if (logoImg) {
    const boxSize = radius * 2.25;
    const x = cx - boxSize / 2;
    const y = cy - boxSize / 2;
    ctx.save();
    drawRoundedRect(ctx, x, y, boxSize, boxSize, Math.round(radius * 0.42));
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = 'rgba(237, 233, 254, 0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.clip();
    const pad = Math.max(5, Math.round(boxSize * 0.1));
    const inner = boxSize - pad * 2;
    const scale = Math.min(inner / logoImg.width, inner / logoImg.height);
    const dw = logoImg.width * scale;
    const dh = logoImg.height * scale;
    ctx.drawImage(logoImg, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.restore();
    return;
  }
  drawMoleculeEmblem(ctx, cx, cy, radius, '#FFFFFF', '#DDD6FE', '#FFFFFF');
}

/**
 * FRONT SIDE — Student Details (Exact CR80 85.60 mm × 53.98 mm ratio at 400 DPI: 1348×850).
 * Pure white card surface, violet accent header, student photograph, 4-digit security code,
 * full student details, generous quiet-zone QR code, academic session & institute signature.
 */
export async function renderIdCardFrontDataUrl(
  student: StudentRecord,
  settings: InstituteSettings
): Promise<string> {
  const W = CARD_PX_W;
  const H = CARD_PX_H;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');

  // Pure White Canvas
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // Subtle geometric chemistry watermark
  ctx.save();
  ctx.strokeStyle = 'rgba(124, 58, 237, 0.05)';
  ctx.lineWidth = 2;
  drawHexagon(ctx, W - 320, H - 240, 120);
  drawHexagon(ctx, W - 150, H - 140, 82);
  drawHexagon(ctx, W - 490, H - 145, 68);
  ctx.restore();

  // Crisp outer CR80 border
  ctx.strokeStyle = '#D1D5DB';
  ctx.lineWidth = 3;
  drawRoundedRect(ctx, 14, 14, W - 28, H - 28, 28);
  ctx.stroke();

  // Solid Purple Header Band
  ctx.save();
  drawRoundedRect(ctx, 16, 16, W - 32, 152, 26);
  ctx.fillStyle = '#6D28D9';
  ctx.fill();
  ctx.fillRect(16, 134, W - 32, 34);
  ctx.restore();

  // Thin violet accent rule below header
  ctx.fillStyle = '#A78BFA';
  ctx.fillRect(16, 168, W - 32, 4);

  // Logo Emblem (uses uploaded Institute Logo when configured)
  const resolvedBrandLogo = await resolveMediaSource(
    settings.mainLogoUrl || settings.appLogoUrl,
    settings.mainLogoMediaId || settings.appLogoMediaId,
    false
  );
  const brandLogoImg = await loadImageSafe(resolvedBrandLogo);
  drawHeaderLogoOrEmblem(ctx, brandLogoImg, 84, 92, 30);

  // Institute Name & Teacher Name
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 37px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.fillText(
    truncateText(ctx, (settings.instituteName || 'THE ZONE OF CHEMISTRY').toUpperCase(), 740),
    138,
    83
  );

  ctx.fillStyle = '#EDE9FE';
  ctx.font = '600 21px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(
    truncateText(ctx, `${settings.teacherName || 'SONU SIR #BABA'}  ·  ${settings.tagline || 'Learn Chemistry – Build Your Future.'}`, 740),
    138,
    124
  );

  // Right Header: Student ID Badge & Academic Session
  ctx.textAlign = 'right';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 18px "JetBrains Mono", monospace';
  ctx.fillText('STUDENT ID CARD', W - 48, 80);
  ctx.fillStyle = '#DDD6FE';
  ctx.font = '600 17px "JetBrains Mono", monospace';
  ctx.fillText(
    `SESSION ${student.academicSession || settings.academicSession || '2026–2027'}`,
    W - 48,
    116
  );
  ctx.textAlign = 'left';

  // ---------------- LEFT COLUMN: Student Photograph + 4-Digit Security Code ----------------
  const photoX = 50;
  const photoY = 204;
  const photoW = 264;
  const photoH = 326;

  ctx.save();
  drawRoundedRect(ctx, photoX, photoY, photoW, photoH, 20);
  ctx.fillStyle = '#F9FAFB';
  ctx.fill();
  ctx.strokeStyle = '#C4B5FD';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.clip();

  const resolvedPhotoUrl = await resolveMediaSource(student.photoUrl, student.photoMediaId, true);
  const photoImg = await loadImageSafe(resolvedPhotoUrl);

  if (photoImg) {
    const scale = Math.max(photoW / photoImg.width, photoH / photoImg.height);
    const drawW = photoImg.width * scale;
    const drawH = photoImg.height * scale;
    const dx = photoX + (photoW - drawW) / 2;
    const dy = photoY + (photoH - drawH) / 2;
    ctx.drawImage(photoImg, dx, dy, drawW, drawH);
  } else {
    ctx.fillStyle = '#F5F3FF';
    ctx.fillRect(photoX, photoY, photoW, photoH);
    ctx.fillStyle = '#6D28D9';
    ctx.font = '700 68px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    const initials = (student.studentName || 'ST')
      .split(/\s+/)
      .filter(Boolean)
      .map((s) => s[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    ctx.fillText(initials || 'ST', photoX + photoW / 2, photoY + photoH / 2 + 24);
    ctx.textAlign = 'left';
  }
  ctx.restore();

  // 4-Digit Security Code Box
  const secY = photoY + photoH + 22;
  const secH = 104;
  drawRoundedRect(ctx, photoX, secY, photoW, secH, 16);
  ctx.fillStyle = '#F5F3FF';
  ctx.fill();
  ctx.strokeStyle = '#DDD6FE';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#6D28D9';
  ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('SECURITY CODE', photoX + photoW / 2, secY + 34);

  ctx.fillStyle = '#111827';
  ctx.font = '700 42px "JetBrains Mono", monospace';
  ctx.fillText(student.securityCode || '0000', photoX + photoW / 2, secY + 84);
  ctx.textAlign = 'left';

  // Academic Session pill under security code
  ctx.fillStyle = '#6B7280';
  ctx.font = '600 14px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    `SESSION: ${student.academicSession || settings.academicSession || '2026–2027'}`,
    photoX + photoW / 2,
    secY + secH + 34
  );
  ctx.textAlign = 'left';

  // ---------------- CENTER COLUMN: Student Information ----------------
  const infoX = 354;
  const infoColW = 576;
  let infoY = 232;

  ctx.fillStyle = '#6D28D9';
  ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('STUDENT FULL NAME', infoX, infoY);

  ctx.fillStyle = '#111827';
  ctx.font = '700 38px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.fillText(truncateText(ctx, student.studentName, infoColW), infoX, infoY + 42);

  // Clean divider below name
  ctx.strokeStyle = '#EDE9FE';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(infoX, infoY + 60);
  ctx.lineTo(infoX + infoColW - 10, infoY + 60);
  ctx.stroke();

  infoY += 92;

  const drawField = (label: string, value: string, x: number, y: number, maxW: number, mono = false) => {
    ctx.fillStyle = '#6B7280';
    ctx.font = '700 14px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(label, x, y);
    ctx.fillStyle = '#111827';
    ctx.font = mono
      ? '700 24px "JetBrains Mono", monospace'
      : '600 24px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(truncateText(ctx, value || '—', maxW), x, y + 32);
  };

  drawField("FATHER'S NAME", student.fatherName, infoX, infoY, infoColW);
  infoY += 76;

  drawField('STUDENT ID NUMBER', student.studentId, infoX, infoY, 320, true);
  drawField('CLASS', student.studentClass, infoX + 340, infoY, 230);
  infoY += 76;

  drawField('COURSE', student.course, infoX, infoY, infoColW);
  infoY += 76;

  drawField('BATCH TIMING', student.batch, infoX, infoY, 320);
  drawField('STUDENT MOBILE', student.studentMobile, infoX + 340, infoY, 230, true);

  // ---------------- RIGHT COLUMN: High-Contrast QR Code + Institute Signature ----------------
  const qrBoxX = 966;
  const qrBoxY = 204;
  const qrBoxW = 330;
  const qrBoxH = 360;

  drawRoundedRect(ctx, qrBoxX, qrBoxY, qrBoxW, qrBoxH, 22);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = '#DDD6FE';
  ctx.lineWidth = 3;
  ctx.stroke();

  const qrPayload = student.qrToken || `ZOC:${student.studentId}`;
  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    width: 520,
    margin: 2, // Generous white quiet-zone for fast rear-camera scanning
    color: { dark: '#111827', light: '#FFFFFF' },
    errorCorrectionLevel: 'H',
  });
  const qrImg = await loadImageSafe(qrDataUrl);
  if (qrImg) {
    ctx.drawImage(qrImg, qrBoxX + 25, qrBoxY + 18, 280, 280);
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#6D28D9';
  ctx.font = '700 15px "JetBrains Mono", monospace';
  ctx.fillText('SCAN FOR ATTENDANCE', qrBoxX + qrBoxW / 2, qrBoxY + 322);
  ctx.fillStyle = '#6B7280';
  ctx.font = '600 14px "JetBrains Mono", monospace';
  ctx.fillText(truncateText(ctx, student.studentId, qrBoxW - 24), qrBoxX + qrBoxW / 2, qrBoxY + 346);

  // Institute Signature beneath QR
  const sigY = qrBoxY + qrBoxH + 26;
  ctx.fillStyle = '#1F2937';
  ctx.font = 'italic 600 32px Georgia, serif';
  ctx.fillText(
    truncateText(ctx, settings.signatureText || settings.teacherName || 'Sonu Sir #Baba', qrBoxW - 20),
    qrBoxX + qrBoxW / 2,
    sigY + 40
  );

  ctx.strokeStyle = '#D1D5DB';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(qrBoxX + 24, sigY + 56);
  ctx.lineTo(qrBoxX + qrBoxW - 24, sigY + 56);
  ctx.stroke();

  ctx.fillStyle = '#6B7280';
  ctx.font = '700 14px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('INSTITUTE SIGNATURE', qrBoxX + qrBoxW / 2, sigY + 80);
  ctx.textAlign = 'left';

  // ---------------- FOOTER STRIP ----------------
  ctx.strokeStyle = '#E5E7EB';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(48, H - 82);
  ctx.lineTo(W - 48, H - 82);
  ctx.stroke();

  ctx.fillStyle = '#4B5563';
  ctx.font = '600 16px "Plus Jakarta Sans", sans-serif';
  const footerLeft = [settings.instituteName || 'THE ZONE OF CHEMISTRY', settings.teacherName || 'SONU SIR #BABA']
    .filter(Boolean)
    .join('  ·  ');
  ctx.fillText(truncateText(ctx, footerLeft, 860), 48, H - 44);

  ctx.textAlign = 'right';
  ctx.fillStyle = student.status === 'active' ? '#15803D' : '#DC2626';
  ctx.font = '700 16px "JetBrains Mono", monospace';
  ctx.fillText(
    student.status === 'active' ? 'STATUS: VERIFIED ACTIVE' : 'STATUS: SUSPENDED',
    W - 48,
    H - 44
  );
  ctx.textAlign = 'left';

  return canvas.toDataURL('image/png', 1.0);
}

/**
 * BACK SIDE — Upgraded Promotional Teacher Banner & Motivational Message
 * (Exact CR80 85.60 mm × 53.98 mm ratio at 400 DPI: 1348×850).
 * Uses ONLY the real admin-uploaded teacher photograph (preserving transparent PNG cutouts
 * over a soft violet chemistry halo) and verified admin-managed profile details.
 */
export async function renderIdCardBackDataUrl(settings: InstituteSettings): Promise<string> {
  const W = CARD_PX_W;
  const H = CARD_PX_H;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');

  // Pure White Canvas
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // Subtle decorative molecular watermark on right half
  ctx.save();
  ctx.strokeStyle = 'rgba(124, 58, 237, 0.055)';
  ctx.lineWidth = 2;
  drawHexagon(ctx, W - 130, 195, 96);
  drawHexagon(ctx, W - 265, 272, 64);
  drawHexagon(ctx, W - 115, 365, 52);
  ctx.restore();

  // Outer CR80 Border
  ctx.strokeStyle = '#D1D5DB';
  ctx.lineWidth = 3;
  drawRoundedRect(ctx, 14, 14, W - 28, H - 28, 28);
  ctx.stroke();

  // Top Solid Purple Header Band
  ctx.save();
  drawRoundedRect(ctx, 16, 16, W - 32, 98, 26);
  ctx.fillStyle = '#6D28D9';
  ctx.fill();
  ctx.fillRect(16, 82, W - 32, 32);
  ctx.restore();

  ctx.fillStyle = '#A78BFA';
  ctx.fillRect(16, 114, W - 32, 4);

  const resolvedBackBrandLogo = await resolveMediaSource(
    settings.mainLogoUrl || settings.appLogoUrl,
    settings.mainLogoMediaId || settings.appLogoMediaId,
    false
  );
  const backBrandLogoImg = await loadImageSafe(resolvedBackBrandLogo);
  drawHeaderLogoOrEmblem(ctx, backBrandLogoImg, 72, 65, 22);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 30px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.fillText('MEET YOUR TEACHER', 114, 75);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#EDE9FE';
  ctx.font = '700 15px "JetBrains Mono", monospace';
  ctx.fillText(
    truncateText(ctx, (settings.instituteName || 'THE ZONE OF CHEMISTRY').toUpperCase(), 480),
    W - 46,
    72
  );
  ctx.textAlign = 'left';

  // ---------------- LEFT HERO PORTRAIT BANNER PANEL ----------------
  const stageX = 38;
  const stageY = 138;
  const stageW = 376;
  const stageH = 592;

  ctx.save();
  drawRoundedRect(ctx, stageX, stageY, stageW, stageH, 24);
  const stageGrad = ctx.createLinearGradient(stageX, stageY, stageX + stageW, stageY + stageH);
  stageGrad.addColorStop(0, '#5B21B6');
  stageGrad.addColorStop(0.55, '#6D28D9');
  stageGrad.addColorStop(1, '#4C1D95');
  ctx.fillStyle = stageGrad;
  ctx.fill();
  ctx.clip();

  // Geometric chemistry hexagons inside purple stage
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
  ctx.lineWidth = 2;
  drawHexagon(ctx, stageX + 68, stageY + 86, 56);
  drawHexagon(ctx, stageX + 162, stageY + 138, 38);
  drawHexagon(ctx, stageX + stageW - 58, stageY + 94, 48);
  drawHexagon(ctx, stageX + 66, stageY + stageH - 150, 62);

  // Soft studio violet-white radial halo behind teacher
  const halo = ctx.createRadialGradient(
    stageX + stageW / 2,
    stageY + stageH * 0.44,
    24,
    stageX + stageW / 2,
    stageY + stageH * 0.44,
    210
  );
  halo.addColorStop(0, 'rgba(245, 243, 255, 0.46)');
  halo.addColorStop(0.58, 'rgba(196, 181, 253, 0.18)');
  halo.addColorStop(1, 'rgba(91, 33, 182, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(stageX, stageY, stageW, stageH);

  // Subtle decorative molecule dots
  ctx.fillStyle = 'rgba(221, 214, 254, 0.45)';
  [
    [stageX + 46, stageY + 210, 5],
    [stageX + stageW - 44, stageY + 230, 4],
    [stageX + stageW - 64, stageY + 184, 3.5],
  ].forEach(([dx, dy, dr]) => {
    ctx.beginPath();
    ctx.arc(dx, dy, dr, 0, Math.PI * 2);
    ctx.fill();
  });

  // Resolve real teacher photograph (NEVER stock/random face)
  const resolvedTeacherPhoto = await resolveMediaSource(
    settings.teacherPhotoUrl,
    settings.teacherPhotoMediaId,
    false
  );
  const teacherImg = await loadImageSafe(resolvedTeacherPhoto);

  const ribbonH = 98;
  const portraitAreaH = stageH - ribbonH + 14;

  if (teacherImg) {
    if (settings.teacherPhotoIsCutout) {
      // Prominent bottom-anchored cutout floating cleanly over the purple chemistry halo
      const maxDrawW = stageW - 22;
      const maxDrawH = portraitAreaH - 18;
      const scale = Math.min(maxDrawW / teacherImg.width, maxDrawH / teacherImg.height);
      const drawW = teacherImg.width * scale;
      const drawH = teacherImg.height * scale;
      const dx = stageX + (stageW - drawW) / 2;
      const dy = stageY + portraitAreaH - drawH;
      ctx.save();
      ctx.shadowColor = 'rgba(26, 9, 64, 0.38)';
      ctx.shadowBlur = 22;
      ctx.shadowOffsetY = 6;
      ctx.drawImage(teacherImg, dx, dy, drawW, drawH);
      ctx.restore();
    } else {
      // Standard full-frame portrait inside clean rounded white-rimmed inset
      const pad = 22;
      const fx = stageX + pad;
      const fy = stageY + pad;
      const fw = stageW - pad * 2;
      const fh = portraitAreaH - pad - 18;
      ctx.save();
      drawRoundedRect(ctx, fx, fy, fw, fh, 18);
      ctx.clip();
      const scale = Math.max(fw / teacherImg.width, fh / teacherImg.height);
      const drawW = teacherImg.width * scale;
      const drawH = teacherImg.height * scale;
      ctx.drawImage(
        teacherImg,
        fx + (fw - drawW) / 2,
        fy + (fh - drawH) / 2,
        drawW,
        drawH
      );
      ctx.restore();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.lineWidth = 3.5;
      drawRoundedRect(ctx, fx, fy, fw, fh, 18);
      ctx.stroke();
    }
  } else {
    // Clean chemistry emblem placeholder when no teacher photo has been uploaded
    drawMoleculeEmblem(
      ctx,
      stageX + stageW / 2,
      stageY + portraitAreaH / 2 - 22,
      58,
      '#FFFFFF',
      '#DDD6FE',
      '#FFFFFF'
    );
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 18px "Outfit", sans-serif';
    ctx.fillText('TEACHER PORTRAIT', stageX + stageW / 2, stageY + portraitAreaH - 68);
    ctx.fillStyle = '#DDD6FE';
    ctx.font = '500 14px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('Upload via Admin Studio', stageX + stageW / 2, stageY + portraitAreaH - 42);
    ctx.textAlign = 'left';
  }

  // Bottom Nameplate Ribbon on Left Stage
  const ribbonY = stageY + stageH - ribbonH;
  ctx.fillStyle = 'rgba(24, 16, 48, 0.88)';
  ctx.fillRect(stageX, ribbonY, stageW, ribbonH);
  ctx.fillStyle = '#A78BFA';
  ctx.fillRect(stageX, ribbonY, stageW, 3);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 24px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.fillText(
    truncateText(ctx, (settings.teacherName || 'SONU SIR #BABA').toUpperCase(), stageW - 28),
    stageX + stageW / 2,
    ribbonY + 42
  );
  ctx.fillStyle = '#DDD6FE';
  ctx.font = '600 16px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(
    truncateText(ctx, (settings.teacherDesignation || 'Chemistry Teacher').trim(), stageW - 28),
    stageX + stageW / 2,
    ribbonY + 72
  );
  ctx.textAlign = 'left';
  ctx.restore();

  // Crisp subtle violet border around left portrait stage
  ctx.strokeStyle = '#C4B5FD';
  ctx.lineWidth = 2.5;
  drawRoundedRect(ctx, stageX, stageY, stageW, stageH, 24);
  ctx.stroke();

  // ---------------- RIGHT PROFILE, CONTACT & MOTIVATIONAL COLUMN ----------------
  const infoX = 448;
  const infoW = W - infoX - 42; // ~858 px
  let y = 178;

  // Teacher Name (Prominent)
  ctx.fillStyle = '#111827';
  ctx.font = '800 40px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.fillText(truncateText(ctx, settings.teacherName || 'SONU SIR #BABA', infoW), infoX, y);
  y += 20;

  // Designation + Specialization / Experience line
  const designation = (settings.teacherDesignation || 'Chemistry Teacher').trim();
  const spec = (settings.teacherSpecialization || '').trim();
  const exp = (settings.teacherExperience || '').trim();
  const subtitleParts = [designation, spec, exp].filter(Boolean);

  ctx.fillStyle = '#6D28D9';
  ctx.font = '700 19px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(truncateText(ctx, subtitleParts.join('  ·  '), infoW), infoX, y + 18);
  y += 38;

  // Violet Accent Divider
  ctx.strokeStyle = '#EDE9FE';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(infoX, y);
  ctx.lineTo(infoX + infoW, y);
  ctx.stroke();
  y += 26;

  // Short Teacher Introduction (Bio)
  const bio = (settings.teacherBio || '').trim();
  if (bio) {
    ctx.fillStyle = '#374151';
    ctx.font = '500 19px "Plus Jakarta Sans", sans-serif';
    const bioLines = wrapParagraphs(ctx, bio, infoW, 4);
    bioLines.forEach((line) => {
      if (line === '') {
        y += 10;
      } else {
        ctx.fillText(line, infoX, y);
        y += 27;
      }
    });
    y += 10;
  } else {
    ctx.fillStyle = '#4B5563';
    ctx.font = '500 19px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(
      truncateText(
        ctx,
        `${settings.instituteName || 'THE ZONE OF CHEMISTRY'} · ${
          settings.tagline || 'Learn Chemistry – Build Your Future.'
        }`,
        infoW
      ),
      infoX,
      y
    );
    y += 38;
  }

  // Verified Contact Strip (ONLY admin-entered verified values — never invented!)
  const verifiedContacts: { label: string; value: string }[] = [];
  if (settings.teacherContactNumber?.trim()) {
    verifiedContacts.push({ label: 'PHONE', value: settings.teacherContactNumber.trim() });
  }
  if (settings.teacherWhatsappNumber?.trim()) {
    verifiedContacts.push({ label: 'WHATSAPP', value: settings.teacherWhatsappNumber.trim() });
  }
  if (settings.teacherEmail?.trim()) {
    verifiedContacts.push({ label: 'EMAIL', value: settings.teacherEmail.trim() });
  }

  if (verifiedContacts.length > 0) {
    const contactTop = Math.max(y + 2, 356);
    const contactH = 74;
    drawRoundedRect(ctx, infoX, contactTop, infoW, contactH, 16);
    ctx.fillStyle = '#F9FAFB';
    ctx.fill();
    ctx.strokeStyle = '#E5E7EB';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const slotW = infoW / verifiedContacts.length;
    verifiedContacts.forEach((item, idx) => {
      const sx = infoX + idx * slotW + 18;
      if (idx > 0) {
        ctx.strokeStyle = '#E5E7EB';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(infoX + idx * slotW, contactTop + 14);
        ctx.lineTo(infoX + idx * slotW, contactTop + contactH - 14);
        ctx.stroke();
      }
      ctx.fillStyle = '#6D28D9';
      ctx.font = '700 13px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(item.label, sx, contactTop + 28);
      ctx.fillStyle = '#111827';
      ctx.font = '600 17px "JetBrains Mono", monospace';
      ctx.fillText(truncateText(ctx, item.value, slotW - 28), sx, contactTop + 55);
    });
    y = contactTop + contactH + 20;
  } else {
    y = Math.max(y + 12, 392);
  }

  // ---------------- MOTIVATIONAL MESSAGE CARD (Right Lower Zone) ----------------
  const msgBoxY = Math.min(Math.max(y, 434), 480);
  const msgBoxH = 730 - msgBoxY;

  drawRoundedRect(ctx, infoX, msgBoxY, infoW, msgBoxH, 20);
  ctx.fillStyle = '#F5F3FF';
  ctx.fill();
  ctx.strokeStyle = '#DDD6FE';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Left vertical purple accent bar inside message card
  ctx.save();
  drawRoundedRect(ctx, infoX + 16, msgBoxY + 20, 7, msgBoxH - 40, 4);
  ctx.fillStyle = '#7C3AED';
  ctx.fill();
  ctx.restore();

  const motivationalText =
    (settings.idCardMotivationalMessage || '').trim() || DEFAULT_ID_CARD_MOTIVATIONAL_MESSAGE;

  ctx.fillStyle = '#6D28D9';
  ctx.font = '700 14px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('MESSAGE FOR STUDENTS', infoX + 42, msgBoxY + 36);

  ctx.fillStyle = '#1F2937';
  ctx.font = '600 20px "Plus Jakarta Sans", sans-serif';
  const maxMsgLines = Math.max(3, Math.floor((msgBoxH - 58) / 28));
  const msgLines = wrapParagraphs(ctx, motivationalText, infoW - 76, maxMsgLines);
  let msgY = msgBoxY + 68;
  msgLines.forEach((line) => {
    if (line === '') {
      msgY += 12;
    } else {
      ctx.fillText(line, infoX + 42, msgY);
      msgY += 27;
    }
  });

  // ---------------- BOTTOM FOOTER BRANDING ----------------
  const footerY = H - 96;
  ctx.save();
  drawRoundedRect(ctx, 16, footerY, W - 32, 80, 24);
  ctx.fillStyle = '#111827';
  ctx.fill();
  ctx.fillRect(16, footerY, W - 32, 24);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 22px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.fillText(
    (settings.instituteName || 'THE ZONE OF CHEMISTRY').toUpperCase(),
    W / 2,
    footerY + 34
  );

  ctx.fillStyle = '#C4B5FD';
  ctx.font = '700 16px "JetBrains Mono", monospace';
  ctx.fillText('LEARN  •  PRACTICE  •  SUCCEED', W / 2, footerY + 62);
  ctx.textAlign = 'left';

  return canvas.toDataURL('image/png', 1.0);
}

// Backward-compatible alias for front side
export async function renderIdCardDataUrl(
  student: StudentRecord,
  settings: InstituteSettings
): Promise<string> {
  return renderIdCardFrontDataUrl(student, settings);
}

export async function renderIdCardBothSidesDataUrls(
  student: StudentRecord,
  settings: InstituteSettings
): Promise<{ frontUrl: string; backUrl: string }> {
  const [frontUrl, backUrl] = await Promise.all([
    renderIdCardFrontDataUrl(student, settings),
    renderIdCardBackDataUrl(settings),
  ]);
  return { frontUrl, backUrl };
}

export async function downloadIdCardPng(
  student: StudentRecord,
  settings: InstituteSettings,
  side: 'front' | 'back' = 'front'
): Promise<void> {
  const dataUrl =
    side === 'front'
      ? await renderIdCardFrontDataUrl(student, settings)
      : await renderIdCardBackDataUrl(settings);
  const link = document.createElement('a');
  const safeName = student.studentName.replace(/\s+/g, '_');
  link.download = `${student.studentId}_${safeName}_ID_Card_${side.toUpperCase()}.png`;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function drawCropMarks(pdf: jsPDF, x: number, y: number, w: number, h: number) {
  const len = 3.5;
  const gap = 1.2;
  pdf.setDrawColor(156, 163, 175);
  pdf.setLineWidth(0.2);

  // Top-left
  pdf.line(x - gap - len, y, x - gap, y);
  pdf.line(x, y - gap - len, x, y - gap);
  // Top-right
  pdf.line(x + w + gap, y, x + w + gap + len, y);
  pdf.line(x + w, y - gap - len, x + w, y - gap);
  // Bottom-left
  pdf.line(x - gap - len, y + h, x - gap, y + h);
  pdf.line(x, y + h + gap, x, y + h + gap + len);
  // Bottom-right
  pdf.line(x + w + gap, y + h, x + w + gap + len, y + h);
  pdf.line(x + w, y + h + gap, x + w, y + h + gap + len);
}

/**
 * Generates a high-resolution, duplex-aligned 2-page Double-Sided Student ID Card PDF.
 * - Exact CR80 card size: 85.60 mm × 53.98 mm on BOTH pages.
 * - Symmetric 10 mm margins on a 105.60 mm × 73.98 mm sheet so Front and Back align
 *   identically during double-sided physical printing.
 * - Clearly labels PAGE 1 (FRONT SIDE) and PAGE 2 (BACK SIDE) outside the cut area.
 */
export async function downloadIdCardPdf(
  student: StudentRecord,
  settings: InstituteSettings
): Promise<void> {
  const { frontUrl, backUrl } = await renderIdCardBothSidesDataUrls(student, settings);

  const marginMm = 10;
  const pageW = CR80_WIDTH_MM + marginMm * 2; // 105.60 mm
  const pageH = CR80_HEIGHT_MM + marginMm * 2; // 73.98 mm

  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [pageW, pageH],
    compress: true,
  });

  // PAGE 1: FRONT SIDE
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(6.5);
  pdf.setTextColor(109, 40, 217);
  pdf.text(
    `FRONT SIDE — STUDENT DETAILS (${student.studentId})`,
    pageW / 2,
    6,
    { align: 'center' }
  );
  pdf.addImage(frontUrl, 'PNG', marginMm, marginMm, CR80_WIDTH_MM, CR80_HEIGHT_MM, undefined, 'FAST');
  drawCropMarks(pdf, marginMm, marginMm, CR80_WIDTH_MM, CR80_HEIGHT_MM);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6);
  pdf.setTextColor(107, 114, 128);
  pdf.text(
    `CR80 Standard: 85.60 mm x 53.98 mm  |  Page 1 of 2 (FRONT)  |  Print at 100% Scale`,
    pageW / 2,
    pageH - 4,
    { align: 'center' }
  );

  // PAGE 2: BACK SIDE (Identical centered coordinates for double-sided printing alignment)
  pdf.addPage([pageW, pageH], 'landscape');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(6.5);
  pdf.setTextColor(109, 40, 217);
  pdf.text(
    `BACK SIDE — TEACHER PROFILE (${settings.teacherName || 'SONU SIR #BABA'})`,
    pageW / 2,
    6,
    { align: 'center' }
  );
  pdf.addImage(backUrl, 'PNG', marginMm, marginMm, CR80_WIDTH_MM, CR80_HEIGHT_MM, undefined, 'FAST');
  drawCropMarks(pdf, marginMm, marginMm, CR80_WIDTH_MM, CR80_HEIGHT_MM);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6);
  pdf.setTextColor(107, 114, 128);
  pdf.text(
    `CR80 Standard: 85.60 mm x 53.98 mm  |  Page 2 of 2 (BACK)  |  Print at 100% Scale`,
    pageW / 2,
    pageH - 4,
    { align: 'center' }
  );

  const safeName = student.studentName.replace(/\s+/g, '_');
  pdf.save(`${student.studentId}_${safeName}_DoubleSided_ID_Card.pdf`);
}

export function downloadPaymentReceiptPdf(
  payment: PaymentRecord,
  settings: InstituteSettings,
  totalFee?: number,
  totalPaid?: number
): void {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const dateStr = payment.paidAt?.toDate
    ? payment.paidAt.toDate().toLocaleString('en-IN')
    : new Date().toLocaleString('en-IN');

  // Violet Header Banner
  pdf.setFillColor(109, 40, 217);
  pdf.rect(0, 0, 210, 42, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(19);
  pdf.text(settings.instituteName.toUpperCase(), 16, 18);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor(237, 233, 254);
  pdf.text(`${settings.teacherName} | ${settings.tagline}`, 16, 27);
  pdf.setFontSize(9);
  pdf.text(`${settings.address} | Phone: ${settings.phone}`, 16, 35);

  // Title
  pdf.setTextColor(17, 24, 39);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text('OFFICIAL FEE PAYMENT RECEIPT', 16, 56);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(75, 85, 99);
  pdf.text(`Receipt No: ${payment.receiptNumber}`, 16, 65);
  pdf.text(`Date & Time: ${dateStr}`, 130, 65);

  pdf.setDrawColor(229, 231, 235);
  pdf.line(16, 70, 194, 70);

  const rows: [string, string][] = [
    ['Student Name', payment.studentName],
    ['Student / Application ID', payment.studentId || payment.applicationId || '—'],
    ['Course', payment.course || '—'],
    ['Batch Timing', payment.batch || '—'],
    ['Payment Mode', payment.method],
    ['Reference / Transaction ID', payment.referenceNo || 'Verified at Institute Desk'],
    ['Recorded & Verified By', payment.recordedBy],
    ['Remarks', payment.notes || '—'],
  ];

  let y = 82;
  rows.forEach(([label, value]) => {
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(107, 114, 128);
    pdf.text(label, 16, y);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(17, 24, 39);
    pdf.text(String(value), 78, y);
    y += 10;
  });

  y += 6;
  pdf.setFillColor(245, 243, 255);
  pdf.roundedRect(16, y, 178, 34, 3, 3, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.setTextColor(17, 24, 39);
  pdf.text('Amount Received (INR):', 24, y + 13);
  pdf.setFontSize(16);
  pdf.setTextColor(109, 40, 217);
  pdf.text(`Rs. ${payment.amount.toLocaleString('en-IN')}/-`, 186, y + 13, { align: 'right' });

  if (typeof totalFee === 'number' && typeof totalPaid === 'number') {
    const balance = Math.max(0, totalFee - totalPaid);
    pdf.setFontSize(10);
    pdf.setTextColor(75, 85, 99);
    pdf.text(
      `Total Course Fee: Rs. ${totalFee.toLocaleString('en-IN')}   |   Total Paid: Rs. ${totalPaid.toLocaleString('en-IN')}   |   Balance Due: Rs. ${balance.toLocaleString('en-IN')}`,
      24,
      y + 26
    );
  }

  const sigY = y + 60;
  pdf.setDrawColor(209, 213, 219);
  pdf.line(132, sigY, 192, sigY);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(17, 24, 39);
  pdf.text(settings.signatureText || 'Sonu Sir #Baba', 162, sigY - 4, { align: 'center' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(107, 114, 128);
  pdf.text('Authorized Institute Signature', 162, sigY + 6, { align: 'center' });

  pdf.save(`Receipt_${payment.receiptNumber}_${payment.studentName.replace(/\s+/g, '_')}.pdf`);
}

function escapeCsvCell(value: unknown): string {
  const str = String(value ?? '');
  const guarded = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  if (guarded.includes(',') || guarded.includes('"') || guarded.includes('\n')) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export function exportStudentsCsv(students: StudentRecord[]): void {
  const headers = [
    'Student ID',
    'Security Code',
    'Application No',
    'Student Name',
    'Father Name',
    'Mother Name',
    'Student Mobile',
    'Father Mobile',
    'Class',
    'Stream',
    'Course',
    'Batch',
    'Total Fee',
    'Paid Amount',
    'Balance',
    'Payment Status',
    'ID Status',
    'Academic Session',
  ];

  const rows = students.map((s) => [
    s.studentId,
    s.securityCode,
    s.applicationNumber,
    s.studentName,
    s.fatherName,
    s.motherName || '',
    s.studentMobile,
    s.fatherMobile || '',
    s.studentClass,
    s.stream || '',
    s.course,
    s.batch,
    s.feeAmount,
    s.paidAmount,
    Math.max(0, s.feeAmount - s.paidAmount),
    s.paymentStatus,
    s.status,
    s.academicSession,
  ]);

  const csv = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `THE_ZONE_OF_CHEMISTRY_Students_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportFeeReportCsv(payments: PaymentRecord[]): void {
  const headers = [
    'Receipt Number',
    'Date & Time',
    'Student Name',
    'Student ID',
    'Course',
    'Batch',
    'Amount (INR)',
    'Method',
    'Reference No',
    'Recorded By',
    'Notes',
  ];

  const rows = payments.map((p) => [
    p.receiptNumber,
    p.paidAt?.toDate ? p.paidAt.toDate().toISOString() : '',
    p.studentName,
    p.studentId || p.applicationId || '',
    p.course || '',
    p.batch || '',
    p.amount,
    p.method,
    p.referenceNo || '',
    p.recordedBy,
    p.notes || '',
  ]);

  const csv = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `THE_ZONE_OF_CHEMISTRY_Fee_Report_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
