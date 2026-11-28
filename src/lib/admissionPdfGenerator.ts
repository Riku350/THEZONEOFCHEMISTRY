import { jsPDF } from 'jspdf';
import { AdmissionApplication, InstituteSettings, StudentRecord } from '../types';
import { resolveMediaSource } from './media';

export async function generateAdmissionFormPdf(
  app: AdmissionApplication | StudentRecord,
  settings: InstituteSettings
): Promise<void> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // 1. Load Teacher Portrait Background & Institute Logo
  const teacherBgUrl = settings.teacherPhotoOriginalUrl || settings.teacherPhotoUrl || '';
  let bgImgData: string | null = null;
  if (teacherBgUrl || settings.teacherPhotoOriginalMediaId || settings.teacherPhotoMediaId) {
    try {
      const resolved = await resolveMediaSource(
        teacherBgUrl,
        settings.teacherPhotoOriginalMediaId || settings.teacherPhotoMediaId,
        false
      );
      if (resolved) {
        const resp = await fetch(resolved);
        const blob = await resp.blob();
        bgImgData = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      }
    } catch {
      // Ignore background image load failures
    }
  }

  // Draw background image if available
  if (bgImgData) {
    try {
      doc.addImage(bgImgData, 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
    } catch {
      // Fallback if image format fails
    }
  } else {
    doc.setFillColor(248, 246, 255);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');
  }

  // 2. Translucent White Overlay for readability over teacher portrait
  doc.setFillColor(255, 255, 255);
  doc.setGState(new (doc as any).GState({ opacity: 0.93 }));
  doc.rect(10, 10, pageWidth - 20, pageHeight - 20, 'F');
  doc.setGState(new (doc as any).GState({ opacity: 1.0 }));

  // Border frame
  doc.setDrawColor(124, 58, 237); // violet-600
  doc.setLineWidth(0.6);
  doc.roundedRect(10, 10, pageWidth - 20, pageHeight - 20, 3, 3, 'S');

  // 3. Header Section
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(76, 29, 149); // violet-900
  doc.text((settings.instituteName || 'THE ZONE OF CHEMISTRY').toUpperCase(), pageWidth / 2, 22, {
    align: 'center',
  });

  doc.setFontSize(10);
  doc.setFont('Helvetica', 'normal');
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text(
    `Teacher & Director: ${settings.teacherName || 'SONU SIR #BABA'} | Ph: ${settings.phone || '+91 6299475970'}`,
    pageWidth / 2,
    28,
    { align: 'center' }
  );

  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(30, 41, 59);
  doc.text('OFFICIAL ADMISSION FORM & ENROLLMENT RECORD', pageWidth / 2, 36, { align: 'center' });

  // Divider line
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(18, 40, pageWidth - 18, 40);

  // 4. Student Photo & Key Details Summary Box
  const studentPhotoUrl = app.photoUrl || '';
  let studentPhotoData: string | null = null;
  if (studentPhotoUrl || app.photoMediaId) {
    try {
      const resolved = await resolveMediaSource(studentPhotoUrl, app.photoMediaId, true);
      if (resolved) {
        const resp = await fetch(resolved);
        const blob = await resp.blob();
        studentPhotoData = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      }
    } catch {
      // Ignore student photo load failures
    }
  }

  // Draw Student Photo Box (top right)
  const photoX = pageWidth - 42;
  const photoY = 45;
  const photoW = 24;
  const photoH = 30;
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(photoX, photoY, photoW, photoH, 2, 2, 'F');
  if (studentPhotoData) {
    try {
      doc.addImage(studentPhotoData, 'JPEG', photoX, photoY, photoW, photoH);
    } catch {
      // fallback
    }
  }
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(photoX, photoY, photoW, photoH, 2, 2, 'S');

  // Application / ID Meta info (top left)
  doc.setFontSize(10);
  doc.setFont('Helvetica', 'bold');
  doc.setTextColor(76, 29, 149);
  const appNo =
    ('applicationNumber' in app ? app.applicationNumber : '') ||
    (app as any).applicationNumber ||
    'ZOC-APP';
  const studentId = ('studentId' in app ? app.studentId : '') || 'Pending Approval';
  doc.text(`Application Number: ${appNo}`, 18, 48);
  doc.text(`Student ID: ${studentId}`, 18, 54);
  doc.text(
    `Academic Session: ${('academicSession' in app ? app.academicSession : '') || settings.academicSession}`,
    18,
    60
  );
  doc.text(`Status: ${('status' in app ? app.status : 'pending').toUpperCase()}`, 18, 66);

  // 5. Section: Personal Information
  let curY = 82;
  doc.setFillColor(248, 245, 255);
  doc.roundedRect(16, curY, pageWidth - 32, 8, 1, 1, 'F');
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(76, 29, 149);
  doc.text('1. STUDENT PERSONAL INFORMATION', 20, curY + 5.5);

  curY += 12;
  doc.setFontSize(10);
  doc.setFont('Helvetica', 'normal');
  doc.setTextColor(51, 65, 85);

  const leftColX = 20;
  const rightColX = 110;

  const rows1 = [
    ['Full Student Name:', app.studentName || '—'],
    ['Gender:', app.gender || '—'],
    ['Student Mobile:', app.studentMobile || '—'],
    ['Student WhatsApp:', app.studentWhatsapp || '—'],
    ["Father's Name:", app.fatherName || '—'],
    ["Father's Mobile:", app.fatherMobile || '—'],
    ["Mother's Name:", app.motherName || '—'],
    ["Mother's Mobile:", app.motherMobile || '—'],
  ];

  for (let i = 0; i < rows1.length; i += 2) {
    const r1 = rows1[i];
    const r2 = rows1[i + 1];

    doc.setFont('Helvetica', 'bold');
    doc.text(r1[0], leftColX, curY);
    doc.setFont('Helvetica', 'normal');
    doc.text(r1[1], leftColX + 38, curY);

    if (r2) {
      doc.setFont('Helvetica', 'bold');
      doc.text(r2[0], rightColX, curY);
      doc.setFont('Helvetica', 'normal');
      doc.text(r2[1], rightColX + 38, curY);
    }
    curY += 7;
  }

  // 6. Section: Academic & Course Selection
  curY += 4;
  doc.setFillColor(248, 245, 255);
  doc.roundedRect(16, curY, pageWidth - 32, 8, 1, 1, 'F');
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(76, 29, 149);
  doc.text('2. ACADEMIC & BATCH SELECTION', 20, curY + 5.5);

  curY += 12;
  doc.setFontSize(10);
  doc.setFont('Helvetica', 'normal');

  const rows2 = [
    ['Class / Level:', app.studentClass || '—'],
    ['Stream:', app.stream || 'Science'],
    ['Course Program:', app.course || '—'],
    ['Batch Timing:', app.batch || '—'],
  ];

  for (let i = 0; i < rows2.length; i += 2) {
    const r1 = rows2[i];
    const r2 = rows2[i + 1];

    doc.setFont('Helvetica', 'bold');
    doc.text(r1[0], leftColX, curY);
    doc.setFont('Helvetica', 'normal');
    doc.text(r1[1], leftColX + 38, curY);

    if (r2) {
      doc.setFont('Helvetica', 'bold');
      doc.text(r2[0], rightColX, curY);
      doc.setFont('Helvetica', 'normal');
      doc.text(r2[1], rightColX + 38, curY);
    }
    curY += 7;
  }

  // 7. Section: Residential Address
  curY += 4;
  doc.setFillColor(248, 245, 255);
  doc.roundedRect(16, curY, pageWidth - 32, 8, 1, 1, 'F');
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(76, 29, 149);
  doc.text('3. RESIDENTIAL ADDRESS', 20, curY + 5.5);

  curY += 12;
  doc.setFontSize(10);
  doc.setFont('Helvetica', 'normal');

  const addressFull = `${app.address || ''}, Vill: ${app.village || ''}, PO: ${app.postOffice || ''}, Dist: ${app.district || ''}, State: ${app.state || 'Bihar'} - ${app.pinCode || ''}`;
  doc.setFont('Helvetica', 'bold');
  doc.text('Address:', leftColX, curY);
  doc.setFont('Helvetica', 'normal');
  const splitAddress = doc.splitTextToSize(addressFull, pageWidth - 60);
  doc.text(splitAddress, leftColX + 38, curY);
  curY += splitAddress.length * 6 + 4;

  // 8. Section: Fee Structure & Payment Summary
  doc.setFillColor(248, 245, 255);
  doc.roundedRect(16, curY, pageWidth - 32, 8, 1, 1, 'F');
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(76, 29, 149);
  doc.text('4. FEE STRUCTURE & PAYMENT SUMMARY', 20, curY + 5.5);

  curY += 12;
  const totalFee = app.feeAmount || 0;
  const paidFee = app.paidAmount || 0;
  const remainingFee = Math.max(0, totalFee - paidFee);

  const rows3 = [
    ['Total Course Fees:', `Rs. ${totalFee.toLocaleString('en-IN')}`],
    ['Total Paid Fees:', `Rs. ${paidFee.toLocaleString('en-IN')}`],
    ['Remaining Balance:', `Rs. ${remainingFee.toLocaleString('en-IN')}`],
    ['Payment Status:', (app.paymentStatus || 'PENDING').toUpperCase()],
  ];

  for (let i = 0; i < rows3.length; i += 2) {
    const r1 = rows3[i];
    const r2 = rows3[i + 1];

    doc.setFont('Helvetica', 'bold');
    doc.text(r1[0], leftColX, curY);
    doc.setFont('Helvetica', 'normal');
    doc.text(r1[1], leftColX + 38, curY);

    if (r2) {
      doc.setFont('Helvetica', 'bold');
      doc.text(r2[0], rightColX, curY);
      doc.setFont('Helvetica', 'normal');
      doc.text(r2[1], rightColX + 38, curY);
    }
    curY += 7;
  }

  // 9. Declaration & Signatures Footer
  curY += 10;
  doc.setFontSize(9);
  doc.setFont('Helvetica', 'italic');
  doc.setTextColor(100, 116, 139);
  doc.text(
    'Declaration: I hereby declare that all information furnished above is true and correct to the best of my knowledge.',
    20,
    curY,
    { maxWidth: pageWidth - 40 }
  );

  curY += 18;
  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);

  // Signatures
  doc.text('Student / Parent Signature', 30, curY);
  doc.setDrawColor(209, 213, 219);
  doc.line(20, curY - 5, 85, curY - 5);

  doc.text('Authorized Signature (Sonu Sir)', pageWidth - 85, curY);
  doc.line(pageWidth - 95, curY - 5, pageWidth - 20, curY - 5);

  // Footer Page Number
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Generated by ${settings.instituteName} Admission Portal — Page 1 of 1`,
    pageWidth / 2,
    pageHeight - 14,
    { align: 'center' }
  );

  // Save PDF
  const safeName = (app.studentName || 'student').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  doc.save(`Admission_Form_${safeName}_${appNo}.pdf`);
}
