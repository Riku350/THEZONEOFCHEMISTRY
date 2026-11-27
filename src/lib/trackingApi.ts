// Shared, fail-closed client helpers for server-side rate-limiting, OTP verification,
// and resilient attendance search (Express backend primary + rules-protected Firestore SDK fail-safe)

import { getClientIstNow } from './attendanceUtils';
import {
  fetchPublicAttendanceHolidays,
  fetchStudentAttendanceById,
  lookupActiveStudentsForAttendanceById,
  lookupActiveStudentsForAttendanceByMobile,
  normalizeIndianMobile,
  normalizeStudentId,
} from './firestoreService';

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: 'rate_limited'; retryAfterSeconds: number; message: string }
  | { ok: false; reason: 'invalid_request' | 'service_unavailable'; status?: number; message: string };

export type OtpRequestResult =
  | {
      ok: true;
      challengeId: string;
      expiresAt: number;
      expiresInSeconds: number;
      cooldownSeconds: number;
      deliveryMode: 'sms' | 'preview';
      maskedMobile: string;
      previewOtp?: string;
    }
  | {
      ok: false;
      code: string;
      retryAfterSeconds?: number;
      message: string;
    };

export type OtpVerifyResult =
  | { ok: true; verificationToken: string }
  | {
      ok: false;
      code: string;
      attemptsLeft?: number;
      message: string;
    };

const FALLBACK_WINDOW_MS = 5 * 60 * 1000;
const FALLBACK_SEARCH_MAX = 30;
const FALLBACK_REPORT_MAX = 60;
const fallbackBuckets = new Map<string, number[]>();

function checkFallbackRateLimit(
  bucketKey: string,
  maxAllowed: number
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const now = Date.now();
  const cutoff = now - FALLBACK_WINDOW_MS;
  let recent = (fallbackBuckets.get(bucketKey) || []).filter((ts) => ts > cutoff);

  try {
    const storageKey = `zoc_rl_${bucketKey}`;
    const raw = window.sessionStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const stored = parsed.filter((n): n is number => typeof n === 'number' && n > cutoff);
        if (stored.length > recent.length) recent = stored;
      }
    }
  } catch {
    // Ignore storage restriction in sandboxed iframes
  }

  if (recent.length >= maxAllowed) {
    fallbackBuckets.set(bucketKey, recent);
    const oldest = recent[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + FALLBACK_WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  recent.push(now);
  fallbackBuckets.set(bucketKey, recent);
  try {
    window.sessionStorage.setItem(`zoc_rl_${bucketKey}`, JSON.stringify(recent));
  } catch {
    // Ignore storage quota errors
  }
  return { allowed: true };
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 10000
): Promise<{ response: Response; json: Record<string, unknown> | null; isJson: boolean }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...(init.headers || {}),
      },
    });
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const isJson = contentType.includes('application/json');
    if (!isJson) {
      return { response, json: null, isJson: false };
    }
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { response, json, isJson: json !== null };
  } finally {
    window.clearTimeout(timer);
  }
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Checks the authoritative server-side sliding-window rate limiter.
 * Strictly FAIL-CLOSED: if the rate-limit service is unreachable or returns a non-JSON
 * or 5xx error (after one brief transient retry), returns service_unavailable so no
 * student records are ever queried or exposed without rate-limit verification.
 */
export async function checkSearchRateLimit(
  mode: 'id' | 'mobile',
  scope: 'attendance' | 'admission'
): Promise<RateLimitResult> {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { response, json, isJson } = await fetchJsonWithTimeout('/api/tracking/rate-limit', {
        method: 'POST',
        body: JSON.stringify({ mode, scope }),
      });

      if (response.status === 429 && isJson && json) {
        const waitSec = Math.max(1, Number(json.retryAfterSeconds) || 30);
        return {
          ok: false,
          reason: 'rate_limited',
          retryAfterSeconds: waitSec,
          message:
            typeof json.error === 'string' && json.error
              ? json.error
              : `Too many search attempts. Please wait ${waitSec} seconds before retrying.`,
        };
      }

      if (response.status === 400 && isJson && json) {
        return {
          ok: false,
          reason: 'invalid_request',
          status: 400,
          message:
            typeof json.error === 'string' && json.error
              ? json.error
              : 'Invalid search request. Please check your input.',
        };
      }

      if (response.ok && isJson && json && json.allowed === true) {
        return {
          ok: true,
          remaining: typeof json.remaining === 'number' ? json.remaining : 0,
        };
      }

      // Transient proxy/cold-start error -> retry once before failing closed
      const isTransient =
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504 ||
        !isJson;
      if (isTransient && attempt < maxAttempts) {
        await delayMs(450);
        continue;
      }

      return {
        ok: false,
        reason: 'service_unavailable',
        status: response.status,
        message:
          'Rate-limit verification service is temporarily unavailable. For student privacy, search is paused. Please try again in a moment.',
      };
    } catch {
      if (attempt < maxAttempts) {
        await delayMs(450);
        continue;
      }
      return {
        ok: false,
        reason: 'service_unavailable',
        message:
          'Unable to reach the verification service. Please check your internet connection and try again.',
      };
    }
  }

  return {
    ok: false,
    reason: 'service_unavailable',
    message:
      'Rate-limit verification service is temporarily unavailable. For student privacy, search is paused. Please try again in a moment.',
  };
}

