import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  DEFAULT_BANNERS,
  DEFAULT_BATCHES,
  DEFAULT_COURSES,
  DEFAULT_GALLERY,
  DEFAULT_NOTICES,
  DEFAULT_SETTINGS,
} from '../config/defaults';
import {
  AdminUserRecord,
  AdmissionApplication,
  ApplicationStatusLookup,
  BannerItem,
  BatchItem,
  CourseItem,
  FeeRule,
  GalleryItem,
  Gender,
  InstituteSettings,
  NoticeCategory,
  NoticeItem,
  PaymentMethod,
  PaymentRecord,
  PaymentStatus,
  ScanHistoryEntry,
  ScanStatusResult,
  StudentClass,
  StudentRecord,
  StudentStream,
} from '../types';
import { db, handleFirestoreError, OperationType, OWNER_ADMIN_EMAIL } from './firebase';
import { uploadMediaSmart } from './media';

export function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 120);
}

export function cleanPhone(raw: string): string {
  return raw.replace(/[^0-9]/g, '').slice(-10);
}

export function generateApplicationNumber(): string {
  const year = new Date().getFullYear();
  const num = Math.floor(10000 + Math.random() * 90000);
  return `ZOC${year}-${num}`;
}

export function generateStudentId(): string {
  const year = new Date().getFullYear();
  const num = Math.floor(1000 + Math.random() * 9000);
  const suffix = Math.floor(10 + Math.random() * 89);
  return `ZOC-${year}-${num}${suffix}`;
}

export function generateReceiptNumber(): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const rand = Math.floor(10000 + Math.random() * 90000);
  return `RCPT-${y}${m}-${rand}`;
}

export function computePaymentStatus(feeAmount: number, paidAmount: number): PaymentStatus {
  if (paidAmount <= 0) return 'PENDING';
  if (paidAmount >= feeAmount) return 'PAID';
  return 'PARTIAL';
}

export function calculateEffectiveFee(
  studentClass: string,
  course: string,
  batch: string,
  courses: CourseItem[],
  batches: BatchItem[],
  feeRules: FeeRule[],
  defaultFee: number
): number {
  // 1. Most specific matching FeeRule (class + course + batch)
  const activeRules = feeRules.filter((r) => r.active);
  const exactAll = activeRules.find(
    (r) =>
      r.course === course &&
      r.batch === batch &&
      (!r.studentClass || r.studentClass === studentClass)
  );
  if (exactAll) return exactAll.amount;

  const exactCourseBatch = activeRules.find(
    (r) => r.course === course && r.batch === batch
  );
  if (exactCourseBatch) return exactCourseBatch.amount;

  const exactClassCourse = activeRules.find(
    (r) => r.studentClass === studentClass && r.course === course && !r.batch
  );
  if (exactClassCourse) return exactClassCourse.amount;

  const exactCourseOnly = activeRules.find(
    (r) => r.course === course && !r.studentClass && !r.batch
  );
  if (exactCourseOnly) return exactCourseOnly.amount;

  const exactClassOnly = activeRules.find(
    (r) => r.studentClass === studentClass && !r.course && !r.batch
  );
  if (exactClassOnly) return exactClassOnly.amount;

  const exactBatchOnly = activeRules.find(
    (r) => r.batch === batch && !r.course && !r.studentClass
  );
  if (exactBatchOnly) return exactBatchOnly.amount;

  // 2. Batch override if configured
  const matchedBatch = batches.find((b) => b.timing === batch || b.name === batch);
  if (matchedBatch && typeof matchedBatch.feeOverride === 'number' && matchedBatch.feeOverride > 0) {
    return matchedBatch.feeOverride;
  }

  // 3. Course fee
  const matchedCourse = courses.find((c) => c.title === course);
  if (matchedCourse && matchedCourse.feeAmount > 0) {
    return matchedCourse.feeAmount;
  }

  return defaultFee || 5500;
}

export interface PublicInstituteData {
  settings: InstituteSettings;
  courses: CourseItem[];
  batches: BatchItem[];
  feeRules: FeeRule[];
  banners: BannerItem[];
  gallery: GalleryItem[];
  notices: NoticeItem[];
}

