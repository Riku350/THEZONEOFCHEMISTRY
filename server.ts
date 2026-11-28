import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveServerPort(): number {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' && args[i + 1]) {
      const parsed = Number(args[i + 1]);
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) return parsed;
    } else if (arg.startsWith('--port=')) {
      const parsed = Number(arg.slice('--port='.length));
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) return parsed;
    }
  }
  const envPort = Number(process.env.PORT);
  if (Number.isInteger(envPort) && envPort > 0 && envPort <= 65535) return envPort;
  return 3000;
}

const PORT = resolveServerPort();
const DIST_INDEX_PATH = path.resolve(__dirname, 'dist', 'index.html');
const IS_PRODUCTION =
  process.env.NODE_ENV === 'production' ||
  (process.env.NODE_ENV !== 'development' && fs.existsSync(DIST_INDEX_PATH));

const ATTENDANCE_SIGNING_KEY = crypto.randomBytes(32).toString('hex');

// ---------------------------------------------------------------------------
// Sliding-Window Rate Limiting (In-Memory, TTL-bounded)
// ---------------------------------------------------------------------------
const SEARCH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const SEARCH_MAX_ATTEMPTS = 12;
const ATTENDANCE_SEARCH_MAX_ATTEMPTS = 30;
const ATTENDANCE_REPORT_MAX_ATTEMPTS = 60;

const searchBuckets = new Map<string, number[]>();

// ---------------------------------------------------------------------------
// Public Firebase Web Config (Read from firebase-applet-config.json;
// Firestore REST calls remain 100% subject to deployed firestore.rules)
// ---------------------------------------------------------------------------
interface FirebaseAppletConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId?: string;
}

function loadFirebaseAppletConfig(): FirebaseAppletConfig | null {
  const candidatePaths = [
    path.resolve(__dirname, 'firebase-applet-config.json'),
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
  ];
  for (const cfgPath of candidatePaths) {
    try {
      if (!fs.existsSync(cfgPath)) continue;
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as Partial<FirebaseAppletConfig>;
      if (!parsed.projectId || !parsed.apiKey || parsed.projectId === 'remixed-project-id') {
        continue;
      }
      return {
        projectId: parsed.projectId,
        apiKey: parsed.apiKey,
        firestoreDatabaseId: parsed.firestoreDatabaseId || '(default)',
      };
    } catch (err) {
      console.error(`[attendance-api] Failed to parse ${cfgPath}:`, err instanceof Error ? err.message : err);
    }
  }
  console.error('[attendance-api] firebase-applet-config.json not found or incomplete.');
  return null;
}

const FIREBASE_CONFIG = loadFirebaseAppletConfig();
if (FIREBASE_CONFIG) {
  console.info(
    `[attendance-api] Firebase Firestore configured (project=${FIREBASE_CONFIG.projectId}, db=${FIREBASE_CONFIG.firestoreDatabaseId})`
  );
}

function sha256HexServer(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function getCurrentIstInfo() {
  const now = new Date();
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now);

  const yearStr = dateParts.find((p) => p.type === 'year')?.value || '2026';
  const monthStr = dateParts.find((p) => p.type === 'month')?.value || '01';
  const dayStr = dateParts.find((p) => p.type === 'day')?.value || '01';
  const weekdayShort = dateParts.find((p) => p.type === 'weekday')?.value || 'Mon';
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const timeStr = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(now);

  return {
    date: `${yearStr}-${monthStr}-${dayStr}`,
    time: timeStr,
    iso: now.toISOString(),
    epochMs: now.getTime(),
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
    weekday: weekdayMap[weekdayShort] ?? 1,
    timezone: 'Asia/Kolkata',
  };
}

function normalizeIndianMobileServer(
  raw: unknown
): { ok: true; mobile10: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return {
      ok: false,
      error: 'Invalid Mobile Number. Please enter a valid 10-digit Indian mobile number.',
    };
  }
  const str = String(raw).trim();
  if (!str) {
    return {
      ok: false,
      error: 'Invalid Mobile Number. Please enter a valid 10-digit Indian mobile number.',
    };
  }
  // Remove spaces, hyphens, parentheses, dots
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
      error: 'Invalid Mobile Number. Please enter a valid 10-digit Indian mobile number (e.g., 6299475970).',
    };
  }
  return { ok: true, mobile10: compact };
}

