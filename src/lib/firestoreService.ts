import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
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
  AdmissionStage,
  ApplicationStatus,
  ApplicationStatusLookup,
  AttendanceAuditLog,
  AttendanceHoliday,
  AttendanceLookupEntry,
  AttendanceLookupIndexDoc,
  AttendanceRecord,
  AttendanceStatus,
  BannerItem,
  BatchItem,
  CourseItem,
  FeeRule,
  GalleryItem,
  Gender,
  HolidayDayType,
  InstituteSettings,
  NoticeCategory,
  NoticeItem,
  PaymentMethod,
  PaymentRecord,
  PaymentStatus,
  ScanHistoryEntry,
  ScanStatusResult,
  StudentAttendanceDayEntry,
  StudentAttendancePublicDoc,
  StudentClass,
  StudentRecord,
  StudentStream,
  TeacherBannerItem,
  StudentTrackingProfile,
  TrackingIndexDoc,
  TrackingIndexEntry,
} from '../types';
import {
  buildAttendanceDocId,
  DEFAULT_SCHEDULED_DAYS,
  formatIstDateYmd,
  formatIstTime,
  getSyncedServerIstNow,
  resolveStudentBatch,
  toEpochMs,
} from './attendanceUtils';
import { db, handleFirestoreError, OperationType, OWNER_ADMIN_EMAIL } from './firebase';
import {
  compressPassportThumbnail,
  resolveMediaSource,
  shrinkImageDataUrlForProfile,
  uploadMediaSmart,
} from './media';

// -----------------------------------------------------------------------------
// Cryptographic Tracking Helpers (Zero-PII Index + Unguessable Profile Keys)
// -----------------------------------------------------------------------------
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function maskMobileNumber(rawMobile: string): string {
  const cleaned = cleanPhone(rawMobile);
  if (cleaned.length < 4) return '******';
  return `******${cleaned.slice(-4)}`;
}

export async function buildMobileLookupId(rawMobile: string): Promise<string> {
  const hash = await sha256Hex(cleanPhone(rawMobile));
  return `mob_${hash}`;
}

export async function buildCodeLookupId(rawCode: string): Promise<string> {
  const normalized = sanitizeId(rawCode.trim().toUpperCase());
  const hash = await sha256Hex(normalized);
  return `id_${hash}`;
}

export async function buildProfileKey(applicationNumber: string, rawMobile: string): Promise<string> {
  const normApp = sanitizeId(applicationNumber.trim().toUpperCase());
  const cleaned = cleanPhone(rawMobile);
  const hash = await sha256Hex(`${normApp}:${cleaned}`);
  return `prof_${hash}`;
}

export function deriveAdmissionStage(
  status: ApplicationStatus,
  studentId?: string,
  currentStage?: AdmissionStage
): AdmissionStage {
  if (status === 'rejected') return 'Rejected';
  if (status === 'approved') {
    return studentId && studentId.trim().length > 0 ? 'Student ID Generated' : 'Approved';
  }
  if (currentStage === 'Under Review') return 'Under Review';
  return 'Application Submitted';
}

export function sanitizeId(raw: string): string {
  return String(raw ?? '').replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 120);
}

export function cleanPhone(raw: unknown): string {
  const str = String(raw ?? '').trim();
  if (!str) return '';
  let compact = str.replace(/[\s\-().]+/g, '');
  if (compact.startsWith('+91')) {
    compact = compact.slice(3);
  } else if (compact.startsWith('0091')) {
    compact = compact.slice(4);
  } else if (compact.startsWith('91') && compact.length === 12) {
    compact = compact.slice(2);
  } else if (compact.startsWith('0') && compact.length === 11) {
    compact = compact.slice(1);
  }
  const digitsOnly = compact.replace(/[^0-9]/g, '');
  return digitsOnly.length > 10 ? digitsOnly.slice(-10) : digitsOnly;
}

export function normalizeIndianMobile(
  raw: unknown
): { ok: true; mobile10: string } | { ok: false; error: string } {
  const str = String(raw ?? '').trim();
  if (!str) {
    return {
      ok: false,
      error: 'Invalid Mobile Number. Please enter a valid 10-digit Indian mobile number.',
    };
  }
  let compact = str.replace(/[\s\-().]+/g, '');
  if (compact.startsWith('+91')) {
    compact = compact.slice(3);
  } else if (compact.startsWith('0091')) {
    compact = compact.slice(4);
  } else if (compact.startsWith('91') && compact.length === 12) {
    compact = compact.slice(2);
  } else if (compact.startsWith('0') && compact.length === 11) {
    compact = compact.slice(1);
  }
  if (!/^[6-9][0-9]{9}$/.test(compact)) {
    return {
      ok: false,
      error:
        'Invalid Mobile Number. Please enter a valid 10-digit Indian mobile number (e.g., 6299475970 or +91 6299475970).',
    };
  }
  return { ok: true, mobile10: compact };
}

export function normalizeStudentId(
  raw: unknown
): { ok: true; studentId: string } | { ok: false; isApplicationNumber?: boolean; error: string } {
  let cleaned = String(raw ?? '').trim().toUpperCase();
  if (cleaned.startsWith('ZOC:')) {
    cleaned = cleaned.slice(4).trim();
  }
  if (!cleaned || cleaned.length < 4 || cleaned.length > 64 || !/^[A-Z0-9_\-]+$/.test(cleaned)) {
    return {
      ok: false,
      error: 'Invalid Student ID. Please enter your Student ID (e.g., ZOC-2026-123456).',
    };
  }
  if (/^ZOC[0-9]{4}-[0-9]+$/.test(cleaned)) {
    return {
      ok: false,
      isApplicationNumber: true,
      error:
        'Invalid Student ID. You entered an Application Number — please enter your official Student ID (e.g., ZOC-2026-123456).',
    };
  }
  return { ok: true, studentId: cleaned };
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
  teacherBanners: TeacherBannerItem[];
}