export async function requestTrackingOtp(params: {
  mobile: string;
  mobileHash: string;
}): Promise<OtpRequestResult> {
  try {
    const { response, json, isJson } = await fetchJsonWithTimeout('/api/tracking/otp/request', {
      method: 'POST',
      body: JSON.stringify(params),
    });

    if (!isJson || !json) {
      return {
        ok: false,
        code: 'SERVICE_UNAVAILABLE',
        message: 'OTP verification service is temporarily unavailable. Please try again shortly.',
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        code: typeof json.code === 'string' ? json.code : `HTTP_${response.status}`,
        retryAfterSeconds:
          typeof json.retryAfterSeconds === 'number' ? json.retryAfterSeconds : undefined,
        message:
          typeof json.error === 'string' && json.error
            ? json.error
            : 'Could not send verification OTP. Please try again.',
      };
    }

    return {
      ok: true,
      challengeId: String(json.challengeId || ''),
      expiresAt:
        typeof json.expiresAt === 'number'
          ? json.expiresAt
          : Date.now() + (Number(json.expiresInSeconds) || 300) * 1000,
      expiresInSeconds: Number(json.expiresInSeconds) || 300,
      cooldownSeconds: Number(json.cooldownSeconds) || 30,
      deliveryMode: json.deliveryMode === 'sms' ? 'sms' : 'preview',
      maskedMobile: String(json.maskedMobile || ''),
      previewOtp: typeof json.previewOtp === 'string' ? json.previewOtp : undefined,
    };
  } catch {
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      message: 'Network error while requesting OTP. Please check your connection and try again.',
    };
  }
}

export async function verifyTrackingOtp(params: {
  challengeId: string;
  otp: string;
  mobileHash: string;
}): Promise<OtpVerifyResult> {
  try {
    const { response, json, isJson } = await fetchJsonWithTimeout('/api/tracking/otp/verify', {
      method: 'POST',
      body: JSON.stringify(params),
    });

    if (!isJson || !json) {
      return {
        ok: false,
        code: 'SERVICE_UNAVAILABLE',
        message: 'OTP verification service is temporarily unavailable. Please try again shortly.',
      };
    }

    if (!response.ok || json.verified !== true) {
      return {
        ok: false,
        code: typeof json.code === 'string' ? json.code : `HTTP_${response.status}`,
        attemptsLeft: typeof json.attemptsLeft === 'number' ? json.attemptsLeft : undefined,
        message:
          typeof json.error === 'string' && json.error
            ? json.error
            : 'Invalid or expired OTP. Please try again.',
      };
    }

    return {
      ok: true,
      verificationToken: String(json.verificationToken || ''),
    };
  } catch {
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      message: 'Unable to reach verification server. Please check your connection and retry.',
    };
  }
}

/**
 * Classifies Firestore connectivity / offline / backend errors so UI can display an
 * accurate Firebase service error instead of mistaking an outage for "no records".
 */
export function isFirebaseUnavailableError(err: unknown): boolean {
  const msg =
    err instanceof Error ? err.message.toLowerCase() : String(err ?? '').toLowerCase();
  return (
    msg.includes('offline') ||
    msg.includes('unavailable') ||
    msg.includes('network') ||
    msg.includes('failed to get document') ||
    msg.includes('deadline-exceeded') ||
    msg.includes('could not reach cloud firestore') ||
    msg.includes('permission-denied') ||
    msg.includes('permission_denied') ||
    msg.includes('quota')
  );
}

export interface AttendanceSearchStudentDto {
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
  reportToken?: string;
  /** Non-persisted client-only fallback for static/shared host year-switch ledger lookups */
  _legacyMobile?: string;
}

