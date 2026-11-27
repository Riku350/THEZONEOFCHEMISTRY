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
  }
];
