import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  Download,
  FileText,
  IdCard,
  KeyRound,
  Loader2,
  Phone,
  RotateCcw,
  Search,
  ShieldCheck,
  User,
  XCircle,
} from 'lucide-react';
import {
  cleanPhone,
  fetchVerifiedTrackingProfile,
  lookupTrackingIndexById,
  lookupTrackingIndexByMobile,
  sha256Hex,
} from '../lib/firestoreService';
import { downloadIdCardPdf } from '../lib/idCardRenderer';
import {
  checkSearchRateLimit,
  isFirebaseUnavailableError,
  requestTrackingOtp,
  verifyTrackingOtp,
} from '../lib/trackingApi';
import {
  AdmissionStage,
  InstituteSettings,
  StudentRecord,
  StudentTrackingProfile,
  TrackingIndexDoc,
  TrackingIndexEntry,
} from '../types';
import { DigitalIdCardModal } from './DigitalIdCardModal';
import { generateAdmissionFormPdf } from '../lib/admissionPdfGenerator';

interface TrackMyAdmissionProps {
  settings: InstituteSettings;
  compact?: boolean;
}

type SearchMode = 'id' | 'mobile';

const PROGRESS_STAGES: AdmissionStage[] = [
  'Application Submitted',
  'Under Review',
  'Approved',
  'Student ID Generated',
];

function getStageRank(stage: AdmissionStage): number {
  switch (stage) {
    case 'Application Submitted':
      return 0;
    case 'Under Review':
      return 1;
    case 'Approved':
      return 2;
    case 'Student ID Generated':
      return 3;
    case 'Rejected':
      return -1;
  }
}

function getStageColorClasses(stage: AdmissionStage): string {
  switch (stage) {
    case 'Student ID Generated':
    case 'Approved':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'Rejected':
      return 'bg-red-50 text-red-700 border-red-200';
    case 'Under Review':
      return 'bg-violet-50 text-violet-700 border-violet-200';
    default:
      return 'bg-amber-50 text-amber-700 border-amber-200';
  }
}

function buildStudentRecordForIdCard(
  profile: StudentTrackingProfile,
  verifiedMobile: string
): StudentRecord {
  const safeStudentId = profile.studentId || profile.applicationNumber;
  return {
    id: safeStudentId,
    studentId: safeStudentId,
    applicationId: profile.applicationNumber,
    applicationNumber: profile.applicationNumber,
    securityCode: profile.securityCode || '0000',
    qrToken: profile.qrToken || `ZOC:${safeStudentId}`,
    studentName: profile.studentName,
    studentMobile: verifiedMobile,
    fatherName: profile.fatherName,
    studentClass: profile.studentClass,
    course: profile.course,
    batch: profile.batch,
    photoUrl: profile.photoUrl || profile.photoDataUrl || '',
    feeAmount: profile.feeAmount,
    paidAmount: profile.paidAmount,
    paymentStatus: profile.paymentStatus,
    status: profile.studentStatus === 'suspended' ? 'suspended' : 'active',
    academicSession: profile.academicSession || '2026–2027',
    approvedAt: profile.updatedAt,
    updatedAt: profile.updatedAt,
  };
}

