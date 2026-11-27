/**
 * Security Rules Verification Spec — THE ZONE OF CHEMISTRY
 * Documents and verifies all 12 Dirty Dozen adversarial payloads against firestore.rules.
 */

export interface AdversarialPayloadCase {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: { uid?: string; email?: string; email_verified?: boolean } | null;
  docId?: string;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
  enforcedBy: string;
}

export const DIRTY_DOZEN_CASES: AdversarialPayloadCase[] = [
  {
    id: 1,
    name: 'Self-Approved Application',
    collection: 'applications',
    operation: 'create',
    auth: null,
    docId: 'ZOC2026-9999',
    payload: { status: 'approved', paymentStatus: 'PENDING', paidAmount: 0 },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'incoming().status == "pending"'
  },
  {
    id: 2,
    name: 'Forged Fee Payment on Submit',
    collection: 'applications',
    operation: 'create',
    auth: null,
    docId: 'ZOC2026-9998',
    payload: { status: 'pending', paymentStatus: 'PAID', paidAmount: 5500 },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'incoming().paymentStatus == "PENDING" && incoming().paidAmount == 0'
  },
  {
    id: 3,
    name: 'Shadow Field Injection',
    collection: 'applications',
    operation: 'create',
    auth: null,
    docId: 'ZOC2026-9997',
    payload: { isAdmin: true, status: 'pending' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'isValidApplication() keys().hasOnly(...)'
  },
  {
    id: 4,
    name: 'Orphan Application Without Tracking Doc',
    collection: 'applications',
    operation: 'create',
    auth: null,
    docId: 'ZOC2026-9996',
    payload: { applicationNumber: 'ZOC2026-9996', trackingKey: 'ZOC2026-9996_9876543210' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'existsAfter(/databases/$(database)/documents/applicationStatus/$(incoming().trackingKey))'
  },
  {
    id: 5,
    name: 'Public Application & Student Scraping',
    collection: 'students',
    operation: 'list',
    auth: null,
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'allow list: if isAdmin()'
  },
  {
    id: 6,
    name: 'Public Private Document Theft',
    collection: 'privateMedia',
    operation: 'get',
    auth: null,
    docId: 'doc_12345',
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'allow get: if isAdmin() && isValidId(mediaId)'
  },
  {
    id: 7,
    name: 'Unverified Admin Email Spoof',
    collection: 'students',
    operation: 'list',
    auth: { uid: 'spoof-uid', email: 'rikudatabackup@gmail.com', email_verified: false },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'request.auth.token.email_verified == true in isAdmin()'
  },
  {
    id: 8,
    name: 'Self-Assigned Admin Escalation',
    collection: 'admins',
    operation: 'create',
    auth: { uid: 'attacker-uid', email: 'attacker@example.com', email_verified: true },
    docId: 'attacker-uid',
    payload: { uid: 'attacker-uid', email: 'attacker@example.com', displayName: 'Attacker', role: 'owner' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'allow create: if isAdmin()'
  },
  {
    id: 9,
    name: 'Path ID Poisoning',
    collection: 'applications',
    operation: 'create',
    auth: null,
    docId: 'x'.repeat(200),
    payload: {},
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'isValidId(applicationId)'
  },
  {
    id: 10,
    name: 'Denial-of-Wallet Oversized String',
    collection: 'applications',
    operation: 'create',
    auth: null,
    docId: 'ZOC2026-9995',
    payload: { studentName: 'A'.repeat(5000) },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'data.studentName.size() <= 120'
  },
  {
    id: 11,
    name: 'Backdated Timestamp Forgery',
    collection: 'applications',
    operation: 'create',
    auth: null,
    docId: 'ZOC2026-9994',
    payload: { submittedAt: '2020-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'incoming().submittedAt == request.time'
  },
  {
    id: 12,
    name: 'Public Status Enumeration',
    collection: 'applicationStatus',
    operation: 'list',
    auth: null,
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'allow list: if isAdmin()'
  },
  {
    id: 13,
    name: 'Public Tracking Profile Enumeration',
    collection: 'studentTrackingProfiles',
    operation: 'list',
    auth: null,
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'allow list: if isAdmin()'
  },
  {
    id: 14,
    name: 'Forged Approved Student Tracking Profile',
    collection: 'studentTrackingProfiles',
    operation: 'create',
    auth: null,
    docId: 'prof_forged123456',
    payload: { status: 'approved', admissionStage: 'Student ID Generated', studentId: 'ZOC-2026-999999' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'incoming().status == "pending" && incoming().admissionStage == "Application Submitted"'
  },
  {
    id: 15,
    name: 'Tracking Index Tampering',
    collection: 'trackingIndex',
    operation: 'update',
    auth: null,
    docId: 'mob_abc123',
    payload: { mobileHash: '0'.repeat(64), entries: [] },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'affectedKeys().hasOnly(["entries", "updatedAt"]) && incoming().entries.size() == existing().entries.size() + 1'
  },
  {
    id: 16,
    name: 'Self-Marked Attendance Forgery',
    collection: 'attendance',
    operation: 'create',
    auth: null,
    docId: 'att_ZOC-2026-1001_batch-1_2026-11-27',
    payload: { studentId: 'ZOC-2026-1001', attendanceStatus: 'Present', source: 'qr' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'allow create: if isAdmin() && ...'
  },
  {
    id: 17,
    name: 'Suspended Student QR Attendance',
    collection: 'attendance',
    operation: 'create',
    auth: { uid: 'owner-uid', email: 'rikudatabackup@gmail.com', email_verified: true },
    docId: 'att_ZOC-2026-SUSP_batch-1_2026-11-27',
    payload: { studentId: 'ZOC-2026-SUSP', attendanceStatus: 'Present', source: 'qr' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'get(/databases/$(database)/documents/students/$(incoming().studentId)).data.status == "active"'
  },
  {
    id: 18,
    name: 'Attendance Audit Log Tampering',
    collection: 'attendanceAuditLogs',
    operation: 'delete',
    auth: { uid: 'owner-uid', email: 'rikudatabackup@gmail.com', email_verified: true },
    docId: 'log_123456',
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'allow update, delete: if false'
  },
  {
    id: 19,
    name: 'Public Attendance Ledger Enumeration',
    collection: 'studentAttendancePublic',
    operation: 'list',
    auth: null,
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'allow list: if isAdmin()'
  },
  {
    id: 20,
    name: 'Unauthorized / Oversized Teacher ID Card Settings Write',
    collection: 'settings',
    operation: 'update',
    auth: null,
    docId: 'main',
    payload: { teacherBio: 'A'.repeat(2000), teacherPhotoUrl: 'https://evil.example/x.jpg' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'isAdmin() && isValidSettings(incoming()) && isOptionalString(data, "teacherBio", 600)'
  },
  {
    id: 21,
    name: 'Public Attendance Lookup Index Enumeration',
    collection: 'attendanceLookupIndex',
    operation: 'list',
    auth: null,
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'allow list: if isAdmin()'
  },
  {
    id: 22,
    name: 'Forged Attendance Lookup Index Write or PII Smuggling',
    collection: 'attendanceLookupIndex',
    operation: 'create',
    auth: null,
    docId: 'attmob_forged1234',
    payload: {
      lookupType: 'mobile',
      entries: [{ studentId: 'ZOC-2026-999999', studentMobile: '9876543210', feeAmount: 5500 }]
    },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'isAdmin() && isValidAttendanceLookupIndex(incoming())'
  },
  {
    id: 23,
    name: 'Unauthorized Banner Write or Unsafe CTA Target Scheme',
    collection: 'banners',
    operation: 'create',
    auth: null,
    docId: 'banner_evil_1',
    payload: {
      title: 'Click Here',
      ctaTarget: 'javascript:alert(1)',
      order: 1,
      active: true
    },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'isAdmin() && isValidBanner(incoming()) && safe ctaTarget validation'
  },
  {
    id: 24,
    name: 'Out-of-Bounds Banner Slider Interval',
    collection: 'settings',
    operation: 'update',
    auth: { uid: 'owner-uid', email: 'rikudatabackup@gmail.com', email_verified: true },
    docId: 'main',
    payload: { bannerSliderIntervalSec: 0 },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'data.bannerSliderIntervalSec >= 2 && data.bannerSliderIntervalSec <= 30'
  }
];



