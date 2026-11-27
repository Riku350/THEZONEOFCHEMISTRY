import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  KeyRound,
  Loader2,
  Phone,
  RotateCcw,
  Search,
  ShieldCheck,
  User,
} from 'lucide-react';
import {
  CalendarDayCell,
  computeStudentAttendanceAnalytics,
  downloadStudentAttendancePdf,
  fetchServerIstTime,
  formatIstDisplayDate,
  formatIstTime,
  formatScheduledDaysSummary,
  getClientIstNow,
  MONTH_NAMES,
  resolveStudentBatch,
  WEEKDAY_LABELS,
} from '../lib/attendanceUtils';
import {
  cleanPhone,
  fetchPublicAttendanceHolidays,
  fetchVerifiedStudentAttendance,
  fetchVerifiedTrackingProfile,
  lookupTrackingIndexById,
  lookupTrackingIndexByMobile,
  sha256Hex,
} from '../lib/firestoreService';
import {
  AttendanceHoliday,
  BatchItem,
  CalendarDayStatus,
  InstituteSettings,
  PublicView,
  StudentAttendancePublicDoc,
  StudentTrackingProfile,
  TrackingIndexDoc,
  TrackingIndexEntry,
} from '../types';

interface StudentAttendanceTrackerProps {
  settings: InstituteSettings;
  batches: BatchItem[];
  onNavigate?: (view: PublicView) => void;
  compact?: boolean;
}

type SearchMode = 'id' | 'mobile';

function calendarCellClasses(status: CalendarDayStatus, isSelected: boolean): string {
  const ring = isSelected ? 'ring-2 ring-violet-600 ring-offset-1' : '';
  switch (status) {
    case 'Present':
      return `bg-emerald-50 border-emerald-300 text-emerald-900 hover:bg-emerald-100 ${ring}`;
    case 'Absent':
      return `bg-red-50 border-red-300 text-red-900 hover:bg-red-100 ${ring}`;
    case 'Holiday':
      return `bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200 ${ring}`;
    case 'NotScheduled':
      return `bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100 ${ring}`;
    default:
      return `bg-white border-gray-200 text-gray-400 hover:bg-gray-50 ${ring}`;
  }
}

function statusDotClass(status: CalendarDayStatus): string {
  switch (status) {
    case 'Present':
      return 'bg-emerald-500';
    case 'Absent':
      return 'bg-red-500';
    case 'Holiday':
      return 'bg-gray-400';
    case 'NotScheduled':
      return 'bg-amber-400';
    default:
      return 'bg-gray-200';
  }
}

function statusLabel(status: CalendarDayStatus): string {
  switch (status) {
    case 'Present':
      return 'Present';
    case 'Absent':
      return 'Absent';
    case 'Holiday':
      return 'Holiday';
    case 'NotScheduled':
      return 'Class Not Scheduled';
    default:
      return 'Upcoming Class';
  }
}