export interface AttendanceSearchHolidayDto {
  id: string;
  date: string;
  title: string;
  batchId: string;
  dayType: 'Holiday' | 'NotScheduled';
}

export interface AttendanceSearchServerIst {
  date: string;
  time: string;
  iso: string;
  epochMs: number;
  year: number;
  month: number;
  day: number;
  weekday: number;
  timezone: string;
}

export type AttendanceSearchApiResult =
  | {
      ok: true;
      serverIst: AttendanceSearchServerIst;
      year: number;
      students: AttendanceSearchStudentDto[];
      attendance: {
        id: string;
        studentId: string;
        year: number;
        batchId: string;
        batchTiming: string;
        enrolledDate?: string;
        scheduledDays: number[];
        records: Record<
          string,
          {
            status: 'Present' | 'Absent';
            entryTimeMs?: number | null;
            exitTimeMs?: number | null;
            batchTiming?: string;
          }
        >;
      } | null;
      hasAttendanceRecords: boolean;
      holidays: AttendanceSearchHolidayDto[];
    }
  | {
      ok: false;
      code:
        | 'INVALID_MOBILE'
        | 'INVALID_STUDENT_ID'
        | 'APPLICATION_NUMBER_NOT_STUDENT_ID'
        | 'STUDENT_NOT_FOUND'
        | 'RATE_LIMITED'
        | 'SERVICE_UNAVAILABLE';
      retryAfterSeconds?: number;
      message: string;
    };

/**
 * Direct rules-protected Firestore Web SDK lookup used ONLY as a resilient fail-safe
 * when the Express /api/* proxy is unmounted (e.g., static shared hosting 404/302 HTML)
 * or temporarily restarting. Enforces the exact same input validation, SHA-256 hashed
 * lookup collections, approved-and-active filtering, and sliding-window rate limit.
 */
async function fallbackDirectFirestoreAttendanceSearch(params: {
  mode: 'mobile' | 'id';
  query: string;
  year?: number;
}): Promise<AttendanceSearchApiResult> {
  const ist = getClientIstNow();
  const targetYear =
    typeof params.year === 'number' &&
    Number.isInteger(params.year) &&
    params.year >= 2020 &&
    params.year <= 2100
      ? params.year
      : ist.year;

  let normalizedMobile = '';
  let normalizedId = '';

  if (params.mode === 'mobile') {
    const check = normalizeIndianMobile(params.query);
    if (!check.ok) {
      return { ok: false, code: 'INVALID_MOBILE', message: check.error };
    }
    normalizedMobile = check.mobile10;
  } else {
    const check = normalizeStudentId(params.query);
    if (!check.ok) {
      return {
        ok: false,
        code: check.isApplicationNumber
          ? 'APPLICATION_NUMBER_NOT_STUDENT_ID'
          : 'INVALID_STUDENT_ID',
        message: check.error,
      };
    }
    normalizedId = check.studentId;
  }

  const rl = checkFallbackRateLimit('attendance_search', FALLBACK_SEARCH_MAX);
  if (!rl.allowed) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      retryAfterSeconds: rl.retryAfterSeconds,
      message: `Too many search attempts. Please wait ${rl.retryAfterSeconds} seconds before trying again.`,
    };
  }

  try {
    const matched =
      params.mode === 'mobile'
        ? await lookupActiveStudentsForAttendanceByMobile(normalizedMobile)
        : await lookupActiveStudentsForAttendanceById(normalizedId);

    if (!matched || matched.length === 0) {
      return {
        ok: false,
        code: 'STUDENT_NOT_FOUND',
        message: 'Student Not Found.',
      };
    }

    const students: AttendanceSearchStudentDto[] = matched.map((m) => ({
      studentId: m.studentId,
      studentName: m.studentName,
      fatherName: m.fatherName,
      studentClass: m.studentClass,
      course: m.course,
      batch: m.batch,
      maskedMobile: m.maskedMobile,
      photoUrl: m.photoUrl || '',
      photoDataUrl: m.photoDataUrl || '',
      enrolledDate: m.enrolledDate || '',
      attendanceKeyHash: m.attendanceKeyHash,
      _legacyMobile: normalizedMobile || m._legacyMobile || undefined,
    }));

    let attendance: Extract<AttendanceSearchApiResult, { ok: true }>['attendance'] = null;
    const rawHolidays = await fetchPublicAttendanceHolidays();
    const holidays: AttendanceSearchHolidayDto[] = rawHolidays.map((h) => ({
      id: h.id,
      date: h.date,
      title: h.title,
      batchId: h.batchId,
      dayType: h.dayType,
    }));

    if (students.length === 1) {
      const ledger = await fetchStudentAttendanceById(
        students[0].studentId,
        targetYear,
        students[0]._legacyMobile
      );
      if (ledger) {
        attendance = {
          id: ledger.id,
          studentId: ledger.studentId,
          year: ledger.year,
          batchId: ledger.batchId,
          batchTiming: ledger.batchTiming,
          enrolledDate: ledger.enrolledDate || '',
          scheduledDays: Array.isArray(ledger.scheduledDays) ? ledger.scheduledDays : [],
          records: ledger.records || {},
        };
      }
    }

    const recordCount = attendance?.records ? Object.keys(attendance.records).length : 0;

    return {
      ok: true,
      serverIst: {
        date: ist.date,
        time: ist.time,
        iso: ist.iso,
        epochMs: ist.epochMs,
        year: ist.year,
        month: ist.month,
        day: ist.day,
        weekday: ist.weekday,
        timezone: 'Asia/Kolkata',
      },
      year: targetYear,
      students,
      attendance,
      hasAttendanceRecords: recordCount > 0,
      holidays,
    };
  } catch (err) {
    console.error('[attendance-fallback] Firestore lookup failed:', err);
    return {
      ok: false,
      code: 'SERVICE_UNAVAILABLE',
      message: isFirebaseUnavailableError(err)
        ? 'Database Temporarily Unavailable. Please check your internet connection and try again.'
        : 'Server Temporarily Unavailable. Please try again in a moment.',
    };
  }
}

