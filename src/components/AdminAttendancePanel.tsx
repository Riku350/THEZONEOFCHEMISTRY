import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CalendarOff,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  History,
  Loader2,
  Plus,
  QrCode,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { CLASS_OPTIONS } from '../config/defaults';
import {
  buildRecordsMapFromAttendanceList,
  CalendarDayCell,
  computeStudentAttendanceAnalytics,
  downloadAdminAttendanceExcel,
  downloadAdminAttendancePdf,
  downloadStudentAttendancePdf,
  formatIstDateTime,
  formatIstDateYmd,
  formatIstDisplayDate,
  formatIstShortTime,
  formatIstTime,
  formatScheduledDaysSummary,
  getClientIstNow,
  MONTH_NAMES,
  resolveStudentBatch,
  WEEKDAY_LABELS,
} from '../lib/attendanceUtils';
import {
  deleteAttendanceHoliday,
  saveAttendanceHoliday,
  saveManualAttendanceCorrection,
} from '../lib/firestoreService';
import {
  AttendanceAuditLog,
  AttendanceHoliday,
  AttendanceRecord,
  AttendanceStatus,
  BatchItem,
  CalendarDayStatus,
  CourseItem,
  HolidayDayType,
  InstituteSettings,
  StudentRecord,
} from '../types';

interface AdminAttendancePanelProps {
  adminEmail: string;
  students: StudentRecord[];
  batches: BatchItem[];
  courses: CourseItem[];
  attendance: AttendanceRecord[];
  auditLogs: AttendanceAuditLog[];
  holidays: AttendanceHoliday[];
  settings: InstituteSettings;
  onOpenScanner: () => void;
  onToast: (message: string) => void;
}

type SubTab = 'daily' | 'batches' | 'reports' | 'holidays' | 'audit';

const inputCls =
  'w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 px-3 py-2 text-xs sm:text-sm text-gray-900 placeholder-gray-400 focus:outline-none transition-colors';

function calendarCellClasses(status: CalendarDayStatus, isSelected: boolean): string {
  const ring = isSelected ? 'ring-2 ring-violet-600 ring-offset-1' : '';
  switch (status) {
    case 'Present':
      return `bg-emerald-50 border-emerald-300 text-emerald-900 ${ring}`;
    case 'Absent':
      return `bg-red-50 border-red-300 text-red-900 ${ring}`;
    case 'Holiday':
      return `bg-gray-100 border-gray-300 text-gray-700 ${ring}`;
    case 'NotScheduled':
      return `bg-amber-50 border-amber-300 text-amber-900 ${ring}`;
    default:
      return `bg-white border-gray-200 text-gray-400 ${ring}`;
  }
}