export async function fetchPublicInstituteData(): Promise<PublicInstituteData> {
  try {
    const [settingsSnap, coursesSnap, batchesSnap, feesSnap, bannersSnap, gallerySnap, noticesSnap] =
      await Promise.all([
        getDoc(doc(db, 'settings', 'main')).catch(() => null),
        getDocs(query(collection(db, 'courses'), where('active', '==', true))).catch(() => null),
        getDocs(query(collection(db, 'batches'), where('active', '==', true))).catch(() => null),
        getDocs(query(collection(db, 'fees'), where('active', '==', true))).catch(() => null),
        getDocs(query(collection(db, 'banners'), where('active', '==', true))).catch(() => null),
        getDocs(query(collection(db, 'gallery'), where('active', '==', true))).catch(() => null),
        getDocs(query(collection(db, 'notices'), where('active', '==', true))).catch(() => null),
      ]);

    const settings: InstituteSettings =
      settingsSnap && settingsSnap.exists()
        ? ({ id: settingsSnap.id, ...settingsSnap.data() } as InstituteSettings)
        : DEFAULT_SETTINGS;

    const courses: CourseItem[] =
      coursesSnap && !coursesSnap.empty
        ? coursesSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as CourseItem)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        : DEFAULT_COURSES;

    const batches: BatchItem[] =
      batchesSnap && !batchesSnap.empty
        ? batchesSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as BatchItem)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        : DEFAULT_BATCHES;

    const feeRules: FeeRule[] =
      feesSnap && !feesSnap.empty
        ? feesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as FeeRule)
        : [];

    const banners: BannerItem[] =
      bannersSnap && !bannersSnap.empty
        ? bannersSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as BannerItem)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        : DEFAULT_BANNERS;

    const gallery: GalleryItem[] =
      gallerySnap && !gallerySnap.empty
        ? gallerySnap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as GalleryItem)
            .sort((a, b) => {
              const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
              const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
              return tb - ta;
            })
        : DEFAULT_GALLERY;

    const notices: NoticeItem[] =
      noticesSnap && !noticesSnap.empty
        ? noticesSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as NoticeItem)
            .sort((a, b) => {
              if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
              const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
              const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
              return tb - ta;
            })
        : DEFAULT_NOTICES;

    return { settings, courses, batches, feeRules, banners, gallery, notices };
  } catch (error) {
    console.error('Error fetching public institute data:', error);
    return {
      settings: DEFAULT_SETTINGS,
      courses: DEFAULT_COURSES,
      batches: DEFAULT_BATCHES,
      feeRules: [],
      banners: DEFAULT_BANNERS,
      gallery: DEFAULT_GALLERY,
      notices: DEFAULT_NOTICES,
    };
  }
}

export interface AdmissionSubmissionInput {
  applicationNumber: string;
  studentName: string;
  studentMobile: string;
  studentWhatsapp: string;
  fatherName: string;
  fatherMobile: string;
  motherName: string;
  motherMobile: string;
  dob: string;
  gender: Gender;
  address: string;
  village: string;
  postOffice: string;
  district: string;
  state: string;
  pinCode: string;
  studentClass: StudentClass;
  stream: StudentStream;
  course: string;
  batch: string;
  feeAmount: number;
  declarationAccepted: boolean;
  photoFile: File;
  idProofFile: File;
  marksheetFile?: File | null;
}

export async function submitAdmissionApplication(
  input: AdmissionSubmissionInput
): Promise<{ applicationNumber: string; trackingKey: string }> {
  const applicationNumber = sanitizeId(input.applicationNumber);
  const cleanedMobile = cleanPhone(input.studentMobile);
  const trackingKey = sanitizeId(`${applicationNumber}_${cleanedMobile}`);

  // Upload private documents first
  const photoUpload = await uploadMediaSmart(input.photoFile, 'student_photos', true, 480);
  const idProofUpload = await uploadMediaSmart(input.idProofFile, 'student_id_proofs', true, 960);
  let marksheetUpload = { url: '', mediaId: '' };
  if (input.marksheetFile) {
    marksheetUpload = await uploadMediaSmart(input.marksheetFile, 'student_marksheets', true, 960);
  }

  const nowTs = serverTimestamp();

  const appDoc: Record<string, unknown> = {
    applicationNumber,
    trackingKey,
    studentName: input.studentName.trim().slice(0, 120),
    studentMobile: cleanedMobile,
    studentWhatsapp: cleanPhone(input.studentWhatsapp || input.studentMobile),
    fatherName: input.fatherName.trim().slice(0, 120),
    fatherMobile: cleanPhone(input.fatherMobile),
    motherName: input.motherName.trim().slice(0, 120),
    motherMobile: cleanPhone(input.motherMobile),
    dob: input.dob.trim().slice(0, 20),
    gender: input.gender,
    address: input.address.trim().slice(0, 400),
    village: input.village.trim().slice(0, 120),
    postOffice: input.postOffice.trim().slice(0, 120),
    district: input.district.trim().slice(0, 120),
    state: input.state.trim().slice(0, 120),
    pinCode: input.pinCode.replace(/[^0-9]/g, '').slice(0, 6),
    studentClass: input.studentClass,
    stream: input.stream,
    course: input.course.trim().slice(0, 100),
    batch: input.batch.trim().slice(0, 80),
    photoUrl: photoUpload.url,
    photoMediaId: photoUpload.mediaId,
    idProofUrl: idProofUpload.url,
    idProofMediaId: idProofUpload.mediaId,
    marksheetUrl: marksheetUpload.url,
    marksheetMediaId: marksheetUpload.mediaId,
    feeAmount: Math.max(0, Math.round(input.feeAmount)),
    paidAmount: 0,
    paymentStatus: 'PENDING',
    status: 'pending',
    declarationAccepted: true,
    studentId: '',
    remarks: '',
    submittedAt: nowTs,
    updatedAt: nowTs,
  };

  const statusDoc: Record<string, unknown> = {
    applicationNumber,
    studentName: input.studentName.trim().slice(0, 120),
    course: input.course.trim().slice(0, 100),
    batch: input.batch.trim().slice(0, 80),
    studentClass: input.studentClass,
    status: 'pending',
    paymentStatus: 'PENDING',
    feeAmount: Math.max(0, Math.round(input.feeAmount)),
    paidAmount: 0,
    studentId: '',
    remarks: 'Submitted successfully. Waiting for admin review.',
    submittedAt: nowTs,
    updatedAt: nowTs,
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'applications', applicationNumber), appDoc);
    batch.set(doc(db, 'applicationStatus', trackingKey), statusDoc);
    await batch.commit();
    return { applicationNumber, trackingKey };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `applications/${applicationNumber}`);
  }
}