export const TrackMyAdmission: React.FC<TrackMyAdmissionProps> = ({
  settings,
  compact = false,
}) => {
  const [mode, setMode] = useState<SearchMode>('id');
  const [queryInput, setQueryInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);

  // Zero-PII index lookup result
  const [indexDoc, setIndexDoc] = useState<TrackingIndexDoc | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<TrackingIndexEntry | null>(null);

  // OTP verification state
  const [confirmMobileInput, setConfirmMobileInput] = useState('');
  const [otpChallengeId, setOtpChallengeId] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [otpPreviewCode, setOtpPreviewCode] = useState('');
  const [otpDeliveryMode, setOtpDeliveryMode] = useState<'sms' | 'preview' | ''>('');
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null);
  const [otpSecondsLeft, setOtpSecondsLeft] = useState(0);
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpError, setOtpError] = useState('');

  // Verified profile state (populated strictly AFTER OTP verification)
  const [verifiedMobile, setVerifiedMobile] = useState('');
  const [verifiedProfile, setVerifiedProfile] = useState<StudentTrackingProfile | null>(null);

  // ID Card preview & PDF download state
  const [showIdCardModal, setShowIdCardModal] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingFormPdf, setDownloadingFormPdf] = useState(false);

  const handleDownloadFormPdf = async () => {
    if (!verifiedProfile || downloadingFormPdf) return;
    setDownloadingFormPdf(true);
    try {
      await generateAdmissionFormPdf(
        {
          id: verifiedProfile.applicationNumber,
          applicationNumber: verifiedProfile.applicationNumber,
          studentName: verifiedProfile.studentName,
          studentMobile: verifiedMobile || '—',
          studentWhatsapp: verifiedMobile || '—',
          fatherName: verifiedProfile.fatherName || '—',
          motherName: '—',
          gender: 'Male',
          address: '—',
          village: '—',
          postOffice: '—',
          district: '—',
          state: 'Bihar',
          pinCode: '—',
          studentClass: verifiedProfile.studentClass as any,
          stream: 'Science',
          course: verifiedProfile.course,
          batch: verifiedProfile.batch,
          feeAmount: verifiedProfile.feeAmount,
          paidAmount: verifiedProfile.paidAmount,
          paymentStatus: verifiedProfile.paymentStatus,
          status: verifiedProfile.studentStatus === 'suspended' ? 'rejected' : 'approved',
          declarationAccepted: true,
          photoUrl: verifiedProfile.photoUrl || verifiedProfile.photoDataUrl || '',
          studentId: verifiedProfile.studentId,
          submittedAt: verifiedProfile.submittedAt,
          updatedAt: verifiedProfile.updatedAt,
          trackingKey: '',
          fatherMobile: '',
          motherMobile: '',
        },
        settings
      );
    } catch (err) {
      console.error('Admission PDF download error:', err);
    } finally {
      setDownloadingFormPdf(false);
    }
  };

  useEffect(() => {
    if (rateLimitCountdown <= 0) return;
    const t = window.setInterval(() => {
      setRateLimitCountdown((s) => (s > 1 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(t);
  }, [rateLimitCountdown]);

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const t = window.setInterval(() => {
      setOtpCooldown((s) => (s > 1 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(t);
  }, [otpCooldown]);

  useEffect(() => {
    if (!otpExpiresAt || !otpChallengeId) {
      setOtpSecondsLeft(0);
      return;
    }
    const updateRemaining = () => {
      setOtpSecondsLeft(Math.max(0, Math.ceil((otpExpiresAt - Date.now()) / 1000)));
    };
    updateRemaining();
    const t = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(t);
  }, [otpExpiresAt, otpChallengeId]);

  const resetResults = () => {
    setErrorMsg('');
    setNotFound(false);
    setIndexDoc(null);
    setSelectedEntry(null);
    setConfirmMobileInput('');
    setOtpChallengeId('');
    setOtpInput('');
    setOtpPreviewCode('');
    setOtpDeliveryMode('');
    setOtpExpiresAt(null);
    setOtpSecondsLeft(0);
    setOtpError('');
    setVerifiedMobile('');
    setVerifiedProfile(null);
    setShowIdCardModal(false);
  };

  const handleModeSwitch = (nextMode: SearchMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setQueryInput('');
    resetResults();
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (searching || rateLimitCountdown > 0) return;

    resetResults();
    const trimmed = queryInput.trim();
    if (mode === 'id') {
      if (trimmed.length < 4) {
        setErrorMsg('Please enter a valid Student ID or Application Number.');
        return;
      }
    } else {
      const cleaned = cleanPhone(trimmed);
      if (cleaned.length !== 10) {
        setErrorMsg('Please enter a valid 10-digit Registered Mobile Number.');
        return;
      }
    }

    setSearching(true);
    try {
      // 1. Fail-closed server-side sliding-window rate limit check
      const rl = await checkSearchRateLimit(mode, 'admission');
      if (!rl.ok) {
        if (rl.reason === 'rate_limited') {
          setRateLimitCountdown(rl.retryAfterSeconds);
        }
        setErrorMsg(rl.message);
        return;
      }

      // 2. Cryptographic zero-PII Firebase index lookup
      const found =
        mode === 'id'
          ? await lookupTrackingIndexById(trimmed)
          : await lookupTrackingIndexByMobile(trimmed);

      if (!found || !Array.isArray(found.entries) || found.entries.length === 0) {
        setNotFound(true);
        return;
      }

      setIndexDoc(found);
      if (mode === 'mobile') {
        setConfirmMobileInput(cleanPhone(trimmed));
      }

      // If only a single application matches, pre-select it immediately
      if (found.entries.length === 1) {
        setSelectedEntry(found.entries[0]);
      }
    } catch (err) {
      console.error('Admission tracking lookup error:', err);
      setErrorMsg(
        isFirebaseUnavailableError(err)
          ? 'Admission database is temporarily unreachable. Please check your connection and try again shortly.'
          : 'Unable to connect to verification service right now. Please try again.'
      );
    } finally {
      setSearching(false);
    }
  };

  const handleRequestOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!indexDoc || !selectedEntry || otpSending || otpCooldown > 0) return;

    setOtpError('');
    const candidateMobile = cleanPhone(confirmMobileInput);
    if (candidateMobile.length !== 10) {
      setOtpError('Please enter your 10-digit Registered Mobile Number to receive an OTP.');
      return;
    }

    // Verify entered mobile matches the SHA-256 hash stored on the Firebase index
    const enteredHash = await sha256Hex(candidateMobile);
    if (enteredHash !== indexDoc.mobileHash) {
      setOtpError(
        `Mobile number does not match the registered number ending in ${indexDoc.maskedMobile.slice(-4)}.`
      );
      return;
    }

    setOtpSending(true);
    try {
      const res = await requestTrackingOtp({
        mobile: candidateMobile,
        mobileHash: indexDoc.mobileHash,
      });

      if (!res.ok) {
        if (res.retryAfterSeconds) {
          setOtpCooldown(res.retryAfterSeconds);
        }
        setOtpError(res.message);
        return;
      }

      setOtpChallengeId(res.challengeId);
      setOtpDeliveryMode(res.deliveryMode);
      setOtpPreviewCode(res.previewOtp || '');
      setOtpCooldown(res.cooldownSeconds);
      setOtpExpiresAt(res.expiresAt);
      setOtpInput('');
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!indexDoc || !selectedEntry || !otpChallengeId || otpVerifying) return;

    if (otpExpiresAt && Date.now() >= otpExpiresAt) {
      setOtpError('This OTP has expired. Please click Resend OTP to receive a new code.');
      return;
    }

    const cleanOtp = otpInput.replace(/[^0-9]/g, '');
    if (cleanOtp.length !== 6) {
      setOtpError('Please enter the 6-digit OTP.');
      return;
    }

    setOtpError('');
    setOtpVerifying(true);
    try {
      const verifyRes = await verifyTrackingOtp({
        challengeId: otpChallengeId,
        otp: cleanOtp,
        mobileHash: indexDoc.mobileHash,
      });

      if (!verifyRes.ok) {
        if (verifyRes.code === 'OTP_EXPIRED' || verifyRes.code === 'OTP_LOCKED') {
          setOtpExpiresAt(0);
          setOtpSecondsLeft(0);
        }
        setOtpError(verifyRes.message);
        return;
      }

      // Strictly AFTER server OTP verification succeeds, fetch the official profile
      const cleanedMob = cleanPhone(confirmMobileInput);
      const profile = await fetchVerifiedTrackingProfile(
        selectedEntry.applicationNumber,
        cleanedMob
      );

      if (!profile) {
        setOtpError('Verified record could not be loaded. Please contact the institute desk.');
        return;
      }

      setVerifiedMobile(cleanedMob);
      setVerifiedProfile(profile);
      setOtpPreviewCode('');
    } catch (err) {
      console.error('OTP verify failed:', err);
      setOtpError(
        isFirebaseUnavailableError(err)
          ? 'OTP verified, but Firebase is temporarily unavailable while loading your record. Please retry.'
          : 'Unable to verify OTP right now. Please try again.'
      );
    } finally {
      setOtpVerifying(false);
    }
  };

  const idCardStudent = useMemo(() => {
    if (!verifiedProfile || !verifiedMobile) return null;
    if (verifiedProfile.status !== 'approved' || !verifiedProfile.studentId) return null;
    return buildStudentRecordForIdCard(verifiedProfile, verifiedMobile);
  }, [verifiedProfile, verifiedMobile]);

  const handleDownloadPdfDirect = async () => {
    if (!idCardStudent || downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      await downloadIdCardPdf(idCardStudent, settings);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const activeStage: AdmissionStage | null =
    verifiedProfile?.admissionStage || selectedEntry?.admissionStage || null;
  const activeRank = activeStage ? getStageRank(activeStage) : -2;

  return (
    <section
      id="track-my-admission"
      className={`app-card rounded-2xl bg-white ${compact ? 'p-5 sm:p-6' : 'p-5 sm:p-7'}`}
    >
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-gray-100">
        <div>
          <p className="text-[11px] font-semibold tracking-wider uppercase text-violet-700">
            Student Self-Service
          </p>
          <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900 mt-0.5">
            TRACK MY ADMISSION
          </h2>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            Check admission status and download your official Student ID Card without logging in.
          </p>
        </div>
        {(indexDoc || notFound) && (
          <button
            type="button"
            onClick={() => {
              setQueryInput('');
              resetResults();
            }}
            className="self-start sm:self-center inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-xs font-medium text-gray-700 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            New Search
          </button>
        )}
      </div>

      {/* Mode Selector + Single Search Input + SEARCH STATUS Button */}
      <form onSubmit={handleSearch} className="mt-4 space-y-3.5">
        <div className="inline-grid grid-cols-2 p-1 rounded-xl bg-gray-100 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => handleModeSwitch('id')}
            className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              mode === 'id'
                ? 'bg-white text-violet-700 shadow-2xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <IdCard className="w-3.5 h-3.5" />
            Student ID Number
          </button>
          <button
            type="button"
            onClick={() => handleModeSwitch('mobile')}
            className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              mode === 'mobile'
                ? 'bg-white text-violet-700 shadow-2xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Phone className="w-3.5 h-3.5" />
            Registered Mobile
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type={mode === 'mobile' ? 'tel' : 'text'}
              inputMode={mode === 'mobile' ? 'numeric' : 'text'}
              maxLength={mode === 'mobile' ? 10 : 40}
              value={queryInput}
              onChange={(e) => {
                if (mode === 'mobile') {
                  setQueryInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 10));
                } else {
                  setQueryInput(e.target.value.toUpperCase());
                }
              }}
              placeholder={
                mode === 'id'
                  ? 'Enter Student ID or Application No. (e.g. ZOC-2026-482190)'
                  : 'Enter 10-digit Registered Mobile Number'
              }
              className="w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 pl-10 pr-3.5 py-3 text-sm font-mono text-gray-900 placeholder:font-sans placeholder-gray-400 focus:outline-none transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={searching || rateLimitCountdown > 0}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold tracking-wide transition-colors whitespace-nowrap cursor-pointer shadow-xs"
          >
            {searching ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                SEARCHING...
              </>
            ) : rateLimitCountdown > 0 ? (
              `WAIT ${rateLimitCountdown}s`
            ) : (
              <>
                <Search className="w-4 h-4" />
                SEARCH STATUS
              </>
            )}
          </button>
        </div>
      </form>

      {/* Validation / Rate-Limit Error */}
      {errorMsg && (
        <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-3.5 flex items-start gap-2.5 text-xs sm:text-sm text-red-700">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Not Found State */}
      {notFound && (
        <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 p-4 text-center">
          <p className="text-sm font-semibold text-gray-900">No Matching Record Found</p>
          <p className="mt-1 text-xs text-gray-500">
            Verify your {mode === 'id' ? 'Student ID / Application Number' : '10-digit Registered Mobile Number'} and try again. For help call{' '}
            <span className="font-mono text-gray-800">{settings.phone}</span>.
          </p>
        </div>
      )}

      {/* STEP A: Multiple Applications Secure Selector (Shows ONLY Application No. & Course — Zero PII) */}
      {indexDoc && indexDoc.entries.length > 1 && !selectedEntry && (
        <div className="mt-5 rounded-2xl bg-gray-50 border border-gray-200 p-4 space-y-3">
          <div>
            <p className="text-xs font-semibold text-violet-700">
              {indexDoc.entries.length} Applications Linked to {indexDoc.maskedMobile}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              Select your application below. Personal details remain protected until OTP verification.
            </p>
          </div>
          <div className="space-y-2">
            {indexDoc.entries.map((entry) => (
              <button
                key={entry.applicationNumber}
                type="button"
                onClick={() => {
                  setSelectedEntry(entry);
                  setOtpChallengeId('');
                  setOtpInput('');
                  setOtpError('');
                  setVerifiedProfile(null);
                }}
                className="w-full text-left rounded-xl bg-white hover:border-violet-400 border border-gray-200 px-4 py-3 flex items-center justify-between gap-3 transition-colors cursor-pointer"
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm font-bold text-gray-900 tabular-nums">
                    {entry.applicationNumber}
                  </p>
                  <p className="text-xs text-gray-600 truncate mt-0.5">{entry.course}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${getStageColorClasses(
                      entry.admissionStage
                    )}`}
                  >
                    {entry.admissionStage}
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* STEP B: Admission Status Timeline (Visible for Selected Entry) */}
      {indexDoc && selectedEntry && activeStage && (
        <div className="mt-5 space-y-4">
          <div className="rounded-2xl bg-gray-50 border border-gray-200 p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-gray-200">
              <div>
                <p className="text-[11px] text-gray-500">Application Reference</p>
                <p className="font-mono text-sm sm:text-base font-bold text-gray-900 tabular-nums">
                  {selectedEntry.applicationNumber}
                </p>
                <p className="text-xs text-gray-600 mt-0.5">{selectedEntry.course}</p>
              </div>
              <div className="flex items-center gap-2">
                {indexDoc.entries.length > 1 && !verifiedProfile && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEntry(null);
                      setOtpChallengeId('');
                      setOtpInput('');
                      setOtpError('');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-medium text-gray-600 hover:text-gray-900 cursor-pointer"
                  >
                    Switch
                  </button>
                )}
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-semibold ${getStageColorClasses(
                    activeStage
                  )}`}
                >
                  {activeStage === 'Rejected' ? (
                    <XCircle className="w-3.5 h-3.5" />
                  ) : activeStage === 'Student ID Generated' || activeStage === 'Approved' ? (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  ) : (
                    <Clock className="w-3.5 h-3.5" />
                  )}
                  {activeStage}
                </span>
              </div>
            </div>

            {/* 5-Stage Status Stepper */}
            {activeStage === 'Rejected' ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {(['Application Submitted', 'Under Review', 'Rejected'] as AdmissionStage[]).map(
                  (stageLabel) => {
                    const isRejected = stageLabel === 'Rejected';
                    return (
                      <div
                        key={stageLabel}
                        className={`rounded-xl border px-3 py-2.5 flex items-center gap-2.5 text-xs font-semibold ${
                          isRejected
                            ? 'bg-red-50 border-red-200 text-red-700'
                            : 'bg-white border-gray-200 text-gray-700'
                        }`}
                      >
                        {isRejected ? (
                          <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        )}
                        <span>{stageLabel}</span>
                      </div>
                    );
                  }
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {PROGRESS_STAGES.map((stageLabel, idx) => {
                  const completed = activeRank >= idx;
                  const isCurrent = activeRank === idx;
                  return (
                    <div
                      key={stageLabel}
                      className={`rounded-xl border px-3 py-2.5 flex items-start gap-2 transition-colors ${
                        completed
                          ? isCurrent
                            ? 'bg-violet-50 border-violet-300 text-violet-900'
                            : 'bg-white border-emerald-200 text-gray-900'
                          : 'bg-white/70 border-gray-200 text-gray-400'
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${
                          completed
                            ? isCurrent
                              ? 'bg-violet-600 text-white'
                              : 'bg-emerald-600 text-white'
                            : 'bg-gray-200 text-gray-500'
                        }`}
                      >
                        {completed ? '✓' : idx + 1}
                      </span>
                      <span className="text-xs font-semibold leading-snug">{stageLabel}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* STEP C: OTP Verification Gate (Required Before Revealing Any Private Student Profile) */}
          {!verifiedProfile && (
            <div className="rounded-2xl bg-violet-50/40 border border-violet-200 p-4 sm:p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-display text-sm sm:text-base font-bold text-gray-900">
                    Verify Registered Mobile via OTP
                  </h3>
                  <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                    To protect student privacy, verify your registered mobile number (
                    <span className="font-mono font-semibold text-gray-900">
                      {indexDoc.maskedMobile}
                    </span>
                    ) to view your official profile and download your ID Card.
                  </p>
                </div>
              </div>

              {!otpChallengeId ? (
                <form onSubmit={handleRequestOtp} className="space-y-3">
                  {mode === 'id' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Confirm Registered 10-Digit Mobile ({indexDoc.maskedMobile})
                      </label>
                      <input
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        required
                        value={confirmMobileInput}
                        onChange={(e) =>
                          setConfirmMobileInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))
                        }
                        placeholder="Enter 10-digit registered mobile"
                        className="w-full rounded-xl bg-white border border-gray-200 focus:border-violet-500 px-3.5 py-2.5 text-sm font-mono text-gray-900 placeholder:font-sans placeholder-gray-400 focus:outline-none"
                      />
                    </div>
                  )}

                  {otpError && (
                    <div className="rounded-xl bg-red-50 border border-red-200 p-3 flex items-start gap-2 text-xs text-red-700">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{otpError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={otpSending || otpCooldown > 0}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
                  >
                    {otpSending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending OTP...
                      </>
                    ) : otpCooldown > 0 ? (
                      `Wait ${otpCooldown}s`
                    ) : (
                      <>
                        <KeyRound className="w-4 h-4" />
                        Send OTP to {indexDoc.maskedMobile}
                      </>
                    )}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} className="space-y-3">
                  {otpDeliveryMode === 'preview' && otpPreviewCode ? (
                    <div className="rounded-xl bg-white border border-violet-200 px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs">
                      <span className="text-gray-600">
                        Verification code for{' '}
                        <span className="font-mono font-semibold text-gray-900">
                          {indexDoc.maskedMobile}
                        </span>
                        :
                      </span>
                      <span className="font-mono text-sm font-bold tracking-widest text-violet-700 tabular-nums">
                        {otpPreviewCode}
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-emerald-700 font-medium">
                      A 6-digit OTP has been sent via SMS to {indexDoc.maskedMobile}.
                    </p>
                  )}

                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      required
                      value={otpInput}
                      onChange={(e) =>
                        setOtpInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))
                      }
                      placeholder="Enter 6-digit OTP"
                      className="flex-1 rounded-xl bg-white border border-gray-200 focus:border-violet-500 px-3.5 py-2.5 text-sm font-mono tracking-widest text-gray-900 placeholder:tracking-normal placeholder:font-sans placeholder-gray-400 focus:outline-none tabular-nums"
                    />
                    <button
                      type="submit"
                      disabled={otpVerifying}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
                    >
                      {otpVerifying ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Verifying...
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-4 h-4" />
                          Verify &amp; View Profile
                        </>
                      )}
                    </button>
                  </div>

                  {otpError && (
                    <div className="rounded-xl bg-red-50 border border-red-200 p-3 flex items-start gap-2 text-xs text-red-700">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{otpError}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs text-gray-500">
                    {otpSecondsLeft > 0 ? (
                      <span className="font-mono tabular-nums">
                        Expires in {String(Math.floor(otpSecondsLeft / 60)).padStart(2, '0')}:
                        {String(otpSecondsLeft % 60).padStart(2, '0')}
                      </span>
                    ) : (
                      <span className="text-red-600 font-semibold">
                        OTP expired. Click Resend OTP.
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={otpSending || otpCooldown > 0}
                      onClick={() => void handleRequestOtp()}
                      className="font-semibold text-violet-700 hover:text-violet-900 disabled:text-gray-400 cursor-pointer"
                    >
                      {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : 'Resend OTP'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* STEP D: Official Verified Student Profile (Strictly After OTP Verification) */}
          {verifiedProfile && (
            <div className="rounded-2xl bg-white border border-gray-200 p-4 sm:p-6 space-y-5 shadow-2xs">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pb-4 border-b border-gray-100">
                {/* Student Photograph */}
                <div className="w-20 h-24 rounded-xl overflow-hidden border border-gray-200 bg-gray-50 shrink-0 flex items-center justify-center">
                  {verifiedProfile.photoUrl || verifiedProfile.photoDataUrl ? (
                    <img
                      src={verifiedProfile.photoUrl || verifiedProfile.photoDataUrl}
                      alt={verifiedProfile.studentName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-8 h-8 text-gray-300" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      OTP Verified Official Record
                    </span>
                  </div>
                  <h3 className="font-display text-lg sm:text-xl font-bold text-gray-900 mt-1 truncate">
                    {verifiedProfile.studentName}
                  </h3>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Father&apos;s Name:{' '}
                    <span className="font-medium text-gray-900">{verifiedProfile.fatherName}</span>
                  </p>
                  {verifiedProfile.studentId ? (
                    <p className="mt-1.5 font-mono text-sm font-bold text-violet-700 tabular-nums">
                      Student ID: {verifiedProfile.studentId}
                    </p>
                  ) : (
                    <p className="mt-1.5 font-mono text-xs text-gray-500 tabular-nums">
                      Application No.: {verifiedProfile.applicationNumber}
                    </p>
                  )}
                </div>
              </div>

              {/* Official Student Profile Details Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 text-xs sm:text-sm">
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                  <p className="text-[11px] text-gray-500">Student ID Number</p>
                  <p className="font-mono font-bold text-violet-700 mt-0.5 tabular-nums">
                    {verifiedProfile.studentId || 'Pending Approval'}
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                  <p className="text-[11px] text-gray-500">Class</p>
                  <p className="font-semibold text-gray-900 mt-0.5">
                    {verifiedProfile.studentClass}
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                  <p className="text-[11px] text-gray-500">Course</p>
                  <p className="font-semibold text-gray-900 mt-0.5">{verifiedProfile.course}</p>
                </div>
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                  <p className="text-[11px] text-gray-500">Batch Timing</p>
                  <p className="font-semibold text-gray-900 mt-0.5">{verifiedProfile.batch}</p>
                </div>
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                  <p className="text-[11px] text-gray-500">Admission Status</p>
                  <p
                    className={`font-bold mt-0.5 ${
                      verifiedProfile.status === 'approved'
                        ? 'text-emerald-700'
                        : verifiedProfile.status === 'rejected'
                        ? 'text-red-600'
                        : 'text-amber-600'
                    }`}
                  >
                    {verifiedProfile.admissionStage}
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                  <p className="text-[11px] text-gray-500 flex items-center gap-1">
                    <CreditCard className="w-3 h-3 text-violet-600" />
                    Fee Payment Status
                  </p>
                  <p
                    className={`font-bold mt-0.5 ${
                      verifiedProfile.paymentStatus === 'PAID'
                        ? 'text-emerald-700'
                        : verifiedProfile.paymentStatus === 'PARTIAL'
                        ? 'text-violet-700'
                        : 'text-amber-600'
                    }`}
                  >
                    {verifiedProfile.paymentStatus}
                  </p>
                  <p className="font-mono text-[11px] text-gray-500 tabular-nums mt-0.5">
                    ₹{verifiedProfile.paidAmount.toLocaleString('en-IN')} / ₹
                    {verifiedProfile.feeAmount.toLocaleString('en-IN')}
                  </p>
                </div>
              </div>

              {verifiedProfile.studentStatus === 'suspended' && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                  This Student ID is currently marked <strong>SUSPENDED</strong>. Please contact{' '}
                  {settings.instituteName} at <span className="font-mono">{settings.phone}</span>.
                </div>
              )}

              {verifiedProfile.remarks && (
                <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 text-xs text-gray-700">
                  <span className="font-semibold text-gray-900">Institute Note: </span>
                  {verifiedProfile.remarks}
                </div>
              )}

              {/* Action Buttons After Approval: VIEW ID CARD, DOWNLOAD ID CARD PDF, DOWNLOAD ADMISSION FORM PDF */}
              <div className="pt-1 space-y-2.5">
                {idCardStudent && (
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <button
                      type="button"
                      onClick={() => setShowIdCardModal(true)}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs sm:text-sm font-semibold tracking-wide transition-colors cursor-pointer"
                    >
                      <IdCard className="w-4 h-4" />
                      VIEW ID CARD
                    </button>
                    <button
                      type="button"
                      disabled={downloadingPdf}
                      onClick={() => void handleDownloadPdfDirect()}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white hover:bg-violet-50 border border-violet-200 text-violet-700 text-xs sm:text-sm font-semibold tracking-wide transition-colors disabled:opacity-60 cursor-pointer"
                    >
                      {downloadingPdf ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          PREPARING ID PDF...
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4" />
                          DOWNLOAD ID CARD PDF
                        </>
                      )}
                    </button>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2.5">
                  <button
                    type="button"
                    disabled={downloadingFormPdf}
                    onClick={() => void handleDownloadFormPdf()}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-violet-50 hover:bg-violet-100 border border-violet-200 text-violet-800 text-xs sm:text-sm font-semibold tracking-wide transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    {downloadingFormPdf ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        GENERATING PDF...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        DOWNLOAD ADMISSION FORM PDF
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={downloadingFormPdf}
                    onClick={() => void handleDownloadFormPdf()}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 text-gray-800 text-xs sm:text-sm font-semibold tracking-wide transition-colors cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-violet-600" />
                    VIEW ADMISSION FORM
                  </button>
                </div>
              </div>
              {!idCardStudent && (
                <div className="rounded-xl bg-violet-50/50 border border-violet-100 p-3 flex items-center gap-2.5 text-xs text-violet-900">
                  <FileText className="w-4 h-4 text-violet-600 shrink-0" />
                  <span>
                    {verifiedProfile.status === 'rejected'
                      ? 'This application was not approved. Please contact the institute desk for assistance.'
                      : 'Your official Student ID Card will unlock here automatically once approved by the admin.'}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Official Digital ID Card Modal (Read-Only for Student) */}
      {showIdCardModal && idCardStudent && (
        <DigitalIdCardModal
          student={idCardStudent}
          settings={settings}
          onClose={() => setShowIdCardModal(false)}
        />
      )}
    </section>
  );
};
