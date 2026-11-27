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
12. **Public Status Enumeration**: Unauthenticated visitor runs `list` on `/applicationStatus`. Expected: `PERMISSION_DENIED`.