export async function trackApplicationStatus(
  applicationNumber: string,
  studentMobile: string
): Promise<ApplicationStatusLookup | null> {
  const cleanAppNo = sanitizeId(applicationNumber.trim().toUpperCase());
  const cleanedMobile = cleanPhone(studentMobile);
  if (!cleanAppNo || cleanedMobile.length < 10) return null;
  const trackingKey = sanitizeId(`${cleanAppNo}_${cleanedMobile}`);

  try {
    const snap = await getDoc(doc(db, 'applicationStatus', trackingKey));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as ApplicationStatusLookup;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `applicationStatus/${trackingKey}`);
  }
}

export async function checkIsUserAdmin(uid: string, email: string | null, emailVerified: boolean): Promise<boolean> {
  if (!emailVerified) return false;
  if (email?.toLowerCase() === OWNER_ADMIN_EMAIL.toLowerCase()) {
    // Ensure owner admin doc exists for transparency
    try {
      const ref = doc(db, 'admins', uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          uid,
          email: email,
          displayName: 'SONU SIR #BABA (Owner)',
          role: 'owner',
          createdAt: serverTimestamp(),
        });
      }
    } catch (e) {
      console.warn('Could not sync owner admin record:', e);
    }
    return true;
  }

  try {
    const snap = await getDoc(doc(db, 'admins', uid));
    return snap.exists();
  } catch {
    return false;
  }
}

