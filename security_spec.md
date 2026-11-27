# Security Specification — THE ZONE OF CHEMISTRY

## 1. Data Invariants
1. **Admin Authority**: Only authenticated users with `email_verified == true` who match the bootstrapped owner email (`rikudatabackup@gmail.com`) or exist in `/admins/{uid}` may read, list, update, or delete student records, applications, payments, scan logs, or private student documents.
2. **Zero Public PII Exposure**: Public visitors cannot `get` or `list` `/applications`, `/students`, `/payments`, `/scanHistory`, `/securityCodes`, or `/privateMedia`.
3. **Atomic Application Tracking**: Public admission submission MUST create `/applications/{applicationNumber}` and `/applicationStatus/{trackingKey}` atomically in the same batch (`existsAfter`), with initial `status == 'pending'`, `paymentStatus == 'PENDING'`, `paidAmount == 0`, and `declarationAccepted == true`.
4. **Non-Enumerable Status Lookup**: `/applicationStatus/{trackingKey}` permits single-document `get` only (never public `list`), keyed by `${applicationNumber}_${studentMobile}`, and contains zero sensitive PII (no home address, parent mobile numbers, or document links).
5. **Immutable Timestamps & Keys**: Creation timestamps (`createdAt`, `submittedAt`, `approvedAt`, `paidAt`, `scannedAt`, `assignedAt`) MUST equal `request.time` on create and remain unchanged on update. Updates MUST set `updatedAt == request.time`.
6. **Strict Schema Enforcement**: Every write is guarded by an entity-specific `isValid*` helper checking `keys().hasAll(...)`, `keys().hasOnly(...)`, exact types, numeric ranges, enum domains, regex patterns, and `.size()` upper bounds on all strings.
7. **Path Variable Hardening**: Every single-document operation (`get`, `create`, `update`, `delete`) validates its path ID via `isValidId(id)` (`^[a-zA-Z0-9_\-]+$`, length <= 128).
8. **Unique 4-Digit Security Codes**: Active student 4-digit codes are reserved in `/securityCodes/{code}` by admin transactions only.
9. **Non-PII Tracking Index**: `/trackingIndex/{lookupHash}` stores only SHA-256 keyed lookup entries (`applicationNumber`, `course`, `admissionStage`, `hasStudentId`, `maskedMobile`, `mobileHash`) with bounded array size <= 10, zero student PII, and no public `list` access.
10. **OTP-Gated Student Tracking Profile**: `/studentTrackingProfiles/{profileKey}` is keyed by `prof_<SHA-256(applicationNumber:mobile)>`, never publicly listable, contains zero private documents/address/parent mobiles, and is retrieved only after server-verified OTP confirmation of the registered mobile number.
11. **Authoritative QR & Manual Attendance**: `/attendance/{attendanceId}` is admin-only for reads and writes, uses deterministic ID `att_<studentId>_<batchId>_<YYYY-MM-DD>` to prevent duplicate daily records per student/batch, enforces `exists(/students/<studentId>)`, enforces `status == 'active'` for QR attendance, and locks `createdAt`, `updatedAt`, and QR `entryTime`/`exitTime` strictly to `request.time`.
12. **Immutable Attendance Audit Trail**: `/attendanceAuditLogs/{logId}` is admin-only create/read and permanently immutable (`allow update, delete: if false;`), enforcing mandatory `reason` (3–400 chars) and `modifiedAt == request.time`.
13. **Public Non-PII Holiday Calendar**: `/attendanceHolidays/{holidayId}` stores only non-PII holiday and not-scheduled class date overrides (admin write only, public read) so student calendars accurately exclude holidays/non-scheduled dates from absence totals.
14. **Direct Yearly Student Attendance Ledger**: `/studentAttendancePublic/{attendanceKey}` is keyed by `attid_<SHA-256(studentId)>_<year>` (with legacy `attpub_<SHA-256(studentId:mobile)>_<year>` fallback), allows single-document `get` only (never public `list`), and is strictly admin-written.
15. **Admin-Managed Teacher ID Card Profile**: Teacher photograph, biography, specialization, experience, contact details, and motivational message stored in `/settings/main` (and photo fallback in `/publicMedia/{mediaId}`) are strictly admin-write only with strict `.size()` limits, while allowing public single-document `get` for authorized ID card rendering.
16. **Privacy-Minimized Direct Attendance Lookup Index**: `/attendanceLookupIndex/{lookupKey}` is keyed by `attmob_<SHA-256(10DigitMobile)>` or `attid_<SHA-256(UPPERCASE_STUDENT_ID)>`, strictly admin-written only for **approved and active** students (suspended/pending/rejected records are excluded or removed), allows single-document `get` only (never public `list`), and exposes only attendance-display fields (`studentId`, `studentName`, `fatherName`, `studentClass`, `course`, `batch`, `maskedMobile`, `photoUrl`, `photoDataUrl`, `enrolledDate`, `attendanceKeyHash`) with zero raw mobile, address, fee, payment, security code, or QR token exposure.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Self-Approved Application**: Public applicant submits `/applications/ZOC2026-9999` with `status: "approved"`. Expected: `PERMISSION_DENIED`.
2. **Forged Fee Payment on Submit**: Public applicant submits `/applications/ZOC2026-9998` with `paymentStatus: "PAID"` and `paidAmount: 5500`. Expected: `PERMISSION_DENIED`.
3. **Shadow Field Injection**: Applicant adds ghost field `isAdmin: true` to `/applications/{id}`. Expected: `PERMISSION_DENIED`.
4. **Orphan Application Without Tracking Doc**: Applicant creates `/applications/{id}` without creating `/applicationStatus/{trackingKey}` in the same batch. Expected: `PERMISSION_DENIED`.
5. **Public Application Scraping**: Unauthenticated or non-admin user runs `list` on `/applications` or `/students`. Expected: `PERMISSION_DENIED`.
6. **Public Document Theft**: Unauthenticated or non-admin user attempts `get` on `/privateMedia/{mediaId}`. Expected: `PERMISSION_DENIED`.
7. **Unverified Admin Email Spoof**: User with `email: "rikudatabackup@gmail.com"` and `email_verified: false` reads `/students`. Expected: `PERMISSION_DENIED`.
8. **Self-Assigned Admin Escalation**: Regular signed-in user creates `/admins/{theirUid}` with `role: "owner"`. Expected: `PERMISSION_DENIED`.
9. **Path ID Poisoning**: Attacker writes document with 200-character ID or invalid characters (`../etc/passwd`). Expected: `PERMISSION_DENIED`.
10. **Denial-of-Wallet Oversized String**: Applicant submits 50KB `studentName` string. Expected: `PERMISSION_DENIED`.
11. **Backdated Timestamp Forgery**: Applicant or admin supplies a past timestamp instead of `request.time` for `submittedAt`. Expected: `PERMISSION_DENIED`.
12. **Public Status Enumeration**: Unauthenticated visitor runs `list` on `/applicationStatus`, `/trackingIndex`, or `/studentTrackingProfiles`. Expected: `PERMISSION_DENIED`.
13. **Forged Tracking Profile Approval**: Unauthenticated caller creates `/studentTrackingProfiles/{profileKey}` with `status: "approved"` or `studentId: "ZOC-2026-999999"`. Expected: `PERMISSION_DENIED`.
14. **Tracking Index Overwrite / Poisoning**: Unauthenticated caller updates `/trackingIndex/mob_<hash>` to modify `mobileHash` or remove existing entries. Expected: `PERMISSION_DENIED`.
15. **Self-Marked Attendance Forgery**: Unauthenticated or non-admin user attempts to create `/attendance/{attendanceId}` with `attendanceStatus: "Present"`. Expected: `PERMISSION_DENIED`.
16. **Suspended Student QR Attendance**: Admin client attempts QR attendance (`source: "qr"`) for a student whose `/students/{studentId}` has `status == "suspended"`. Expected: `PERMISSION_DENIED`.
17. **Audit Log Deletion / Tampering**: Even an authenticated admin attempts `update` or `delete` on `/attendanceAuditLogs/{logId}`. Expected: `PERMISSION_DENIED`.
18. **Public Attendance Enumeration**: Unauthenticated visitor runs `list` on `/attendance`, `/studentAttendancePublic`, or `/attendanceLookupIndex`. Expected: `PERMISSION_DENIED`.
19. **Unauthorized Teacher Profile Overwrite / Oversized Bio**: Unauthenticated caller or oversized `teacherBio` (>600 chars) attempts write to `/settings/main`. Expected: `PERMISSION_DENIED`.
20. **Forged Attendance Lookup Index Write**: Unauthenticated caller attempts `create` or `update` on `/attendanceLookupIndex/attmob_<hash>` to inject a fake active student record. Expected: `PERMISSION_DENIED`.
21. **Attendance Lookup Index PII Smuggling**: Admin or caller attempts to write unauthorized extra keys (`feeAmount`, `securityCode`, `address`, `studentMobile`) into `/attendanceLookupIndex/{lookupKey}` entry map. Expected: `PERMISSION_DENIED`.