function normalizeStudentIdServer(
  raw: unknown
): { ok: true; studentId: string } | { ok: false; isApplicationNumber?: boolean; error: string } {
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return {
      ok: false,
      error: 'Invalid Student ID. Please enter your Student ID (e.g., ZOC-2026-123456).',
    };
  }
  let cleaned = String(raw).trim().toUpperCase();
  if (cleaned.startsWith('ZOC:')) {
    cleaned = cleaned.slice(4).trim();
  }
  if (!cleaned || cleaned.length < 4 || cleaned.length > 64 || !/^[A-Z0-9_\-]+$/.test(cleaned)) {
    return {
      ok: false,
      error: 'Invalid Student ID. Please enter your Student ID (e.g., ZOC-2026-123456).',
    };
  }
  // Explicitly reject Application Numbers (e.g., ZOC2026-37460) so they are never confused with Student IDs
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

function sanitizeDocKeySegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 120);
}

function signAttendanceReportToken(studentId: string, mobile10: string): string {
  const legacyPairHash = sha256HexServer(`${studentId}:${mobile10}`);
  const exp = Date.now() + 15 * 60 * 1000;
  const payload = `${studentId}.${legacyPairHash}.${exp}`;
  const sig = crypto.createHmac('sha256', ATTENDANCE_SIGNING_KEY).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyAttendanceReportToken(
  token: string,
  expectedStudentId: string
): { legacyPairHash: string } | null {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [stuId, legacyPairHash, expStr, sigHex] = parts;
  if (
    stuId !== expectedStudentId ||
    !/^[a-f0-9]{64}$/.test(legacyPairHash) ||
    !/^[0-9]+$/.test(expStr) ||
    !/^[a-f0-9]{64}$/.test(sigHex)
  ) {
    return null;
  }
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  const payload = `${stuId}.${legacyPairHash}.${expStr}`;
  const expectedSig = crypto.createHmac('sha256', ATTENDANCE_SIGNING_KEY).update(payload).digest('hex');
  const matches = crypto.timingSafeEqual(
    Buffer.from(expectedSig, 'hex'),
    Buffer.from(sigHex, 'hex')
  );
  return matches ? { legacyPairHash } : null;
}

// Firestore REST JSON Value Decoder
type FirestoreRestValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  timestampValue?: string;
  arrayValue?: { values?: FirestoreRestValue[] };
  mapValue?: { fields?: Record<string, FirestoreRestValue> };
};

function decodeFirestoreValue(val: FirestoreRestValue | undefined): unknown {
  if (!val || typeof val !== 'object') return null;
  if ('stringValue' in val) return val.stringValue ?? '';
  if ('integerValue' in val) return Number(val.integerValue ?? 0);
  if ('doubleValue' in val) return Number(val.doubleValue ?? 0);
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue ?? null;
  if ('arrayValue' in val) {
    const items = val.arrayValue?.values;
    return Array.isArray(items) ? items.map((v) => decodeFirestoreValue(v)) : [];
  }
  if ('mapValue' in val) {
    const fields = val.mapValue?.fields;
    if (!fields || typeof fields !== 'object') return {};
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      obj[k] = decodeFirestoreValue(v);
    }
    return obj;
  }
  return null;
}

function decodeFirestoreDocument(docJson: {
  name?: string;
  fields?: Record<string, FirestoreRestValue>;
}): { id: string; data: Record<string, unknown> } {
  const name = typeof docJson.name === 'string' ? docJson.name : '';
  const id = name.split('/').pop() || '';
  const data: Record<string, unknown> = {};
  if (docJson.fields && typeof docJson.fields === 'object') {
    for (const [k, v] of Object.entries(docJson.fields)) {
      data[k] = decodeFirestoreValue(v);
    }
  }
  return { id, data };
}

class FirestoreUpstreamError extends Error {
  status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.status = status;
  }
}

