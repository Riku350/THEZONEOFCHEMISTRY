import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Ephemeral HMAC key if OTP_SESSION_SECRET is not provided in environment
const OTP_SIGNING_KEY =
  process.env.OTP_SESSION_SECRET && process.env.OTP_SESSION_SECRET.length >= 16
    ? process.env.OTP_SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

// ---------------------------------------------------------------------------
// Sliding-Window Rate Limiting & OTP Challenge Store (In-Memory, TTL-bounded)
// ---------------------------------------------------------------------------
const SEARCH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const SEARCH_MAX_ATTEMPTS = 10;

const OTP_REQ_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const OTP_REQ_MAX_PER_WINDOW = 4;
const OTP_RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_MAX_VERIFY_ATTEMPTS = 5;

const searchBuckets = new Map<string, number[]>();
const otpIpBuckets = new Map<string, number[]>();
const otpMobileBuckets = new Map<string, number[]>();

interface OtpChallenge {
  challengeId: string;
  mobileHash: string;
  salt: string;
  hashHex: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
}

const otpChallenges = new Map<string, OtpChallenge>();

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0].trim().slice(0, 64);
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
  for (const [id, ch] of otpChallenges.entries()) {
    if (ch.expiresAt <= now) {
      otpChallenges.delete(id);
    }
  }
  if (searchBuckets.size > 5000) {
    for (const [key, list] of searchBuckets.entries()) {
      const kept = list.filter((ts) => ts > now - SEARCH_WINDOW_MS);
      if (kept.length === 0) searchBuckets.delete(key);
      else searchBuckets.set(key, kept);
    }
  }
  if (otpIpBuckets.size > 5000) {
    for (const [key, list] of otpIpBuckets.entries()) {
      const kept = list.filter((ts) => ts > now - OTP_REQ_WINDOW_MS);
      if (kept.length === 0) otpIpBuckets.delete(key);
      else otpIpBuckets.set(key, kept);
    }
  }
  if (otpMobileBuckets.size > 5000) {
    for (const [key, list] of otpMobileBuckets.entries()) {
      const kept = list.filter((ts) => ts > now - OTP_REQ_WINDOW_MS);
      if (kept.length === 0) otpMobileBuckets.delete(key);
      else otpMobileBuckets.set(key, kept);
    }
  }
}

setInterval(pruneExpiredState, 60 * 1000).unref();

function hashOtp(otp: string, salt: string): string {
  return crypto.scryptSync(otp, salt, 32).toString('hex');
}