export async function searchStudentAttendanceApi(params: {
  mode: 'mobile' | 'id';
  query: string;
  year?: number;
}): Promise<AttendanceSearchApiResult> {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { response, json, isJson } = await fetchJsonWithTimeout(
        '/api/attendance/search',
        {
          method: 'POST',
          body: JSON.stringify(params),
        },
        10000
      );

      if (response.ok && isJson && json && json.ok === true && Array.isArray(json.students)) {
        return {
          ok: true,
          serverIst: json.serverIst as AttendanceSearchServerIst,
          year: Number(json.year) || new Date().getFullYear(),
          students: json.students as AttendanceSearchStudentDto[],
          attendance: (json.attendance ?? null) as Extract<
            AttendanceSearchApiResult,
            { ok: true }
          >['attendance'],
          hasAttendanceRecords: Boolean(json.hasAttendanceRecords),
          holidays: Array.isArray(json.holidays)
            ? (json.holidays as AttendanceSearchHolidayDto[])
            : [],
        };
      }

      // Strictly honor authoritative JSON verdicts from Express backend
      if (response.status === 404 && isJson && json) {
        return {
          ok: false,
          code: 'STUDENT_NOT_FOUND',
          message: typeof json.error === 'string' && json.error ? json.error : 'Student Not Found.',
        };
      }

      if (response.status === 400 && isJson && json) {
        const rawCode = typeof json.code === 'string' ? json.code : '';
        const code =
          rawCode === 'INVALID_MOBILE' ||
          rawCode === 'INVALID_STUDENT_ID' ||
          rawCode === 'APPLICATION_NUMBER_NOT_STUDENT_ID'
            ? rawCode
            : params.mode === 'mobile'
            ? 'INVALID_MOBILE'
            : 'INVALID_STUDENT_ID';
        return {
          ok: false,
          code,
          message:
            typeof json.error === 'string' && json.error
              ? json.error
              : params.mode === 'mobile'
              ? 'Invalid Mobile Number.'
              : 'Invalid Student ID.',
        };
      }

      if (response.status === 429 && isJson && json) {
        const waitSec = Math.max(1, Number(json.retryAfterSeconds) || 30);
        return {
          ok: false,
          code: 'RATE_LIMITED',
          retryAfterSeconds: waitSec,
          message:
            typeof json.error === 'string' && json.error
              ? json.error
              : `Too many search attempts. Please wait ${waitSec} seconds before retrying.`,
        };
      }

      // If /api/* returned non-JSON HTML (e.g., static host 404 or proxy 302), switch to fail-safe immediately
      if (!isJson) {
        return fallbackDirectFirestoreAttendanceSearch(params);
      }

      const isTransient = response.status === 502 || response.status === 503 || response.status === 504;
      if (isTransient && attempt < maxAttempts) {
        await delayMs(400);
        continue;
      }

      // Backend temporarily unavailable after retry -> fail-safe direct rules-protected Firestore lookup
      return fallbackDirectFirestoreAttendanceSearch(params);
    } catch {
      if (attempt < maxAttempts) {
        await delayMs(400);
        continue;
      }
      return fallbackDirectFirestoreAttendanceSearch(params);
    }
  }

  return fallbackDirectFirestoreAttendanceSearch(params);
}

