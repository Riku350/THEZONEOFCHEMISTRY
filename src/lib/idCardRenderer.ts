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

  // Logo Emblem
  drawMoleculeEmblem(ctx, 84, 92, 30, '#FFFFFF', '#DDD6FE', '#FFFFFF');

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
 * BACK SIDE — Teacher Profile & Motivational Message (Exact CR80 85.60 mm × 53.98 mm ratio: 1348×850).
 * Displays ONLY verified, admin-managed teacher information and admin-uploaded teacher photograph.
 * Never uses a stock/random person photograph or invented phone/email/qualifications.
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

  // Subtle molecular watermark in top-right
  ctx.save();
  ctx.strokeStyle = 'rgba(124, 58, 237, 0.05)';
  ctx.lineWidth = 2;
  drawHexagon(ctx, W - 150, 210, 92);
  drawHexagon(ctx, W - 290, 290, 62);
  ctx.restore();

  // Outer CR80 Border
  ctx.strokeStyle = '#D1D5DB';
  ctx.lineWidth = 3;
  drawRoundedRect(ctx, 14, 14, W - 28, H - 28, 28);
  ctx.stroke();

  // Top Purple Accent Header Bar: MEET YOUR TEACHER
  ctx.save();
  drawRoundedRect(ctx, 16, 16, W - 32, 102, 26);
  ctx.fillStyle = '#6D28D9';
  ctx.fill();
  ctx.fillRect(16, 86, W - 32, 32);
  ctx.restore();

  ctx.fillStyle = '#A78BFA';
  ctx.fillRect(16, 118, W - 32, 4);

  drawMoleculeEmblem(ctx, 74, 67, 22, '#FFFFFF', '#DDD6FE', '#FFFFFF');

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 32px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.fillText('MEET YOUR TEACHER', 118, 78);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#EDE9FE';
  ctx.font = '700 15px "JetBrains Mono", monospace';
  ctx.fillText('OFFICIAL MENTOR PROFILE', W - 48, 74);
  ctx.textAlign = 'left';

  // ---------------- TEACHER PHOTOGRAPH AREA (Left) ----------------
  const photoX = 50;
  const photoY = 152;
  const photoW = 246;
  const photoH = 296;

  ctx.save();
  drawRoundedRect(ctx, photoX, photoY, photoW, photoH, 20);
  ctx.fillStyle = '#F5F3FF';
  ctx.fill();
  ctx.strokeStyle = '#C4B5FD';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.clip();

  // ONLY render teacher photo uploaded & managed from Admin Panel (never a stock person!)
  const resolvedTeacherPhoto = await resolveMediaSource(
    settings.teacherPhotoUrl,
    settings.teacherPhotoMediaId,
    false
  );
  const teacherImg = await loadImageSafe(resolvedTeacherPhoto);

  if (teacherImg) {
    const scale = Math.max(photoW / teacherImg.width, photoH / teacherImg.height);
    const drawW = teacherImg.width * scale;
    const drawH = teacherImg.height * scale;
    const dx = photoX + (photoW - drawW) / 2;
    const dy = photoY + (photoH - drawH) / 2;
    ctx.drawImage(teacherImg, dx, dy, drawW, drawH);
  } else {
    // Clean geometric chemistry emblem placeholder — never a stock/random person!
    ctx.fillStyle = '#F5F3FF';
    ctx.fillRect(photoX, photoY, photoW, photoH);
    drawMoleculeEmblem(
      ctx,
      photoX + photoW / 2,
      photoY + photoH / 2 - 22,
      46,
      '#7C3AED',
      '#A78BFA',
      '#6D28D9'
    );
    ctx.textAlign = 'center';
    ctx.fillStyle = '#6D28D9';
    ctx.font = '700 16px "Outfit", sans-serif';
    ctx.fillText('TEACHER PHOTO', photoX + photoW / 2, photoY + photoH - 54);
    ctx.fillStyle = '#6B7280';
    ctx.font = '500 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('Managed via Admin Panel', photoX + photoW / 2, photoY + photoH - 30);
    ctx.textAlign = 'left';
  }
  ctx.restore();

  // ---------------- VERIFIED TEACHER PROFILE DETAILS (Right) ----------------
  const infoX = 332;
  const infoW = W - infoX - 50; // ~966 px
  let y = 186;

  // Teacher Name
  ctx.fillStyle = '#111827';
  ctx.font = '700 38px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.fillText(truncateText(ctx, settings.teacherName || 'SONU SIR #BABA', infoW), infoX, y);
  y += 30;

  // Verified Specialization & Experience line (ONLY render fields entered by Admin)
  const spec = (settings.teacherSpecialization || '').trim();
  const exp = (settings.teacherExperience || '').trim();
  const metaParts = [spec, exp].filter(Boolean);
  if (metaParts.length > 0) {
    ctx.fillStyle = '#6D28D9';
    ctx.font = '700 19px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(truncateText(ctx, metaParts.join('  ·  '), infoW), infoX, y + 6);
    y += 34;
  } else {
    y += 10;
  }

  // Divider line
  ctx.strokeStyle = '#EDE9FE';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(infoX, y);
  ctx.lineTo(infoX + infoW, y);
  ctx.stroke();
  y += 26;

  // Short Biography (ONLY render if Admin entered one)
  const bio = (settings.teacherBio || '').trim();
  if (bio) {
    ctx.fillStyle = '#374151';
    ctx.font = '500 19px "Plus Jakarta Sans", sans-serif';
    const bioLines = wrapParagraphs(ctx, bio, infoW, 4);
    bioLines.forEach((line) => {
      if (line === '') {
        y += 12;
      } else {
        ctx.fillText(line, infoX, y);
        y += 27;
      }
    });
    y += 8;
  } else {
    ctx.fillStyle = '#6B7280';
    ctx.font = '500 18px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(
      truncateText(
        ctx,
        `${settings.instituteName || 'THE ZONE OF CHEMISTRY'} · ${settings.tagline || 'Learn Chemistry – Build Your Future.'}`,
        infoW
      ),
      infoX,
      y
    );
    y += 34;
  }

  // Verified Contact Details (ONLY display admin-entered verified contact fields — NEVER invented!)
  const verifiedContacts: { label: string; value: string }[] = [];
  if (settings.teacherContactNumber?.trim()) {
    verifiedContacts.push({ label: 'CALL', value: settings.teacherContactNumber.trim() });
  }
  if (settings.teacherWhatsappNumber?.trim()) {
    verifiedContacts.push({ label: 'WHATSAPP', value: settings.teacherWhatsappNumber.trim() });
  }
  if (settings.teacherEmail?.trim()) {
    verifiedContacts.push({ label: 'EMAIL', value: settings.teacherEmail.trim() });
  }

  if (verifiedContacts.length > 0) {
    const contactTop = Math.max(y + 4, 376);
    drawRoundedRect(ctx, infoX, contactTop, infoW, 72, 14);
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
        ctx.lineTo(infoX + idx * slotW, contactTop + 58);
        ctx.stroke();
      }
      ctx.fillStyle = '#6D28D9';
      ctx.font = '700 13px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(item.label, sx, contactTop + 28);
      ctx.fillStyle = '#111827';
      ctx.font = '600 18px "JetBrains Mono", monospace';
      ctx.fillText(truncateText(ctx, item.value, slotW - 30), sx, contactTop + 54);
    });
  }

  // ---------------- MOTIVATIONAL MESSAGE CARD (Lower Half) ----------------
  const msgBoxX = 50;
  const msgBoxY = 474;
  const msgBoxW = W - 100;
  const msgBoxH = 250;

  drawRoundedRect(ctx, msgBoxX, msgBoxY, msgBoxW, msgBoxH, 20);
  ctx.fillStyle = '#F5F3FF';
  ctx.fill();
  ctx.strokeStyle = '#DDD6FE';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Left vertical purple accent bar inside message card
  ctx.save();
  drawRoundedRect(ctx, msgBoxX + 18, msgBoxY + 22, 7, msgBoxH - 44, 4);
  ctx.fillStyle = '#7C3AED';
  ctx.fill();
  ctx.restore();

  const motivationalText =
    (settings.idCardMotivationalMessage || '').trim() || DEFAULT_ID_CARD_MOTIVATIONAL_MESSAGE;

  ctx.fillStyle = '#6D28D9';
  ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('MESSAGE FOR STUDENTS', msgBoxX + 46, msgBoxY + 38);

  ctx.fillStyle = '#1F2937';
  ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
  const msgLines = wrapParagraphs(ctx, motivationalText, msgBoxW - 92, 7);
  let msgY = msgBoxY + 74;
  msgLines.forEach((line) => {
    if (line === '') {
      msgY += 14;
    } else {
      ctx.fillText(line, msgBoxX + 46, msgY);
      msgY += 30;
    }
  });

  // ---------------- BOTTOM FOOTER BRANDING ----------------
  const footerY = H - 104;
  ctx.save();
  drawRoundedRect(ctx, 16, footerY, W - 32, 88, 24);
  ctx.fillStyle = '#111827';
  ctx.fill();
  // Square top corners of footer strip
  ctx.fillRect(16, footerY, W - 32, 24);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 24px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.fillText(
    (settings.instituteName || 'THE ZONE OF CHEMISTRY').toUpperCase(),
    W / 2,
    footerY + 38
  );

  ctx.fillStyle = '#C4B5FD';
  ctx.font = '700 17px "JetBrains Mono", monospace';
  ctx.fillText('LEARN  •  PRACTICE  •  SUCCEED', W / 2, footerY + 68);
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