export const AdminAttendancePanel: React.FC<AdminAttendancePanelProps> = ({
  adminEmail,
  students,
  batches,
  courses,
  attendance,
  auditLogs,
  holidays,
  settings,
  onOpenScanner,
  onToast,
}) => {
  const istNow = getClientIstNow();
  const [subTab, setSubTab] = useState<SubTab>('daily');

  // 8 Required Filters
  const [filterName, setFilterName] = useState('');
  const [filterStudentId, setFilterStudentId] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [filterCourse, setFilterCourse] = useState('');
  const [filterBatch, setFilterBatch] = useState('');
  const [filterMonth, setFilterMonth] = useState<number>(istNow.month);
  const [filterYear, setFilterYear] = useState<number>(istNow.year);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(istNow.date);

  // Report mode
  const [reportScope, setReportScope] = useState<'monthly' | 'annual'>('monthly');

  // Holiday form state
  const [holidayDate, setHolidayDate] = useState(istNow.date);
  const [holidayTitle, setHolidayTitle] = useState('');
  const [holidayBatchId, setHolidayBatchId] = useState('ALL');
  const [holidayDayType, setHolidayDayType] = useState<HolidayDayType>('Holiday');
  const [holidayBusy, setHolidayBusy] = useState(false);

  // Manual Correction Modal
  const [correctionStudent, setCorrectionStudent] = useState<StudentRecord | null>(null);
  const [correctionDate, setCorrectionDate] = useState(istNow.date);
  const [correctionStatus, setCorrectionStatus] = useState<AttendanceStatus>('Present');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const [correctionError, setCorrectionError] = useState('');

  // Individual Student Calendar Modal
  const [inspectStudent, setInspectStudent] = useState<StudentRecord | null>(null);
  const [inspectMonth, setInspectMonth] = useState<number>(istNow.month);
  const [inspectYear, setInspectYear] = useState<number>(istNow.year);
  const [inspectDay, setInspectDay] = useState<CalendarDayCell | null>(null);

  const approvedStudents = useMemo(
    () => students.filter((s) => s.status === 'active'),
    [students]
  );

  // Index attendance by studentId -> list of records
  const attendanceByStudent = useMemo(() => {
    const map = new Map<string, AttendanceRecord[]>();
    for (const r of attendance) {
      const list = map.get(r.studentId) || [];
      list.push(r);
      map.set(r.studentId, list);
    }
    return map;
  }, [attendance]);

  // Index attendance for selectedDate by studentId
  const selectedDateRecordByStudent = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of attendance) {
      if (r.attendanceDate === selectedDate) {
        map.set(r.studentId, r);
      }
    }
    return map;
  }, [attendance, selectedDate]);

  // Helper to compute day status for a student on a specific date
  const getStudentStatusOnDate = (
    student: StudentRecord,
    dateYmd: string
  ): { status: CalendarDayStatus; record?: AttendanceRecord; holidayTitle?: string } => {
    const resolved = resolveStudentBatch(student.batch, batches);
    const rec = attendance.find(
      (a) => a.studentId === student.studentId && a.attendanceDate === dateYmd
    );
    if (rec) {
      return { status: rec.attendanceStatus, record: rec };
    }
    const hol =
      holidays.find((h) => h.date === dateYmd && h.batchId === resolved.batchId) ||
      holidays.find((h) => h.date === dateYmd && h.batchId === 'ALL');
    if (hol) {
      return { status: hol.dayType === 'Holiday' ? 'Holiday' : 'NotScheduled', holidayTitle: hol.title };
    }
    if (dateYmd > istNow.date) {
      return { status: 'Upcoming' };
    }
    const enrolled = formatIstDateYmd(student.approvedAt);
    const effectiveStart =
      enrolled && resolved.scheduleStartDate
        ? enrolled > resolved.scheduleStartDate
          ? enrolled
          : resolved.scheduleStartDate
        : enrolled || resolved.scheduleStartDate;
    if (effectiveStart && dateYmd < effectiveStart) {
      return { status: 'NotScheduled' };
    }
    const [y, m, d] = dateYmd.split('-').map(Number);
    const wd = new Date(y, m - 1, d).getDay();
    if (!resolved.scheduledDays.includes(wd)) {
      return { status: 'NotScheduled' };
    }
    return { status: 'Absent' };
  };

  // Top 4 Live KPIs (Today in IST)
  const todayKpis = useMemo(() => {
    let presentToday = 0;
    let absentToday = 0;
    let scheduledToday = 0;

    for (const s of approvedStudents) {
      const info = getStudentStatusOnDate(s, istNow.date);
      if (info.status === 'Present') {
        presentToday += 1;
        scheduledToday += 1;
      } else if (info.status === 'Absent') {
        absentToday += 1;
        scheduledToday += 1;
      }
    }

    const pct = scheduledToday > 0 ? Math.round((presentToday / scheduledToday) * 1000) / 10 : 0;
    return {
      totalApproved: approvedStudents.length,
      presentToday,
      absentToday,
      scheduledToday,
      attendancePct: pct,
    };
  }, [approvedStudents, attendance, batches, holidays, istNow.date]);

  const uniqueCourses = useMemo(
    () => Array.from(new Set([...courses.map((c) => c.title), ...students.map((s) => s.course)])),
    [courses, students]
  );

  const uniqueBatches = useMemo(
    () => Array.from(new Set([...batches.map((b) => b.timing), ...students.map((s) => s.batch)])),
    [batches, students]
  );

  // Filtered rows combining daily status + selected month/year analytics
  const studentRows = useMemo(() => {
    const nameQ = filterName.trim().toLowerCase();
    const idQ = filterStudentId.trim().toLowerCase();

    return approvedStudents
      .map((student) => {
        const resolved = resolveStudentBatch(student.batch, batches);
        const stuRecords = attendanceByStudent.get(student.studentId) || [];
        const recordsMap = buildRecordsMapFromAttendanceList(stuRecords, filterYear);
        const analytics = computeStudentAttendanceAnalytics({
          batchId: resolved.batchId,
          batchTiming: resolved.batchTiming,
          enrolledDate: formatIstDateYmd(student.approvedAt),
          scheduleStartDate: resolved.scheduleStartDate,
          scheduledDays: resolved.scheduledDays,
          recordsByDate: recordsMap,
          holidays,
          year: filterYear,
          selectedMonth: filterMonth,
          todayIst: istNow.date,
        });

        const dayInfo = getStudentStatusOnDate(student, selectedDate);
        const recForDay = selectedDateRecordByStudent.get(student.studentId);

        return {
          student,
          resolvedBatch: resolved,
          analytics,
          dayStatus: dayInfo.status,
          dayRecord: recForDay || dayInfo.record,
          holidayTitle: dayInfo.holidayTitle,
        };
      })
      .filter((row) => {
        if (nameQ && !row.student.studentName.toLowerCase().includes(nameQ)) return false;
        if (idQ && !row.student.studentId.toLowerCase().includes(idQ)) return false;
        if (filterClass && row.student.studentClass !== filterClass) return false;
        if (filterCourse && row.student.course !== filterCourse) return false;
        if (filterBatch && row.student.batch !== filterBatch) return false;
        if (filterStatus && row.dayStatus !== filterStatus) return false;
        return true;
      });
  }, [
    approvedStudents,
    batches,
    attendanceByStudent,
    holidays,
    filterName,
    filterStudentId,
    filterClass,
    filterCourse,
    filterBatch,
    filterStatus,
    filterMonth,
    filterYear,
    selectedDate,
    selectedDateRecordByStudent,
    istNow.date,
  ]);

  // Batch-wise summary for selectedDate + selectedMonth
  const batchSummaries = useMemo(() => {
    const groups = new Map<
      string,
      {
        batchId: string;
        batchName: string;
        batchTiming: string;
        scheduledDays: number[];
        totalStudents: number;
        presentOnDate: number;
        absentOnDate: number;
        monthScheduledSum: number;
        monthPresentSum: number;
      }
    >();

    for (const b of batches) {
      const resolved = resolveStudentBatch(b.timing, batches);
      groups.set(resolved.batchId, {
        batchId: resolved.batchId,
        batchName: b.name,
        batchTiming: b.timing,
        scheduledDays: resolved.scheduledDays,
        totalStudents: 0,
        presentOnDate: 0,
        absentOnDate: 0,
        monthScheduledSum: 0,
        monthPresentSum: 0,
      });
    }

    for (const row of studentRows) {
      const b = row.resolvedBatch;
      const g = groups.get(b.batchId) || {
        batchId: b.batchId,
        batchName: b.batchName,
        batchTiming: b.batchTiming,
        scheduledDays: b.scheduledDays,
        totalStudents: 0,
        presentOnDate: 0,
        absentOnDate: 0,
        monthScheduledSum: 0,
        monthPresentSum: 0,
      };
      g.totalStudents += 1;
      if (row.dayStatus === 'Present') g.presentOnDate += 1;
      if (row.dayStatus === 'Absent') g.absentOnDate += 1;
      g.monthScheduledSum += row.analytics.selectedMonthSummary.scheduledDays;
      g.monthPresentSum += row.analytics.selectedMonthSummary.presentDays;
      groups.set(b.batchId, g);
    }

    return Array.from(groups.values());
  }, [batches, studentRows]);

  const inspectAnalytics = useMemo(() => {
    if (!inspectStudent) return null;
    const resolved = resolveStudentBatch(inspectStudent.batch, batches);
    const stuRecords = attendanceByStudent.get(inspectStudent.studentId) || [];
    const recordsMap = buildRecordsMapFromAttendanceList(stuRecords, inspectYear);
    return {
      resolved,
      analytics: computeStudentAttendanceAnalytics({
        batchId: resolved.batchId,
        batchTiming: resolved.batchTiming,
        enrolledDate: formatIstDateYmd(inspectStudent.approvedAt),
        scheduleStartDate: resolved.scheduleStartDate,
        scheduledDays: resolved.scheduledDays,
        recordsByDate: recordsMap,
        holidays,
        year: inspectYear,
        selectedMonth: inspectMonth,
        todayIst: istNow.date,
      }),
    };
  }, [inspectStudent, batches, attendanceByStudent, holidays, inspectYear, inspectMonth, istNow.date]);

  const handleOpenManualCorrection = (student: StudentRecord, dateToEdit = selectedDate) => {
    const existing = attendance.find(
      (a) => a.studentId === student.studentId && a.attendanceDate === dateToEdit
    );
    setCorrectionStudent(student);
    setCorrectionDate(dateToEdit);
    setCorrectionStatus(existing?.attendanceStatus === 'Present' ? 'Absent' : 'Present');
    setCorrectionReason('');
    setCorrectionError('');
  };

  const handleSubmitManualCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctionStudent || correctionBusy) return;
    if (correctionReason.trim().length < 3) {
      setCorrectionError('Please enter a correction reason (at least 3 characters).');
      return;
    }

    setCorrectionBusy(true);
    setCorrectionError('');
    try {
      await saveManualAttendanceCorrection({
        student: correctionStudent,
        batches,
        attendanceDate: correctionDate,
        newStatus: correctionStatus,
        reason: correctionReason,
        adminEmail,
      });
      onToast(
        `Attendance updated to ${correctionStatus} for ${correctionStudent.studentName} (${formatIstDisplayDate(
          correctionDate
        )}) and logged in Audit Log.`
      );
      setCorrectionStudent(null);
    } catch (err) {
      setCorrectionError(err instanceof Error ? err.message : 'Unable to save manual correction.');
    } finally {
      setCorrectionBusy(false);
    }
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holidayDate || !holidayTitle.trim() || holidayBusy) return;
    setHolidayBusy(true);
    try {
      await saveAttendanceHoliday({
        date: holidayDate,
        title: holidayTitle,
        batchId: holidayBatchId,
        dayType: holidayDayType,
        adminEmail,
      });
      setHolidayTitle('');
      onToast(`Saved ${holidayDayType} on ${formatIstDisplayDate(holidayDate)}.`);
    } finally {
      setHolidayBusy(false);
    }
  };

  const handleExportReportExcel = () => {
    const isMonthly = reportScope === 'monthly';
    const label = isMonthly ? `${MONTH_NAMES[filterMonth - 1]}_${filterYear}` : `Annual_${filterYear}`;
    const headers = [
      'Student ID',
      'Student Name',
      'Class',
      'Course',
      'Batch',
      'Scheduled Days',
      'Present Days',
      'Absent Days',
      'Holidays',
      'Attendance %',
    ];
    const rows = studentRows.map((r) => {
      const m = isMonthly ? r.analytics.selectedMonthSummary : r.analytics.yearlySummary;
      return [
        r.student.studentId,
        r.student.studentName,
        r.student.studentClass,
        r.student.course,
        r.resolvedBatch.batchTiming,
        m.scheduledDays,
        m.presentDays,
        m.absentDays,
        m.holidayDays,
        `${m.percentage.toFixed(1)}%`,
      ];
    });
    downloadAdminAttendanceExcel(`Attendance_Report_${label}.xls`, label, headers, rows);
  };

  const handleExportReportPdf = () => {
    const isMonthly = reportScope === 'monthly';
    const periodTitle = isMonthly
      ? `${MONTH_NAMES[filterMonth - 1]} ${filterYear} Attendance Report`
      : `Annual Attendance Report (${filterYear})`;
    const headers = [
      'Student ID',
      'Student Name',
      'Class',
      'Batch',
      'Scheduled',
      'Present',
      'Absent',
      'Attendance %',
    ];
    const rows = studentRows.map((r) => {
      const m = isMonthly ? r.analytics.selectedMonthSummary : r.analytics.yearlySummary;
      return [
        r.student.studentId,
        r.student.studentName,
        r.student.studentClass,
        r.resolvedBatch.batchTiming,
        m.scheduledDays,
        m.presentDays,
        m.absentDays,
        `${m.percentage.toFixed(1)}%`,
      ];
    });
    const totalSched = studentRows.reduce(
      (sum, r) =>
        sum +
        (isMonthly
          ? r.analytics.selectedMonthSummary.scheduledDays
          : r.analytics.yearlySummary.scheduledDays),
      0
    );
    const totalPres = studentRows.reduce(
      (sum, r) =>
        sum +
        (isMonthly
          ? r.analytics.selectedMonthSummary.presentDays
          : r.analytics.yearlySummary.presentDays),
      0
    );
    const avgPct = totalSched > 0 ? `${((totalPres / totalSched) * 100).toFixed(1)}%` : '0.0%';

    downloadAdminAttendancePdf({
      title: periodTitle,
      subtitle: `Filtered Students: ${studentRows.length} · Only scheduled batch days counted`,
      headers,
      rows,
      summaryPairs: [
        { label: 'Students Included', value: String(studentRows.length) },
        { label: 'Total Present Marks', value: String(totalPres) },
        { label: 'Total Scheduled Marks', value: String(totalSched) },
        { label: 'Overall Attendance %', value: avgPct },
      ],
      settings,
      fileName: `Attendance_${isMonthly ? `${MONTH_NAMES[filterMonth - 1]}_${filterYear}` : `Annual_${filterYear}`}.pdf`,
    });
  };

  const handleExportDailyExcel = () => {
    const headers = [
      'Date (IST)',
      'Student ID',
      'Student Name',
      'Class',
      'Course',
      'Batch',
      'Status',
      'Entry Time (IST)',
      'Exit Time (IST)',
      'Recorded By',
      'Last Modified By',
      'Correction Reason',
    ];
    const rows = studentRows.map((r) => [
      selectedDate,
      r.student.studentId,
      r.student.studentName,
      r.student.studentClass,
      r.student.course,
      r.resolvedBatch.batchTiming,
      r.dayStatus,
      r.dayRecord?.entryTime ? formatIstTime(r.dayRecord.entryTime) : '—',
      r.dayRecord?.exitTime ? formatIstTime(r.dayRecord.exitTime) : '—',
      r.dayRecord?.recordedBy || '—',
      r.dayRecord?.lastModifiedBy || '—',
      r.dayRecord?.correctionReason || '—',
    ]);
    downloadAdminAttendanceExcel(`Daily_Attendance_${selectedDate}.xls`, selectedDate, headers, rows);
  };

  const availableYears = [istNow.year, istNow.year - 1];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-lg sm:text-xl font-bold text-gray-900">
            Attendance Management
          </h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Live QR attendance tracking, batch schedules, manual corrections with audit logs, and Excel/PDF reports.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenScanner}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap self-start sm:self-auto cursor-pointer"
        >
          <QrCode className="w-4 h-4" />
          Open Auto QR Scanner
        </button>
      </div>

      {/* 4 Live KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="app-card rounded-2xl p-4">
          <p className="text-[11px] sm:text-xs text-gray-500 font-medium">Total Approved Students</p>
          <p className="mt-1.5 font-mono text-xl sm:text-2xl font-bold text-gray-900 tabular-nums">
            {todayKpis.totalApproved}
          </p>
        </div>
        <div className="app-card rounded-2xl p-4">
          <p className="text-[11px] sm:text-xs text-gray-500 font-medium">
            Today&apos;s Present ({formatIstDisplayDate(istNow.date)})
          </p>
          <p className="mt-1.5 font-mono text-xl sm:text-2xl font-bold text-emerald-600 tabular-nums">
            {todayKpis.presentToday}
          </p>
        </div>
        <div className="app-card rounded-2xl p-4">
          <p className="text-[11px] sm:text-xs text-gray-500 font-medium">Today&apos;s Absent</p>
          <p className="mt-1.5 font-mono text-xl sm:text-2xl font-bold text-red-600 tabular-nums">
            {todayKpis.absentToday}
          </p>
        </div>
        <div className="app-card rounded-2xl p-4">
          <p className="text-[11px] sm:text-xs text-gray-500 font-medium">Today&apos;s Attendance %</p>
          <p className="mt-1.5 font-mono text-xl sm:text-2xl font-bold text-violet-700 tabular-nums">
            {todayKpis.scheduledToday > 0 ? `${todayKpis.attendancePct.toFixed(1)}%` : '—'}
          </p>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-gray-100 border border-gray-200/80 w-fit">
        {(
          [
            { id: 'daily', label: 'Daily & Students' },
            { id: 'batches', label: 'Batch-Wise' },
            { id: 'reports', label: 'Monthly & Annual Reports' },
            { id: 'holidays', label: 'Holidays & Schedule' },
            { id: 'audit', label: `Audit Log (${auditLogs.length})` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              subTab === t.id
                ? 'bg-white text-violet-700 shadow-2xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Shared 8-Filter Control Bar (shown for Daily, Batch-Wise, Reports) */}
      {(subTab === 'daily' || subTab === 'batches' || subTab === 'reports') && (
        <div className="app-card rounded-2xl p-3.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              placeholder="Filter by Student Name..."
              className="w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 pl-8 pr-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
            />
          </div>
          <input
            type="text"
            value={filterStudentId}
            onChange={(e) => setFilterStudentId(e.target.value)}
            placeholder="Filter by Student ID..."
            className={`${inputCls} font-mono`}
          />
          <select
            value={filterClass}
            onChange={(e) => setFilterClass(e.target.value)}
            className={inputCls}
          >
            <option value="">All Classes</option>
            {CLASS_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filterCourse}
            onChange={(e) => setFilterCourse(e.target.value)}
            className={inputCls}
          >
            <option value="">All Courses</option>
            {uniqueCourses.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filterBatch}
            onChange={(e) => setFilterBatch(e.target.value)}
            className={inputCls}
          >
            <option value="">All Batches</option>
            {uniqueBatches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <select
            value={filterMonth}
            onChange={(e) => setFilterMonth(Number(e.target.value))}
            className={inputCls}
          >
            {MONTH_NAMES.map((m, idx) => (
              <option key={m} value={idx + 1}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={filterYear}
            onChange={(e) => setFilterYear(Number(e.target.value))}
            className={`${inputCls} font-mono`}
          >
            {availableYears.map((yr) => (
              <option key={yr} value={yr}>
                Year: {yr}
              </option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className={inputCls}
          >
            <option value="">All Statuses</option>
            <option value="Present">Present</option>
            <option value="Absent">Absent</option>
            <option value="Holiday">Holiday</option>
            <option value="NotScheduled">Class Not Scheduled</option>
          </select>
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 1: DAILY & INDIVIDUAL STUDENTS ATTENDANCE                 */}
      {/* ================================================================= */}
      {subTab === 'daily' && (
        <div className="app-card rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <label className="text-xs font-semibold text-gray-700">Attendance Date (IST):</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-1.5 text-xs font-mono text-gray-900 focus:outline-none focus:border-violet-500"
              />
              <span className="text-xs text-gray-500">
                Showing {studentRows.length} student{studentRows.length === 1 ? '' : 's'}
              </span>
            </div>
            <button
              type="button"
              disabled={studentRows.length === 0}
              onClick={handleExportDailyExcel}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 disabled:opacity-40 text-xs font-semibold text-gray-700 whitespace-nowrap cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              Export Daily Excel
            </button>
          </div>

          {studentRows.length === 0 ? (
            <p className="text-xs sm:text-sm text-gray-500 py-8 text-center">
              No approved students match the current filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs text-gray-500">
                    <th className="pb-2.5 font-medium">Student</th>
                    <th className="pb-2.5 font-medium">Batch &amp; Course</th>
                    <th className="pb-2.5 font-medium">Status ({formatIstDisplayDate(selectedDate)})</th>
                    <th className="pb-2.5 font-medium">Entry / Exit (IST)</th>
                    <th className="pb-2.5 font-medium">
                      {MONTH_NAMES[filterMonth - 1].slice(0, 3)} %
                    </th>
                    <th className="pb-2.5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {studentRows.map(({ student, resolvedBatch, analytics, dayStatus, dayRecord }) => (
                    <tr key={student.studentId} className="hover:bg-gray-50/70">
                      <td className="py-3">
                        <p className="font-semibold text-gray-900">{student.studentName}</p>
                        <p className="font-mono text-[11px] text-violet-700">
                          {student.studentId} · {student.studentClass}
                        </p>
                      </td>
                      <td className="py-3 text-xs">
                        <p className="font-medium text-gray-900">{resolvedBatch.batchTiming}</p>
                        <p className="text-gray-500">{student.course}</p>
                      </td>
                      <td className="py-3">
                        <span
                          className={`text-xs font-semibold ${
                            dayStatus === 'Present'
                              ? 'text-emerald-600'
                              : dayStatus === 'Absent'
                              ? 'text-red-600'
                              : dayStatus === 'Holiday'
                              ? 'text-gray-500'
                              : 'text-amber-700'
                          }`}
                        >
                          {dayStatus === 'NotScheduled' ? 'Not Scheduled' : dayStatus}
                        </span>
                        {dayRecord?.lastModifiedBy && (
                          <p className="text-[10px] text-gray-400 truncate max-w-[160px]">
                            Edited by {dayRecord.lastModifiedBy}
                          </p>
                        )}
                      </td>
                      <td className="py-3 font-mono text-xs tabular-nums whitespace-nowrap">
                        <p className="text-emerald-700">
                          In: {dayRecord?.entryTime ? formatIstShortTime(dayRecord.entryTime) : '—'}
                        </p>
                        {dayRecord?.exitTime && (
                          <p className="text-violet-700">
                            Out: {formatIstShortTime(dayRecord.exitTime)}
                          </p>
                        )}
                      </td>
                      <td className="py-3 font-mono text-xs font-semibold text-violet-700 tabular-nums">
                        {analytics.selectedMonthSummary.scheduledDays > 0
                          ? `${analytics.selectedMonthSummary.percentage.toFixed(1)}%`
                          : '—'}
                        <div className="text-[10px] font-normal text-gray-400">
                          {analytics.selectedMonthSummary.presentDays}/
                          {analytics.selectedMonthSummary.scheduledDays} days
                        </div>
                      </td>
                      <td className="py-3 text-right whitespace-nowrap space-x-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setInspectStudent(student);
                            setInspectMonth(filterMonth);
                            setInspectYear(filterYear);
                            setInspectDay(null);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 border border-violet-200 text-violet-700 text-xs font-semibold cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Calendar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenManualCorrection(student, selectedDate)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-semibold cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Correct
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 2: BATCH-WISE ATTENDANCE BREAKDOWN                        */}
      {/* ================================================================= */}
      {subTab === 'batches' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {batchSummaries.map((b) => {
            const scheduledDayCount = b.presentOnDate + b.absentOnDate;
            const datePct =
              scheduledDayCount > 0 ? Math.round((b.presentOnDate / scheduledDayCount) * 1000) / 10 : 0;
            const monthPct =
              b.monthScheduledSum > 0
                ? Math.round((b.monthPresentSum / b.monthScheduledSum) * 1000) / 10
                : 0;

            return (
              <div key={b.batchId} className="app-card rounded-2xl p-4 sm:p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-display text-base font-bold text-gray-900">
                      {b.batchTiming}
                    </h3>
                    <p className="text-xs text-gray-500">
                      {b.batchName} · Schedule: {formatScheduledDaysSummary(b.scheduledDays)}
                    </p>
                  </div>
                  <span className="font-mono text-xs font-semibold text-violet-700 tabular-nums">
                    {b.totalStudents} students
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs bg-gray-50 border border-gray-200 rounded-xl p-3">
                  <div>
                    <p className="text-gray-500">Present ({formatIstDisplayDate(selectedDate)})</p>
                    <p className="font-mono text-base font-bold text-emerald-600 tabular-nums mt-0.5">
                      {b.presentOnDate}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Absent</p>
                    <p className="font-mono text-base font-bold text-red-600 tabular-nums mt-0.5">
                      {b.absentOnDate}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Day %</p>
                    <p className="font-mono text-base font-bold text-violet-700 tabular-nums mt-0.5">
                      {scheduledDayCount > 0 ? `${datePct.toFixed(1)}%` : '—'}
                    </p>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">
                      {MONTH_NAMES[filterMonth - 1]} {filterYear} Overall
                    </span>
                    <span className="font-mono font-semibold text-violet-700 tabular-nums">
                      {b.monthScheduledSum > 0 ? `${monthPct.toFixed(1)}%` : 'No scheduled classes'}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full bg-violet-600 rounded-full transition-all"
                      style={{ width: `${Math.min(100, monthPct)}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 3: MONTHLY & ANNUAL REPORTS + EXCEL / PDF EXPORT          */}
      {/* ================================================================= */}
      {subTab === 'reports' && (
        <div className="app-card rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-gray-100 border border-gray-200/80 w-fit">
              <button
                type="button"
                onClick={() => setReportScope('monthly')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  reportScope === 'monthly'
                    ? 'bg-white text-violet-700 shadow-2xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Monthly ({MONTH_NAMES[filterMonth - 1]} {filterYear})
              </button>
              <button
                type="button"
                onClick={() => setReportScope('annual')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  reportScope === 'annual'
                    ? 'bg-white text-violet-700 shadow-2xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Annual Report ({filterYear})
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={studentRows.length === 0}
                onClick={handleExportReportExcel}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Download Excel (.xls)
              </button>
              <button
                type="button"
                disabled={studentRows.length === 0}
                onClick={handleExportReportPdf}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Download PDF
              </button>
            </div>
          </div>

          {studentRows.length === 0 ? (
            <p className="text-xs sm:text-sm text-gray-500 py-8 text-center">
              No students match the selected filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs text-gray-500">
                    <th className="pb-2.5 font-medium">Student</th>
                    <th className="pb-2.5 font-medium">Class / Batch</th>
                    <th className="pb-2.5 font-medium text-right">Scheduled</th>
                    <th className="pb-2.5 font-medium text-right">Present</th>
                    <th className="pb-2.5 font-medium text-right">Absent</th>
                    <th className="pb-2.5 font-medium text-right">Holidays</th>
                    <th className="pb-2.5 font-medium text-right">Attendance %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {studentRows.map(({ student, resolvedBatch, analytics }) => {
                    const m =
                      reportScope === 'monthly'
                        ? analytics.selectedMonthSummary
                        : analytics.yearlySummary;
                    return (
                      <tr key={student.studentId} className="hover:bg-gray-50/70">
                        <td className="py-2.5">
                          <p className="font-semibold text-gray-900">{student.studentName}</p>
                          <p className="font-mono text-[11px] text-violet-700">
                            {student.studentId}
                          </p>
                        </td>
                        <td className="py-2.5 text-xs text-gray-600">
                          {student.studentClass} · {resolvedBatch.batchTiming}
                        </td>
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 4: HOLIDAYS & NOT-SCHEDULED CLASS DATES                   */}
      {/* ================================================================= */}
      {subTab === 'holidays' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <form
            onSubmit={handleAddHoliday}
            className="lg:col-span-5 app-card rounded-2xl p-5 space-y-3.5"
          >
            <div className="flex items-center gap-2">
              <CalendarOff className="w-4 h-4 text-violet-600" />
              <h3 className="font-display text-base font-bold text-gray-900">
                Add Holiday / Off Day
              </h3>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              Dates marked as <strong>Holiday</strong> (Grey) or{' '}
              <strong>Class Not Scheduled</strong> (Yellow) are never counted as student absences.
            </p>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Date (IST) *</label>
              <input
                type="date"
                required
                value={holidayDate}
                onChange={(e) => setHolidayDate(e.target.value)}
                className={`${inputCls} font-mono`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Title / Reason *</label>
              <input
                type="text"
                required
                maxLength={120}
                value={holidayTitle}
                onChange={(e) => setHolidayTitle(e.target.value)}
                placeholder="e.g., Diwali Holiday / Special Exam Off"
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Day Type</label>
                <select
                  value={holidayDayType}
                  onChange={(e) => setHolidayDayType(e.target.value as HolidayDayType)}
                  className={inputCls}
                >
                  <option value="Holiday">Holiday (Grey)</option>
                  <option value="NotScheduled">Class Not Scheduled (Yellow)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Applies To</label>
                <select
                  value={holidayBatchId}
                  onChange={(e) => setHolidayBatchId(e.target.value)}
                  className={inputCls}
                >
                  <option value="ALL">All Batches</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.timing} ({b.name})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={holidayBusy}
              className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer"
            >
              {holidayBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Save Calendar Override
            </button>
          </form>

          <div className="lg:col-span-7 space-y-3">
            <div className="app-card rounded-2xl p-4 sm:p-5">
              <h3 className="font-display text-sm font-bold text-gray-900 mb-3">
                Configured Holidays &amp; Non-Scheduled Dates ({holidays.length})
              </h3>
              {holidays.length === 0 ? (
                <p className="text-xs text-gray-500 py-4 text-center">
                  No holidays or date overrides configured yet. Weekly off-days follow each batch&apos;s scheduled weekdays.
                </p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {holidays.map((h) => {
                    const matchedBatch = batches.find((b) => b.id === h.batchId);
                    return (
                      <div
                        key={h.id}
                        className="py-2.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-gray-900 tabular-nums">
                              {formatIstDisplayDate(h.date)}
                            </span>
                            <span
                              className={`font-semibold ${
                                h.dayType === 'Holiday' ? 'text-gray-600' : 'text-amber-700'
                              }`}
                            >
                              {h.dayType === 'Holiday' ? 'Holiday' : 'Not Scheduled'}
                            </span>
                          </div>
                          <p className="text-gray-700 font-medium mt-0.5">{h.title}</p>
                          <p className="text-[11px] text-gray-400">
                            Scope: {h.batchId === 'ALL' ? 'All Batches' : matchedBatch?.timing || h.batchId}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label="Delete holiday"
                          onClick={() => void deleteAttendanceHoliday(h.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 5: IMMUTABLE ATTENDANCE AUDIT LOG                         */}
      {/* ================================================================= */}
      {subTab === 'audit' && (
        <div className="app-card rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-violet-600" />
              <h3 className="font-display text-base font-bold text-gray-900">
                Manual Attendance Correction Audit Log
              </h3>
            </div>
            <span className="text-xs font-mono text-gray-500 tabular-nums">
              {auditLogs.length} immutable entries
            </span>
          </div>

          {auditLogs.length === 0 ? (
            <p className="text-xs sm:text-sm text-gray-500 py-8 text-center">
              No manual attendance corrections have been made yet. Every manual edit is permanently logged here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs text-gray-500">
                    <th className="pb-2.5 font-medium">Modified At (IST)</th>
                    <th className="pb-2.5 font-medium">Student</th>
                    <th className="pb-2.5 font-medium">Date</th>
                    <th className="pb-2.5 font-medium">Change</th>
                    <th className="pb-2.5 font-medium">Reason</th>
                    <th className="pb-2.5 font-medium">Modified By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50/70">
                      <td className="py-2.5 font-mono text-[11px] text-gray-500 whitespace-nowrap tabular-nums">
                        {formatIstDateTime(log.modifiedAt)}
                      </td>
                      <td className="py-2.5">
                        <p className="font-semibold text-gray-900">{log.studentName}</p>
                        <p className="font-mono text-[11px] text-violet-700">{log.studentId}</p>
                      </td>
                      <td className="py-2.5 font-mono text-xs whitespace-nowrap tabular-nums">
                        {formatIstDisplayDate(log.attendanceDate)}
                      </td>
                      <td className="py-2.5 text-xs whitespace-nowrap">
                        <span className="text-gray-500">{log.previousStatus}</span>
                        <span className="mx-1.5 text-gray-400">→</span>
                        <span
                          className={`font-semibold ${
                            log.newStatus === 'Present' ? 'text-emerald-600' : 'text-red-600'
                          }`}
                        >
                          {log.newStatus}
                        </span>
                      </td>
                      <td className="py-2.5 text-xs text-gray-700 max-w-xs">{log.reason}</td>
                      <td className="py-2.5 text-xs text-gray-500">{log.modifiedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL 1: MANUAL ATTENDANCE CORRECTION (WITH AUDIT TRAIL)          */}
      {/* ================================================================= */}
      {correctionStudent && (
        <div
          className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setCorrectionStudent(null)}
        >
          <form
            onSubmit={handleSubmitManualCorrection}
            onClick={(e) => e.stopPropagation()}
            className="max-w-md w-full bg-white border border-gray-200 rounded-2xl shadow-xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-gray-200">
              <div>
                <h3 className="font-display text-base font-bold text-gray-900">
                  Manual Attendance Correction
                </h3>
                <p className="text-xs text-gray-500">
                  {correctionStudent.studentName} ·{' '}
                  <span className="font-mono text-violet-700">{correctionStudent.studentId}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCorrectionStudent(null)}
                className="p-1.5 text-gray-400 hover:text-gray-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Attendance Date (IST) *
                </label>
                <input
                  type="date"
                  required
                  value={correctionDate}
                  onChange={(e) => setCorrectionDate(e.target.value)}
                  className={`${inputCls} font-mono`}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Corrected Status *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['Present', 'Absent'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setCorrectionStatus(st)}
                      className={`py-2.5 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                        correctionStatus === st
                          ? st === 'Present'
                            ? 'bg-emerald-50 border-emerald-400 text-emerald-800'
                            : 'bg-red-50 border-red-400 text-red-800'
                          : 'bg-gray-50 border-gray-200 text-gray-600'
                      }`}
                    >
                      Mark {st}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Reason for Correction (Required for Audit Log) *
                </label>
                <textarea
                  rows={2}
                  required
                  minLength={3}
                  maxLength={400}
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  placeholder="e.g., Student forgot ID card today; verified physically in classroom."
                  className={inputCls}
                />
              </div>

              {correctionError && (
                <p className="text-xs text-red-600 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {correctionError}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setCorrectionStudent(null)}
                className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={correctionBusy}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
              >
                {correctionBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                Save &amp; Log Audit
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL 2: INDIVIDUAL STUDENT ATTENDANCE CALENDAR & 12-MONTH VIEW   */}
      {/* ================================================================= */}
      {inspectStudent && inspectAnalytics && (
        <div
          className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setInspectStudent(null)}
        >
          <div
            className="max-w-3xl w-full bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base sm:text-lg font-bold text-gray-900">
                  {inspectStudent.studentName}
                </h3>
                <p className="text-xs font-mono text-violet-700">
                  {inspectStudent.studentId} · {inspectStudent.studentClass} ·{' '}
                  {inspectAnalytics.resolved.batchTiming}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadStudentAttendancePdf({
                      studentName: inspectStudent.studentName,
                      studentId: inspectStudent.studentId,
                      fatherName: inspectStudent.fatherName,
                      studentClass: inspectStudent.studentClass,
                      course: inspectStudent.course,
                      batchTiming: inspectAnalytics.resolved.batchTiming,
                      analytics: inspectAnalytics.analytics,
                      settings,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  PDF
                </button>
                <button
                  type="button"
                  onClick={() => setInspectStudent(null)}
                  className="p-1.5 text-gray-400 hover:text-gray-700 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-5 max-h-[75vh] overflow-y-auto space-y-4">
              {/* Summary Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {[
                  {
                    label: 'Scheduled',
                    val: String(inspectAnalytics.analytics.yearlySummary.scheduledDays),
                    tone: 'text-gray-900',
                  },
                  {
                    label: 'Present',
                    val: String(inspectAnalytics.analytics.yearlySummary.presentDays),
                    tone: 'text-emerald-600',
                  },
                  {
                    label: 'Absent',
                    val: String(inspectAnalytics.analytics.yearlySummary.absentDays),
                    tone: 'text-red-600',
                  },
                  {
                    label: `${inspectYear} %`,
                    val: `${inspectAnalytics.analytics.yearlySummary.percentage.toFixed(1)}%`,
                    tone: 'text-violet-700',
                  },
                ].map((c) => (
                  <div
                    key={c.label}
                    className="rounded-xl bg-gray-50 border border-gray-200 p-3 text-center"
                  >
                    <p className="text-[11px] text-gray-500">{c.label}</p>
                    <p className={`font-mono text-lg font-bold tabular-nums ${c.tone}`}>{c.val}</p>
                  </div>
                ))}
              </div>

              {/* Month Navigator */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-violet-600" />
                  <p className="font-display text-sm font-bold text-gray-900">
                    {MONTH_NAMES[inspectMonth - 1]} {inspectYear}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setInspectDay(null);
                      if (inspectMonth === 1) {
                        setInspectMonth(12);
                        setInspectYear((y) => y - 1);
                      } else setInspectMonth((m) => m - 1);
                    }}
                    className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setInspectDay(null);
                      if (inspectMonth === 12) {
                        setInspectMonth(1);
                        setInspectYear((y) => y + 1);
                      } else setInspectMonth((m) => m + 1);
                    }}
                    className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Calendar Grid */}
              <div>
                <div className="grid grid-cols-7 gap-1 mb-1 text-center">
                  {WEEKDAY_LABELS.map((w) => (
                    <div key={w} className="text-[11px] font-semibold text-gray-500">
                      {w}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: inspectAnalytics.analytics.leadingEmptyCells }).map((_, i) => (
                    <div key={`b-${i}`} className="h-10" />
                  ))}
                  {inspectAnalytics.analytics.calendarDays.map((cell) => (
                    <button
                      key={cell.date}
                      type="button"
                      onClick={() => setInspectDay(cell)}
                      className={`h-10 rounded-lg border text-xs font-mono font-bold tabular-nums cursor-pointer ${calendarCellClasses(
                        cell.status,
                        inspectDay?.date === cell.date
                      )}`}
                    >
                      {cell.dayNumber}
                    </button>
                  ))}
                </div>
              </div>

              {inspectDay && (
                <div className="rounded-xl bg-gray-50 border border-gray-200 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="space-y-0.5">
                    <p className="font-semibold text-gray-900">
                      {formatIstDisplayDate(inspectDay.date)} — {inspectDay.status}
                      {inspectDay.holidayTitle ? ` (${inspectDay.holidayTitle})` : ''}
                    </p>
                    <p className="font-mono text-gray-600 tabular-nums">
                      Entry: {inspectDay.record?.entryTimeMs ? formatIstTime(inspectDay.record.entryTimeMs) : '—'}{' '}
                      · Exit: {inspectDay.record?.exitTimeMs ? formatIstTime(inspectDay.record.exitTimeMs) : '—'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const stu = inspectStudent;
                      const dt = inspectDay.date;
                      setInspectStudent(null);
                      handleOpenManualCorrection(stu, dt);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Edit This Date
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