export type AttendanceReportApiResult =
  | {
      ok: true;
      year: number;
      attendance: Extract<AttendanceSearchApiResult, { ok: true }>['attendance'];
      hasAttendanceRecords: boolean;
    }
  | {
      ok: false;
      code: 'INVALID_STUDENT_ID' | 'RATE_LIMITED' | 'SERVICE_UNAVAILABLE';
      retryAfterSeconds?: number;
      message: string;
    };

async function fallbackDirectFirestoreAttendanceReport(params: {
  studentId: string;
  year: number;
  legacyMobile?: string;
}): Promise<AttendanceReportApiResult> {
  const idCheck = normalizeStudentId(params.studentId);
  if (!idCheck.ok) {
    return { ok: false, code: 'INVALID_STUDENT_ID', message: idCheck.error };
  }

  const rl = checkFallbackRateLimit('attendance_report', FALLBACK_REPORT_MAX);
  if (!rl.allowed) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      retryAfterSeconds: rl.retryAfterSeconds,
      message: `Too many requests. Please wait ${rl.retryAfterSeconds} seconds.`,
    };
  }

  try {
    const ledger = await fetchStudentAttendanceById(
      idCheck.studentId,
      params.year,
      params.legacyMobile
    );
    const attendance = ledger
      ? {
          id: ledger.id,
          studentId: ledger.studentId,
          year: ledger.year,
          batchId: ledger.batchId,
          batchTiming: ledger.batchTiming,
          enrolledDate: ledger.enrolledDate || '',
          scheduledDays: Array.isArray(ledger.scheduledDays) ? ledger.scheduledDays : [],
          records: ledger.records || {},
        }
      : null;
    const recordCount = attendance?.records ? Object.keys(attendance.records).length : 0;
    return {
      ok: true,
      year: params.year,
      attendance,
      hasAttendanceRecords: recordCount > 0,
    };
  } catch (err) {
    console.error('[attendance-report-fallback] Firestore lookup failed:', err);
    return {
      ok: false,
      code: 'SERVICE_UNAVAILABLE',
      message: isFirebaseUnavailableError(err)
        ? 'Database Temporarily Unavailable. Please check your internet connection and retry.'
        : 'Server Temporarily Unavailable. Please try again in a moment.',
    };
  }
}

export async function fetchStudentAttendanceReportApi(params: {
  studentId: string;
  year: number;
  reportToken?: string;
  legacyMobile?: string;
}): Promise<AttendanceReportApiResult> {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { response, json, isJson } = await fetchJsonWithTimeout(
        '/api/attendance/report',
        {
          method: 'POST',
          body: JSON.stringify({
            studentId: params.studentId,
            year: params.year,
            reportToken: params.reportToken,
          }),
        },
        10000
      );

      if (response.ok && isJson && json && json.ok === true) {
        return {
          ok: true,
          year: Number(json.year) || params.year,
          attendance: (json.attendance ?? null) as Extract<
            AttendanceSearchApiResult,
            { ok: true }
          >['attendance'],
          hasAttendanceRecords: Boolean(json.hasAttendanceRecords),
        };
      }

      if (response.status === 429 && isJson && json) {
        const waitSec = Math.max(1, Number(json.retryAfterSeconds) || 30);
        return {
          ok: false,
          code: 'RATE_LIMITED',
          retryAfterSeconds: waitSec,
          message:
            typeof json.error === 'string' && json.error
              ? json.error
              : `Too many requests. Please wait ${waitSec} seconds.`,
        };
      }

      if (response.status === 400 && isJson && json) {
        return {
          ok: false,
          code: 'INVALID_STUDENT_ID',
          message: typeof json.error === 'string' && json.error ? json.error : 'Invalid Student ID.',
        };
      }

      if (!isJson) {
        return fallbackDirectFirestoreAttendanceReport(params);
      }

      const isTransient = response.status === 502 || response.status === 503 || response.status === 504;
      if (isTransient && attempt < maxAttempts) {
        await delayMs(400);
        continue;
      }

      return fallbackDirectFirestoreAttendanceReport(params);
    } catch {
      if (attempt < maxAttempts) {
        await delayMs(400);
        continue;
      }
      return fallbackDirectFirestoreAttendanceReport(params);
    }
  }

  return fallbackDirectFirestoreAttendanceReport(params);
}