export async function initializeDefaultCatalogInFirestore(): Promise<void> {
  try {
    const batch = writeBatch(db);
    const now = serverTimestamp();

    const settingsSnap = await getDoc(doc(db, 'settings', 'main'));
    if (!settingsSnap.exists()) {
      const { id: _id, updatedAt: _u, ...rest } = DEFAULT_SETTINGS;
      batch.set(doc(db, 'settings', 'main'), { ...rest, updatedAt: now });
    }

    const existingCourses = await getDocs(collection(db, 'courses'));
    if (existingCourses.empty) {
      DEFAULT_COURSES.forEach((c) => {
        const { id, updatedAt: _u, ...rest } = c;
        batch.set(doc(db, 'courses', id), { ...rest, updatedAt: now });
      });
    }

    const existingBatches = await getDocs(collection(db, 'batches'));
    if (existingBatches.empty) {
      DEFAULT_BATCHES.forEach((b) => {
        const { id, updatedAt: _u, ...rest } = b;
        batch.set(doc(db, 'batches', id), { ...rest, updatedAt: now });
      });
    }

    const existingBanners = await getDocs(collection(db, 'banners'));
    if (existingBanners.empty) {
      DEFAULT_BANNERS.forEach((bn) => {
        const { id, updatedAt: _u, ...rest } = bn;
        batch.set(doc(db, 'banners', id), { ...rest, updatedAt: now });
      });
    }

    const existingGallery = await getDocs(collection(db, 'gallery'));
    if (existingGallery.empty) {
      DEFAULT_GALLERY.forEach((g) => {
        const { id, createdAt: _c, ...rest } = g;
        batch.set(doc(db, 'gallery', id), { ...rest, createdAt: now });
      });
    }

    const existingNotices = await getDocs(collection(db, 'notices'));
    if (existingNotices.empty) {
      DEFAULT_NOTICES.forEach((n) => {
        const { id, createdAt: _c, updatedAt: _u, ...rest } = n;
        batch.set(doc(db, 'notices', id), { ...rest, createdAt: now, updatedAt: now });
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'catalog_init');
  }
}

/**
 * Approves an application atomically via Firestore transaction:
 * 1. Allocates a cryptographically random, collision-free 4-digit security code in /securityCodes/{code}
 * 2. Generates a unique studentId & opaque QR token (no PII in QR!)
 * 3. Creates permanent record in /students/{studentId}
 * 4. Updates /applications/{appId} and /applicationStatus/{trackingKey}
 */
export async function approveApplicationAndCreateStudent(
  application: AdmissionApplication,
  adminEmail: string,
  academicSession: string
): Promise<StudentRecord> {
  const studentId = generateStudentId();
  const qrToken = `ZOC:${studentId}`;

  // Retry loop for 4-digit security code collision resolution
  for (let attempt = 0; attempt < 25; attempt++) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    const codeNum = 1000 + (array[0] % 9000);
    const securityCode = String(codeNum);

    try {
      const result = await runTransaction(db, async (tx) => {
        const codeRef = doc(db, 'securityCodes', securityCode);
        const codeSnap = await tx.get(codeRef);
        if (codeSnap.exists() && codeSnap.data().active === true) {
          return { collision: true as const };
        }

        const appRef = doc(db, 'applications', application.id);
        const appSnap = await tx.get(appRef);
        if (!appSnap.exists()) {
          throw new Error('Application record no longer exists.');
        }

        const statusRef = doc(db, 'applicationStatus', application.trackingKey);
        const statusSnap = await tx.get(statusRef);

        const now = serverTimestamp();

        const studentPayload = {
          studentId,
          applicationId: application.id,
          applicationNumber: application.applicationNumber,
          securityCode,
          qrToken,
          studentName: application.studentName,
          studentMobile: application.studentMobile,
          studentWhatsapp: application.studentWhatsapp || application.studentMobile,
          fatherName: application.fatherName,
          fatherMobile: application.fatherMobile || '',
          motherName: application.motherName || '',
          motherMobile: application.motherMobile || '',
          dob: application.dob || '',
          gender: application.gender || 'Other',
          address: application.address || '',
          village: application.village || '',
          postOffice: application.postOffice || '',
          district: application.district || '',
          state: application.state || '',
          pinCode: application.pinCode || '',
          studentClass: application.studentClass,
          stream: application.stream || 'Science',
          course: application.course,
          batch: application.batch,
          photoUrl: application.photoUrl || '',
          photoMediaId: application.photoMediaId || '',
          idProofUrl: application.idProofUrl || '',
          idProofMediaId: application.idProofMediaId || '',
          marksheetUrl: application.marksheetUrl || '',
          marksheetMediaId: application.marksheetMediaId || '',
          feeAmount: application.feeAmount,
          paidAmount: application.paidAmount,
          paymentStatus: computePaymentStatus(application.feeAmount, application.paidAmount),
          status: 'active' as const,
          academicSession: academicSession || '2026–2027',
          approvedBy: adminEmail,
          approvedAt: now,
          updatedAt: now,
        };

        tx.set(codeRef, {
          code: securityCode,
          studentId,
          active: true,
          assignedAt: now,
        });

        tx.set(doc(db, 'students', studentId), studentPayload);

        tx.update(appRef, {
          status: 'approved',
          studentId,
          remarks: `Approved. Official Student ID ${studentId} issued.`,
          updatedAt: now,
        });

        if (statusSnap.exists()) {
          tx.update(statusRef, {
            status: 'approved',
            studentId,
            remarks: `Congratulations! Admission approved. Your Student ID is ${studentId}. Please collect your Digital ID Card from the institute desk.`,
            updatedAt: now,
          });
        }

        return {
          collision: false as const,
          student: {
            id: studentId,
            ...studentPayload,
            approvedAt: { toDate: () => new Date() },
            updatedAt: { toDate: () => new Date() },
          } as StudentRecord,
        };
      });

      if (!result.collision && result.student) {
        return result.student;
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `students/${studentId}`);
    }
  }

  throw new Error('Could not allocate a unique 4-digit security code. Please retry.');
}

export async function rejectApplication(
  application: AdmissionApplication,
  remarks: string
): Promise<void> {
  try {
    const batch = writeBatch(db);
    const now = serverTimestamp();
    const cleanRemarks = (remarks || 'Application rejected by administration.').slice(0, 480);

    batch.update(doc(db, 'applications', application.id), {
      status: 'rejected',
      remarks: cleanRemarks,
      updatedAt: now,
    });

    const statusRef = doc(db, 'applicationStatus', application.trackingKey);
    const statusSnap = await getDoc(statusRef);
    if (statusSnap.exists()) {
      batch.update(statusRef, {
        status: 'rejected',
        remarks: cleanRemarks,
        updatedAt: now,
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `applications/${application.id}`);
  }
}

export async function updateApplicationDetails(
  application: AdmissionApplication,
  updates: Partial<AdmissionApplication>
): Promise<void> {
  try {
    const batch = writeBatch(db);
    const now = serverTimestamp();

    const allowed: Record<string, unknown> = {
      studentName: (updates.studentName ?? application.studentName).trim().slice(0, 120),
      studentMobile: cleanPhone(updates.studentMobile ?? application.studentMobile),
      studentWhatsapp: cleanPhone(updates.studentWhatsapp ?? application.studentWhatsapp),
      fatherName: (updates.fatherName ?? application.fatherName).trim().slice(0, 120),
      fatherMobile: cleanPhone(updates.fatherMobile ?? application.fatherMobile),
      motherName: (updates.motherName ?? application.motherName).trim().slice(0, 120),
      motherMobile: cleanPhone(updates.motherMobile ?? application.motherMobile),
      studentClass: updates.studentClass ?? application.studentClass,
      stream: updates.stream ?? application.stream,
      course: (updates.course ?? application.course).trim().slice(0, 100),
      batch: (updates.batch ?? application.batch).trim().slice(0, 80),
      address: (updates.address ?? application.address).trim().slice(0, 400),
      feeAmount: Math.max(0, Number(updates.feeAmount ?? application.feeAmount)),
      paymentStatus: computePaymentStatus(
        Math.max(0, Number(updates.feeAmount ?? application.feeAmount)),
        application.paidAmount
      ),
      remarks: (updates.remarks ?? application.remarks ?? '').slice(0, 480),
      updatedAt: now,
    };

    batch.update(doc(db, 'applications', application.id), allowed);

    const statusRef = doc(db, 'applicationStatus', application.trackingKey);
    const statusSnap = await getDoc(statusRef);
    if (statusSnap.exists()) {
      batch.update(statusRef, {
        studentName: allowed.studentName,
        course: allowed.course,
        batch: allowed.batch,
        studentClass: allowed.studentClass,
        feeAmount: allowed.feeAmount,
        paymentStatus: allowed.paymentStatus,
        remarks: allowed.remarks,
        updatedAt: now,
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `applications/${application.id}`);
  }
}

export async function deleteApplicationRecord(application: AdmissionApplication): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'applications', application.id));
    batch.delete(doc(db, 'applicationStatus', application.trackingKey));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `applications/${application.id}`);
  }
}