export async function fetchPublicInstituteData(): Promise<PublicInstituteData> {
  try {
    const [
      settingsSnap,
      coursesSnap,
      batchesSnap,
      feesSnap,
      bannersSnap,
      gallerySnap,
      noticesSnap,
      teacherBannersSnap,
    ] = await Promise.all([
      getDoc(doc(db, 'settings', 'main')).catch(() => null),
      getDocs(query(collection(db, 'courses'), where('active', '==', true))).catch(() => null),
      getDocs(query(collection(db, 'batches'), where('active', '==', true))).catch(() => null),
      getDocs(query(collection(db, 'fees'), where('active', '==', true))).catch(() => null),
      getDocs(query(collection(db, 'banners'), where('active', '==', true))).catch(() => null),
      getDocs(query(collection(db, 'gallery'), where('active', '==', true))).catch(() => null),
      getDocs(query(collection(db, 'notices'), where('active', '==', true))).catch(() => null),
      getDocs(
        query(
          collection(db, 'teacherBanners'),
          where('status', '==', 'approved'),
          where('active', '==', true)
        )
      ).catch(() => null),
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

    const teacherBanners: TeacherBannerItem[] =
      teacherBannersSnap && !teacherBannersSnap.empty
        ? teacherBannersSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as TeacherBannerItem)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        : [];

    return { settings, courses, batches, feeRules, banners, gallery, notices, teacherBanners };
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
      teacherBanners: [],
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
  academicSession?: string;
  photoFile: File;
  idProofFile: File;
  marksheetFile?: File | null;
}

export async function submitAdmissionApplication(
  input: AdmissionSubmissionInput
): Promise<{ applicationNumber: string; trackingKey: string }> {
  const applicationNumber = sanitizeId(input.applicationNumber);
  const cleanedMobile = cleanPhone(input.studentMobile);
  if (cleanedMobile.length !== 10) {
    throw new Error('Please enter a valid 10-digit Student Mobile Number.');
  }

  // Strict duplicate admission prevention (One mobile number = One student admission record)
  const earlyMobLookupId = await buildMobileLookupId(cleanedMobile);
  const earlyMobSnap = await getDoc(doc(db, 'trackingIndex', earlyMobLookupId)).catch(() => null);
  if (earlyMobSnap && earlyMobSnap.exists()) {
    const data = earlyMobSnap.data();
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    if (entries.length > 0) {
      throw new Error(
        'This mobile number is already registered. One mobile number can be used for only one student admission.'
      );
    }
  }

  const qApp = query(collection(db, 'applications'), where('studentMobile', '==', cleanedMobile), limit(1));
  const appSnap = await getDocs(qApp).catch(() => null);
  if (appSnap && !appSnap.empty) {
    throw new Error(
      'This mobile number is already registered. One mobile number can be used for only one student admission.'
    );
  }

  const trackingKey = sanitizeId(`${applicationNumber}_${cleanedMobile}`);

  // Upload private documents first + generate compact passport thumbnail for verified tracking profile
  const [photoUpload, idProofUpload, photoDataUrl] = await Promise.all([
    uploadMediaSmart(input.photoFile, 'student_photos', true, 480),
    uploadMediaSmart(input.idProofFile, 'student_id_proofs', true, 960),
    compressPassportThumbnail(input.photoFile),
  ]);
  let marksheetUpload = { url: '', mediaId: '' };
  if (input.marksheetFile) {
    marksheetUpload = await uploadMediaSmart(input.marksheetFile, 'student_marksheets', true, 960);
  }

  const nowTs = serverTimestamp();
  const trimmedName = input.studentName.trim().slice(0, 120);
  const trimmedFather = input.fatherName.trim().slice(0, 120);
  const trimmedCourse = input.course.trim().slice(0, 100);
  const trimmedBatch = input.batch.trim().slice(0, 80);
  const roundedFee = Math.max(0, Math.round(input.feeAmount));
  const sessionLabel = (input.academicSession || '2026–2027').trim().slice(0, 40);

  const appDoc: Record<string, unknown> = {
    applicationNumber,
    trackingKey,
    studentName: trimmedName,
    studentMobile: cleanedMobile,
    studentWhatsapp: cleanPhone(input.studentWhatsapp || input.studentMobile),
    fatherName: trimmedFather,
    fatherMobile: cleanPhone(input.fatherMobile),
    motherName: input.motherName.trim().slice(0, 120),
    motherMobile: cleanPhone(input.motherMobile),
    gender: input.gender,
    address: input.address.trim().slice(0, 400),
    village: input.village.trim().slice(0, 120),
    postOffice: input.postOffice.trim().slice(0, 120),
    district: input.district.trim().slice(0, 120),
    state: input.state.trim().slice(0, 120),
    pinCode: input.pinCode.replace(/[^0-9]/g, '').slice(0, 6),
    studentClass: input.studentClass,
    stream: input.stream,
    course: trimmedCourse,
    batch: trimmedBatch,
    photoUrl: photoUpload.url,
    photoMediaId: photoUpload.mediaId,
    idProofUrl: idProofUpload.url,
    idProofMediaId: idProofUpload.mediaId,
    marksheetUrl: marksheetUpload.url,
    marksheetMediaId: marksheetUpload.mediaId,
    feeAmount: roundedFee,
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
    studentName: trimmedName,
    course: trimmedCourse,
    batch: trimmedBatch,
    studentClass: input.studentClass,
    status: 'pending',
    paymentStatus: 'PENDING',
    feeAmount: roundedFee,
    paidAmount: 0,
    studentId: '',
    remarks: 'Submitted successfully. Waiting for admin review.',
    submittedAt: nowTs,
    updatedAt: nowTs,
  };

  // Cryptographic lookup IDs for zero-PII tracking index & OTP-gated profile
  const [mobileHash, mobLookupId, appLookupId, profileKey] = await Promise.all([
    sha256Hex(cleanedMobile),
    buildMobileLookupId(cleanedMobile),
    buildCodeLookupId(applicationNumber),
    buildProfileKey(applicationNumber, cleanedMobile),
  ]);
  const maskedMobile = maskMobileNumber(cleanedMobile);
  const newIndexEntry: TrackingIndexEntry = {
    applicationNumber,
    course: trimmedCourse,
    admissionStage: 'Application Submitted',
    hasStudentId: false,
  };

  const trackingProfileDoc: Record<string, unknown> = {
    applicationNumber,
    studentId: '',
    studentName: trimmedName,
    fatherName: trimmedFather,
    studentClass: input.studentClass,
    course: trimmedCourse,
    batch: trimmedBatch,
    academicSession: sessionLabel,
    status: 'pending',
    admissionStage: 'Application Submitted',
    studentStatus: '',
    feeAmount: roundedFee,
    paidAmount: 0,
    paymentStatus: 'PENDING',
    securityCode: '',
    qrToken: '',
    photoUrl: photoUpload.url,
    photoDataUrl,
    remarks: 'Submitted successfully. Waiting for admin review.',
    submittedAt: nowTs,
    updatedAt: nowTs,
  };

  // Check if mobile tracking index already exists (multiple applications on same mobile)
  const mobRef = doc(db, 'trackingIndex', mobLookupId);
  const existingMobSnap = await getDoc(mobRef).catch(() => null);

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'applications', applicationNumber), appDoc);
    batch.set(doc(db, 'applicationStatus', trackingKey), statusDoc);
    batch.set(doc(db, 'studentTrackingProfiles', profileKey), trackingProfileDoc);
    batch.set(doc(db, 'trackingIndex', appLookupId), {
      lookupType: 'id',
      maskedMobile,
      mobileHash,
      entries: [newIndexEntry],
      updatedAt: nowTs,
    });

    if (existingMobSnap && existingMobSnap.exists()) {
      const prevEntries = Array.isArray(existingMobSnap.data().entries)
        ? (existingMobSnap.data().entries as TrackingIndexEntry[])
        : [];
      if (prevEntries.length < 10) {
        batch.update(mobRef, {
          entries: [...prevEntries, newIndexEntry],
          updatedAt: nowTs,
        });
      }
    } else {
      batch.set(mobRef, {
        lookupType: 'mobile',
        maskedMobile,
        mobileHash,
        entries: [newIndexEntry],
        updatedAt: nowTs,
      });
    }

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

/**
 * Public zero-PII lookup by Student ID or Application Number.
 * Returns only non-sensitive metadata + masked mobile hash for OTP verification.
 */
export async function lookupTrackingIndexById(rawId: string): Promise<TrackingIndexDoc | null> {
  const normalized = sanitizeId(rawId.trim().toUpperCase());
  if (normalized.length < 4) return null;
  const lookupId = await buildCodeLookupId(normalized);
  try {
    const snap = await getDoc(doc(db, 'trackingIndex', lookupId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as TrackingIndexDoc;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `trackingIndex/${lookupId}`);
  }
}

/**
 * Public zero-PII lookup by Registered 10-Digit Mobile Number.
 * If multiple applications share this mobile, returns ONLY applicationNumber, course, and stage.
 */
export async function lookupTrackingIndexByMobile(rawMobile: string): Promise<TrackingIndexDoc | null> {
  const cleaned = cleanPhone(rawMobile);
  if (cleaned.length !== 10) return null;
  const lookupId = await buildMobileLookupId(cleaned);
  try {
    const snap = await getDoc(doc(db, 'trackingIndex', lookupId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as TrackingIndexDoc;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `trackingIndex/${lookupId}`);
  }
}

/**
 * Fetches the official StudentTrackingProfile strictly AFTER OTP verification
 * using the unguessable SHA-256 profile key derived from applicationNumber + verifiedMobile.
 */
export async function fetchVerifiedTrackingProfile(
  applicationNumber: string,
  verifiedMobile: string
): Promise<StudentTrackingProfile | null> {
  const normApp = sanitizeId(applicationNumber.trim().toUpperCase());
  const cleaned = cleanPhone(verifiedMobile);
  if (!normApp || cleaned.length !== 10) return null;
  const profileKey = await buildProfileKey(normApp, cleaned);
  try {
    const snap = await getDoc(doc(db, 'studentTrackingProfiles', profileKey));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as StudentTrackingProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `studentTrackingProfiles/${profileKey}`);
  }
}

export async function fetchTrackingProfileByApplicationNumber(
  appOrStudentId: string
): Promise<StudentTrackingProfile | null> {
  const norm = sanitizeId(appOrStudentId.trim().toUpperCase());
  if (!norm) return null;
  try {
    const q1 = query(collection(db, 'studentTrackingProfiles'), where('applicationNumber', '==', norm), limit(1));
    const snap1 = await getDocs(q1);
    if (!snap1.empty) {
      const d = snap1.docs[0];
      return { id: d.id, ...d.data() } as StudentTrackingProfile;
    }
    const q2 = query(collection(db, 'studentTrackingProfiles'), where('studentId', '==', norm), limit(1));
    const snap2 = await getDocs(q2);
    if (!snap2.empty) {
      const d = snap2.docs[0];
      return { id: d.id, ...d.data() } as StudentTrackingProfile;
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `studentTrackingProfiles/query_${norm}`);
  }
}

interface AdminTrackingSyncPayload {
  applicationNumber: string;
  studentId?: string;
  studentMobile: string;
  previousMobile?: string;
  studentName: string;
  fatherName: string;
  studentClass: string;
  course: string;
  batch: string;
  academicSession: string;
  status: ApplicationStatus;
  admissionStage: AdmissionStage;
  studentStatus?: '' | 'active' | 'suspended';
  feeAmount: number;
  paidAmount: number;
  paymentStatus: PaymentStatus;
  securityCode?: string;
  qrToken?: string;
  photoUrl?: string;
  photoMediaId?: string;
  remarks?: string;
  submittedAt?: unknown;
}

/**
 * Admin-only synchronizer that updates /studentTrackingProfiles and /trackingIndex
 * across mobile, application number, and student ID lookup keys.
 */
async function syncAdminTrackingRecords(payload: AdminTrackingSyncPayload): Promise<void> {
  const cleanedMobile = cleanPhone(payload.studentMobile);
  if (cleanedMobile.length !== 10) return;

  const appNo = sanitizeId(payload.applicationNumber);
  const studentId = payload.studentId ? sanitizeId(payload.studentId) : '';

  const [mobileHash, mobLookupId, appLookupId, profileKey] = await Promise.all([
    sha256Hex(cleanedMobile),
    buildMobileLookupId(cleanedMobile),
    buildCodeLookupId(appNo),
    buildProfileKey(appNo, cleanedMobile),
  ]);
  const maskedMobile = maskMobileNumber(cleanedMobile);
  const nowTs = serverTimestamp();

  const profRef = doc(db, 'studentTrackingProfiles', profileKey);
  const existingProfSnap = await getDoc(profRef).catch(() => null);
  const existingProf = existingProfSnap?.exists() ? existingProfSnap.data() : null;

  let photoDataUrl = typeof existingProf?.photoDataUrl === 'string' ? existingProf.photoDataUrl : '';
  if (!photoDataUrl && !payload.photoUrl && payload.photoMediaId) {
    const rawMedia = await resolveMediaSource('', payload.photoMediaId, true);
    if (rawMedia) {
      photoDataUrl = await shrinkImageDataUrlForProfile(rawMedia);
    }
  }

  const entry: TrackingIndexEntry = {
    applicationNumber: appNo,
    course: payload.course.trim().slice(0, 100),
    admissionStage: payload.admissionStage,
    hasStudentId: Boolean(studentId),
  };

  const profileData: Record<string, unknown> = {
    applicationNumber: appNo,
    studentId,
    studentName: payload.studentName.trim().slice(0, 120),
    fatherName: payload.fatherName.trim().slice(0, 120),
    studentClass: payload.studentClass.trim().slice(0, 40),
    course: payload.course.trim().slice(0, 100),
    batch: payload.batch.trim().slice(0, 80),
    academicSession: (payload.academicSession || '2026–2027').trim().slice(0, 40),
    status: payload.status,
    admissionStage: payload.admissionStage,
    studentStatus: payload.studentStatus || '',
    feeAmount: Math.max(0, Math.round(payload.feeAmount)),
    paidAmount: Math.max(0, Math.round(payload.paidAmount)),
    paymentStatus: payload.paymentStatus,
    securityCode: (payload.securityCode || '').slice(0, 4),
    qrToken: (payload.qrToken || '').slice(0, 120),
    photoUrl: (payload.photoUrl || '').slice(0, 2000),
    photoDataUrl: photoDataUrl.slice(0, 250000),
    remarks: (payload.remarks || '').slice(0, 500),
    submittedAt: existingProf?.submittedAt || payload.submittedAt || nowTs,
    updatedAt: nowTs,
  };

  const batch = writeBatch(db);
  batch.set(profRef, profileData);

  // 1. Update Application Number index
  batch.set(doc(db, 'trackingIndex', appLookupId), {
    lookupType: 'id',
    maskedMobile,
    mobileHash,
    entries: [entry],
    updatedAt: nowTs,
  });

  // 2. Update Student ID index (when issued)
  if (studentId) {
    const studentIdLookup = await buildCodeLookupId(studentId);
    batch.set(doc(db, 'trackingIndex', studentIdLookup), {
      lookupType: 'id',
      maskedMobile,
      mobileHash,
      entries: [entry],
      updatedAt: nowTs,
    });
  }

  // 3. Upsert into Mobile lookup index (supporting multiple applications per mobile)
  const mobRef = doc(db, 'trackingIndex', mobLookupId);
  const existingMobSnap = await getDoc(mobRef).catch(() => null);
  const existingEntries: TrackingIndexEntry[] =
    existingMobSnap && existingMobSnap.exists() && Array.isArray(existingMobSnap.data().entries)
      ? (existingMobSnap.data().entries as TrackingIndexEntry[])
      : [];

  const filteredEntries = existingEntries.filter((e) => e.applicationNumber !== appNo);
  const nextEntries = [...filteredEntries, entry].slice(0, 10);

  batch.set(mobRef, {
    lookupType: 'mobile',
    maskedMobile,
    mobileHash,
    entries: nextEntries,
    updatedAt: nowTs,
  });

  // 4. If mobile number was changed by admin, clean up old mobile index & old profile key
  const prevCleaned = payload.previousMobile ? cleanPhone(payload.previousMobile) : '';
  if (prevCleaned.length === 10 && prevCleaned !== cleanedMobile) {
    const [oldMobLookupId, oldProfileKey] = await Promise.all([
      buildMobileLookupId(prevCleaned),
      buildProfileKey(appNo, prevCleaned),
    ]);
    batch.delete(doc(db, 'studentTrackingProfiles', oldProfileKey));
    const oldMobRef = doc(db, 'trackingIndex', oldMobLookupId);
    const oldMobSnap = await getDoc(oldMobRef).catch(() => null);
    if (oldMobSnap && oldMobSnap.exists() && Array.isArray(oldMobSnap.data().entries)) {
      const remaining = (oldMobSnap.data().entries as TrackingIndexEntry[]).filter(
        (e) => e.applicationNumber !== appNo
      );
      if (remaining.length === 0) {
        batch.delete(oldMobRef);
      } else {
        batch.set(oldMobRef, {
          lookupType: 'mobile',
          maskedMobile: maskMobileNumber(prevCleaned),
          mobileHash: await sha256Hex(prevCleaned),
          entries: remaining,
          updatedAt: nowTs,
        });
      }
    }
  }

  await batch.commit();
}

export async function markApplicationUnderReview(
  application: AdmissionApplication,
  academicSession = '2026–2027'
): Promise<void> {
  if (application.status !== 'pending') return;
  try {
    await syncAdminTrackingRecords({
      applicationNumber: application.applicationNumber,
      studentMobile: application.studentMobile,
      studentName: application.studentName,
      fatherName: application.fatherName,
      studentClass: application.studentClass,
      course: application.course,
      batch: application.batch,
      academicSession,
      status: 'pending',
      admissionStage: 'Under Review',
      feeAmount: application.feeAmount,
      paidAmount: application.paidAmount,
      paymentStatus: application.paymentStatus,
      photoUrl: application.photoUrl,
      photoMediaId: application.photoMediaId,
      remarks: application.remarks || 'Application is currently under review by administration.',
      submittedAt: application.submittedAt,
    });
  } catch (err) {
    console.warn('Unable to mark application under review in tracking index:', err);
  }
}

/**
 * Silent idempotent admin backfill so any previously submitted applications
 * or approved students are immediately searchable via Track My Admission.
 */
export async function syncMissingTrackingRecords(
  applications: AdmissionApplication[],
  students: StudentRecord[],
  academicSession = '2026–2027'
): Promise<void> {
  const studentByApp = new Map<string, StudentRecord>();
  for (const s of students) {
    studentByApp.set(s.applicationNumber, s);
  }

  for (const app of applications) {
    try {
      const linkedStudent = studentByApp.get(app.applicationNumber);
      const mobile = linkedStudent?.studentMobile || app.studentMobile;
      const profileKey = await buildProfileKey(app.applicationNumber, mobile);
      const existingSnap = await getDoc(doc(db, 'studentTrackingProfiles', profileKey));

      // Skip if already synced and matches current studentId & status
      if (existingSnap.exists()) {
        const data = existingSnap.data();
        const expectedStage = deriveAdmissionStage(
          app.status,
          linkedStudent?.studentId || app.studentId,
          data.admissionStage as AdmissionStage | undefined
        );
        if (
          data.status === app.status &&
          data.admissionStage === expectedStage &&
          (data.studentId || '') === (linkedStudent?.studentId || app.studentId || '') &&
          data.paidAmount === (linkedStudent?.paidAmount ?? app.paidAmount)
        ) {
          continue;
        }
      }

      const stage = deriveAdmissionStage(
        app.status,
        linkedStudent?.studentId || app.studentId,
        existingSnap.exists() ? (existingSnap.data().admissionStage as AdmissionStage) : undefined
      );

      await syncAdminTrackingRecords({
        applicationNumber: app.applicationNumber,
        studentId: linkedStudent?.studentId || app.studentId || '',
        studentMobile: mobile,
        studentName: linkedStudent?.studentName || app.studentName,
        fatherName: linkedStudent?.fatherName || app.fatherName,
        studentClass: linkedStudent?.studentClass || app.studentClass,
        course: linkedStudent?.course || app.course,
        batch: linkedStudent?.batch || app.batch,
        academicSession: linkedStudent?.academicSession || academicSession,
        status: app.status,
        admissionStage: stage,
        studentStatus: linkedStudent?.status || '',
        feeAmount: linkedStudent?.feeAmount ?? app.feeAmount,
        paidAmount: linkedStudent?.paidAmount ?? app.paidAmount,
        paymentStatus: linkedStudent?.paymentStatus || app.paymentStatus,
        securityCode: linkedStudent?.securityCode || '',
        qrToken: linkedStudent?.qrToken || '',
        photoUrl: linkedStudent?.photoUrl || app.photoUrl,
        photoMediaId: linkedStudent?.photoMediaId || app.photoMediaId,
        remarks: app.remarks || '',
        submittedAt: app.submittedAt,
      });
    } catch (err) {
      console.warn(`Tracking backfill skipped for ${app.applicationNumber}:`, err);
    }
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
          studentMobile: cleanPhone(application.studentMobile) || String(application.studentMobile).trim(),
          studentWhatsapp:
            cleanPhone(application.studentWhatsapp || application.studentMobile) ||
            String(application.studentWhatsapp || application.studentMobile).trim(),
          fatherName: application.fatherName,
          fatherMobile: application.fatherMobile || '',
          motherName: application.motherName || '',
          motherMobile: application.motherMobile || '',
          ...(application.dob ? { dob: application.dob } : {}),
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
        // Sync verified student tracking profile & Student ID lookup index
        await syncAdminTrackingRecords({
          applicationNumber: application.applicationNumber,
          studentId: result.student.studentId,
          studentMobile: result.student.studentMobile,
          studentName: result.student.studentName,
          fatherName: result.student.fatherName,
          studentClass: result.student.studentClass,
          course: result.student.course,
          batch: result.student.batch,
          academicSession: result.student.academicSession,
          status: 'approved',
          admissionStage: 'Student ID Generated',
          studentStatus: 'active',
          feeAmount: result.student.feeAmount,
          paidAmount: result.student.paidAmount,
          paymentStatus: result.student.paymentStatus,
          securityCode: result.student.securityCode,
          qrToken: result.student.qrToken,
          photoUrl: result.student.photoUrl,
          photoMediaId: result.student.photoMediaId,
          remarks: `Congratulations! Admission approved. Your Student ID is ${result.student.studentId}.`,
          submittedAt: application.submittedAt,
        }).catch((syncErr) => console.warn('Tracking sync after approval warning:', syncErr));
        await syncStudentAttendanceLookupIndex(result.student).catch((syncErr) =>
          console.warn('Attendance lookup sync after approval warning:', syncErr)
        );
        await syncStudentPublicAttendanceYear(
          result.student,
          [],
          getSyncedServerIstNow().year
        ).catch((syncErr) =>
          console.warn('Public attendance ledger init after approval warning:', syncErr)
        );
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
    await syncAdminTrackingRecords({
      applicationNumber: application.applicationNumber,
      studentMobile: application.studentMobile,
      studentName: application.studentName,
      fatherName: application.fatherName,
      studentClass: application.studentClass,
      course: application.course,
      batch: application.batch,
      academicSession: '2026–2027',
      status: 'rejected',
      admissionStage: 'Rejected',
      feeAmount: application.feeAmount,
      paidAmount: application.paidAmount,
      paymentStatus: application.paymentStatus,
      photoUrl: application.photoUrl,
      photoMediaId: application.photoMediaId,
      remarks: cleanRemarks,
      submittedAt: application.submittedAt,
    }).catch((syncErr) => console.warn('Tracking sync after reject warning:', syncErr));
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
    await syncAdminTrackingRecords({
      applicationNumber: application.applicationNumber,
      studentId: application.studentId || '',
      studentMobile: String(allowed.studentMobile),
      previousMobile: application.studentMobile,
      studentName: String(allowed.studentName),
      fatherName: String(allowed.fatherName),
      studentClass: String(allowed.studentClass),
      course: String(allowed.course),
      batch: String(allowed.batch),
      academicSession: '2026–2027',
      status: application.status,
      admissionStage: deriveAdmissionStage(application.status, application.studentId),
      feeAmount: Number(allowed.feeAmount),
      paidAmount: application.paidAmount,
      paymentStatus: allowed.paymentStatus as PaymentStatus,
      photoUrl: application.photoUrl,
      photoMediaId: application.photoMediaId,
      remarks: String(allowed.remarks),
      submittedAt: application.submittedAt,
    }).catch((syncErr) => console.warn('Tracking sync after app edit warning:', syncErr));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `applications/${application.id}`);
  }
}

export async function deleteApplicationRecord(application: AdmissionApplication): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'applications', application.id));
    batch.delete(doc(db, 'applicationStatus', application.trackingKey));

    // Also remove tracking index and tracking profile for deleted application
    const cleanedMobile = cleanPhone(application.studentMobile);
    const appLookupId = await buildCodeLookupId(application.applicationNumber);
    batch.delete(doc(db, 'trackingIndex', appLookupId));
    if (application.studentId) {
      const stuLookupId = await buildCodeLookupId(application.studentId);
      batch.delete(doc(db, 'trackingIndex', stuLookupId));
    }
    if (cleanedMobile.length === 10) {
      const [profileKey, mobLookupId, mobileHash] = await Promise.all([
        buildProfileKey(application.applicationNumber, cleanedMobile),
        buildMobileLookupId(cleanedMobile),
        sha256Hex(cleanedMobile),
      ]);
      batch.delete(doc(db, 'studentTrackingProfiles', profileKey));
      const mobRef = doc(db, 'trackingIndex', mobLookupId);
      const mobSnap = await getDoc(mobRef).catch(() => null);
      if (mobSnap && mobSnap.exists() && Array.isArray(mobSnap.data().entries)) {
        const remaining = (mobSnap.data().entries as TrackingIndexEntry[]).filter(
          (e) => e.applicationNumber !== application.applicationNumber
        );
        if (remaining.length === 0) {
          batch.delete(mobRef);
        } else {
          batch.set(mobRef, {
            lookupType: 'mobile',
            maskedMobile: maskMobileNumber(cleanedMobile),
            mobileHash,
            entries: remaining,
            updatedAt: serverTimestamp(),
          });
        }
      }
    }

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
    const nextMobile = cleanPhone(updates.studentMobile ?? student.studentMobile);
    const nextName = (updates.studentName ?? student.studentName).trim().slice(0, 120);
    const nextFather = (updates.fatherName ?? student.fatherName).trim().slice(0, 120);
    const nextClass = (updates.studentClass ?? student.studentClass).trim().slice(0, 40);
    const nextCourse = (updates.course ?? student.course).trim().slice(0, 100);
    const nextBatch = (updates.batch ?? student.batch).trim().slice(0, 80);
    const nextStatus = updates.status ?? student.status;

    await updateDoc(doc(db, 'students', student.studentId), {
      studentName: nextName,
      studentMobile: nextMobile,
      studentWhatsapp: cleanPhone(updates.studentWhatsapp ?? student.studentWhatsapp ?? student.studentMobile),
      fatherName: nextFather,
      fatherMobile: cleanPhone(updates.fatherMobile ?? student.fatherMobile ?? ''),
      studentClass: nextClass,
      course: nextCourse,
      batch: nextBatch,
      address: (updates.address ?? student.address ?? '').trim().slice(0, 400),
      feeAmount: newFee,
      paidAmount: newPaid,
      paymentStatus: newPaymentStatus,
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });

    await syncAdminTrackingRecords({
      applicationNumber: student.applicationNumber,
      studentId: student.studentId,
      studentMobile: nextMobile,
      previousMobile: student.studentMobile,
      studentName: nextName,
      fatherName: nextFather,
      studentClass: nextClass,
      course: nextCourse,
      batch: nextBatch,
      academicSession: student.academicSession,
      status: 'approved',
      admissionStage: 'Student ID Generated',
      studentStatus: nextStatus,
      feeAmount: newFee,
      paidAmount: newPaid,
      paymentStatus: newPaymentStatus,
      securityCode: student.securityCode,
      qrToken: student.qrToken,
      photoUrl: student.photoUrl,
      photoMediaId: student.photoMediaId,
      submittedAt: student.approvedAt,
    }).catch((syncErr) => console.warn('Tracking sync after student edit warning:', syncErr));

    await syncStudentAttendanceLookupIndex(
      {
        ...student,
        studentName: nextName,
        studentMobile: nextMobile,
        fatherName: nextFather,
        studentClass: nextClass,
        course: nextCourse,
        batch: nextBatch,
        status: nextStatus,
      },
      student.studentMobile
    ).catch((syncErr) => console.warn('Attendance lookup sync after student edit warning:', syncErr));
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

    await syncAdminTrackingRecords({
      applicationNumber: student.applicationNumber,
      studentId: student.studentId,
      studentMobile: student.studentMobile,
      studentName: student.studentName,
      fatherName: student.fatherName,
      studentClass: student.studentClass,
      course: student.course,
      batch: student.batch,
      academicSession: student.academicSession,
      status: 'approved',
      admissionStage: 'Student ID Generated',
      studentStatus: nextStatus,
      feeAmount: student.feeAmount,
      paidAmount: student.paidAmount,
      paymentStatus: student.paymentStatus,
      securityCode: student.securityCode,
      qrToken: student.qrToken,
      photoUrl: student.photoUrl,
      photoMediaId: student.photoMediaId,
      submittedAt: student.approvedAt,
    }).catch((syncErr) => console.warn('Tracking sync after status toggle warning:', syncErr));

    await syncStudentAttendanceLookupIndex({
      ...student,
      status: nextStatus,
    }).catch((syncErr) => console.warn('Attendance lookup sync after status toggle warning:', syncErr));
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

      if (done) {
        await syncAdminTrackingRecords({
          applicationNumber: student.applicationNumber,
          studentId: student.studentId,
          studentMobile: student.studentMobile,
          studentName: student.studentName,
          fatherName: student.fatherName,
          studentClass: student.studentClass,
          course: student.course,
          batch: student.batch,
          academicSession: student.academicSession,
          status: 'approved',
          admissionStage: 'Student ID Generated',
          studentStatus: student.status,
          feeAmount: student.feeAmount,
          paidAmount: student.paidAmount,
          paymentStatus: student.paymentStatus,
          securityCode: newCode,
          qrToken: student.qrToken,
          photoUrl: student.photoUrl,
          photoMediaId: student.photoMediaId,
          submittedAt: student.approvedAt,
        }).catch((syncErr) => console.warn('Tracking sync after code regen warning:', syncErr));
        return newCode;
      }
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

    // Sync fee payment status to studentTrackingProfiles
    if (params.student) {
      const nextPaid = params.student.paidAmount + amount;
      const nextStatus = computePaymentStatus(params.student.feeAmount, nextPaid);
      await syncAdminTrackingRecords({
        applicationNumber: params.student.applicationNumber,
        studentId: params.student.studentId,
        studentMobile: params.student.studentMobile,
        studentName: params.student.studentName,
        fatherName: params.student.fatherName,
        studentClass: params.student.studentClass,
        course: params.student.course,
        batch: params.student.batch,
        academicSession: params.student.academicSession,
        status: 'approved',
        admissionStage: 'Student ID Generated',
        studentStatus: params.student.status,
        feeAmount: params.student.feeAmount,
        paidAmount: nextPaid,
        paymentStatus: nextStatus,
        securityCode: params.student.securityCode,
        qrToken: params.student.qrToken,
        photoUrl: params.student.photoUrl,
        photoMediaId: params.student.photoMediaId,
        submittedAt: params.student.approvedAt,
      }).catch((syncErr) => console.warn('Tracking sync after student payment warning:', syncErr));
    } else if (params.application) {
      const nextPaid = params.application.paidAmount + amount;
      const nextStatus = computePaymentStatus(params.application.feeAmount, nextPaid);
      await syncAdminTrackingRecords({
        applicationNumber: params.application.applicationNumber,
        studentId: params.application.studentId || '',
        studentMobile: params.application.studentMobile,
        studentName: params.application.studentName,
        fatherName: params.application.fatherName,
        studentClass: params.application.studentClass,
        course: params.application.course,
        batch: params.application.batch,
        academicSession: '2026–2027',
        status: params.application.status,
        admissionStage: deriveAdmissionStage(params.application.status, params.application.studentId),
        feeAmount: params.application.feeAmount,
        paidAmount: nextPaid,
        paymentStatus: nextStatus,
        photoUrl: params.application.photoUrl,
        photoMediaId: params.application.photoMediaId,
        remarks: params.application.remarks || '',
        submittedAt: params.application.submittedAt,
      }).catch((syncErr) => console.warn('Tracking sync after app payment warning:', syncErr));
    }

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