async function fetchFirestorePublicDoc(
  collectionName: string,
  docId: string
): Promise<{ exists: true; id: string; data: Record<string, unknown> } | { exists: false }> {
  if (!FIREBASE_CONFIG) {
    throw new FirestoreUpstreamError('Firebase configuration is missing on the server.', 503);
  }
  const dbId = encodeURIComponent(FIREBASE_CONFIG.firestoreDatabaseId || '(default)');
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    FIREBASE_CONFIG.projectId
  )}/databases/${dbId}/documents/${encodeURIComponent(collectionName)}/${encodeURIComponent(
    docId
  )}?key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`;

  const maxAttempts = 2;
  let lastError: FirestoreUpstreamError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (res.status === 404) {
        return { exists: false };
      }
      if (!res.ok) {
        const status = res.status >= 500 ? 503 : res.status;
        lastError = new FirestoreUpstreamError(
          `Firestore read failed for ${collectionName} (HTTP ${res.status}).`,
          status
        );
        if (res.status >= 500 && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 350));
          continue;
        }
        throw lastError;
      }
      const json = (await res.json()) as {
        name?: string;
        fields?: Record<string, FirestoreRestValue>;
      };
      const decoded = decodeFirestoreDocument(json);
      return { exists: true, id: decoded.id, data: decoded.data };
    } catch (err) {
      if (err instanceof FirestoreUpstreamError) {
        if (err.status < 500 || attempt >= maxAttempts) throw err;
        lastError = err;
      } else {
        lastError = new FirestoreUpstreamError('Unable to reach Firebase Firestore right now.', 503);
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 350));
          continue;
        }
        throw lastError;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new FirestoreUpstreamError('Unable to reach Firebase Firestore right now.', 503);
}

async function fetchFirestorePublicHolidays(): Promise<
  Array<{
    id: string;
    date: string;
    title: string;
    batchId: string;
    dayType: 'Holiday' | 'NotScheduled';
  }>
> {
  if (!FIREBASE_CONFIG) return [];
  const dbId = encodeURIComponent(FIREBASE_CONFIG.firestoreDatabaseId || '(default)');
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    FIREBASE_CONFIG.projectId
  )}/databases/${dbId}/documents/attendanceHolidays?pageSize=200&key=${encodeURIComponent(
    FIREBASE_CONFIG.apiKey
  )}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      documents?: Array<{ name?: string; fields?: Record<string, FirestoreRestValue> }>;
    };
    if (!Array.isArray(json.documents)) return [];
    return json.documents
      .map((d) => {
        const { id, data } = decodeFirestoreDocument(d);
        return {
          id,
          date: typeof data.date === 'string' ? data.date : '',
          title: typeof data.title === 'string' ? data.title : 'Holiday',
          batchId: typeof data.batchId === 'string' ? data.batchId : 'ALL',
          dayType: (data.dayType === 'NotScheduled' ? 'NotScheduled' : 'Holiday') as
            | 'Holiday'
            | 'NotScheduled',
        };
      })
      .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

interface SanitizedAttendanceStudent {
  studentId: string;
  studentName: string;
  fatherName: string;
  studentClass: string;
  course: string;
  batch: string;
  maskedMobile: string;
  photoUrl: string;
  photoDataUrl: string;
  enrolledDate: string;
  attendanceKeyHash: string;
  reportToken?: string;
}

function sanitizeAttendanceLookupEntry(
  raw: Record<string, unknown>,
  mobile10ForToken?: string
): SanitizedAttendanceStudent | null {
  const rawId = typeof raw.studentId === 'string' ? raw.studentId.trim().toUpperCase() : '';
  const idCheck = normalizeStudentIdServer(rawId);
  if (!idCheck.ok) return null;

  const studentId = idCheck.studentId;
  const studentName =
    typeof raw.studentName === 'string' && raw.studentName.trim().length > 0
      ? raw.studentName.trim().slice(0, 120)
      : 'Student';
  const fatherName =
    typeof raw.fatherName === 'string' && raw.fatherName.trim().length > 0
      ? raw.fatherName.trim().slice(0, 120)
      : '—';
  const studentClass =
    typeof raw.studentClass === 'string' && raw.studentClass.trim().length > 0
      ? raw.studentClass.trim().slice(0, 40)
      : '—';
  const course =
    typeof raw.course === 'string' && raw.course.trim().length > 0
      ? raw.course.trim().slice(0, 100)
      : 'Chemistry';
  const batch =
    typeof raw.batch === 'string' && raw.batch.trim().length > 0
      ? raw.batch.trim().slice(0, 80)
      : 'Regular Batch';
  const maskedMobile =
    typeof raw.maskedMobile === 'string' && raw.maskedMobile.trim().length > 0
      ? raw.maskedMobile.trim().slice(0, 20)
      : mobile10ForToken
      ? `******${mobile10ForToken.slice(-4)}`
      : '******';
  const photoUrl = typeof raw.photoUrl === 'string' ? raw.photoUrl.trim().slice(0, 2000) : '';
  const photoDataUrl =
    typeof raw.photoDataUrl === 'string' && raw.photoDataUrl.startsWith('data:image/')
      ? raw.photoDataUrl.slice(0, 250000)
      : '';
  const enrolledDate =
    typeof raw.enrolledDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.enrolledDate)
      ? raw.enrolledDate
      : '';
  const attendanceKeyHash =
    typeof raw.attendanceKeyHash === 'string' && /^[a-f0-9]{64}$/.test(raw.attendanceKeyHash)
      ? raw.attendanceKeyHash
      : sha256HexServer(sanitizeDocKeySegment(studentId));

  const dto: SanitizedAttendanceStudent = {
    studentId,
    studentName,
    fatherName,
    studentClass,
    course,
    batch,
    maskedMobile,
    photoUrl,
    photoDataUrl,
    enrolledDate,
    attendanceKeyHash,
  };
  if (mobile10ForToken) {
    dto.reportToken = signAttendanceReportToken(studentId, mobile10ForToken);
  }
  return dto;
}

function formatYmdFromIsoIst(isoVal: unknown): string {
  if (typeof isoVal !== 'string' || !isoVal) return '';
  const d = new Date(isoVal);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return y && m && day ? `${y}-${m}-${day}` : '';
}

async function fetchPublicAttendanceLedgerServer(
  studentId: string,
  year: number,
  legacyPairHash?: string
): Promise<Record<string, unknown> | null> {
  const normId = sanitizeDocKeySegment(studentId.trim().toUpperCase());
  const attIdKey = `attid_${sha256HexServer(normId)}_${year}`;
  const primary = await fetchFirestorePublicDoc('studentAttendancePublic', attIdKey);
  if (primary.exists) {
    return {
      id: primary.id,
      studentId: typeof primary.data.studentId === 'string' ? primary.data.studentId : normId,
      year: typeof primary.data.year === 'number' ? primary.data.year : year,
      batchId: typeof primary.data.batchId === 'string' ? primary.data.batchId : '',
      batchTiming: typeof primary.data.batchTiming === 'string' ? primary.data.batchTiming : '',
      enrolledDate: typeof primary.data.enrolledDate === 'string' ? primary.data.enrolledDate : '',
      scheduledDays: Array.isArray(primary.data.scheduledDays) ? primary.data.scheduledDays : [],
      records:
        primary.data.records && typeof primary.data.records === 'object'
          ? primary.data.records
          : {},
    };
  }

  if (legacyPairHash && /^[a-f0-9]{64}$/.test(legacyPairHash)) {
    const legacyKey = `attpub_${legacyPairHash}_${year}`;
    const legacy = await fetchFirestorePublicDoc('studentAttendancePublic', legacyKey);
    if (legacy.exists) {
      return {
        id: legacy.id,
        studentId: typeof legacy.data.studentId === 'string' ? legacy.data.studentId : normId,
        year: typeof legacy.data.year === 'number' ? legacy.data.year : year,
        batchId: typeof legacy.data.batchId === 'string' ? legacy.data.batchId : '',
        batchTiming: typeof legacy.data.batchTiming === 'string' ? legacy.data.batchTiming : '',
        enrolledDate: typeof legacy.data.enrolledDate === 'string' ? legacy.data.enrolledDate : '',
        scheduledDays: Array.isArray(legacy.data.scheduledDays) ? legacy.data.scheduledDays : [],
        records:
          legacy.data.records && typeof legacy.data.records === 'object'
            ? legacy.data.records
            : {},
      };
    }
  }
  return null;
}

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0].trim().slice(0, 64);
  }
  if (Array.isArray(forwarded) && forwarded.length > 0 && forwarded[0]) {
    return forwarded[0].split(',')[0].trim().slice(0, 64);
  }
  return (req.ip || req.socket.remoteAddress || 'unknown').slice(0, 64);
}

function checkSlidingWindow(
  buckets: Map<string, number[]>,
  key: string,
  windowMs: number,
  maxAllowed: number
): { allowed: boolean; remaining: number; retryAfterSeconds: number; lastTimestamp: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const recent = (buckets.get(key) || []).filter((ts) => ts > cutoff);
  const lastTimestamp = recent.length > 0 ? recent[recent.length - 1] : 0;

  if (recent.length >= maxAllowed) {
    buckets.set(key, recent);
    const oldest = recent[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds, lastTimestamp };
  }

  recent.push(now);
  buckets.set(key, recent);
  return {
    allowed: true,
    remaining: Math.max(0, maxAllowed - recent.length),
    retryAfterSeconds: 0,
    lastTimestamp,
  };
}

function pruneExpiredState(): void {
  const now = Date.now();
  if (searchBuckets.size > 5000) {
    for (const [key, list] of searchBuckets.entries()) {
      const kept = list.filter((ts) => ts > now - SEARCH_WINDOW_MS);
      if (kept.length === 0) searchBuckets.delete(key);
      else searchBuckets.set(key, kept);
    }
  }
}

setInterval(pruneExpiredState, 60 * 1000).unref();

async function startServer(): Promise<void> {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  // Safe same-origin / preview CORS + no-store headers on all /api routes
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const host = req.headers.host || '';
    if (typeof origin === 'string' && origin.length > 0) {
      try {
        const parsed = new URL(origin);
        const isSameHost = parsed.host === host;
        const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
        const isRunApp = parsed.hostname.endsWith('.run.app') && parsed.protocol === 'https:';
        if (isSameHost || isLocal || isRunApp) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Vary', 'Origin');
          res.setHeader('Access-Control-Allow-Credentials', 'true');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Requested-With');
        }
      } catch {
        // Ignore malformed Origin header
      }
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // -------------------------------------------------------------------------
  // 0. Health & Server-Authoritative IST (Asia/Kolkata) Endpoints
  // -------------------------------------------------------------------------
  app.get('/api/tracking/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'tracking-rate-limit',
      timestamp: Date.now(),
    });
  });

  app.get('/api/attendance/health', async (_req: Request, res: Response) => {
    if (!FIREBASE_CONFIG) {
      res.status(503).json({
        ok: false,
        service: 'attendance-api',
        firebaseConfigured: false,
        firestoreReachable: false,
        timestamp: Date.now(),
      });
      return;
    }
    try {
      await fetchFirestorePublicDoc('settings', 'main');
      res.json({
        ok: true,
        service: 'attendance-api',
        firebaseConfigured: true,
        firestoreReachable: true,
        databaseId: FIREBASE_CONFIG.firestoreDatabaseId || '(default)',
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error(
        '[attendance-health] Firestore connectivity check failed:',
        err instanceof Error ? err.message : err
      );
      res.status(503).json({
        ok: false,
        service: 'attendance-api',
        firebaseConfigured: true,
        firestoreReachable: false,
        timestamp: Date.now(),
      });
    }
  });

  app.get('/api/time/ist', (_req: Request, res: Response) => {
    const now = new Date();
    const dateParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).formatToParts(now);

    const yearStr = dateParts.find((p) => p.type === 'year')?.value || '2026';
    const monthStr = dateParts.find((p) => p.type === 'month')?.value || '01';
    const dayStr = dateParts.find((p) => p.type === 'day')?.value || '01';
    const weekdayShort = dateParts.find((p) => p.type === 'weekday')?.value || 'Mon';
    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };

    const timeStr = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(now);

    res.json({
      date: `${yearStr}-${monthStr}-${dayStr}`,
      time: timeStr,
      iso: now.toISOString(),
      epochMs: now.getTime(),
      year: Number(yearStr),
      month: Number(monthStr),
      day: Number(dayStr),
      weekday: weekdayMap[weekdayShort] ?? 1,
      timezone: 'Asia/Kolkata',
    });
  });

  // -------------------------------------------------------------------------
  // 1. Search Rate-Limit Check Endpoint (Sliding Window, Fail-Closed)
  // -------------------------------------------------------------------------
  app.post('/api/tracking/rate-limit', (req: Request, res: Response) => {
    const mode = typeof req.body?.mode === 'string' ? req.body.mode.trim().toLowerCase() : '';
    const rawScope = typeof req.body?.scope === 'string' ? req.body.scope.trim().toLowerCase() : 'tracking';
    const scope = rawScope === 'attendance' || rawScope === 'admission' ? rawScope : 'tracking';

    if (mode !== 'id' && mode !== 'mobile') {
      res.status(400).json({
        allowed: false,
        code: 'INVALID_MODE',
        error: 'Invalid search mode. Choose Student ID or Registered Mobile Number.',
      });
      return;
    }

    const ip = getClientIp(req);
    const bucketKey = `${ip}:${scope}`;
    const maxAllowed = scope === 'attendance' ? ATTENDANCE_SEARCH_MAX_ATTEMPTS : SEARCH_MAX_ATTEMPTS;
    const verdict = checkSlidingWindow(searchBuckets, bucketKey, SEARCH_WINDOW_MS, maxAllowed);

    if (!verdict.allowed) {
      res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
      res.status(429).json({
        allowed: false,
        code: 'RATE_LIMITED',
        error: `Too many search attempts. Please wait ${verdict.retryAfterSeconds} seconds before trying again.`,
        retryAfterSeconds: verdict.retryAfterSeconds,
      });
      return;
    }

    res.json({
      allowed: true,
      remaining: verdict.remaining,
      windowSeconds: Math.floor(SEARCH_WINDOW_MS / 1000),
      serverTime: Date.now(),
    });
  });



  // -------------------------------------------------------------------------
  // 4. Direct No-OTP Student Attendance Search API (Rate-Limited, Minimal PII)
  // -------------------------------------------------------------------------
  app.post('/api/attendance/search', async (req: Request, res: Response) => {
    const mode = typeof req.body?.mode === 'string' ? req.body.mode.trim().toLowerCase() : '';
    const rawQuery = req.body?.query;
    const serverIst = getCurrentIstInfo();
    const rawYear = Number(req.body?.year);
    const targetYear =
      Number.isInteger(rawYear) && rawYear >= 2020 && rawYear <= 2100 ? rawYear : serverIst.year;

    if (mode !== 'mobile' && mode !== 'id') {
      res.status(400).json({
        ok: false,
        code: 'INVALID_MODE',
        error: 'Invalid search mode. Choose Registered Mobile Number or Student ID Number.',
      });
      return;
    }

    // Validate input BEFORE consuming rate-limit budget for obvious typos
    let normalizedMobile = '';
    let normalizedStudentId = '';

    if (mode === 'mobile') {
      const mobileCheck = normalizeIndianMobileServer(rawQuery);
      if (!mobileCheck.ok) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_MOBILE',
          error: mobileCheck.error,
        });
        return;
      }
      normalizedMobile = mobileCheck.mobile10;
    } else {
      const idCheck = normalizeStudentIdServer(rawQuery);
      if (!idCheck.ok) {
        res.status(400).json({
          ok: false,
          code: idCheck.isApplicationNumber ? 'APPLICATION_NUMBER_NOT_STUDENT_ID' : 'INVALID_STUDENT_ID',
          error: idCheck.error,
        });
        return;
      }
      normalizedStudentId = idCheck.studentId;
    }

    // Server-side sliding-window rate limiting
    const ip = getClientIp(req);
    const verdict = checkSlidingWindow(
      searchBuckets,
      `${ip}:attendance_search`,
      SEARCH_WINDOW_MS,
      ATTENDANCE_SEARCH_MAX_ATTEMPTS
    );
    if (!verdict.allowed) {
      res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
      res.status(429).json({
        ok: false,
        code: 'RATE_LIMITED',
        error: `Too many search attempts. Please wait ${verdict.retryAfterSeconds} seconds before trying again.`,
        retryAfterSeconds: verdict.retryAfterSeconds,
      });
      return;
    }

    try {
      const matchedMap = new Map<string, SanitizedAttendanceStudent>();

      if (mode === 'mobile') {
        const mobKey = `attmob_${sha256HexServer(normalizedMobile)}`;
        const attIdxDoc = await fetchFirestorePublicDoc('attendanceLookupIndex', mobKey);
        if (attIdxDoc.exists && Array.isArray(attIdxDoc.data.entries)) {
          for (const rawEntry of attIdxDoc.data.entries) {
            if (rawEntry && typeof rawEntry === 'object') {
              const sanitized = sanitizeAttendanceLookupEntry(
                rawEntry as Record<string, unknown>,
                normalizedMobile
              );
              if (sanitized) {
                matchedMap.set(sanitized.studentId, sanitized);
              }
            }
          }
        }

        // Seamless fallback: also link any approved & active students present in trackingIndex
        // that have not yet been backfilled into attendanceLookupIndex.
        // Strictly ignores pending, rejected, or suspended records!
        if (matchedMap.size === 0) {
          const trackMobKey = `mob_${sha256HexServer(normalizedMobile)}`;
          const trackDoc = await fetchFirestorePublicDoc('trackingIndex', trackMobKey);
          if (trackDoc.exists && Array.isArray(trackDoc.data.entries)) {
            const approvedCandidates = (trackDoc.data.entries as Array<Record<string, unknown>>).filter(
              (e) =>
                e &&
                e.hasStudentId === true &&
                (e.admissionStage === 'Student ID Generated' || e.admissionStage === 'Approved') &&
                typeof e.applicationNumber === 'string' &&
                e.applicationNumber.trim().length >= 4
            );

            for (const candidate of approvedCandidates) {
              const appNo = sanitizeDocKeySegment(
                String(candidate.applicationNumber).trim().toUpperCase()
              );
              const profKey = `prof_${sha256HexServer(`${appNo}:${normalizedMobile}`)}`;
              const profDoc = await fetchFirestorePublicDoc('studentTrackingProfiles', profKey);
              if (
                profDoc.exists &&
                profDoc.data.status === 'approved' &&
                typeof profDoc.data.studentId === 'string' &&
                profDoc.data.studentId.trim().length >= 4 &&
                profDoc.data.studentStatus !== 'suspended'
              ) {
                const sanitized = sanitizeAttendanceLookupEntry(
                  {
                    ...profDoc.data,
                    maskedMobile: `******${normalizedMobile.slice(-4)}`,
                    enrolledDate: formatYmdFromIsoIst(profDoc.data.submittedAt),
                  },
                  normalizedMobile
                );
                if (sanitized) {
                  matchedMap.set(sanitized.studentId, sanitized);
                }
              }
            }
          }
        }
      } else {
        // Exact Student ID lookup (never matches Application Number)
        const idKey = `attid_${sha256HexServer(sanitizeDocKeySegment(normalizedStudentId))}`;
        const attIdxDoc = await fetchFirestorePublicDoc('attendanceLookupIndex', idKey);
        if (attIdxDoc.exists && Array.isArray(attIdxDoc.data.entries)) {
          for (const rawEntry of attIdxDoc.data.entries) {
            if (rawEntry && typeof rawEntry === 'object') {
              const sanitized = sanitizeAttendanceLookupEntry(rawEntry as Record<string, unknown>);
              if (sanitized && sanitized.studentId === normalizedStudentId) {
                matchedMap.set(sanitized.studentId, sanitized);
              }
            }
          }
        }
      }

      const students = Array.from(matchedMap.values());
      if (students.length === 0) {
        res.status(404).json({
          ok: false,
          code: 'STUDENT_NOT_FOUND',
          error: 'Student Not Found.',
          serverIst,
        });
        return;
      }

      // If a single student matched, immediately load their attendance ledger + holidays in one round-trip
      let attendance: Record<string, unknown> | null = null;
      let holidays: Array<{
        id: string;
        date: string;
        title: string;
        batchId: string;
        dayType: 'Holiday' | 'NotScheduled';
      }> = [];

      if (students.length === 1) {
        const legacyPairHash = normalizedMobile
          ? sha256HexServer(`${students[0].studentId}:${normalizedMobile}`)
          : undefined;
        const [attLedger, pubHolidays] = await Promise.all([
          fetchPublicAttendanceLedgerServer(students[0].studentId, targetYear, legacyPairHash),
          fetchFirestorePublicHolidays(),
        ]);
        attendance = attLedger;
        holidays = pubHolidays;
      } else {
        holidays = await fetchFirestorePublicHolidays();
      }

      const recordCount =
        attendance && attendance.records && typeof attendance.records === 'object'
          ? Object.keys(attendance.records as Record<string, unknown>).length
          : 0;

      console.info(
        `[attendance-search] ok mode=${mode} matches=${students.length} hasRecords=${recordCount > 0}`
      );
      res.json({
        ok: true,
        serverIst,
        year: targetYear,
        students,
        attendance,
        hasAttendanceRecords: recordCount > 0,
        holidays,
      });
    } catch (err) {
      console.error(
        `[attendance-search] upstream error mode=${mode}:`,
        err instanceof Error ? err.message : err
      );
      res.status(503).json({
        ok: false,
        code: 'SERVICE_UNAVAILABLE',
        error: 'Server Temporarily Unavailable. Please try again in a moment.',
      });
    }
  });

  // -------------------------------------------------------------------------
  // 5. Yearly Attendance Report Fetch API (For Year Switch / Multi-Student Pick)
  // -------------------------------------------------------------------------
  app.post('/api/attendance/report', async (req: Request, res: Response) => {
    const idCheck = normalizeStudentIdServer(req.body?.studentId);
    if (!idCheck.ok) {
      res.status(400).json({
        ok: false,
        code: 'INVALID_STUDENT_ID',
        error: idCheck.error,
      });
      return;
    }

    const serverIst = getCurrentIstInfo();
    const rawYear = Number(req.body?.year);
    const targetYear =
      Number.isInteger(rawYear) && rawYear >= 2020 && rawYear <= 2100 ? rawYear : serverIst.year;

    const ip = getClientIp(req);
    const verdict = checkSlidingWindow(
      searchBuckets,
      `${ip}:attendance_report`,
      SEARCH_WINDOW_MS,
      ATTENDANCE_REPORT_MAX_ATTEMPTS
    );
    if (!verdict.allowed) {
      res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
      res.status(429).json({
        ok: false,
        code: 'RATE_LIMITED',
        error: `Too many requests. Please wait ${verdict.retryAfterSeconds} seconds before trying again.`,
        retryAfterSeconds: verdict.retryAfterSeconds,
      });
      return;
    }

    let legacyPairHash: string | undefined;
    if (typeof req.body?.reportToken === 'string' && req.body.reportToken.length > 0) {
      const verified = verifyAttendanceReportToken(req.body.reportToken, idCheck.studentId);
      if (verified) {
        legacyPairHash = verified.legacyPairHash;
      }
    }

    try {
      const attendance = await fetchPublicAttendanceLedgerServer(
        idCheck.studentId,
        targetYear,
        legacyPairHash
      );
      const recordCount =
        attendance && attendance.records && typeof attendance.records === 'object'
          ? Object.keys(attendance.records as Record<string, unknown>).length
          : 0;

      res.json({
        ok: true,
        year: targetYear,
        attendance,
        hasAttendanceRecords: recordCount > 0,
      });
    } catch (err) {
      console.error('Attendance report upstream error:', err);
      res.status(503).json({
        ok: false,
        code: 'SERVICE_UNAVAILABLE',
        error: 'Server Temporarily Unavailable. Please try again in a moment.',
      });
    }
  });

  // Catch unknown /api routes with JSON 404 (never fall through to HTML SPA)
  app.all('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({
      code: 'NOT_FOUND',
      error: 'API endpoint not found.',
    });
  });

  // Express JSON error handler for malformed payloads or unexpected API errors
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api/')) {
      next(err);
      return;
    }
    const status =
      typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status: unknown }).status === 'number'
        ? (err as { status: number }).status
        : 500;
    if (status === 400) {
      res.status(400).json({
        code: 'BAD_REQUEST',
        error: 'Invalid request payload.',
      });
      return;
    }
    res.status(503).json({
      code: 'SERVICE_UNAVAILABLE',
      error: 'Verification service temporarily unavailable. Please try again.',
    });
  });

  // -------------------------------------------------------------------------
  // Vite Middleware (Dev) / Static Dist (Production)
  // -------------------------------------------------------------------------
  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT} (${IS_PRODUCTION ? 'production' : 'development'})`);
  });
}

void startServer();
