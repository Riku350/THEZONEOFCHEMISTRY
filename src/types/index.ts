export type StudentClass = 'Class 10' | 'Class 11' | 'Class 12' | 'Other';
export type StudentStream = 'Science' | 'PCM' | 'PCB' | 'Other';
export type Gender = 'Male' | 'Female' | 'Other';
export type ApplicationStatus = 'pending' | 'approved' | 'rejected';
export type PaymentStatus = 'PENDING' | 'PARTIAL' | 'PAID';
export type StudentStatus = 'active' | 'suspended';
export type PaymentMethod = 'Cash' | 'UPI' | 'Bank Transfer' | 'Card' | 'Cheque';
export type NoticeCategory = 'Admission' | 'Exam' | 'Schedule' | 'General';
export type ScanStatusResult = 'VALID' | 'PENDING' | 'INVALID';
export type AdmissionStage =
  | 'Application Submitted'
  | 'Under Review'
  | 'Approved'
  | 'Rejected'
  | 'Student ID Generated';
export type AttendanceStatus = 'Present' | 'Absent';
export type AttendanceSource = 'qr' | 'manual';
export type HolidayDayType = 'Holiday' | 'NotScheduled';
export type CalendarDayStatus = 'Present' | 'Absent' | 'Holiday' | 'NotScheduled' | 'Upcoming';


export interface TimestampLike {
  toDate?: () => Date;
  seconds?: number;
  nanoseconds?: number;
}

export interface TrackingIndexEntry {
  applicationNumber: string;
  course: string;
  admissionStage: AdmissionStage;
  hasStudentId: boolean;
}

export interface TrackingIndexDoc {
  id: string;
  lookupType: 'id' | 'mobile';
  maskedMobile: string;
  mobileHash: string;
  entries: TrackingIndexEntry[];
  updatedAt: TimestampLike | null;
}

export interface StudentTrackingProfile {
  id: string;
  applicationNumber: string;
  studentId?: string;
  studentName: string;
  fatherName: string;
  studentClass: string;
  course: string;
  batch: string;
  academicSession: string;
  status: ApplicationStatus;
  admissionStage: AdmissionStage;
  studentStatus?: '' | StudentStatus;
  feeAmount: number;
  paidAmount: number;
  paymentStatus: PaymentStatus;
  securityCode?: string;
  qrToken?: string;
  photoUrl?: string;
  photoDataUrl?: string;
  remarks?: string;
  submittedAt: TimestampLike | null;
  updatedAt: TimestampLike | null;
}

export interface AdmissionApplication {
  id: string;
  applicationNumber: string;
  trackingKey: string;
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
  photoUrl?: string;
  photoMediaId?: string;
  idProofUrl?: string;
  idProofMediaId?: string;
  marksheetUrl?: string;
  marksheetMediaId?: string;
  feeAmount: number;
  paidAmount: number;
  paymentStatus: PaymentStatus;
  status: ApplicationStatus;
  declarationAccepted: boolean;
  studentId?: string;
  remarks?: string;
  submittedAt: TimestampLike | null;
  updatedAt: TimestampLike | null;
}

export interface ApplicationStatusLookup {
  id: string;
  applicationNumber: string;
  studentName: string;
  course: string;
  batch: string;
  studentClass: string;
  status: ApplicationStatus;
  paymentStatus: PaymentStatus;
  feeAmount: number;
  paidAmount: number;
  studentId?: string;
  remarks?: string;
  submittedAt: TimestampLike | null;
  updatedAt: TimestampLike | null;
}

export interface StudentRecord {
  id: string;
  studentId: string;
  applicationId: string;
  applicationNumber: string;
  securityCode: string;
  qrToken: string;
  studentName: string;
  studentMobile: string;
  studentWhatsapp?: string;
  fatherName: string;
  fatherMobile?: string;
  motherName?: string;
  motherMobile?: string;
  dob?: string;
  gender?: Gender;
  address?: string;
  village?: string;
  postOffice?: string;
  district?: string;
  state?: string;
  pinCode?: string;
  studentClass: string;
  stream?: string;
  course: string;
  batch: string;
  photoUrl?: string;
  photoMediaId?: string;
  idProofUrl?: string;
  idProofMediaId?: string;
  marksheetUrl?: string;
  marksheetMediaId?: string;
  feeAmount: number;
  paidAmount: number;
  paymentStatus: PaymentStatus;
  status: StudentStatus;
  academicSession: string;
  approvedAt: TimestampLike | null;
  approvedBy?: string;
  updatedAt: TimestampLike | null;
}

export interface BatchItem {
  id: string;
  name: string;
  timing: string;
  capacity?: number;
  feeOverride?: number | null;
  scheduledDays?: number[]; // 0=Sun..6=Sat
  scheduleStartDate?: string; // YYYY-MM-DD
  active: boolean;
  order: number;
  updatedAt?: TimestampLike | null;
}

export interface CourseItem {
  id: string;
  title: string;
  category?: string;
  targetClass?: string;
  description?: string;
  duration?: string;
  feeAmount: number;
  active: boolean;
  order: number;
  updatedAt?: TimestampLike | null;
}