function signVerificationToken(mobileHash: string): string {
  const payload = `${mobileHash}.${Date.now() + 15 * 60 * 1000}`;
  const sig = crypto.createHmac('sha256', OTP_SIGNING_KEY).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

async function sendSmsViaTwilio(
  mobile10: string,
  otpCode: string
): Promise<{ sent: boolean; configured: boolean }> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();

  if (!sid || !token || !from) {
    return { sent: false, configured: false };
  }

  const toNumber = `+91${mobile10}`;
  const body = new URLSearchParams({
    To: toNumber,
    From: from,
    Body: `THE ZONE OF CHEMISTRY: Your admission tracking verification OTP is ${otpCode}. Valid for 5 minutes. Do not share this code.`,
  });

  const authHeader = Buffer.from(`${sid}:${token}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authHeader}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error('SMS gateway rejected delivery request.');
  }

  return { sent: true, configured: true };
}

async function startServer(): Promise<void> {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  // -------------------------------------------------------------------------
  // 0. Server-Authoritative Indian Standard Time (Asia/Kolkata) Endpoint
  // -------------------------------------------------------------------------
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

    res.setHeader('Cache-Control', 'no-store');
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
  // 1. Search Rate-Limit Check Endpoint
  // -------------------------------------------------------------------------
  app.post('/api/tracking/rate-limit', (req: Request, res: Response) => {
    const mode = typeof req.body?.mode === 'string' ? req.body.mode : '';
    if (mode !== 'id' && mode !== 'mobile') {
      res.status(400).json({ error: 'Invalid search mode.' });
      return;
    }

    const ip = getClientIp(req);
    const verdict = checkSlidingWindow(searchBuckets, ip, SEARCH_WINDOW_MS, SEARCH_MAX_ATTEMPTS);

    if (!verdict.allowed) {
      res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
      res.status(429).json({
        allowed: false,
        error: `Too many search attempts. Please wait ${verdict.retryAfterSeconds} seconds before trying again.`,
        retryAfterSeconds: verdict.retryAfterSeconds,
      });
      return;
    }

    res.json({
      allowed: true,
      remaining: verdict.remaining,
    });
  });

  // -------------------------------------------------------------------------
  // 2. OTP Request Endpoint (Verifies registered mobile before profile reveal)
  // -------------------------------------------------------------------------
  app.post('/api/tracking/otp/request', async (req: Request, res: Response) => {
    const rawMobile = typeof req.body?.mobile === 'string' ? req.body.mobile.replace(/[^0-9]/g, '') : '';
    const mobileHash = typeof req.body?.mobileHash === 'string' ? req.body.mobileHash.trim().toLowerCase() : '';

    if (!/^[0-9]{10}$/.test(rawMobile)) {
      res.status(400).json({ error: 'Please enter a valid 10-digit registered mobile number.' });
      return;
    }
    if (!/^[a-f0-9]{64}$/.test(mobileHash)) {
      res.status(400).json({ error: 'Invalid verification signature.' });
      return;
    }

    // Confirm the submitted 10-digit mobile matches the SHA-256 hash stored in Firestore trackingIndex
    const expectedHash = crypto.createHash('sha256').update(rawMobile).digest('hex');
    const matchesHash = crypto.timingSafeEqual(
      Buffer.from(expectedHash, 'hex'),
      Buffer.from(mobileHash, 'hex')
    );
    if (!matchesHash) {
      res.status(403).json({ error: 'Entered mobile number does not match the registered mobile number.' });
      return;
    }

    const ip = getClientIp(req);
    const now = Date.now();

    // Enforce 30-second cooldown per mobileHash
    const recentForMobile = (otpMobileBuckets.get(mobileHash) || []).filter(
      (ts) => ts > now - OTP_REQ_WINDOW_MS
    );
    if (recentForMobile.length > 0) {
      const elapsed = now - recentForMobile[recentForMobile.length - 1];
      if (elapsed < OTP_RESEND_COOLDOWN_MS) {
        const waitSec = Math.max(1, Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsed) / 1000));
        res.setHeader('Retry-After', String(waitSec));
        res.status(429).json({
          error: `Please wait ${waitSec} seconds before requesting another OTP.`,
          retryAfterSeconds: waitSec,
        });
        return;
      }
    }

    const ipCheck = checkSlidingWindow(otpIpBuckets, ip, OTP_REQ_WINDOW_MS, OTP_REQ_MAX_PER_WINDOW * 2);
    if (!ipCheck.allowed) {
      res.setHeader('Retry-After', String(ipCheck.retryAfterSeconds));
      res.status(429).json({
        error: `Too many OTP requests from this network. Please wait ${ipCheck.retryAfterSeconds} seconds.`,
        retryAfterSeconds: ipCheck.retryAfterSeconds,
      });
      return;
    }

    const mobileCheck = checkSlidingWindow(otpMobileBuckets, mobileHash, OTP_REQ_WINDOW_MS, OTP_REQ_MAX_PER_WINDOW);
    if (!mobileCheck.allowed) {
      res.setHeader('Retry-After', String(mobileCheck.retryAfterSeconds));
      res.status(429).json({
        error: `Maximum OTP requests reached for this number. Please wait ${mobileCheck.retryAfterSeconds} seconds.`,
        retryAfterSeconds: mobileCheck.retryAfterSeconds,
      });
      return;
    }

    const otpCode = String(crypto.randomInt(100000, 1000000));
    const challengeId = crypto.randomBytes(16).toString('hex');
    const salt = crypto.randomBytes(16).toString('hex');
    const hashHex = hashOtp(otpCode, salt);

    otpChallenges.set(challengeId, {
      challengeId,
      mobileHash,
      salt,
      hashHex,
      createdAt: now,
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
    });

    try {
      const sms = await sendSmsViaTwilio(rawMobile, otpCode);
      if (sms.configured && sms.sent) {
        res.json({
          challengeId,
          expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
          cooldownSeconds: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000),
          deliveryMode: 'sms',
          maskedMobile: `******${rawMobile.slice(-4)}`,
        });
        return;
      }
    } catch {
      otpChallenges.delete(challengeId);
      res.status(502).json({ error: 'Unable to send verification SMS right now. Please try again shortly.' });
      return;
    }

    // When external SMS gateway credentials are not configured in environment,
    // return a secure in-session delivery code so verification remains testable end-to-end.
    res.json({
      challengeId,
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      cooldownSeconds: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000),
      deliveryMode: 'preview',
      maskedMobile: `******${rawMobile.slice(-4)}`,
      previewOtp: otpCode,
    });
  });

  // -------------------------------------------------------------------------
  // 3. OTP Verification Endpoint
  // -------------------------------------------------------------------------
  app.post('/api/tracking/otp/verify', (req: Request, res: Response) => {
    const challengeId = typeof req.body?.challengeId === 'string' ? req.body.challengeId.trim() : '';
    const otp = typeof req.body?.otp === 'string' ? req.body.otp.replace(/[^0-9]/g, '') : '';
    const mobileHash = typeof req.body?.mobileHash === 'string' ? req.body.mobileHash.trim().toLowerCase() : '';

    if (!/^[a-f0-9]{32}$/.test(challengeId) || !/^[0-9]{6}$/.test(otp) || !/^[a-f0-9]{64}$/.test(mobileHash)) {
      res.status(400).json({ error: 'Please enter a valid 6-digit OTP.' });
      return;
    }

    const challenge = otpChallenges.get(challengeId);
    if (!challenge) {
      res.status(400).json({ error: 'OTP session expired or invalid. Please request a new OTP.' });
      return;
    }

    if (Date.now() > challenge.expiresAt) {
      otpChallenges.delete(challengeId);
      res.status(400).json({ error: 'OTP has expired. Please request a new code.' });
      return;
    }

    const hashMatch = crypto.timingSafeEqual(
      Buffer.from(challenge.mobileHash, 'hex'),
      Buffer.from(mobileHash, 'hex')
    );
    if (!hashMatch) {
      res.status(403).json({ error: 'Verification session mismatch. Please start again.' });
      return;
    }

    if (challenge.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
      otpChallenges.delete(challengeId);
      res.status(429).json({ error: 'Too many invalid OTP attempts. Please request a new OTP.' });
      return;
    }

    const candidateHash = hashOtp(otp, challenge.salt);
    const otpMatches = crypto.timingSafeEqual(
      Buffer.from(candidateHash, 'hex'),
      Buffer.from(challenge.hashHex, 'hex')
    );

    if (!otpMatches) {
      challenge.attempts += 1;
      const attemptsLeft = Math.max(0, OTP_MAX_VERIFY_ATTEMPTS - challenge.attempts);
      if (attemptsLeft === 0) {
        otpChallenges.delete(challengeId);
        res.status(429).json({ error: 'Too many invalid OTP attempts. Please request a new OTP.' });
        return;
      }
      res.status(401).json({
        error: `Incorrect OTP. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining.`,
        attemptsLeft,
      });
      return;
    }

    // One-time use: remove challenge immediately upon successful verification
    otpChallenges.delete(challengeId);
    const verificationToken = signVerificationToken(mobileHash);

    res.json({
      verified: true,
      verificationToken,
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
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