export async function updateStudentProfile(
  student: StudentRecord,
  updates: Partial<StudentRecord>
): Promise<void> {
  try {
    const newFee = Math.max(0, Number(updates.feeAmount ?? student.feeAmount));
    const newPaid = Math.max(0, Number(updates.paidAmount ?? student.paidAmount));
    const newPaymentStatus = computePaymentStatus(newFee, newPaid);

    await updateDoc(doc(db, 'students', student.studentId), {
      studentName: (updates.studentName ?? student.studentName).trim().slice(0, 120),
      studentMobile: cleanPhone(updates.studentMobile ?? student.studentMobile),
      studentWhatsapp: cleanPhone(updates.studentWhatsapp ?? student.studentWhatsapp ?? student.studentMobile),
      fatherName: (updates.fatherName ?? student.fatherName).trim().slice(0, 120),
      fatherMobile: cleanPhone(updates.fatherMobile ?? student.fatherMobile ?? ''),
      studentClass: (updates.studentClass ?? student.studentClass).trim().slice(0, 40),
      course: (updates.course ?? student.course).trim().slice(0, 100),
      batch: (updates.batch ?? student.batch).trim().slice(0, 80),
      address: (updates.address ?? student.address ?? '').trim().slice(0, 400),
      feeAmount: newFee,
      paidAmount: newPaid,
      paymentStatus: newPaymentStatus,
      status: updates.status ?? student.status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `students/${student.studentId}`);
  }
}

export async function toggleStudentStatus(student: StudentRecord): Promise<void> {
  const nextStatus = student.status === 'active' ? 'suspended' : 'active';
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'students', student.studentId), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
    const codeRef = doc(db, 'securityCodes', student.securityCode);
    const codeSnap = await getDoc(codeRef);
    if (codeSnap.exists()) {
      batch.update(codeRef, {
        active: nextStatus === 'active',
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `students/${student.studentId}`);
  }
}

export async function regenerateStudentSecurityCode(student: StudentRecord): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    const newCode = String(1000 + (array[0] % 9000));
    if (newCode === student.securityCode) continue;

    try {
      const done = await runTransaction(db, async (tx) => {
        const newCodeRef = doc(db, 'securityCodes', newCode);
        const newCodeSnap = await tx.get(newCodeRef);
        if (newCodeSnap.exists() && newCodeSnap.data().active === true) {
          return false;
        }
        const oldCodeRef = doc(db, 'securityCodes', student.securityCode);
        const oldCodeSnap = await tx.get(oldCodeRef);
        const now = serverTimestamp();

        if (oldCodeSnap.exists()) {
          tx.update(oldCodeRef, { active: false });
        }
        tx.set(newCodeRef, {
          code: newCode,
          studentId: student.studentId,
          active: student.status === 'active',
          assignedAt: now,
        });
        tx.update(doc(db, 'students', student.studentId), {
          securityCode: newCode,
          updatedAt: now,
        });
        return true;
      });

      if (done) return newCode;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `students/${student.studentId}`);
    }
  }
  throw new Error('Could not generate a new unique security code.');
}

export async function recordVerifiedPayment(params: {
  student?: StudentRecord;
  application?: AdmissionApplication;
  amount: number;
  method: PaymentMethod;
  referenceNo?: string;
  notes?: string;
  adminEmail: string;
}): Promise<PaymentRecord> {
  const receiptNumber = generateReceiptNumber();
  const amount = Math.round(params.amount);
  if (amount <= 0) throw new Error('Payment amount must be greater than ₹0.');

  const now = serverTimestamp();
  const targetName = params.student?.studentName || params.application?.studentName || 'Student';
  const targetCourse = params.student?.course || params.application?.course || '';
  const targetBatch = params.student?.batch || params.application?.batch || '';
  const targetStudentId = params.student?.studentId || params.application?.studentId || '';
  const targetAppId = params.student?.applicationId || params.application?.id || '';

  const paymentPayload = {
    receiptNumber,
    studentId: targetStudentId,
    applicationId: targetAppId,
    studentName: targetName,
    course: targetCourse,
    batch: targetBatch,
    amount,
    method: params.method,
    referenceNo: (params.referenceNo || '').trim().slice(0, 100),
    notes: (params.notes || '').trim().slice(0, 300),
    recordedBy: params.adminEmail,
    paidAt: now,
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'payments', receiptNumber), paymentPayload);

    if (params.student) {
      const nextPaid = params.student.paidAmount + amount;
      const nextStatus = computePaymentStatus(params.student.feeAmount, nextPaid);
      batch.update(doc(db, 'students', params.student.studentId), {
        paidAmount: nextPaid,
        paymentStatus: nextStatus,
        updatedAt: now,
      });

      // Also sync linked application if present
      if (params.student.applicationId) {
        const appRef = doc(db, 'applications', params.student.applicationId);
        const appSnap = await getDoc(appRef);
        if (appSnap.exists()) {
          batch.update(appRef, {
            paidAmount: nextPaid,
            paymentStatus: nextStatus,
            updatedAt: now,
          });
          const tk = appSnap.data().trackingKey;
          if (tk) {
            const stRef = doc(db, 'applicationStatus', tk);
            const stSnap = await getDoc(stRef);
            if (stSnap.exists()) {
              batch.update(stRef, {
                paidAmount: nextPaid,
                paymentStatus: nextStatus,
                updatedAt: now,
              });
            }
          }
        }
      }
    } else if (params.application) {
      const nextPaid = params.application.paidAmount + amount;
      const nextStatus = computePaymentStatus(params.application.feeAmount, nextPaid);
      batch.update(doc(db, 'applications', params.application.id), {
        paidAmount: nextPaid,
        paymentStatus: nextStatus,
        updatedAt: now,
      });
      const stRef = doc(db, 'applicationStatus', params.application.trackingKey);
      const stSnap = await getDoc(stRef);
      if (stSnap.exists()) {
        batch.update(stRef, {
          paidAmount: nextPaid,
          paymentStatus: nextStatus,
          updatedAt: now,
        });
      }
    }

    await batch.commit();
    return {
      id: receiptNumber,
      ...paymentPayload,
      paidAt: { toDate: () => new Date() },
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `payments/${receiptNumber}`);
  }
}