export const StudentAttendanceTracker: React.FC<StudentAttendanceTrackerProps> = ({
  settings,
  batches,
  onNavigate,
  compact = false,
}) => {
  const initialIst = getClientIstNow();
  const [todayIst, setTodayIst] = useState(initialIst.date);
  const [selectedYear, setSelectedYear] = useState(initialIst.year);
  const [selectedMonth, setSelectedMonth] = useState(initialIst.month);

  // Search & OTP Verification State
  const [mode, setMode] = useState<SearchMode>('id');
  const [queryInput, setQueryInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);

  const [indexDoc, setIndexDoc] = useState<TrackingIndexDoc | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<TrackingIndexEntry | null>(null);

  const [confirmMobileInput, setConfirmMobileInput] = useState('');
  const [otpChallengeId, setOtpChallengeId] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [otpPreviewCode, setOtpPreviewCode] = useState('');
  const [otpDeliveryMode, setOtpDeliveryMode] = useState<'sms' | 'preview' | ''>('');
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpError, setOtpError] = useState('');

  // Verified Attendance Data
  const [verifiedMobile, setVerifiedMobile] = useState('');
  const [verifiedProfile, setVerifiedProfile] = useState<StudentTrackingProfile | null>(null);
  const [attendanceDoc, setAttendanceDoc] = useState<StudentAttendancePublicDoc | null>(null);
  const [holidays, setHolidays] = useState<AttendanceHoliday[]>([]);
  const [loadingYearData, setLoadingYearData] = useState(false);
  const [selectedDay, setSelectedDay] = useState<CalendarDayCell | null>(null);

  useEffect(() => {
    void fetchServerIstTime().then((t) => {
      setTodayIst(t.date);
      setSelectedYear(t.year);
      setSelectedMonth(t.month);
    });
    void fetchPublicAttendanceHolidays().then(setHolidays);
  }, []);

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

  // Refetch attendance ledger whenever verified student switches year
  useEffect(() => {
    if (!verifiedProfile?.studentId || !verifiedMobile) return;
    let cancelled = false;
    setLoadingYearData(true);
    setSelectedDay(null);
    void fetchVerifiedStudentAttendance(verifiedProfile.studentId, verifiedMobile, selectedYear)
      .then((docData) => {
        if (!cancelled) setAttendanceDoc(docData);
      })
      .finally(() => {
        if (!cancelled) setLoadingYearData(false);
      });
    return () => {
      cancelled = true;
    };
  }, [verifiedProfile?.studentId, verifiedMobile, selectedYear]);

  const resetAll = () => {
    setErrorMsg('');
    setNotFound(false);
    setIndexDoc(null);
    setSelectedEntry(null);
    setConfirmMobileInput('');
    setOtpChallengeId('');
    setOtpInput('');
    setOtpPreviewCode('');
    setOtpDeliveryMode('');
    setOtpError('');
    setVerifiedMobile('');
    setVerifiedProfile(null);
    setAttendanceDoc(null);
    setSelectedDay(null);
  };

  const handleModeSwitch = (nextMode: SearchMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setQueryInput('');
    resetAll();
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (searching || rateLimitCountdown > 0) return;

    resetAll();
    const trimmed = queryInput.trim();
    if (mode === 'id') {
      if (trimmed.length < 4) {
        setErrorMsg('Please enter a valid Student ID Number.');
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
      const rlRes = await fetch('/api/tracking/rate-limit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });

      if (rlRes.status === 429) {
        const data = (await rlRes.json().catch(() => ({}))) as {
          error?: string;
          retryAfterSeconds?: number;
        };
        const waitSec = Number(data.retryAfterSeconds) || 30;
        setRateLimitCountdown(waitSec);
        setErrorMsg(
          data.error || `Too many attempts. Please wait ${waitSec} seconds before retrying.`
        );
        return;
      }

      if (!rlRes.ok) {
        setErrorMsg('Unable to check rate limit. Please try again.');
        return;
      }

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
      if (found.entries.length === 1) {
        setSelectedEntry(found.entries[0]);
      }
    } catch (err) {
      console.error('Attendance lookup error:', err);
      setErrorMsg('Unable to connect to attendance server. Please try again.');
    } finally {
      setSearching(false);
    }
  };

  const handleRequestOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!indexDoc || !selectedEntry || otpSending || otpCooldown > 0) return;

    const cleaned = cleanPhone(confirmMobileInput);
    if (cleaned.length !== 10) {
      setOtpError('Enter the 10-digit mobile number registered with this Student ID.');
      return;
    }

    setOtpSending(true);
    setOtpError('');
    try {
      const res = await fetch('/api/tracking/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mobile: cleaned,
          mobileHash: indexDoc.mobileHash,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        challengeId?: string;
        cooldownSeconds?: number;
        retryAfterSeconds?: number;
        deliveryMode?: 'sms' | 'preview';
        previewOtp?: string;
      };

      if (!res.ok) {
        if (data.retryAfterSeconds) setOtpCooldown(Number(data.retryAfterSeconds));
        setOtpError(data.error || 'Could not send verification OTP.');
        return;
      }

      setOtpChallengeId(data.challengeId || '');
      setOtpDeliveryMode(data.deliveryMode || 'preview');
      setOtpPreviewCode(data.previewOtp || '');
      setOtpCooldown(Number(data.cooldownSeconds) || 30);
    } catch {
      setOtpError('Network error while requesting OTP. Please try again.');
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!indexDoc || !selectedEntry || !otpChallengeId || otpVerifying) return;

    const cleanedOtp = otpInput.replace(/[^0-9]/g, '');
    if (cleanedOtp.length !== 6) {
      setOtpError('Please enter the 6-digit OTP.');
      return;
    }

    setOtpVerifying(true);
    setOtpError('');
    try {
      const cleanedMobile = cleanPhone(confirmMobileInput);
      const mobileHash = await sha256Hex(cleanedMobile);
      const res = await fetch('/api/tracking/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: otpChallengeId,
          otp: cleanedOtp,
          mobileHash,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        verified?: boolean;
        error?: string;
      };

      if (!res.ok || !data.verified) {
        setOtpError(data.error || 'Invalid OTP. Please try again.');
        return;
      }

      const profile = await fetchVerifiedTrackingProfile(
        selectedEntry.applicationNumber,
        cleanedMobile
      );
      if (!profile) {
        setOtpError('Verified student profile could not be loaded. Contact institute office.');
        return;
      }

      setVerifiedMobile(cleanedMobile);
      setVerifiedProfile(profile);
      if (profile.studentId) {
        setLoadingYearData(true);
        const att = await fetchVerifiedStudentAttendance(
          profile.studentId,
          cleanedMobile,
          selectedYear
        );
        setAttendanceDoc(att);
        setLoadingYearData(false);
      }
    } catch {
      setOtpError('Verification failed. Please retry.');
    } finally {
      setOtpVerifying(false);
    }
  };

  const resolvedBatch = useMemo(() => {
    if (!verifiedProfile) return null;
    return resolveStudentBatch(verifiedProfile.batch, batches);
  }, [verifiedProfile, batches]);

  const analytics = useMemo(() => {
    if (!verifiedProfile || !verifiedProfile.studentId || !resolvedBatch) return null;
    const scheduledDays =
      attendanceDoc?.scheduledDays && attendanceDoc.scheduledDays.length > 0
        ? attendanceDoc.scheduledDays
        : resolvedBatch.scheduledDays;
    return computeStudentAttendanceAnalytics({
      batchId: attendanceDoc?.batchId || resolvedBatch.batchId,
      batchTiming: attendanceDoc?.batchTiming || resolvedBatch.batchTiming,
      enrolledDate: attendanceDoc?.enrolledDate || '',
      scheduleStartDate: resolvedBatch.scheduleStartDate,
      scheduledDays,
      recordsByDate: attendanceDoc?.records || {},
      holidays,
      year: selectedYear,
      selectedMonth,
      todayIst,
    });
  }, [verifiedProfile, resolvedBatch, attendanceDoc, holidays, selectedYear, selectedMonth, todayIst]);

  const availableYears = useMemo(() => {
    const cur = Number(todayIst.slice(0, 4)) || new Date().getFullYear();
    return [cur, cur - 1];
  }, [todayIst]);

  const handlePrevMonth = () => {
    setSelectedDay(null);
    if (selectedMonth === 1) {
      setSelectedMonth(12);
      setSelectedYear((y) => y - 1);
    } else {
      setSelectedMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    setSelectedDay(null);
    if (selectedMonth === 12) {
      setSelectedMonth(1);
      setSelectedYear((y) => y + 1);
    } else {
      setSelectedMonth((m) => m + 1);
    }
  };

  const handleDownloadPdf = () => {
    if (!verifiedProfile || !verifiedProfile.studentId || !analytics) return;
    downloadStudentAttendancePdf({
      studentName: verifiedProfile.studentName,
      studentId: verifiedProfile.studentId,
      fatherName: verifiedProfile.fatherName,
      studentClass: verifiedProfile.studentClass,
      course: verifiedProfile.course,
      batchTiming: attendanceDoc?.batchTiming || verifiedProfile.batch,
      analytics,
      settings,
    });
  };

  const innerContent = (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide">
            MY ATTENDANCE / TRACK ATTENDANCE
          </p>
          <h2 className="mt-0.5 font-display text-xl sm:text-2xl font-bold text-gray-900">
            Student Attendance Portal
          </h2>
          <p className="mt-1 text-xs sm:text-sm text-gray-500">
            Check daily entry/exit timings, monthly calendar, and yearly reports with OTP verification — no account required.
          </p>
        </div>
        {verifiedProfile && (
          <button
            type="button"
            onClick={resetAll}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 self-start cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Search Another
          </button>
        )}
      </div>

      {/* Step 1: Search Box (Shown until OTP verified) */}
      {!verifiedProfile && (
        <div className="app-card rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="inline-flex p-1 rounded-xl bg-gray-100 border border-gray-200/80">
            <button
              type="button"
              onClick={() => handleModeSwitch('id')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                mode === 'id'
                  ? 'bg-white text-violet-700 shadow-2xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Student ID Number
            </button>
            <button
              type="button"
              onClick={() => handleModeSwitch('mobile')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                mode === 'mobile'
                  ? 'bg-white text-violet-700 shadow-2xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Registered Mobile Number
            </button>
          </div>

          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              {mode === 'id' ? (
                <User className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              ) : (
                <Phone className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              )}
              <input
                type="text"
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder={
                  mode === 'id'
                    ? 'Enter Student ID (e.g., ZOC-2026-123456)'
                    : 'Enter 10-digit Registered Mobile Number'
                }
                className="w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 pl-10 pr-4 py-3 text-sm font-mono text-gray-900 placeholder-gray-400 focus:outline-none transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={searching || rateLimitCountdown > 0}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              {searching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              {rateLimitCountdown > 0 ? `Wait ${rateLimitCountdown}s` : 'Check Attendance'}
            </button>
          </form>

          {errorMsg && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 flex items-center gap-2 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {notFound && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-xs sm:text-sm text-amber-900">
              No student record found matching this{' '}
              {mode === 'id' ? 'Student ID' : 'mobile number'}. Please verify the details entered or contact {settings.instituteName}.
            </div>
          )}

          {/* Step 2: Safe Multi-Student Selector (Application No & Course Only — Zero PII) */}
          {indexDoc && indexDoc.entries.length > 1 && !selectedEntry && (
            <div className="rounded-xl bg-violet-50/50 border border-violet-200 p-4 space-y-2.5">
              <p className="text-xs font-semibold text-violet-900">
                Multiple enrollments found on {indexDoc.maskedMobile}. Select your course to verify with OTP:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {indexDoc.entries.map((entry) => (
                  <button
                    key={entry.applicationNumber}
                    type="button"
                    onClick={() => setSelectedEntry(entry)}
                    className="text-left rounded-xl bg-white hover:border-violet-400 border border-gray-200 p-3 flex items-center justify-between gap-2 transition-colors cursor-pointer"
                  >
                    <div>
                      <p className="font-mono text-xs font-bold text-violet-700">
                        {entry.applicationNumber}
                      </p>
                      <p className="text-xs text-gray-700 font-medium mt-0.5">{entry.course}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Mandatory OTP Verification Gate */}
          {indexDoc && selectedEntry && (
            <div className="rounded-2xl bg-violet-50/40 border border-violet-200 p-4 sm:p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="w-5 h-5 text-violet-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-gray-900">
                      Verify Registered Mobile ({indexDoc.maskedMobile})
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      For student privacy, OTP verification is required before displaying attendance records for{' '}
                      <span className="font-mono font-semibold text-violet-700">
                        {selectedEntry.applicationNumber}
                      </span>
                      .
                    </p>
                  </div>
                </div>
                {indexDoc.entries.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEntry(null);
                      setOtpChallengeId('');
                      setOtpInput('');
                      setOtpPreviewCode('');
                      setOtpError('');
                    }}
                    className="text-xs font-semibold text-violet-700 hover:underline shrink-0 cursor-pointer"
                  >
                    Change
                  </button>
                )}
              </div>

              {!otpChallengeId ? (
                <form onSubmit={handleRequestOtp} className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="tel"
                    maxLength={10}
                    value={confirmMobileInput}
                    onChange={(e) =>
                      setConfirmMobileInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))
                    }
                    placeholder="Confirm 10-digit registered mobile"
                    className="flex-1 rounded-xl bg-white border border-gray-200 focus:border-violet-500 px-3.5 py-2.5 text-sm font-mono text-gray-900 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={otpSending || otpCooldown > 0}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold whitespace-nowrap cursor-pointer"
                  >
                    {otpSending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <KeyRound className="w-4 h-4" />
                    )}
                    {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : 'Send OTP'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} className="space-y-3">
                  {otpDeliveryMode === 'preview' && otpPreviewCode && (
                    <div className="rounded-xl bg-white border border-violet-200 px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs">
                      <span className="text-gray-600">
                        In-session Verification Code for {indexDoc.maskedMobile}:
                      </span>
                      <span className="font-mono text-base font-bold text-violet-700 tracking-widest tabular-nums">
                        {otpPreviewCode}
                      </span>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={otpInput}
                      onChange={(e) => setOtpInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                      placeholder="Enter 6-digit OTP"
                      className="flex-1 rounded-xl bg-white border border-gray-200 focus:border-violet-500 px-3.5 py-2.5 text-sm font-mono tracking-widest text-gray-900 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={otpVerifying}
                      className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold whitespace-nowrap cursor-pointer"
                    >
                      {otpVerifying ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      Verify &amp; View Attendance
                    </button>
                    <button
                      type="button"
                      disabled={otpSending || otpCooldown > 0}
                      onClick={() => void handleRequestOtp()}
                      className="px-3.5 py-2.5 rounded-xl bg-white border border-gray-200 text-xs font-semibold text-gray-700 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                    >
                      {otpCooldown > 0 ? `${otpCooldown}s` : 'Resend'}
                    </button>
                  </div>
                </form>
              )}

              {otpError && (
                <p className="text-xs text-red-600 font-medium flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {otpError}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Step 4: Verified Student Attendance Dashboard */}
      {verifiedProfile && (
        <div className="space-y-5">
          {/* Student Profile Banner */}
          <div className="app-card rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-14 h-14 rounded-2xl overflow-hidden border border-gray-200 bg-violet-50 flex items-center justify-center shrink-0">
                {verifiedProfile.photoUrl || verifiedProfile.photoDataUrl ? (
                  <img
                    src={verifiedProfile.photoUrl || verifiedProfile.photoDataUrl}
                    alt={verifiedProfile.studentName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-6 h-6 text-violet-600" />
                )}
              </div>
              <div className="min-w-0">
                <h3 className="font-display text-base sm:text-lg font-bold text-gray-900 truncate">
                  {verifiedProfile.studentName}
                </h3>
                <p className="text-xs font-mono text-violet-700 font-semibold">
                  {verifiedProfile.studentId || verifiedProfile.applicationNumber} ·{' '}
                  {verifiedProfile.studentClass} · {verifiedProfile.course}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Batch: <span className="font-medium text-gray-800">{verifiedProfile.batch}</span> ·{' '}
                  Schedule:{' '}
                  <span className="font-medium text-gray-800">
                    {formatScheduledDaysSummary(
                      attendanceDoc?.scheduledDays || resolvedBatch?.scheduledDays
                    )}
                  </span>
                </p>
              </div>
            </div>

            {verifiedProfile.studentId && analytics && (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <select
                  aria-label="Select Year"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs font-mono font-semibold text-gray-900 focus:outline-none focus:border-violet-500"
                >
                  {availableYears.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Attendance PDF
                </button>
              </div>
            )}
          </div>

          {/* Not Yet Approved Notice */}
          {!verifiedProfile.studentId ? (
            <div className="app-card rounded-2xl p-6 text-center space-y-2">
              <Clock className="w-8 h-8 text-amber-500 mx-auto" />
              <h4 className="font-display text-base font-bold text-gray-900">
                Admission Status: {verifiedProfile.admissionStage}
              </h4>
              <p className="text-xs sm:text-sm text-gray-600 max-w-md mx-auto">
                Attendance tracking activates automatically once your admission is approved and your Official Student ID QR card is generated.
              </p>
            </div>
          ) : loadingYearData ? (
            <div className="app-card rounded-2xl p-10 flex items-center justify-center gap-2.5 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin text-violet-600" />
              Loading {selectedYear} attendance records...
            </div>
          ) : (
            analytics && (
              <>
                {/* 6 Core KPI Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {[
                    {
                      label: 'Total Scheduled Class Days',
                      value: String(analytics.yearlySummary.scheduledDays),
                      tone: 'text-gray-900',
                    },
                    {
                      label: 'Total Present Days',
                      value: String(analytics.yearlySummary.presentDays),
                      tone: 'text-emerald-600',
                    },
                    {
                      label: 'Total Absent Days',
                      value: String(analytics.yearlySummary.absentDays),
                      tone: 'text-red-600',
                    },
                    {
                      label: 'Attendance Percentage',
                      value: `${analytics.yearlySummary.percentage.toFixed(1)}%`,
                      tone: 'text-violet-700',
                    },
                    {
                      label: `Current Month (${MONTH_NAMES[analytics.currentMonthSummary.month - 1].slice(0, 3)})`,
                      value: `${analytics.currentMonthSummary.presentDays}/${analytics.currentMonthSummary.scheduledDays}`,
                      sub:
                        analytics.currentMonthSummary.scheduledDays > 0
                          ? `${analytics.currentMonthSummary.percentage.toFixed(1)}%`
                          : 'No classes yet',
                      tone: 'text-violet-700',
                    },
                    {
                      label: `Yearly Attendance (${selectedYear})`,
                      value: `${analytics.yearlySummary.presentDays}/${analytics.yearlySummary.scheduledDays}`,
                      sub: `${analytics.yearlySummary.percentage.toFixed(1)}%`,
                      tone: 'text-emerald-700',
                    },
                  ].map((card) => (
                    <div key={card.label} className="app-card rounded-2xl p-3.5">
                      <p className="text-[11px] text-gray-500 font-medium leading-snug">
                        {card.label}
                      </p>
                      <p
                        className={`mt-1.5 font-mono text-lg sm:text-xl font-bold tabular-nums ${card.tone}`}
                      >
                        {card.value}
                      </p>
                      {card.sub && (
                        <p className="text-[11px] font-mono text-gray-500 tabular-nums mt-0.5">
                          {card.sub}
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Interactive Monthly Calendar + Selected Date Details */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                  <div className="lg:col-span-8 app-card rounded-2xl p-4 sm:p-5 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-violet-600" />
                        <h4 className="font-display text-base font-bold text-gray-900">
                          {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
                        </h4>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          aria-label="Previous Month"
                          onClick={handlePrevMonth}
                          className="p-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 cursor-pointer"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          aria-label="Next Month"
                          onClick={handleNextMonth}
                          className="p-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 cursor-pointer"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Color + Text Legend */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-gray-600">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                        Green = Present
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-red-500" />
                        Red = Absent
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-gray-400" />
                        Grey = Holiday
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-amber-400" />
                        Yellow = Class Not Scheduled
                      </span>
                    </div>

                    {/* Calendar Grid */}
                    <div>
                      <div className="grid grid-cols-7 gap-1.5 mb-1.5 text-center">
                        {WEEKDAY_LABELS.map((w) => (
                          <div
                            key={w}
                            className="text-[11px] font-semibold text-gray-500 py-1"
                          >
                            {w}
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-7 gap-1.5">
                        {Array.from({ length: analytics.leadingEmptyCells }).map((_, idx) => (
                          <div key={`blank-${idx}`} className="h-11 sm:h-12" />
                        ))}

                        {analytics.calendarDays.map((cell) => {
                          const isSelected = selectedDay?.date === cell.date;
                          const isToday = cell.date === todayIst;
                          return (
                            <button
                              key={cell.date}
                              type="button"
                              onClick={() => setSelectedDay(cell)}
                              className={`h-11 sm:h-12 rounded-xl border flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${calendarCellClasses(
                                cell.status,
                                isSelected
                              )}`}
                            >
                              <span
                                className={`font-mono text-xs sm:text-sm font-bold tabular-nums ${
                                  isToday ? 'underline decoration-violet-600 underline-offset-2' : ''
                                }`}
                              >
                                {cell.dayNumber}
                              </span>
                              <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass(cell.status)}`} />
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <p className="text-[11px] text-gray-500 pt-1">
                      Tap any date to view Entry Time, Exit Time (if recorded), Batch Timing, and Attendance Status in IST.
                    </p>
                  </div>

                  {/* Selected Date Detail Card */}
                  <div className="lg:col-span-4 app-card rounded-2xl p-4 sm:p-5 space-y-3.5">
                    <h4 className="font-display text-sm font-bold text-gray-900">
                      Date Attendance Details
                    </h4>

                    {!selectedDay ? (
                      <div className="rounded-xl bg-gray-50 border border-gray-200 p-5 text-center text-xs text-gray-500">
                        Select any date on the calendar to inspect attendance date, entry/exit time, batch timing, and status.
                      </div>
                    ) : (
                      <div className="space-y-3 text-xs sm:text-sm">
                        <div className="rounded-xl bg-gray-50 border border-gray-200 p-3.5 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-500">Attendance Date</span>
                            <span className="font-mono font-semibold text-gray-900 tabular-nums">
                              {formatIstDisplayDate(selectedDay.date)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-500">Attendance Status</span>
                            <span
                              className={`font-semibold ${
                                selectedDay.status === 'Present'
                                  ? 'text-emerald-600'
                                  : selectedDay.status === 'Absent'
                                  ? 'text-red-600'
                                  : selectedDay.status === 'Holiday'
                                  ? 'text-gray-600'
                                  : 'text-amber-700'
                              }`}
                            >
                              {statusLabel(selectedDay.status)}
                            </span>
                          </div>
                          {selectedDay.holidayTitle && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-gray-500">Note</span>
                              <span className="font-medium text-gray-800 text-right">
                                {selectedDay.holidayTitle}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-gray-500">Batch Timing</span>
                            <span className="font-medium text-gray-900 text-right">
                              {selectedDay.batchTiming}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-gray-500">Entry Time</span>
                            <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                              {selectedDay.record?.entryTimeMs
                                ? formatIstTime(selectedDay.record.entryTimeMs)
                                : '—'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-gray-500">Exit Time</span>
                            <span className="font-mono font-semibold text-violet-700 tabular-nums">
                              {selectedDay.record?.exitTimeMs
                                ? formatIstTime(selectedDay.record.exitTimeMs)
                                : 'Not Recorded'}
                            </span>
                          </div>
                        </div>

                        <p className="text-[11px] text-gray-500 leading-relaxed">
                          Holidays and non-scheduled days are excluded from total scheduled class days and never reduce attendance percentage.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* 12-Month Attendance Report */}
                <div className="app-card rounded-2xl p-4 sm:p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="font-display text-base font-bold text-gray-900">
                        Month-Wise Attendance Report ({selectedYear})
                      </h4>
                      <p className="text-xs text-gray-500">
                        Click any month to jump directly to its daily calendar.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleDownloadPdf}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-violet-50 hover:bg-violet-100 border border-violet-200 text-violet-700 text-xs font-semibold cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download PDF
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs sm:text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-xs text-gray-500">
                          <th className="pb-2.5 font-medium">Month</th>
                          <th className="pb-2.5 font-medium text-right">Scheduled</th>
                          <th className="pb-2.5 font-medium text-right">Present</th>
                          <th className="pb-2.5 font-medium text-right">Absent</th>
                          <th className="pb-2.5 font-medium text-right">Holidays</th>
                          <th className="pb-2.5 font-medium text-right">Attendance %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-gray-700">
                        {analytics.monthlyBreakdown.map((m) => (
                          <tr
                            key={m.month}
                            onClick={() => {
                              setSelectedMonth(m.month);
                              setSelectedDay(null);
                            }}
                            className={`cursor-pointer transition-colors ${
                              m.month === selectedMonth
                                ? 'bg-violet-50/70 font-semibold'
                                : 'hover:bg-gray-50/80'
                            }`}
                          >
                            <td className="py-2.5 text-gray-900">{m.monthName}</td>
                            <td className="py-2.5 text-right font-mono tabular-nums">
                              {m.scheduledDays}
                            </td>
                            <td className="py-2.5 text-right font-mono text-emerald-600 tabular-nums">
                              {m.presentDays}
                            </td>
                            <td className="py-2.5 text-right font-mono text-red-600 tabular-nums">
                              {m.absentDays}
                            </td>
                            <td className="py-2.5 text-right font-mono text-gray-500 tabular-nums">
                              {m.holidayDays}
                            </td>
                            <td className="py-2.5 text-right font-mono font-semibold text-violet-700 tabular-nums">
                              {m.scheduledDays > 0 ? `${m.percentage.toFixed(1)}%` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )
          )}
        </div>
      )}
    </div>
  );

  if (compact) {
    return <section id="my-attendance">{innerContent}</section>;
  }

  return (
    <div className="bg-white text-gray-900 min-h-[calc(100vh-3.5rem)] pb-24 md:pb-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10 space-y-5">
        {onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-violet-700 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </button>
        )}
        {innerContent}
      </div>
    </div>
  );
};
