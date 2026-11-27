import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { InstituteSettings, PaymentRecord, StudentRecord } from '../types';
import { resolveMediaSource } from './media';

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

/**
 * Renders a premium pure-white horizontal Digital Student ID Card (1200x750, 300 DPI)
 * with clean purple & violet institute branding, clear student photograph, and scannable QR code.
 */
export async function renderIdCardDataUrl(
  student: StudentRecord,
  settings: InstituteSettings
): Promise<string> {
  const W = 1200;
  const H = 750;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');

  // Pure White Canvas
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // Very subtle pale violet molecular geometry watermark on right
  ctx.save();
  ctx.strokeStyle = 'rgba(124, 58, 237, 0.06)';
  ctx.lineWidth = 2;
  drawHexagon(ctx, W - 260, H - 220, 110);
  drawHexagon(ctx, W - 115, H - 135, 76);
  drawHexagon(ctx, W - 405, H - 135, 62);
  ctx.restore();

  // Outer card frame border
  ctx.strokeStyle = '#E5E7EB';
  ctx.lineWidth = 4;
  drawRoundedRect(ctx, 18, 18, W - 36, H - 36, 28);
  ctx.stroke();

  // Solid Purple / Violet Header Bar
  ctx.save();
  drawRoundedRect(ctx, 20, 20, W - 40, 146, 26);
  ctx.fillStyle = '#6D28D9';
  ctx.fill();
  // Square off bottom corners of header band cleanly
  ctx.fillRect(20, 134, W - 40, 32);
  ctx.restore();

  // Simple Minimalist Molecular Logo Mark in Header
  ctx.save();
  ctx.translate(88, 93);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 3;
  drawHexagon(ctx, 0, 0, 30);
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, Math.PI * 2);
  ctx.strokeStyle = '#DDD6FE';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  for (let i = 0; i < 3; i++) {
    const a = (Math.PI * 2 * i) / 3 - Math.PI / 6;
    ctx.beginPath();
    ctx.arc(30 * Math.cos(a), 30 * Math.sin(a), 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Institute Name & Teacher
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 36px "Outfit", sans-serif';
  ctx.fillText(settings.instituteName.toUpperCase(), 144, 84);

  ctx.fillStyle = '#EDE9FE';
  ctx.font = '500 20px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`${settings.teacherName}  ·  ${settings.tagline}`, 144, 122);

  // Right side of Header: Student ID Tag & Session
  ctx.textAlign = 'right';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 17px "JetBrains Mono", monospace';
  ctx.fillText('STUDENT IDENTITY CARD', W - 54, 82);
  ctx.fillStyle = '#DDD6FE';
  ctx.font = '500 16px "JetBrains Mono", monospace';
  ctx.fillText(`SESSION ${student.academicSession || settings.academicSession}`, W - 54, 114);
  ctx.textAlign = 'left';

  // Left Column: Student Photograph
  const photoX = 56;
  const photoY = 204;
  const photoW = 242;
  const photoH = 298;

  ctx.save();
  drawRoundedRect(ctx, photoX, photoY, photoW, photoH, 20);
  ctx.fillStyle = '#F9FAFB';
  ctx.fill();
  ctx.strokeStyle = '#DDD6FE';
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
    ctx.fillStyle = '#7C3AED';
    ctx.font = '700 62px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    const initials = student.studentName
      .split(' ')
      .map((s) => s[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    ctx.fillText(initials || 'ST', photoX + photoW / 2, photoY + photoH / 2 + 20);
    ctx.textAlign = 'left';
  }
  ctx.restore();

  // 4-Digit Security Code Box beneath Photo
  const secY = photoY + photoH + 22;
  drawRoundedRect(ctx, photoX, secY, photoW, 92, 16);
  ctx.fillStyle = '#F5F3FF';
  ctx.fill();
  ctx.strokeStyle = '#DDD6FE';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#6D28D9';
  ctx.font = '600 14px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SECURITY CODE', photoX + photoW / 2, secY + 30);

  ctx.fillStyle = '#111827';
  ctx.font = '700 36px "JetBrains Mono", monospace';
  ctx.fillText(student.securityCode, photoX + photoW / 2, secY + 74);
  ctx.textAlign = 'left';

  // Center Column: Crisp Black & Dark Grey Student Details
  const infoX = 338;
  let infoY = 236;

  ctx.fillStyle = '#7C3AED';
  ctx.font = '600 14px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('STUDENT NAME', infoX, infoY);

  ctx.fillStyle = '#111827';
  ctx.font = '700 34px "Outfit", sans-serif';
  ctx.fillText(student.studentName.slice(0, 26), infoX, infoY + 38);

  infoY += 76;

  const drawField = (label: string, value: string, x: number, y: number) => {
    ctx.fillStyle = '#6B7280';
    ctx.font = '600 14px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(label, x, y);
    ctx.fillStyle = '#111827';
    ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(value || '—', x, y + 29);
  };

  drawField("FATHER'S NAME", student.fatherName.slice(0, 28), infoX, infoY);
  infoY += 68;

  drawField('STUDENT ID', student.studentId, infoX, infoY);
  drawField('CLASS', student.studentClass, infoX + 270, infoY);
  infoY += 68;

  drawField('COURSE', student.course.slice(0, 26), infoX, infoY);
  infoY += 68;

  drawField('BATCH TIMING', student.batch, infoX, infoY);
  drawField('MOBILE NO.', student.studentMobile, infoX + 270, infoY);

  // Right Column: Clean Bordered QR Code Panel
  const qrBoxX = 900;
  const qrBoxY = 204;
  const qrBoxW = 244;
  const qrBoxH = 294;

  drawRoundedRect(ctx, qrBoxX, qrBoxY, qrBoxW, qrBoxH, 20);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = '#E5E7EB';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  const qrPayload = student.qrToken || `ZOC:${student.studentId}`;
  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    width: 440,
    margin: 1,
    color: { dark: '#111827', light: '#FFFFFF' },
    errorCorrectionLevel: 'H',
  });
  const qrImg = await loadImageSafe(qrDataUrl);
  if (qrImg) {
    ctx.drawImage(qrImg, qrBoxX + 18, qrBoxY + 18, 208, 208);
  }

  ctx.fillStyle = '#6D28D9';
  ctx.font = '700 14px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('SCAN TO VERIFY', qrBoxX + qrBoxW / 2, qrBoxY + 252);
  ctx.fillStyle = '#6B7280';
  ctx.font = '500 13px "JetBrains Mono", monospace';
  ctx.fillText(student.studentId, qrBoxX + qrBoxW / 2, qrBoxY + 276);
  ctx.textAlign = 'left';

  // Authorized Signature beneath QR
  const sigY = qrBoxY + qrBoxH + 26;
  ctx.fillStyle = '#1F2937';
  ctx.font = 'italic 600 28px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(settings.signatureText || 'Sonu Sir #Baba', qrBoxX + qrBoxW / 2, sigY + 34);

  ctx.strokeStyle = '#D1D5DB';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(qrBoxX + 18, sigY + 48);
  ctx.lineTo(qrBoxX + qrBoxW - 18, sigY + 48);
  ctx.stroke();

  ctx.fillStyle = '#6B7280';
  ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('AUTHORIZED SIGNATURE', qrBoxX + qrBoxW / 2, sigY + 70);
  ctx.textAlign = 'left';

  // Clean Footer Strip
  ctx.strokeStyle = '#E5E7EB';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(56, H - 72);
  ctx.lineTo(W - 56, H - 72);
  ctx.stroke();

  ctx.fillStyle = '#6B7280';
  ctx.font = '500 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`${settings.address.slice(0, 72)}  ·  ${settings.phone}`, 56, H - 40);

  ctx.textAlign = 'right';
  ctx.fillStyle = student.status === 'active' ? '#15803D' : '#DC2626';
  ctx.font = '700 15px "JetBrains Mono", monospace';
  ctx.fillText(
    student.status === 'active' ? 'STATUS: VERIFIED ACTIVE' : 'STATUS: SUSPENDED',
    W - 56,
    H - 40
  );
  ctx.textAlign = 'left';

  return canvas.toDataURL('image/png', 1.0);
}

export async function downloadIdCardPng(
  student: StudentRecord,
  settings: InstituteSettings
): Promise<void> {
  const dataUrl = await renderIdCardDataUrl(student, settings);
  const link = document.createElement('a');
  link.download = `${student.studentId}_${student.studentName.replace(/\s+/g, '_')}_ID_Card.png`;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function downloadIdCardPdf(
  student: StudentRecord,
  settings: InstituteSettings
): Promise<void> {
  const dataUrl = await renderIdCardDataUrl(student, settings);
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [148, 105],
  });
  const cardW = 128;
  const cardH = 80;
  const x = (148 - cardW) / 2;
  const y = (105 - cardH) / 2;
  pdf.addImage(dataUrl, 'PNG', x, y, cardW, cardH);
  pdf.save(`${student.studentId}_${student.studentName.replace(/\s+/g, '_')}_ID_Card.pdf`);
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
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
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