export interface FeeRule {
  id: string;
  label: string;
  studentClass?: string;
  course?: string;
  batch?: string;
  amount: number;
  active: boolean;
  updatedAt?: TimestampLike | null;
}

export interface PaymentRecord {
  id: string;
  receiptNumber: string;
  studentId?: string;
  applicationId?: string;
  studentName: string;
  course?: string;
  batch?: string;
  amount: number;
  method: PaymentMethod;
  referenceNo?: string;
  notes?: string;
  recordedBy: string;
  paidAt: TimestampLike | null;
}

export interface BannerItem {
  id: string;
  title: string;
  description?: string;
  announcement?: string;
  imageUrl?: string;
  mediaId?: string;
  order: number;
  active: boolean;
  updatedAt?: TimestampLike | null;
}

export interface GalleryItem {
  id: string;
  title: string;
  category: string;
  imageUrl?: string;
  mediaId?: string;
  active: boolean;
  createdAt?: TimestampLike | null;
}

export interface NoticeItem {
  id: string;
  title: string;
  content: string;
  category: NoticeCategory;
  pinned: boolean;
  active: boolean;
  createdAt?: TimestampLike | null;
  updatedAt?: TimestampLike | null;
}

export interface ScanHistoryEntry {
  id: string;
  scannedCode: string;
  studentId?: string;
  studentName?: string;
  statusResult: ScanStatusResult;
  reason?: string;
  scannedBy: string;
  scannedAt: TimestampLike | null;
}

export interface InstituteSettings {
  id: string;
  instituteName: string;
  teacherName: string;
  tagline: string;
  academicSession: string;
  defaultFee: number;
  admissionsOpen: boolean;
  admissionHeadline: string;
  phone: string;
  whatsappNumber: string;
  email: string;
  address: string;
  signatureText: string;
  attendanceExitTracking?: boolean;
  teacherPhotoUrl?: string;
  teacherPhotoMediaId?: string;
  teacherBio?: string;
  teacherExperience?: string;
  teacherSpecialization?: string;
  teacherContactNumber?: string;
  teacherWhatsappNumber?: string;
  teacherEmail?: string;
  idCardMotivationalMessage?: string;
  updatedAt?: TimestampLike | null;
}

export interface AdminUserRecord {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  role: 'owner' | 'admin';
  createdAt?: TimestampLike | null;
}

export interface AttendanceRecord {
  id: string;
  attendanceId: string;
  studentId: string;
  studentName: string;
  batchId: string;
  batchTiming?: string;
  class: string;
  course: string;
  attendanceDate: string; // YYYY-MM-DD in Asia/Kolkata
  entryTime?: TimestampLike | null;
  exitTime?: TimestampLike | null;
  attendanceStatus: AttendanceStatus;
  source: AttendanceSource;
  recordedBy: string;
  lastModifiedBy?: string;
  correctionReason?: string;
  createdAt: TimestampLike | null;
  updatedAt: TimestampLike | null;
}

export interface AttendanceAuditLog {
  id: string;
  logId: string;
  attendanceId: string;
  studentId: string;
  studentName: string;
  batchId: string;
  attendanceDate: string;
  previousStatus: AttendanceStatus | 'None';
  newStatus: AttendanceStatus;
  reason: string;
  modifiedBy: string;
  modifiedAt: TimestampLike | null;
}

export interface AttendanceHoliday {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  batchId: string; // 'ALL' or specific batchId
  dayType: HolidayDayType;
  createdBy: string;
  createdAt: TimestampLike | null;
}

export interface StudentAttendanceDayEntry {
  status: AttendanceStatus;
  entryTimeMs?: number | null;
  exitTimeMs?: number | null;
  batchTiming?: string;
}

export interface StudentAttendancePublicDoc {
  id: string;
  studentId: string;
  year: number;
  batchId: string;
  batchTiming: string;
  enrolledDate?: string;
  scheduledDays: number[];
  records: Record<string, StudentAttendanceDayEntry>;
  updatedAt: TimestampLike | null;
}

export interface AttendanceLookupEntry {
  studentId: string;
  studentName: string;
  fatherName: string;
  studentClass: string;
  course: string;
  batch: string;
  maskedMobile: string;
  photoUrl?: string;
  photoDataUrl?: string;
  enrolledDate?: string;
  attendanceKeyHash: string;
  /** Internal client-only fallback for pre-backfill legacy attpub_ ledgers (never persisted to Firestore). */
  _legacyMobile?: string;
}

export interface AttendanceLookupIndexDoc {
  id: string;
  lookupType: 'id' | 'mobile';
  entries: AttendanceLookupEntry[];
  updatedAt: TimestampLike | null;
}

export type PublicView = 'home' | 'apply' | 'track' | 'attendance' | 'admin';

export type AdminTab =
  | 'overview'
  | 'applications'
  | 'students'
  | 'attendance'
  | 'scanner'
  | 'fees'
  | 'banners'
  | 'gallery'
  | 'notices'
  | 'settings';

