import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Loader2,
  Phone,
  RotateCcw,
  Search,
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
  fetchStudentAttendanceById,
  lookupActiveStudentsForAttendanceById,
  lookupActiveStudentsForAttendanceByMobile,
} from '../lib/firestoreService';
import { checkSearchRateLimit, isFirebaseUnavailableError } from '../lib/trackingApi';
import {
  AttendanceHoliday,
  AttendanceLookupEntry,
  BatchItem,
  CalendarDayStatus,
  InstituteSettings,
  PublicView,
  StudentAttendancePublicDoc,
} from '../types';

interface StudentAttendanceTrackerProps {
  settings: InstituteSettings;
  batches: BatchItem[];
  onNavigate?: (view: PublicView) => void;
  compact?: boolean;
}

type SearchMode = 'mobile' | 'id';

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

  // Direct Search State (Registered Mobile Number or Student ID — No Login Required)
  const [mode, setMode] = useState<SearchMode>('mobile');
  const [queryInput, setQueryInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);

  // Matched Active Approved Student(s)
  const [matchedStudents, setMatchedStudents] = useState<AttendanceLookupEntry[]>([]);
  const [activeStudent, setActiveStudent] = useState<AttendanceLookupEntry | null>(null);

  // Yearly Attendance Ledger & Calendar State
  const [attendanceDoc, setAttendanceDoc] = useState<StudentAttendancePublicDoc | null>(null);
  const [attendanceLoadError, setAttendanceLoadError] = useState('');
  const [attendanceReloadSeq, setAttendanceReloadSeq] = useState(0);
  const [holidays, setHolidays] = useState<AttendanceHoliday[]>([]);
  const [loadingYearData, setLoadingYearData] = useState(false);
  const [selectedDay, setSelectedDay] = useState<CalendarDayCell | null>(null);

  useEffect(() => {
    void fetchServerIstTime().then((t) => {
      setTodayIst(t.date);
      setSelectedYear(t.year);
      setSelectedMonth(t.month);
    });
    void fetchPublicAttendanceHolidays()
      .then(setHolidays)
      .catch(() => {
        /* Holidays fall back gracefully without blocking attendance display */
      });
  }, []);

  useEffect(() => {
    if (rateLimitCountdown <= 0) return;
    const t = window.setInterval(() => {
      setRateLimitCountdown((s) => (s > 1 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(t);
  }, [rateLimitCountdown]);

  // Fetch yearly attendance ledger immediately when an active student is selected or year changes
  useEffect(() => {
    if (!activeStudent?.studentId) return;
    let cancelled = false;
    setLoadingYearData(true);
    setAttendanceLoadError('');
    setSelectedDay(null);

    void fetchStudentAttendanceById(
      activeStudent.studentId,
      selectedYear,
      activeStudent._legacyMobile
    )
      .then((docData) => {
        if (!cancelled) {
          setAttendanceDoc(docData);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Student attendance ledger load failed:', err);
          setAttendanceDoc(null);
          setAttendanceLoadError(
            isFirebaseUnavailableError(err)
              ? 'Firebase attendance database is temporarily unreachable. Please check your internet connection and retry.'
              : 'Unable to load attendance records right now. Please try again.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingYearData(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeStudent?.studentId, activeStudent?._legacyMobile, selectedYear, attendanceReloadSeq]);

  const resetAll = () => {
    setErrorMsg('');
    setNotFound(false);
    setMatchedStudents([]);
    setActiveStudent(null);
    setAttendanceDoc(null);
    setAttendanceLoadError('');
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
    if (mode === 'mobile') {
      const cleaned = cleanPhone(trimmed);
      if (!/^[0-9]{10}$/.test(cleaned)) {
        setErrorMsg('Please enter a valid 10-digit Registered Mobile Number.');
        return;
      }
    } else {
      if (trimmed.length < 4 || !/^[a-zA-Z0-9_\-]+$/.test(trimmed)) {
        setErrorMsg('Please enter a valid Student ID Number (e.g., ZOC-2026-123456).');
        return;
      }
    }

    setSearching(true);
    try {
      // 1. Fail-closed server-side rate-limit check to prevent abuse
      const rl = await checkSearchRateLimit(mode, 'attendance');
      if (!rl.ok) {
        if (rl.reason === 'rate_limited') {
          setRateLimitCountdown(rl.retryAfterSeconds);
        }
        setErrorMsg(rl.message);
        return;
      }

      // 2. Direct Firebase lookup of ONLY approved and active student records
      const results =
        mode === 'mobile'
          ? await lookupActiveStudentsForAttendanceByMobile(trimmed)
          : await lookupActiveStudentsForAttendanceById(trimmed);

      if (!results || results.length === 0) {
        setNotFound(true);
        return;
      }

      setMatchedStudents(results);
      if (results.length === 1) {
        setActiveStudent(results[0]);
      }
    } catch (err) {
      console.error('Attendance lookup error:', err);
      setErrorMsg(
        isFirebaseUnavailableError(err)
          ? 'Student attendance database is temporarily unavailable. Please check your internet connection and try again shortly.'
          : 'Unable to complete attendance lookup right now. Please try again.'
      );
    } finally {
      setSearching(false);
    }
  };

  const resolvedBatch = useMemo(() => {
    if (!activeStudent) return null;
    return resolveStudentBatch(activeStudent.batch, batches);
  }, [activeStudent, batches]);

  const analytics = useMemo(() => {
    if (!activeStudent || !resolvedBatch) return null;
    const scheduledDays =
      attendanceDoc?.scheduledDays && attendanceDoc.scheduledDays.length > 0
        ? attendanceDoc.scheduledDays
        : resolvedBatch.scheduledDays;
    return computeStudentAttendanceAnalytics({
      batchId: attendanceDoc?.batchId || resolvedBatch.batchId,
      batchTiming: attendanceDoc?.batchTiming || resolvedBatch.batchTiming,
      enrolledDate: attendanceDoc?.enrolledDate || activeStudent.enrolledDate || '',
      scheduleStartDate: resolvedBatch.scheduleStartDate,
      scheduledDays,
      recordsByDate: attendanceDoc?.records || {},
      holidays,
      year: selectedYear,
      selectedMonth,
      todayIst,
    });
  }, [activeStudent, resolvedBatch, attendanceDoc, holidays, selectedYear, selectedMonth, todayIst]);

  const monthlyDailyLogs = useMemo(() => {
    if (!analytics) return [];
    return analytics.calendarDays
      .filter((cell) => cell.status === 'Present' && cell.record)
      .slice()
      .reverse();
  }, [analytics]);

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
    if (!activeStudent || !analytics) return;
    downloadStudentAttendancePdf({
      studentName: activeStudent.studentName,
      studentId: activeStudent.studentId,
      fatherName: activeStudent.fatherName,
      studentClass: activeStudent.studentClass,
      course: activeStudent.course,
      batchTiming: attendanceDoc?.batchTiming || activeStudent.batch,
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
            Enter your registered mobile number or Student ID to view your attendance report, daily entry/exit times, monthly calendar, and downloadable PDF.
          </p>
        </div>
        {activeStudent && (
          <div className="flex items-center gap-2 self-start">
            {matchedStudents.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setActiveStudent(null);
                  setAttendanceDoc(null);
                  setSelectedDay(null);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-50 hover:bg-violet-100 border border-violet-200 text-xs font-semibold text-violet-700 cursor-pointer"
              >
                Switch Student
              </button>
            )}
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Search Another
            </button>
          </div>
        )}
      </div>

      {/* Direct Search Card (Shown when no active student report is open) */}
      {!activeStudent && (
        <div className="app-card rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="inline-flex p-1 rounded-xl bg-gray-100 border border-gray-200/80">
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
          </div>

          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              {mode === 'mobile' ? (
                <Phone className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              ) : (
                <User className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              )}
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
                  mode === 'mobile'
                    ? 'Enter 10-digit Registered Mobile Number'
                    : 'Enter Student ID (e.g., ZOC-2026-123456)'
                }
                className="w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 pl-10 pr-4 py-3 text-sm font-mono text-gray-900 placeholder:font-sans placeholder-gray-400 focus:outline-none transition-colors"
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
              {mode === 'mobile'
                ? `No active approved student record found for this mobile number. Please check the 10-digit registered number or contact ${settings.instituteName}.`
                : `No active approved student record found matching this Student ID. Please verify your Student ID or contact ${settings.instituteName}.`}
            </div>
          )}

          {/* Multiple Active Students Sharing Same Registered Mobile Number */}
          {matchedStudents.length > 1 && (
            <div className="rounded-xl bg-violet-50/50 border border-violet-200 p-4 space-y-2.5">
              <p className="text-xs font-semibold text-violet-900">
                Multiple active enrollments found on {matchedStudents[0].maskedMobile}. Tap your Student ID to view attendance:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {matchedStudents.map((entry) => (
                  <button
                    key={entry.studentId}
                    type="button"
                    onClick={() => setActiveStudent(entry)}
                    className="text-left rounded-xl bg-white hover:border-violet-400 border border-gray-200 p-3 flex items-center justify-between gap-2 transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-bold text-violet-700">
                        {entry.studentId}
                      </p>
                      <p className="text-xs text-gray-800 font-semibold mt-0.5 truncate">
                        {entry.course}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {entry.studentClass} · {entry.batch}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Immediate Attendance Report Dashboard */}
      {activeStudent && (
        <div className="space-y-5">
          {/* Student Profile Card (Privacy-Minimized: No Raw Mobile, Fees, or Address) */}
          <div className="app-card rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl overflow-hidden border border-gray-200 bg-violet-50 flex items-center justify-center shrink-0">
                  {activeStudent.photoUrl || activeStudent.photoDataUrl ? (
                    <img
                      src={activeStudent.photoUrl || activeStudent.photoDataUrl}
                      alt={activeStudent.studentName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-7 h-7 text-violet-600" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-base sm:text-lg font-bold text-gray-900 truncate">
                      {activeStudent.studentName}
                    </h3>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg border text-[11px] font-semibold bg-emerald-50 border-emerald-200 text-emerald-700">
                      Active Student
                    </span>
                  </div>
                  <p className="text-xs font-mono text-violet-700 font-semibold mt-0.5">
                    Student ID: {activeStudent.studentId}
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Father&apos;s Name:{' '}
                    <span className="font-semibold text-gray-900">
                      {activeStudent.fatherName || '—'}
                    </span>
                    {activeStudent.maskedMobile && (
                      <span className="ml-2.5 text-gray-400 font-mono text-[11px]">
                        ({activeStudent.maskedMobile})
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {analytics && !attendanceLoadError && (
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

            {/* Academic & Batch Metadata Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-3 border-t border-gray-100 text-xs">
              <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
                <p className="text-[11px] text-gray-500">Class</p>
                <p className="font-semibold text-gray-900 mt-0.5">{activeStudent.studentClass}</p>
              </div>
              <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
                <p className="text-[11px] text-gray-500">Course</p>
                <p className="font-semibold text-gray-900 mt-0.5">{activeStudent.course}</p>
              </div>
              <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
                <p className="text-[11px] text-gray-500">Batch Timing</p>
                <p className="font-semibold text-gray-900 mt-0.5">
                  {attendanceDoc?.batchTiming || activeStudent.batch}
                </p>
              </div>
              <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
                <p className="text-[11px] text-gray-500">Class Days</p>
                <p className="font-semibold text-gray-900 mt-0.5">
                  {formatScheduledDaysSummary(
                    attendanceDoc?.scheduledDays || resolvedBatch?.scheduledDays
                  )}
                </p>
              </div>
            </div>
          </div>

          {loadingYearData ? (
            <div className="app-card rounded-2xl p-10 flex items-center justify-center gap-2.5 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin text-violet-600" />
              Loading {selectedYear} attendance records...
            </div>
          ) : attendanceLoadError ? (
            <div className="app-card rounded-2xl p-6 text-center space-y-3 border-red-200 bg-red-50/40">
              <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
              <h4 className="font-display text-base font-bold text-gray-900">
                Attendance Service Temporarily Unavailable
              </h4>
              <p className="text-xs sm:text-sm text-red-700 max-w-md mx-auto">
                {attendanceLoadError}
              </p>
              <button
                type="button"
                onClick={() => setAttendanceReloadSeq((n) => n + 1)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Retry Loading Attendance
              </button>
            </div>
          ) : (
            analytics && (
              <>
                {Object.keys(attendanceDoc?.records || {}).length === 0 && (
                  <div className="rounded-2xl bg-violet-50/60 border border-violet-200 px-4 py-3 text-xs sm:text-sm text-violet-900 flex items-start gap-2.5">
                    <Clock className="w-4 h-4 text-violet-600 shrink-0 mt-0.5" />
                    <span>
                      No QR attendance scans have been recorded for <strong>{selectedYear}</strong> yet.
                      Your attendance totals and monthly calendar will update automatically as soon as your teacher scans your Student ID card.
                    </span>
                  </div>
                )}

                {/* 6 Core Attendance KPI Cards */}
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

                {/* Interactive Monthly Calendar + Selected Date Entry/Exit Details */}
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
                      Tap any date to view Daily Entry Time, Daily Exit Time, Batch Timing, and Attendance Status in IST.
                    </p>
                  </div>

                  {/* Selected Date Detail Card */}
                  <div className="lg:col-span-4 app-card rounded-2xl p-4 sm:p-5 space-y-3.5">
                    <h4 className="font-display text-sm font-bold text-gray-900">
                      Daily Entry &amp; Exit Details
                    </h4>

                    {!selectedDay ? (
                      <div className="rounded-xl bg-gray-50 border border-gray-200 p-5 text-center text-xs text-gray-500">
                        Select any date on the calendar to inspect attendance date, daily entry time, daily exit time, batch timing, and status.
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
                            <span className="text-gray-500">Daily Entry Time</span>
                            <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                              {selectedDay.record?.entryTimeMs
                                ? formatIstTime(selectedDay.record.entryTimeMs)
                                : '—'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-gray-500">Daily Exit Time</span>
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

                {/* Daily Entry & Exit Log for Selected Month (when present scans exist) */}
                {monthlyDailyLogs.length > 0 && (
                  <div className="app-card rounded-2xl p-4 sm:p-5 space-y-3">
                    <div>
                      <h4 className="font-display text-base font-bold text-gray-900">
                        Daily Entry &amp; Exit Log ({MONTH_NAMES[selectedMonth - 1]} {selectedYear})
                      </h4>
                      <p className="text-xs text-gray-500">
                        Recorded classroom check-in and check-out timestamps (IST).
                      </p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs sm:text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 text-xs text-gray-500">
                            <th className="pb-2 font-medium">Date</th>
                            <th className="pb-2 font-medium">Status</th>
                            <th className="pb-2 font-medium">Daily Entry Time</th>
                            <th className="pb-2 font-medium">Daily Exit Time</th>
                            <th className="pb-2 font-medium">Batch Timing</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-gray-700">
                          {monthlyDailyLogs.map((cell) => (
                            <tr
                              key={cell.date}
                              onClick={() => setSelectedDay(cell)}
                              className="hover:bg-gray-50/80 cursor-pointer"
                            >
                              <td className="py-2 font-mono text-gray-900 tabular-nums">
                                {formatIstDisplayDate(cell.date)}
                              </td>
                              <td className="py-2 font-semibold text-emerald-600">Present</td>
                              <td className="py-2 font-mono text-emerald-700 tabular-nums">
                                {cell.record?.entryTimeMs
                                  ? formatIstTime(cell.record.entryTimeMs)
                                  : '—'}
                              </td>
                              <td className="py-2 font-mono text-violet-700 tabular-nums">
                                {cell.record?.exitTimeMs
                                  ? formatIstTime(cell.record.exitTimeMs)
                                  : 'Not Recorded'}
                              </td>
                              <td className="py-2 text-gray-600">{cell.batchTiming}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

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