const ALLOWED_INTERNAL_CTA_TARGETS = new Set([
  'apply',
  'attendance',
  'track',
  'whatsapp',
  '#courses',
  '#batches',
  '#about',
  '#gallery',
  '#contact',
]);

export function sanitizeBannerCtaTarget(raw?: string): string {
  const val = (raw || '').trim().slice(0, 300);
  if (!val) return '';
  if (ALLOWED_INTERNAL_CTA_TARGETS.has(val)) return val;
  if (/^https:\/\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(val)) {
    return val;
  }
  return '';
}

export async function saveBanner(
  banner: Omit<BannerItem, 'id' | 'updatedAt'> & { id?: string },
  imageFile?: File | null
): Promise<void> {
  const id = sanitizeId(banner.id || `banner_${Date.now()}`);
  let imageUrl = banner.imageUrl || '';
  let mediaId = banner.mediaId || '';

  if (imageFile) {
    const uploaded = await uploadMediaSmart(imageFile, 'banners', false, 1440);
    imageUrl = uploaded.url;
    mediaId = uploaded.mediaId;
  }

  const safeTarget = sanitizeBannerCtaTarget(banner.ctaTarget);

  try {
    await setDoc(doc(db, 'banners', id), {
      title: banner.title.trim().slice(0, 140),
      subtitle: (banner.subtitle || '').trim().slice(0, 180),
      description: (banner.description || '').trim().slice(0, 500),
      announcement: (banner.announcement || '').trim().slice(0, 240),
      ctaLabel: (banner.ctaLabel || '').trim().slice(0, 60),
      ctaTarget: safeTarget,
      imageUrl,
      mediaId,
      order: Math.max(0, Math.min(1000, Number(banner.order) || 1)),
      active: Boolean(banner.active),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `banners/${id}`);
  }
}

export async function reorderBanners(orderedBanners: BannerItem[]): Promise<void> {
  if (orderedBanners.length === 0) return;
  try {
    const batch = writeBatch(db);
    orderedBanners.forEach((b, idx) => {
      batch.set(doc(db, 'banners', sanitizeId(b.id)), {
        title: b.title.trim().slice(0, 140),
        subtitle: (b.subtitle || '').trim().slice(0, 180),
        description: (b.description || '').trim().slice(0, 500),
        announcement: (b.announcement || '').trim().slice(0, 240),
        ctaLabel: (b.ctaLabel || '').trim().slice(0, 60),
        ctaTarget: sanitizeBannerCtaTarget(b.ctaTarget),
        imageUrl: b.imageUrl || '',
        mediaId: b.mediaId || '',
        order: idx + 1,
        active: Boolean(b.active),
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'banners/reorder');
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

export async function saveTeacherBanner(
  banner: {
    id?: string;
    teacherEmail: string;
    title: string;
    description?: string;
    className: string;
    batchId?: string;
    batchName: string;
    batchTiming?: string;
    whatsappUrl?: string;
    telegramUrl?: string;
    active?: boolean;
    order?: number;
  },
  imageFile?: File | null
): Promise<void> {
  const id = sanitizeId(banner.id || `tbanner_${Date.now()}`);
  let imageUrl = '';
  let mediaId = '';

  if (imageFile) {
    const uploaded = await uploadMediaSmart(imageFile, 'teacherBanners', false, 1200);
    imageUrl = uploaded.url;
    mediaId = uploaded.mediaId;
  }

  try {
    const docRef = doc(db, 'teacherBanners', id);
    const existing = await getDoc(docRef).catch(() => null);
    const existingData = existing?.exists() ? existing.data() : null;

    await setDoc(docRef, {
      teacherEmail: banner.teacherEmail.trim().toLowerCase().slice(0, 200),
      title: banner.title.trim().slice(0, 140),
      description: (banner.description || '').trim().slice(0, 500),
      className: (banner.className || 'Class 12').trim().slice(0, 60),
      batchId: (banner.batchId || '').trim().slice(0, 100),
      batchName: (banner.batchName || '').trim().slice(0, 100),
      batchTiming: (banner.batchTiming || '').trim().slice(0, 80),
      whatsappUrl: sanitizeBannerCtaTarget(banner.whatsappUrl),
      telegramUrl: sanitizeBannerCtaTarget(banner.telegramUrl),
      imageUrl: imageUrl || existingData?.imageUrl || '',
      mediaId: mediaId || existingData?.mediaId || '',
      status: existingData?.status === 'approved' ? 'approved' : 'pending',
      active: banner.active !== false,
      order: Number(banner.order) || 1,
      createdAt: existingData?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `teacherBanners/${id}`);
  }
}

export async function setTeacherBannerStatus(
  id: string,
  status: 'approved' | 'rejected'
): Promise<void> {
  try {
    await updateDoc(doc(db, 'teacherBanners', id), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `teacherBanners/${id}`);
  }
}

export async function deleteTeacherBanner(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'teacherBanners', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `teacherBanners/${id}`);
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

export function sanitizeHttpsUrl(raw?: string): string {
  const val = (raw || '').trim().slice(0, 400);
  if (!val) return '';
  if (/^https:\/\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(val)) {
    return val;
  }
  return '';
}

export async function uploadBatchLogo(file: File | Blob, fileName?: string): Promise<{ url: string; mediaId: string }> {
  return uploadMediaSmart(file, 'batch_logos', false, 512, true, fileName);
}

export async function uploadBrandingAsset(
  file: File | Blob,
  kind: 'main_logo' | 'app_logo' | 'favicon',
  fileName?: string
): Promise<{ url: string; mediaId: string }> {
  const maxDim = kind === 'favicon' ? 256 : 512;
  return uploadMediaSmart(file, `branding_${kind}`, false, maxDim, true, fileName);
}

export async function saveBatch(
  batchItem: Omit<BatchItem, 'id' | 'updatedAt'> & { id?: string }
): Promise<void> {
  const id = sanitizeId(batchItem.id || `batch_${Date.now()}`);
  const cleanScheduledDays =
    Array.isArray(batchItem.scheduledDays) && batchItem.scheduledDays.length > 0
      ? [...new Set(batchItem.scheduledDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
          (a, b) => a - b
        )
      : DEFAULT_SCHEDULED_DAYS;
  const cleanStartDate =
    batchItem.scheduleStartDate && /^\d{4}-\d{2}-\d{2}$/.test(batchItem.scheduleStartDate.trim())
      ? batchItem.scheduleStartDate.trim()
      : '';

  try {
    await setDoc(doc(db, 'batches', id), {
      name: batchItem.name.trim().slice(0, 80),
      timing: batchItem.timing.trim().slice(0, 80),
      className: (batchItem.className || '').trim().slice(0, 60),
      courseName: (batchItem.courseName || '').trim().slice(0, 100),
      capacity: Math.max(1, Number(batchItem.capacity) || 60),
      feeOverride:
        batchItem.feeOverride !== null &&
        batchItem.feeOverride !== undefined &&
        Number(batchItem.feeOverride) > 0
          ? Number(batchItem.feeOverride)
          : null,
      scheduledDays: cleanScheduledDays,
      scheduleStartDate: cleanStartDate,
      instagramUrl: sanitizeHttpsUrl(batchItem.instagramUrl),
      telegramUrl: sanitizeHttpsUrl(batchItem.telegramUrl),
      whatsappUrl: sanitizeHttpsUrl(batchItem.whatsappUrl),
      socialLinksActive: batchItem.socialLinksActive !== false,
      logoUrl: (batchItem.logoUrl || '').trim().slice(0, 2000),
      logoMediaId: (batchItem.logoMediaId || '').trim().slice(0, 128),
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

export async function uploadTeacherProfilePhoto(
  file: File | Blob,
  preserveTransparency = false,
  fileName?: string
): Promise<{ url: string; mediaId: string }> {
  return uploadMediaSmart(
    file,
    'teacher_profile',
    false,
    preserveTransparency ? 720 : 800,
    preserveTransparency,
    fileName
  );
}

export async function saveInstituteSettings(
  settings: Omit<InstituteSettings, 'id' | 'updatedAt'>
): Promise<void> {
  const sliderIntervalRaw = Number(settings.bannerSliderIntervalSec);
  const bannerSliderIntervalSec =
    Number.isFinite(sliderIntervalRaw) && sliderIntervalRaw >= 2 && sliderIntervalRaw <= 30
      ? Math.round(sliderIntervalRaw)
      : 5;

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
      attendanceExitTracking: Boolean(settings.attendanceExitTracking),
      bannerSliderIntervalSec,
      bannerAutoSlide: settings.bannerAutoSlide !== false,
      teacherPhotoUrl: (settings.teacherPhotoUrl || '').trim().slice(0, 2000),
      teacherPhotoMediaId: (settings.teacherPhotoMediaId || '').trim().slice(0, 128),
      teacherPhotoOriginalUrl: (settings.teacherPhotoOriginalUrl || '').trim().slice(0, 2000),
      teacherPhotoOriginalMediaId: (settings.teacherPhotoOriginalMediaId || '').trim().slice(0, 128),
      teacherPhotoIsCutout: Boolean(settings.teacherPhotoIsCutout),
      teacherDesignation: (settings.teacherDesignation || 'Chemistry Teacher').trim().slice(0, 80),
      teacherBio: (settings.teacherBio || '').trim().slice(0, 600),
      teacherExperience: (settings.teacherExperience || '').trim().slice(0, 120),
      teacherSpecialization: (settings.teacherSpecialization || '').trim().slice(0, 160),
      teacherContactNumber: (settings.teacherContactNumber || '').trim().slice(0, 30),
      teacherWhatsappNumber: (settings.teacherWhatsappNumber || '').trim().slice(0, 30),
      teacherEmail: (settings.teacherEmail || '').trim().slice(0, 160),
      idCardMotivationalMessage: (settings.idCardMotivationalMessage || '').trim().slice(0, 600),
      instagramUrl: sanitizeHttpsUrl(settings.instagramUrl),
      telegramChannelUrl: sanitizeHttpsUrl(settings.telegramChannelUrl),
      telegramGroupUrl: sanitizeHttpsUrl(settings.telegramGroupUrl),
      whatsappCommunityUrl: sanitizeHttpsUrl(settings.whatsappCommunityUrl),
      socialLinksActive: settings.socialLinksActive !== false,
      mainLogoUrl: (settings.mainLogoUrl || '').trim().slice(0, 2000),
      mainLogoMediaId: (settings.mainLogoMediaId || '').trim().slice(0, 128),
      appLogoUrl: (settings.appLogoUrl || '').trim().slice(0, 2000),
      appLogoMediaId: (settings.appLogoMediaId || '').trim().slice(0, 128),
      faviconUrl: (settings.faviconUrl || '').trim().slice(0, 2000),
      faviconMediaId: (settings.faviconMediaId || '').trim().slice(0, 128),
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
  onAttendance?: (items: AttendanceRecord[]) => void;
  onAttendanceAuditLogs?: (items: AttendanceAuditLog[]) => void;
  onAttendanceHolidays?: (items: AttendanceHoliday[]) => void;
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
    ...(handlers.onAttendance
      ? [
          onSnapshot(
            collection(db, 'attendance'),
            (snap) => {
              const items = snap.docs
                .map((d) => ({ id: d.id, ...d.data() }) as AttendanceRecord)
                .sort((a, b) => {
                  if (a.attendanceDate !== b.attendanceDate) {
                    return b.attendanceDate.localeCompare(a.attendanceDate);
                  }
                  const ta = toEpochMs(a.entryTime || a.createdAt) || 0;
                  const tb = toEpochMs(b.entryTime || b.createdAt) || 0;
                  return tb - ta;
                });
              handlers.onAttendance?.(items);
            },
            (err) => report(err, 'attendance')
          ),
        ]
      : []),
    ...(handlers.onAttendanceAuditLogs
      ? [
          onSnapshot(
            collection(db, 'attendanceAuditLogs'),
            (snap) => {
              const items = snap.docs
                .map((d) => ({ id: d.id, ...d.data() }) as AttendanceAuditLog)
                .sort((a, b) => (toEpochMs(b.modifiedAt) || 0) - (toEpochMs(a.modifiedAt) || 0));
              handlers.onAttendanceAuditLogs?.(items);
            },
            (err) => report(err, 'attendanceAuditLogs')
          ),
        ]
      : []),
    ...(handlers.onAttendanceHolidays
      ? [
          onSnapshot(
            collection(db, 'attendanceHolidays'),
            (snap) => {
              const items = snap.docs
                .map((d) => ({ id: d.id, ...d.data() }) as AttendanceHoliday)
                .sort((a, b) => b.date.localeCompare(a.date));
              handlers.onAttendanceHolidays?.(items);
            },
            (err) => report(err, 'attendanceHolidays')
          ),
        ]
      : []),
  ];

  return () => {
    unsubs.forEach((u) => u());
  };
}

// =============================================================================
// QR-BASED AUTOMATIC ATTENDANCE MANAGEMENT SYSTEM
// =============================================================================

export async function buildPublicAttendanceKey(
  studentId: string,
  rawMobile: string,
  year: number
): Promise<string> {
  const normId = sanitizeId(studentId.trim().toUpperCase());
  const cleaned = cleanPhone(rawMobile);
  const hash = await sha256Hex(`${normId}:${cleaned}`);
  return `attpub_${hash}_${year}`;
}

export async function buildAttendanceIdLookupKey(studentId: string): Promise<string> {
  const normId = sanitizeId(studentId.trim().toUpperCase());
  const hash = await sha256Hex(normId);
  return `attid_${hash}`;
}

export async function buildAttendanceMobileLookupKey(rawMobile: string): Promise<string> {
  const cleaned = cleanPhone(rawMobile);
  const hash = await sha256Hex(cleaned);
  return `attmob_${hash}`;
}

export async function buildPublicAttendanceByIdKey(
  studentId: string,
  year: number
): Promise<string> {
  const normId = sanitizeId(studentId.trim().toUpperCase());
  const hash = await sha256Hex(normId);
  return `attid_${hash}_${year}`;
}

async function buildAttendanceLookupEntryPayload(
  student: StudentRecord,
  existingPhotoDataUrl = ''
): Promise<Omit<AttendanceLookupEntry, '_legacyMobile'>> {
  const normId = sanitizeId(student.studentId.trim().toUpperCase());
  const cleanedMobile = cleanPhone(student.studentMobile);
  const attendanceKeyHash = await sha256Hex(normId);

  let photoDataUrl = existingPhotoDataUrl || '';
  if (!photoDataUrl && !student.photoUrl && student.photoMediaId) {
    const rawMedia = await resolveMediaSource('', student.photoMediaId, true).catch(() => '');
    if (rawMedia) {
      photoDataUrl = await shrinkImageDataUrlForProfile(rawMedia).catch(() => '');
    }
  }

  return {
    studentId: normId,
    studentName: (student.studentName || 'Student').trim().slice(0, 120) || 'Student',
    fatherName: (student.fatherName || '—').trim().slice(0, 120) || '—',
    studentClass: (student.studentClass || '—').trim().slice(0, 40) || '—',
    course: (student.course || 'Chemistry').trim().slice(0, 100) || 'Chemistry',
    batch: (student.batch || 'General').trim().slice(0, 80) || 'General',
    maskedMobile: maskMobileNumber(cleanedMobile),
    photoUrl: (student.photoUrl || '').trim().slice(0, 2000),
    photoDataUrl: photoDataUrl.slice(0, 250000),
    enrolledDate: formatIstDateYmd(student.approvedAt) || '',
    attendanceKeyHash,
  };
}

/**
 * Caps total inline photoDataUrl size across entries sharing one mobile lookup document
 * so multi-student mobile buckets never approach Firestore's 1MB document ceiling.
 */
function capMobileBucketEntries(
  entries: AttendanceLookupEntry[]
): Omit<AttendanceLookupEntry, '_legacyMobile'>[] {
  const MAX_TOTAL_PHOTO_BYTES = 550000;
  let runningBytes = 0;
  return entries.slice(0, 10).map((item) => {
    const { _legacyMobile: _ignored, ...clean } = item;
    const rawPhoto = typeof clean.photoDataUrl === 'string' ? clean.photoDataUrl : '';
    if (rawPhoto && runningBytes + rawPhoto.length <= MAX_TOTAL_PHOTO_BYTES) {
      runningBytes += rawPhoto.length;
      return clean;
    }
    return { ...clean, photoDataUrl: '' };
  });
}

/**
 * Admin-only synchronizer maintaining /attendanceLookupIndex for ONLY approved & active students.
 * Suspended students are immediately removed from both ID and mobile lookup indexes.
 */
export async function syncStudentAttendanceLookupIndex(
  student: StudentRecord,
  previousMobile?: string
): Promise<void> {
  const normId = sanitizeId((student.studentId || '').trim().toUpperCase());
  const cleanedMobile = cleanPhone(student.studentMobile || student.studentWhatsapp || '');
  if (normId.length < 4 || cleanedMobile.length !== 10) return;

  const [idLookupKey, mobLookupKey] = await Promise.all([
    buildAttendanceIdLookupKey(normId),
    buildAttendanceMobileLookupKey(cleanedMobile),
  ]);
  const idRef = doc(db, 'attendanceLookupIndex', idLookupKey);
  const mobRef = doc(db, 'attendanceLookupIndex', mobLookupKey);
  const nowTs = serverTimestamp();

  const existingIdSnap = await getDoc(idRef).catch(() => null);
  const existingPhotoDataUrl =
    existingIdSnap?.exists() &&
    Array.isArray(existingIdSnap.data().entries) &&
    typeof existingIdSnap.data().entries[0]?.photoDataUrl === 'string'
      ? (existingIdSnap.data().entries[0].photoDataUrl as string)
      : '';

  const batch = writeBatch(db);

  if (student.status === 'active') {
    const entry = await buildAttendanceLookupEntryPayload(student, existingPhotoDataUrl);
    batch.set(idRef, {
      lookupType: 'id',
      entries: [entry],
      updatedAt: nowTs,
    });

    const mobSnap = await getDoc(mobRef).catch(() => null);
    const existingEntries: AttendanceLookupEntry[] =
      mobSnap?.exists() && Array.isArray(mobSnap.data().entries)
        ? (mobSnap.data().entries as AttendanceLookupEntry[]).filter(
            (e) => e.studentId !== normId
          )
        : [];
    const nextMobEntries = capMobileBucketEntries([...existingEntries, entry]);
    batch.set(mobRef, {
      lookupType: 'mobile',
      entries: nextMobEntries,
      updatedAt: nowTs,
    });
  } else {
    // Suspended student: remove from direct attendance lookup immediately
    if (existingIdSnap?.exists()) {
      batch.delete(idRef);
    }
    const mobSnap = await getDoc(mobRef).catch(() => null);
    if (mobSnap?.exists() && Array.isArray(mobSnap.data().entries)) {
      const remaining = (mobSnap.data().entries as AttendanceLookupEntry[]).filter(
        (e) => e.studentId !== normId
      );
      if (remaining.length === 0) {
        batch.delete(mobRef);
      } else {
        batch.set(mobRef, {
          lookupType: 'mobile',
          entries: capMobileBucketEntries(remaining),
          updatedAt: nowTs,
        });
      }
    }
  }

  // Clean up old mobile lookup bucket if the student's registered mobile changed
  const prevClean = cleanPhone(previousMobile || '');
  if (prevClean.length === 10 && prevClean !== cleanedMobile) {
    const prevMobKey = await buildAttendanceMobileLookupKey(prevClean);
    const prevMobRef = doc(db, 'attendanceLookupIndex', prevMobKey);
    const prevSnap = await getDoc(prevMobRef).catch(() => null);
    if (prevSnap?.exists() && Array.isArray(prevSnap.data().entries)) {
      const remaining = (prevSnap.data().entries as AttendanceLookupEntry[]).filter(
        (e) => e.studentId !== normId
      );
      if (remaining.length === 0) {
        batch.delete(prevMobRef);
      } else {
        batch.set(prevMobRef, {
          lookupType: 'mobile',
          entries: capMobileBucketEntries(remaining),
          updatedAt: nowTs,
        });
      }
    }
  }

  await batch.commit();
}

/**
 * Syncs an approved student's yearly attendance ledger to /studentAttendancePublic/{key}
 * under both attid_<sha256(studentId)>_<year> and legacy attpub_<sha256(studentId:mobile)>_<year>,
 * and refreshes the privacy-minimized /attendanceLookupIndex entry.
 */
export async function syncStudentPublicAttendanceYear(
  student: StudentRecord,
  batches: BatchItem[],
  year: number,
  extraRecord?: { date: string; entry: StudentAttendanceDayEntry }
): Promise<void> {
  const normId = sanitizeId((student.studentId || '').trim().toUpperCase());
  if (normId.length < 4) return;

  const cleanedMobile = cleanPhone(student.studentMobile || student.studentWhatsapp || '');
  const resolvedBatch = resolveStudentBatch(student.batch, batches);
  const attIdKey = await buildPublicAttendanceByIdKey(normId, year);
  const attLegacyKey =
    cleanedMobile.length === 10 ? await buildPublicAttendanceKey(normId, cleanedMobile, year) : '';
  const enrolledDate = formatIstDateYmd(student.approvedAt) || '';

  try {
    const q = query(collection(db, 'attendance'), where('studentId', '==', student.studentId));
    const snap = await getDocs(q);

    const records: Record<string, StudentAttendanceDayEntry> = {};
    snap.docs.forEach((d) => {
      const data = d.data() as AttendanceRecord;
      if (data.attendanceDate && data.attendanceDate.startsWith(`${year}-`)) {
        records[data.attendanceDate] = {
          status: data.attendanceStatus,
          entryTimeMs: toEpochMs(data.entryTime),
          exitTimeMs: toEpochMs(data.exitTime),
          batchTiming: (data.batchTiming || resolvedBatch.batchTiming).slice(0, 80),
        };
      }
    });

    if (extraRecord && extraRecord.date.startsWith(`${year}-`)) {
      records[extraRecord.date] = extraRecord.entry;
    }

    const ledgerPayload = {
      studentId: normId,
      year,
      batchId: resolvedBatch.batchId.slice(0, 100) || 'default_batch',
      batchTiming: resolvedBatch.batchTiming.slice(0, 80) || 'Regular Batch',
      enrolledDate,
      scheduledDays: resolvedBatch.scheduledDays,
      records,
      updatedAt: serverTimestamp(),
    };

    const batch = writeBatch(db);
    batch.set(doc(db, 'studentAttendancePublic', attIdKey), ledgerPayload);
    if (attLegacyKey) {
      batch.set(doc(db, 'studentAttendancePublic', attLegacyKey), ledgerPayload);
    }
    await batch.commit();

    await syncStudentAttendanceLookupIndex(student).catch(() => {
      /* Non-blocking refresh */
    });
  } catch (err) {
    console.warn(`Public attendance sync skipped for ${student.studentId}:`, err);
  }
}

export type QrAttendanceOutcome =
  | 'MARKED_PRESENT'
  | 'EXIT_RECORDED'
  | 'ALREADY_PRESENT'
  | 'REJECTED_SUSPENDED'
  | 'REJECTED_PENDING'
  | 'REJECTED_INVALID';

export interface QrAttendanceResult {
  outcome: QrAttendanceOutcome;
  title: string;
  message: string;
  scannedCode: string;
  attendanceDate: string; // YYYY-MM-DD (IST)
  timeLabel: string; // IST time string
  student?: StudentRecord;
  application?: AdmissionApplication;
  batchTiming?: string;
  entryTimeLabel?: string;
  exitTimeLabel?: string;
  attendanceId?: string;
  latencyMs?: number;
}

/**
 * Ultra-Fast Automatic Continuous QR Attendance Transaction:
 * - Uses pre-synced server IST clock offset (0ms blocking HTTP latency) while
 *   Firestore security rules strictly enforce serverTimestamp() (`request.time`)
 * - Fetches only the required /students/{studentId} and /attendance/{attendanceId}
 *   documents inside a single atomic Firestore transaction (parallelized in 1 RTT
 *   when a speculative batch hint is available — hints are never trusted for auth)
 * - Strictly verifies student exists and status === 'active' against Firebase
 * - Guarantees max one valid attendance record per student per batch per day
 * - Optionally records separate Exit time when enabled by admin (60s anti-bounce)
 * - Runs scan audit logging and public attendance sync non-blockingly after commit
 */
export async function recordQrAttendanceTransaction(
  rawQrText: string,
  batches: BatchItem[],
  adminEmail: string,
  enableExitTracking = false,
  studentBatchHintMap?: Map<string, string>
): Promise<QrAttendanceResult> {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const elapsed = () =>
    Math.max(1, Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt));

  const cleanedRaw = rawQrText.trim().slice(0, 180);
  const extractedId = cleanedRaw.startsWith('ZOC:') ? cleanedRaw.slice(4).trim() : cleanedRaw;
  const isIdSafe = /^[a-zA-Z0-9_\-]{3,128}$/.test(extractedId);

  const serverIst = getSyncedServerIstNow();
  const istDate = serverIst.date;
  const timeLabel = `${serverIst.time} IST`;

  const writeScanAudit = (
    statusResult: ScanStatusResult,
    reason: string,
    studentId = '',
    studentName = 'Unknown'
  ) => {
    const scanId = `SCAN_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;
    void setDoc(doc(db, 'scanHistory', scanId), {
      scannedCode: cleanedRaw || 'EMPTY',
      studentId: studentId.slice(0, 64),
      studentName: studentName.slice(0, 120),
      statusResult,
      reason: reason.slice(0, 240),
      scannedBy: adminEmail,
      scannedAt: serverTimestamp(),
    }).catch((e) => {
      console.warn('Scan audit write warning:', e);
    });
  };

  if (!isIdSafe) {
    const msg = 'Not a valid institute Student ID QR code.';
    writeScanAudit('INVALID', msg);
    return {
      outcome: 'REJECTED_INVALID',
      title: 'Invalid Student ID',
      message: msg,
      scannedCode: cleanedRaw,
      attendanceDate: istDate,
      timeLabel,
      latencyMs: elapsed(),
    };
  }

  type TxInnerResult =
    | { notFound: true }
    | {
        notFound: false;
        outcome: QrAttendanceOutcome;
        title: string;
        message: string;
        student: StudentRecord;
        batchTiming?: string;
        attendanceId?: string;
        entryTimeLabel?: string;
        exitTimeLabel?: string;
        entryMs?: number | null;
        exitMs?: number | null;
      };

  const executeStudentTransaction = async (targetStudentId: string): Promise<TxInnerResult> => {
    return runTransaction(db, async (tx) => {
      const stuRef = doc(db, 'students', targetStudentId);

      // Speculative 1-RTT parallel read using read-only batch hint (NEVER trusted for auth or write)
      const hintBatch = studentBatchHintMap?.get(targetStudentId);
      let predictedAttId: string | null = null;
      let stuSnap;
      let preAttSnap = null;

      if (hintBatch) {
        const hintResolved = resolveStudentBatch(hintBatch, batches);
        predictedAttId = buildAttendanceDocId(targetStudentId, hintResolved.batchId, istDate);
        const [sSnap, aSnap] = await Promise.all([
          tx.get(stuRef),
          tx.get(doc(db, 'attendance', predictedAttId)),
        ]);
        stuSnap = sSnap;
        preAttSnap = aSnap;
      } else {
        stuSnap = await tx.get(stuRef);
      }

      if (!stuSnap.exists()) {
        return { notFound: true as const };
      }

      const student = { id: stuSnap.id, ...stuSnap.data() } as StudentRecord;
      if (student.status !== 'active') {
        return {
          notFound: false as const,
          outcome: 'REJECTED_SUSPENDED' as const,
          title: 'Student Suspended',
          message: 'Student ID is suspended. Attendance cannot be recorded.',
          student,
        };
      }

      const resolvedBatch = resolveStudentBatch(student.batch, batches);
      const attendanceId = buildAttendanceDocId(student.studentId, resolvedBatch.batchId, istDate);
      const attRef = doc(db, 'attendance', attendanceId);
      const attSnap =
        preAttSnap && predictedAttId === attendanceId ? preAttSnap : await tx.get(attRef);
      const nowTs = serverTimestamp();

      if (!attSnap.exists()) {
        tx.set(attRef, {
          attendanceId,
          studentId: student.studentId,
          studentName: student.studentName.trim().slice(0, 120),
          batchId: resolvedBatch.batchId,
          batchTiming: resolvedBatch.batchTiming.slice(0, 80),
          class: student.studentClass.trim().slice(0, 40),
          course: student.course.trim().slice(0, 100),
          attendanceDate: istDate,
          entryTime: nowTs,
          attendanceStatus: 'Present',
          source: 'qr',
          recordedBy: adminEmail,
          createdAt: nowTs,
          updatedAt: nowTs,
        });

        return {
          notFound: false as const,
          outcome: 'MARKED_PRESENT' as const,
          title: 'Attendance Marked Successfully',
          message: `Present recorded for ${resolvedBatch.batchTiming}.`,
          student,
          batchTiming: resolvedBatch.batchTiming,
          attendanceId,
          entryTimeLabel: timeLabel,
          entryMs: serverIst.epochMs,
          exitMs: null as number | null,
        };
      }

      const existing = attSnap.data() as AttendanceRecord;
      const existingEntryMs = toEpochMs(existing.entryTime);
      const existingExitMs = toEpochMs(existing.exitTime);

      if (existing.attendanceStatus === 'Absent') {
        tx.update(attRef, {
          attendanceStatus: 'Present',
          entryTime: nowTs,
          source: 'manual',
          lastModifiedBy: adminEmail,
          correctionReason: 'Student checked in via automatic QR scanner',
          updatedAt: nowTs,
        });
        return {
          notFound: false as const,
          outcome: 'MARKED_PRESENT' as const,
          title: 'Attendance Marked Successfully',
          message: `Updated to Present for ${resolvedBatch.batchTiming}.`,
          student,
          batchTiming: resolvedBatch.batchTiming,
          attendanceId,
          entryTimeLabel: timeLabel,
          entryMs: serverIst.epochMs,
          exitMs: null as number | null,
        };
      }

      // Already marked Present for today in this batch
      if (enableExitTracking && !existingExitMs) {
        const elapsedMs = existingEntryMs ? serverIst.epochMs - existingEntryMs : 65_000;
        if (elapsedMs >= 60_000) {
          tx.update(attRef, {
            exitTime: nowTs,
            source: 'qr',
            lastModifiedBy: adminEmail,
            updatedAt: nowTs,
          });
          return {
            notFound: false as const,
            outcome: 'EXIT_RECORDED' as const,
            title: 'Exit Time Recorded',
            message: `Exit logged at ${timeLabel}.`,
            student,
            batchTiming: existing.batchTiming || resolvedBatch.batchTiming,
            attendanceId,
            entryTimeLabel: existingEntryMs ? formatIstTime(existingEntryMs) : '—',
            exitTimeLabel: timeLabel,
            entryMs: existingEntryMs,
            exitMs: serverIst.epochMs,
          };
        }
        return {
          notFound: false as const,
          outcome: 'ALREADY_PRESENT' as const,
          title: 'Already Marked Present',
          message: `Entry recorded at ${existingEntryMs ? formatIstTime(existingEntryMs) : 'today'}. Wait 1 minute to scan exit.`,
          student,
          batchTiming: existing.batchTiming || resolvedBatch.batchTiming,
          attendanceId,
          entryTimeLabel: existingEntryMs ? formatIstTime(existingEntryMs) : '—',
          entryMs: existingEntryMs,
          exitMs: null as number | null,
        };
      }

      return {
        notFound: false as const,
        outcome: 'ALREADY_PRESENT' as const,
        title: 'Already Marked Present',
        message: existingExitMs
          ? `Entry (${existingEntryMs ? formatIstTime(existingEntryMs) : '—'}) & Exit (${formatIstTime(existingExitMs)}) already recorded today.`
          : `Already marked Present today at ${existingEntryMs ? formatIstTime(existingEntryMs) : 'earlier'}.`,
        student,
        batchTiming: existing.batchTiming || resolvedBatch.batchTiming,
        attendanceId,
        entryTimeLabel: existingEntryMs ? formatIstTime(existingEntryMs) : '—',
        exitTimeLabel: existingExitMs ? formatIstTime(existingExitMs) : undefined,
        entryMs: existingEntryMs,
        exitMs: existingExitMs,
      };
    });
  };

  try {
    let txResult = await executeStudentTransaction(extractedId);

    // Rare fallback: only inspect /applications/{extractedId} if no student doc matched directly
    if (txResult.notFound) {
      const appSnap = await getDoc(doc(db, 'applications', extractedId));
      if (appSnap.exists()) {
        const appData = { id: appSnap.id, ...appSnap.data() } as AdmissionApplication;
        if (appData.status === 'pending') {
          const msg = 'Admission application is still pending approval.';
          writeScanAudit('PENDING', msg, appData.applicationNumber, appData.studentName);
          return {
            outcome: 'REJECTED_PENDING',
            title: 'Admission Pending',
            message: msg,
            scannedCode: cleanedRaw,
            attendanceDate: istDate,
            timeLabel,
            application: appData,
            latencyMs: elapsed(),
          };
        }
        if (appData.status === 'rejected') {
          const msg = 'Admission application was rejected.';
          writeScanAudit('INVALID', msg, appData.applicationNumber, appData.studentName);
          return {
            outcome: 'REJECTED_INVALID',
            title: 'Invalid Student ID',
            message: msg,
            scannedCode: cleanedRaw,
            attendanceDate: istDate,
            timeLabel,
            application: appData,
            latencyMs: elapsed(),
          };
        }
        if (appData.status === 'approved' && appData.studentId) {
          txResult = await executeStudentTransaction(appData.studentId);
        }
      }
    }

    if (txResult.notFound) {
      const msg = 'No approved student record matches this QR code.';
      writeScanAudit('INVALID', msg, extractedId, 'Unknown');
      return {
        outcome: 'REJECTED_INVALID',
        title: 'Invalid Student ID',
        message: msg,
        scannedCode: cleanedRaw,
        attendanceDate: istDate,
        timeLabel,
        latencyMs: elapsed(),
      };
    }

    // Non-blocking audit log & student public attendance ledger sync (0ms impact on scanner UI)
    if (txResult.outcome === 'MARKED_PRESENT' || txResult.outcome === 'EXIT_RECORDED') {
      writeScanAudit(
        'VALID',
        `${txResult.title} (${istDate})`,
        txResult.student.studentId,
        txResult.student.studentName
      );
      void syncStudentPublicAttendanceYear(txResult.student, batches, serverIst.year, {
        date: istDate,
        entry: {
          status: 'Present',
          entryTimeMs: txResult.entryMs ?? serverIst.epochMs,
          exitTimeMs: txResult.exitMs ?? null,
          batchTiming: txResult.batchTiming || txResult.student.batch,
        },
      });
    } else if (txResult.outcome === 'ALREADY_PRESENT') {
      writeScanAudit(
        'VALID',
        `Already Marked Present (${istDate})`,
        txResult.student.studentId,
        txResult.student.studentName
      );
    } else {
      writeScanAudit(
        'INVALID',
        txResult.message,
        txResult.student.studentId || extractedId,
        txResult.student.studentName || 'Unknown'
      );
    }

    return {
      outcome: txResult.outcome,
      title: txResult.title,
      message: txResult.message,
      scannedCode: cleanedRaw,
      attendanceDate: istDate,
      timeLabel,
      student: txResult.student,
      batchTiming: txResult.batchTiming,
      attendanceId: txResult.attendanceId,
      entryTimeLabel: txResult.entryTimeLabel,
      exitTimeLabel: txResult.exitTimeLabel,
      latencyMs: elapsed(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `attendance/${extractedId}`);
  }
}

/**
 * Admin Manual Attendance Entry / Correction with mandatory reason & immutable audit log.
 */
export async function saveManualAttendanceCorrection(params: {
  student: StudentRecord;
  batches: BatchItem[];
  attendanceDate: string; // YYYY-MM-DD
  newStatus: AttendanceStatus;
  reason: string;
  adminEmail: string;
}): Promise<void> {
  const { student, batches, attendanceDate, newStatus, reason, adminEmail } = params;
  const cleanDate = attendanceDate.trim();
  const cleanReason = reason.trim().slice(0, 400);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    throw new Error('Please choose a valid attendance date (YYYY-MM-DD).');
  }
  if (cleanReason.length < 3) {
    throw new Error('Please provide a clear reason (at least 3 characters) for manual attendance correction.');
  }

  const resolvedBatch = resolveStudentBatch(student.batch, batches);
  const attendanceId = buildAttendanceDocId(student.studentId, resolvedBatch.batchId, cleanDate);
  const logId = sanitizeId(`attlog_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`);

  try {
    await runTransaction(db, async (tx) => {
      const attRef = doc(db, 'attendance', attendanceId);
      const attSnap = await tx.get(attRef);
      const nowTs = serverTimestamp();

      const previousStatus: AttendanceStatus | 'None' = attSnap.exists()
        ? ((attSnap.data().attendanceStatus as AttendanceStatus) || 'None')
        : 'None';

      if (attSnap.exists()) {
        const existingData = attSnap.data() as AttendanceRecord;
        tx.update(attRef, {
          attendanceStatus: newStatus,
          entryTime: newStatus === 'Present' ? existingData.entryTime || nowTs : null,
          exitTime: newStatus === 'Present' ? existingData.exitTime || null : null,
          source: 'manual',
          lastModifiedBy: adminEmail,
          correctionReason: cleanReason,
          updatedAt: nowTs,
        });
      } else {
        tx.set(attRef, {
          attendanceId,
          studentId: student.studentId,
          studentName: student.studentName.trim().slice(0, 120),
          batchId: resolvedBatch.batchId,
          batchTiming: resolvedBatch.batchTiming.slice(0, 80),
          class: student.studentClass.trim().slice(0, 40),
          course: student.course.trim().slice(0, 100),
          attendanceDate: cleanDate,
          entryTime: newStatus === 'Present' ? nowTs : null,
          attendanceStatus: newStatus,
          source: 'manual',
          recordedBy: adminEmail,
          lastModifiedBy: adminEmail,
          correctionReason: cleanReason,
          createdAt: nowTs,
          updatedAt: nowTs,
        });
      }

      tx.set(doc(db, 'attendanceAuditLogs', logId), {
        logId,
        attendanceId,
        studentId: student.studentId,
        studentName: student.studentName.trim().slice(0, 120),
        batchId: resolvedBatch.batchId,
        attendanceDate: cleanDate,
        previousStatus,
        newStatus,
        reason: cleanReason,
        modifiedBy: adminEmail,
        modifiedAt: nowTs,
      });
    });

    const year = Number(cleanDate.slice(0, 4)) || new Date().getFullYear();
    await syncStudentPublicAttendanceYear(student, batches, year);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `attendance/${attendanceId}`);
  }
}

export async function saveAttendanceHoliday(params: {
  date: string;
  title: string;
  batchId: string; // 'ALL' or batchId
  dayType: HolidayDayType;
  adminEmail: string;
}): Promise<void> {
  const cleanDate = params.date.trim();
  const cleanTitle = params.title.trim().slice(0, 120);
  const cleanBatchId = sanitizeId(params.batchId || 'ALL');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    throw new Error('Please enter a valid date (YYYY-MM-DD).');
  }
  if (cleanTitle.length < 2) {
    throw new Error('Please enter a holiday or schedule note title.');
  }

  const holidayId = sanitizeId(`hol_${cleanDate}_${cleanBatchId}`);
  try {
    await setDoc(doc(db, 'attendanceHolidays', holidayId), {
      date: cleanDate,
      title: cleanTitle,
      batchId: cleanBatchId,
      dayType: params.dayType,
      createdBy: params.adminEmail,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `attendanceHolidays/${holidayId}`);
  }
}

export async function deleteAttendanceHoliday(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'attendanceHolidays', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `attendanceHolidays/${id}`);
  }
}

export async function fetchPublicAttendanceHolidays(): Promise<AttendanceHoliday[]> {
  try {
    const snap = await getDocs(collection(db, 'attendanceHolidays'));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as AttendanceHoliday)
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch (err) {
    console.warn('Unable to load public attendance holidays:', err);
    return [];
  }
}

/**
 * Direct no-OTP lookup of ONLY approved & active students by Registered Mobile Number.
 * Primary path reads privacy-minimized /attendanceLookupIndex/attmob_<sha256(mobile)>.
 * Falls back cleanly to pre-backfill approved profiles (strictly masking mobile and
 * stripping sensitive fields like fees, PIN, QR tokens, and suspended/pending records).
 */
export async function lookupActiveStudentsForAttendanceByMobile(
  rawMobile: string
): Promise<AttendanceLookupEntry[]> {
  const check = normalizeIndianMobile(rawMobile);
  if (!check.ok) return [];
  const cleaned = check.mobile10;

  const mobLookupKey = await buildAttendanceMobileLookupKey(cleaned);
  try {
    const snap = await getDoc(doc(db, 'attendanceLookupIndex', mobLookupKey));
    if (snap.exists()) {
      const data = snap.data() as AttendanceLookupIndexDoc;
      if (Array.isArray(data.entries) && data.entries.length > 0) {
        return data.entries.map((entry) => ({
          ...entry,
          _legacyMobile: cleaned,
        }));
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `attendanceLookupIndex/${mobLookupKey}`);
  }

  // Seamless backward-compatible fallback for students approved before index backfill
  try {
    const legacyIndex = await lookupTrackingIndexByMobile(cleaned);
    if (!legacyIndex || !Array.isArray(legacyIndex.entries) || legacyIndex.entries.length === 0) {
      return [];
    }

    const approvedCandidates = legacyIndex.entries.filter(
      (e) =>
        e.hasStudentId &&
        (e.admissionStage === 'Student ID Generated' || e.admissionStage === 'Approved')
    );
    if (approvedCandidates.length === 0) return [];

    const results: AttendanceLookupEntry[] = [];
    for (const candidate of approvedCandidates) {
      const profile = await fetchVerifiedTrackingProfile(candidate.applicationNumber, cleaned);
      if (
        profile &&
        profile.status === 'approved' &&
        profile.studentId &&
        profile.studentStatus !== 'suspended'
      ) {
        const normId = sanitizeId(profile.studentId.trim().toUpperCase());
        const attendanceKeyHash = await sha256Hex(normId);
        results.push({
          studentId: normId,
          studentName: profile.studentName,
          fatherName: profile.fatherName || '—',
          studentClass: profile.studentClass,
          course: profile.course,
          batch: profile.batch,
          maskedMobile: maskMobileNumber(cleaned),
          photoUrl: profile.photoUrl || '',
          photoDataUrl: profile.photoDataUrl || '',
          enrolledDate: formatIstDateYmd(profile.submittedAt) || '',
          attendanceKeyHash,
          _legacyMobile: cleaned,
        });
      }
    }
    return results;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `trackingIndex/mobile_fallback`);
  }
}

/**
 * Direct no-OTP lookup of ONLY approved & active students by Student ID Number.
 * Reads privacy-minimized /attendanceLookupIndex/attid_<sha256(UPPERCASE_STUDENT_ID)>.
 */
export async function lookupActiveStudentsForAttendanceById(
  rawStudentId: string
): Promise<AttendanceLookupEntry[]> {
  const idCheck = normalizeStudentId(rawStudentId);
  if (!idCheck.ok) return [];
  const normId = sanitizeId(idCheck.studentId);

  const idLookupKey = await buildAttendanceIdLookupKey(normId);
  try {
    const snap = await getDoc(doc(db, 'attendanceLookupIndex', idLookupKey));
    if (!snap.exists()) return [];
    const data = snap.data() as AttendanceLookupIndexDoc;
    return Array.isArray(data.entries)
      ? data.entries.filter((e) => e.studentId?.toUpperCase() === normId)
      : [];
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `attendanceLookupIndex/${idLookupKey}`);
  }
}

/**
 * Fetches an active approved student's yearly attendance ledger directly by Student ID
 * (attid_<sha256(studentId)>_<year>), with seamless fallback to legacy attpub_ key if present.
 */
export async function fetchStudentAttendanceById(
  studentId: string,
  year: number,
  legacyMobile?: string
): Promise<StudentAttendancePublicDoc | null> {
  const normId = sanitizeId(studentId.trim().toUpperCase());
  if (normId.length < 4) return null;

  const attIdKey = await buildPublicAttendanceByIdKey(normId, year);
  try {
    const snap = await getDoc(doc(db, 'studentAttendancePublic', attIdKey));
    if (snap.exists()) {
      return { id: snap.id, ...snap.data() } as StudentAttendancePublicDoc;
    }

    const cleanedLegacy = cleanPhone(legacyMobile || '');
    if (cleanedLegacy.length === 10) {
      const legacyKey = await buildPublicAttendanceKey(normId, cleanedLegacy, year);
      const legacySnap = await getDoc(doc(db, 'studentAttendancePublic', legacyKey));
      if (legacySnap.exists()) {
        return { id: legacySnap.id, ...legacySnap.data() } as StudentAttendancePublicDoc;
      }
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `studentAttendancePublic/${attIdKey}`);
  }
}

/**
 * Legacy helper retained for backward compatibility.
 */
export async function fetchVerifiedStudentAttendance(
  studentId: string,
  verifiedMobile: string,
  year: number
): Promise<StudentAttendancePublicDoc | null> {
  return fetchStudentAttendanceById(studentId, year, verifiedMobile);
}

function buildRecordsFingerprint(records: Record<string, StudentAttendanceDayEntry>): string {
  return Object.keys(records)
    .sort()
    .map((date) => {
      const r = records[date];
      return `${date}:${r.status}:${r.entryTimeMs ?? ''}:${r.exitTimeMs ?? ''}`;
    })
    .join('|');
}

/**
 * Silent admin backfill ensuring every approved & active student has both:
 * 1) /attendanceLookupIndex (ID & Mobile buckets for direct no-OTP attendance lookup), and
 * 2) /studentAttendancePublic (attid_ + legacy attpub_ yearly ledgers for all active years).
 * Suspended students are automatically removed from /attendanceLookupIndex.
 */
export async function syncApprovedStudentsPublicAttendance(
  students: StudentRecord[],
  attendance: AttendanceRecord[],
  batches: BatchItem[],
  currentYear: number
): Promise<void> {
  // Collect all years present in attendance records plus current IST year
  const yearsSet = new Set<number>([currentYear]);
  for (const r of attendance) {
    const yr = Number((r.attendanceDate || '').slice(0, 4));
    if (Number.isInteger(yr) && yr >= 2020 && yr <= 2100) {
      yearsSet.add(yr);
    }
  }
  const years = Array.from(yearsSet).sort((a, b) => b - a);

  const byStudentYear = new Map<string, AttendanceRecord[]>();
  for (const r of attendance) {
    const yr = Number((r.attendanceDate || '').slice(0, 4));
    if (!Number.isInteger(yr)) continue;
    const key = `${r.studentId.trim().toUpperCase()}::${yr}`;
    const arr = byStudentYear.get(key) || [];
    arr.push(r);
    byStudentYear.set(key, arr);
  }

  // Group active approved students by 10-digit mobile for clean atomic mobile buckets
  const activeByMobile = new Map<string, AttendanceLookupEntry[]>();

  for (const stu of students) {
    const normId = sanitizeId((stu.studentId || '').trim().toUpperCase());
    if (normId.length < 4) continue;

    const cleanedMobile = cleanPhone(stu.studentMobile || stu.studentWhatsapp || '');

    if (stu.status !== 'active') {
      // Ensure suspended student is purged from direct attendance lookup index
      try {
        await syncStudentAttendanceLookupIndex(stu);
      } catch (err) {
        console.warn(`Attendance lookup cleanup skipped for ${stu.studentId}:`, err);
      }
      continue;
    }

    try {
      const resolvedBatch = resolveStudentBatch(stu.batch, batches);
      const idLookupKey = await buildAttendanceIdLookupKey(normId);

      // 1. Sync /attendanceLookupIndex ID doc & collect entry for mobile bucket
      const idSnap = await getDoc(doc(db, 'attendanceLookupIndex', idLookupKey)).catch(() => null);
      const existingPhotoDataUrl =
        idSnap?.exists() &&
        Array.isArray(idSnap.data().entries) &&
        typeof idSnap.data().entries[0]?.photoDataUrl === 'string'
          ? (idSnap.data().entries[0].photoDataUrl as string)
          : '';
      const entry = await buildAttendanceLookupEntryPayload(stu, existingPhotoDataUrl);

      if (cleanedMobile.length === 10) {
        const mobList = activeByMobile.get(cleanedMobile) || [];
        mobList.push(entry);
        activeByMobile.set(cleanedMobile, mobList);
      }

      const needsIdIndexWrite =
        !idSnap?.exists() ||
        idSnap.data().entries?.[0]?.studentName !== entry.studentName ||
        idSnap.data().entries?.[0]?.fatherName !== entry.fatherName ||
        idSnap.data().entries?.[0]?.studentClass !== entry.studentClass ||
        idSnap.data().entries?.[0]?.batch !== entry.batch ||
        idSnap.data().entries?.[0]?.course !== entry.course ||
        idSnap.data().entries?.[0]?.photoUrl !== entry.photoUrl;

      if (needsIdIndexWrite) {
        await setDoc(doc(db, 'attendanceLookupIndex', idLookupKey), {
          lookupType: 'id',
          entries: [entry],
          updatedAt: serverTimestamp(),
        });
      }

      // 2. Sync /studentAttendancePublic yearly ledgers (attid_ + attpub_) for each active year
      for (const year of years) {
        const stuRecords = byStudentYear.get(`${normId}::${year}`) || [];
        if (year !== currentYear && stuRecords.length === 0) continue;

        const [attIdKey, attLegacyKey] = await Promise.all([
          buildPublicAttendanceByIdKey(normId, year),
          cleanedMobile.length === 10
            ? buildPublicAttendanceKey(normId, cleanedMobile, year)
            : Promise.resolve(''),
        ]);

        const records: Record<string, StudentAttendanceDayEntry> = {};
        for (const r of stuRecords) {
          records[r.attendanceDate] = {
            status: r.attendanceStatus,
            entryTimeMs: toEpochMs(r.entryTime),
            exitTimeMs: toEpochMs(r.exitTime),
            batchTiming: (r.batchTiming || resolvedBatch.batchTiming).slice(0, 80),
          };
        }

        const nextFingerprint = buildRecordsFingerprint(records);
        const existingSnap = await getDoc(doc(db, 'studentAttendancePublic', attIdKey));
        if (existingSnap.exists()) {
          const existingData = existingSnap.data() as StudentAttendancePublicDoc;
          const existingFingerprint = buildRecordsFingerprint(existingData.records || {});
          if (
            existingFingerprint === nextFingerprint &&
            existingData.batchId === resolvedBatch.batchId &&
            existingData.batchTiming === resolvedBatch.batchTiming &&
            JSON.stringify(existingData.scheduledDays || []) ===
              JSON.stringify(resolvedBatch.scheduledDays)
          ) {
            continue;
          }
        }

        const ledgerPayload = {
          studentId: normId,
          year,
          batchId: resolvedBatch.batchId.slice(0, 100) || 'default_batch',
          batchTiming: resolvedBatch.batchTiming.slice(0, 80) || 'Regular Batch',
          enrolledDate: formatIstDateYmd(stu.approvedAt) || '',
          scheduledDays: resolvedBatch.scheduledDays,
          records,
          updatedAt: serverTimestamp(),
        };

        const batch = writeBatch(db);
        batch.set(doc(db, 'studentAttendancePublic', attIdKey), ledgerPayload);
        if (attLegacyKey) {
          batch.set(doc(db, 'studentAttendancePublic', attLegacyKey), ledgerPayload);
        }
        await batch.commit();
      }
    } catch (err) {
      console.warn(`Attendance public sync skipped for ${stu.studentId}:`, err);
    }
  }

  // 3. Write grouped mobile lookup docs in /attendanceLookupIndex
  for (const [mobile, entries] of activeByMobile.entries()) {
    try {
      const mobLookupKey = await buildAttendanceMobileLookupKey(mobile);
      const mobRef = doc(db, 'attendanceLookupIndex', mobLookupKey);
      const mobSnap = await getDoc(mobRef).catch(() => null);
      const nextEntries = capMobileBucketEntries(entries);
      const existingSig =
        mobSnap?.exists() && Array.isArray(mobSnap.data().entries)
          ? (mobSnap.data().entries as AttendanceLookupEntry[])
              .map((e) => `${e.studentId}:${e.studentName}:${e.batch}:${e.course}`)
              .sort()
              .join(',')
          : '';
      const nextSig = nextEntries
        .map((e) => `${e.studentId}:${e.studentName}:${e.batch}:${e.course}`)
        .sort()
        .join(',');
      if (!mobSnap?.exists() || existingSig !== nextSig) {
        await setDoc(mobRef, {
          lookupType: 'mobile',
          entries: nextEntries,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      console.warn('Attendance mobile lookup bucket sync warning:', err);
    }
  }
}