export interface QrVerificationResult {
  statusResult: ScanStatusResult;
  reason: string;
  scannedCode: string;
  student?: StudentRecord;
  application?: AdmissionApplication;
  scannedAt: Date;
}

/**
 * Verifies a scanned QR code or manually entered ID strictly against live Firestore records.
 * Never trusts QR payload contents alone.
 */
export async function verifyQrCodeAgainstFirestore(
  rawQrText: string,
  adminEmail: string
): Promise<QrVerificationResult> {
  const cleanedRaw = rawQrText.trim().slice(0, 180);
  const extractedId = cleanedRaw.startsWith('ZOC:')
    ? cleanedRaw.slice(4).trim()
    : cleanedRaw;

  const isIdSafe = /^[a-zA-Z0-9_\-]{3,128}$/.test(extractedId);
  let statusResult: ScanStatusResult = 'INVALID';
  let reason = 'ID not found in institute database.';
  let student: StudentRecord | undefined;
  let application: AdmissionApplication | undefined;

  if (isIdSafe) {
    try {
      // 1. Primary lookup: Approved Students collection
      const studentSnap = await getDoc(doc(db, 'students', extractedId));
      if (studentSnap.exists()) {
        student = { id: studentSnap.id, ...studentSnap.data() } as StudentRecord;
        if (student.status === 'active') {
          statusResult = 'VALID';
          reason = 'Approved & Active Student verified against Firestore.';
        } else {
          statusResult = 'INVALID';
          reason = 'Student ID is currently SUSPENDED by administration.';
        }
      } else {
        // 2. Fallback lookup: Applications collection (detect Pending / Rejected)
        const appSnap = await getDoc(doc(db, 'applications', extractedId));
        if (appSnap.exists()) {
          application = { id: appSnap.id, ...appSnap.data() } as AdmissionApplication;
          if (application.status === 'pending') {
            statusResult = 'PENDING';
            reason = 'Admission application is still PENDING admin approval.';
          } else if (application.status === 'rejected') {
            statusResult = 'INVALID';
            reason = 'Admission application was REJECTED.';
          } else if (application.status === 'approved' && application.studentId) {
            const linkedSnap = await getDoc(doc(db, 'students', application.studentId));
            if (linkedSnap.exists()) {
              student = { id: linkedSnap.id, ...linkedSnap.data() } as StudentRecord;
              statusResult = student.status === 'active' ? 'VALID' : 'INVALID';
              reason =
                student.status === 'active'
                  ? 'Approved & Active Student verified via application reference.'
                  : 'Student ID is currently SUSPENDED.';
            }
          }
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `students/${extractedId}`);
    }
  } else {
    reason = 'Malformed QR code — does not match institute ID format.';
  }

  // Persist immutable scan audit log
  const scanId = `SCAN_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;
  try {
    await setDoc(doc(db, 'scanHistory', scanId), {
      scannedCode: cleanedRaw || 'EMPTY',
      studentId: student?.studentId || application?.applicationNumber || '',
      studentName: student?.studentName || application?.studentName || 'Unknown',
      statusResult,
      reason,
      scannedBy: adminEmail,
      scannedAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn('Could not save scan history entry:', error);
  }

  return {
    statusResult,
    reason,
    scannedCode: cleanedRaw,
    student,
    application,
    scannedAt: new Date(),
  };
}

// -----------------------------------------------------------------------------
// Admin CMS Operations: Banners, Gallery, Notices, Courses, Batches, Fees, Settings
// -----------------------------------------------------------------------------

export async function saveBanner(
  banner: Omit<BannerItem, 'id' | 'updatedAt'> & { id?: string },
  imageFile?: File | null
): Promise<void> {
  const id = sanitizeId(banner.id || `banner_${Date.now()}`);
  let imageUrl = banner.imageUrl || '';
  let mediaId = banner.mediaId || '';

  if (imageFile) {
    const uploaded = await uploadMediaSmart(imageFile, 'banners', false, 1280);
    imageUrl = uploaded.url;
    mediaId = uploaded.mediaId;
  }

  try {
    await setDoc(doc(db, 'banners', id), {
      title: banner.title.trim().slice(0, 140),
      description: (banner.description || '').trim().slice(0, 500),
      announcement: (banner.announcement || '').trim().slice(0, 240),
      imageUrl,
      mediaId,
      order: Number(banner.order) || 1,
      active: Boolean(banner.active),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `banners/${id}`);
  }
}

export async function deleteBanner(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'banners', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `banners/${id}`);
  }
}

export async function addGalleryPhoto(
  title: string,
  category: string,
  file: File
): Promise<void> {
  const id = sanitizeId(`gal_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`);
  const uploaded = await uploadMediaSmart(file, 'gallery', false, 1100);
  try {
    await setDoc(doc(db, 'gallery', id), {
      title: title.trim().slice(0, 140),
      category: category.trim().slice(0, 60),
      imageUrl: uploaded.url,
      mediaId: uploaded.mediaId,
      active: true,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `gallery/${id}`);
  }
}

export async function deleteGalleryPhoto(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'gallery', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `gallery/${id}`);
  }
}

export async function saveNotice(notice: {
  id?: string;
  title: string;
  content: string;
  category: NoticeCategory;
  pinned: boolean;
  active: boolean;
  existingCreatedAt?: unknown;
}): Promise<void> {
  const id = sanitizeId(notice.id || `notice_${Date.now()}`);
  const now = serverTimestamp();
  try {
    if (notice.id) {
      await updateDoc(doc(db, 'notices', id), {
        title: notice.title.trim().slice(0, 160),
        content: notice.content.trim().slice(0, 1500),
        category: notice.category,
        pinned: Boolean(notice.pinned),
        active: Boolean(notice.active),
        updatedAt: now,
      });
    } else {
      await setDoc(doc(db, 'notices', id), {
        title: notice.title.trim().slice(0, 160),
        content: notice.content.trim().slice(0, 1500),
        category: notice.category,
        pinned: Boolean(notice.pinned),
        active: Boolean(notice.active),
        createdAt: now,
        updatedAt: now,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `notices/${id}`);
  }
}

export async function deleteNotice(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'notices', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `notices/${id}`);
  }
}

export async function saveCourse(
  course: Omit<CourseItem, 'id' | 'updatedAt'> & { id?: string }
): Promise<void> {
  const id = sanitizeId(course.id || `course_${Date.now()}`);
  try {
    await setDoc(doc(db, 'courses', id), {
      title: course.title.trim().slice(0, 100),
      category: (course.category || 'Chemistry').trim().slice(0, 60),
      targetClass: (course.targetClass || '').trim().slice(0, 60),
      description: (course.description || '').trim().slice(0, 600),
      duration: (course.duration || '10 Months').trim().slice(0, 60),
      feeAmount: Math.max(0, Number(course.feeAmount) || 5500),
      active: Boolean(course.active),
      order: Number(course.order) || 1,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `courses/${id}`);
  }
}

export async function deleteCourse(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'courses', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `courses/${id}`);
  }
}

export async function saveBatch(
  batchItem: Omit<BatchItem, 'id' | 'updatedAt'> & { id?: string }
): Promise<void> {
  const id = sanitizeId(batchItem.id || `batch_${Date.now()}`);
  try {
    await setDoc(doc(db, 'batches', id), {
      name: batchItem.name.trim().slice(0, 80),
      timing: batchItem.timing.trim().slice(0, 80),
      capacity: Math.max(1, Number(batchItem.capacity) || 60),
      feeOverride:
        batchItem.feeOverride !== null &&
        batchItem.feeOverride !== undefined &&
        Number(batchItem.feeOverride) > 0
          ? Number(batchItem.feeOverride)
          : null,
      active: Boolean(batchItem.active),
      order: Number(batchItem.order) || 1,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `batches/${id}`);
  }
}

export async function deleteBatch(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'batches', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `batches/${id}`);
  }
}

export async function saveFeeRule(
  rule: Omit<FeeRule, 'id' | 'updatedAt'> & { id?: string }
): Promise<void> {
  const id = sanitizeId(rule.id || `fee_${Date.now()}`);
  try {
    await setDoc(doc(db, 'fees', id), {
      label: rule.label.trim().slice(0, 120),
      studentClass: (rule.studentClass || '').trim().slice(0, 40),
      course: (rule.course || '').trim().slice(0, 100),
      batch: (rule.batch || '').trim().slice(0, 80),
      amount: Math.max(0, Number(rule.amount) || 5500),
      active: Boolean(rule.active),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `fees/${id}`);
  }
}

export async function deleteFeeRule(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'fees', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `fees/${id}`);
  }
}

export async function saveInstituteSettings(
  settings: Omit<InstituteSettings, 'id' | 'updatedAt'>
): Promise<void> {
  try {
    await setDoc(doc(db, 'settings', 'main'), {
      instituteName: settings.instituteName.trim().slice(0, 120),
      teacherName: settings.teacherName.trim().slice(0, 120),
      tagline: settings.tagline.trim().slice(0, 200),
      academicSession: settings.academicSession.trim().slice(0, 40),
      defaultFee: Math.max(0, Number(settings.defaultFee) || 5500),
      admissionsOpen: Boolean(settings.admissionsOpen),
      admissionHeadline: settings.admissionHeadline.trim().slice(0, 200),
      phone: settings.phone.trim().slice(0, 30),
      whatsappNumber: settings.whatsappNumber.replace(/[^0-9]/g, '').slice(0, 20),
      email: settings.email.trim().slice(0, 160),
      address: settings.address.trim().slice(0, 300),
      signatureText: settings.signatureText.trim().slice(0, 80),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'settings/main');
  }
}

export async function addAuthorizedAdmin(uid: string, email: string, displayName: string): Promise<void> {
  const cleanUid = sanitizeId(uid.trim());
  if (!cleanUid) throw new Error('Valid Firebase Auth UID is required.');
  try {
    await setDoc(doc(db, 'admins', cleanUid), {
      uid: cleanUid,
      email: email.trim().slice(0, 200),
      displayName: displayName.trim().slice(0, 120),
      role: 'admin',
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `admins/${cleanUid}`);
  }
}

export async function removeAuthorizedAdmin(uid: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'admins', uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `admins/${uid}`);
  }
}

/**
 * Subscribes to all admin collections cleanly with structured error handling.
 * Only invoke after admin authentication is verified.
 */
export function subscribeAdminCollections(handlers: {
  onApplications: (items: AdmissionApplication[]) => void;
  onStudents: (items: StudentRecord[]) => void;
  onPayments: (items: PaymentRecord[]) => void;
  onScanHistory: (items: ScanHistoryEntry[]) => void;
  onBanners: (items: BannerItem[]) => void;
  onGallery: (items: GalleryItem[]) => void;
  onNotices: (items: NoticeItem[]) => void;
  onCourses: (items: CourseItem[]) => void;
  onBatches: (items: BatchItem[]) => void;
  onFees: (items: FeeRule[]) => void;
  onAdmins: (items: AdminUserRecord[]) => void;
  onSettings: (settings: InstituteSettings) => void;
  onError?: (err: Error) => void;
}): () => void {
  const report = (err: unknown, path: string) => {
    try {
      handleFirestoreError(err, OperationType.LIST, path);
    } catch (wrapped) {
      handlers.onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
    }
  };

  const unsubs = [
    onSnapshot(
      collection(db, 'applications'),
      (snap) => {
        const items = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as AdmissionApplication)
          .sort((a, b) => {
            const ta = a.submittedAt?.toDate ? a.submittedAt.toDate().getTime() : 0;
            const tb = b.submittedAt?.toDate ? b.submittedAt.toDate().getTime() : 0;
            return tb - ta;
          });
        handlers.onApplications(items);
      },
      (err) => report(err, 'applications')
    ),
    onSnapshot(
      collection(db, 'students'),
      (snap) => {
        const items = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as StudentRecord)
          .sort((a, b) => {
            const ta = a.approvedAt?.toDate ? a.approvedAt.toDate().getTime() : 0;
            const tb = b.approvedAt?.toDate ? b.approvedAt.toDate().getTime() : 0;
            return tb - ta;
          });
        handlers.onStudents(items);
      },
      (err) => report(err, 'students')
    ),
    onSnapshot(
      collection(db, 'payments'),
      (snap) => {
        const items = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as PaymentRecord)
          .sort((a, b) => {
            const ta = a.paidAt?.toDate ? a.paidAt.toDate().getTime() : 0;
            const tb = b.paidAt?.toDate ? b.paidAt.toDate().getTime() : 0;
            return tb - ta;
          });
        handlers.onPayments(items);
      },
      (err) => report(err, 'payments')
    ),
    onSnapshot(
      collection(db, 'scanHistory'),
      (snap) => {
        const items = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as ScanHistoryEntry)
          .sort((a, b) => {
            const ta = a.scannedAt?.toDate ? a.scannedAt.toDate().getTime() : 0;
            const tb = b.scannedAt?.toDate ? b.scannedAt.toDate().getTime() : 0;
            return tb - ta;
          });
        handlers.onScanHistory(items);
      },
      (err) => report(err, 'scanHistory')
    ),
    onSnapshot(
      collection(db, 'banners'),
      (snap) => {
        const items = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as BannerItem)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        handlers.onBanners(items);
      },
      (err) => report(err, 'banners')
    ),
    onSnapshot(
      collection(db, 'gallery'),
      (snap) => {
        const items = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as GalleryItem)
          .sort((a, b) => {
            const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
            const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
            return tb - ta;
          });
        handlers.onGallery(items);
      },
      (err) => report(err, 'gallery')
    ),
    onSnapshot(
      collection(db, 'notices'),
      (snap) => {
        const items = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as NoticeItem)
          .sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
            const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
            return tb - ta;
          });
        handlers.onNotices(items);
      },
      (err) => report(err, 'notices')
    ),
    onSnapshot(
      collection(db, 'courses'),
      (snap) => {
        const items = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as CourseItem)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        handlers.onCourses(items);
      },
      (err) => report(err, 'courses')
    ),
    onSnapshot(
      collection(db, 'batches'),
      (snap) => {
        const items = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as BatchItem)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        handlers.onBatches(items);
      },
      (err) => report(err, 'batches')
    ),
    onSnapshot(
      collection(db, 'fees'),
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FeeRule);
        handlers.onFees(items);
      },
      (err) => report(err, 'fees')
    ),
    onSnapshot(
      collection(db, 'admins'),
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AdminUserRecord);
        handlers.onAdmins(items);
      },
      (err) => report(err, 'admins')
    ),
    onSnapshot(
      doc(db, 'settings', 'main'),
      (snap) => {
        if (snap.exists()) {
          handlers.onSettings({ id: snap.id, ...snap.data() } as InstituteSettings);
        } else {
          handlers.onSettings(DEFAULT_SETTINGS);
        }
      },
      (err) => report(err, 'settings/main')
    ),
  ];

  return () => {
    unsubs.forEach((u) => u());
  };
}
