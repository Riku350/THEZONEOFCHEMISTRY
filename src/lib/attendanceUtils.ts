import { jsPDF } from 'jspdf';
import {
  AttendanceHoliday,
  AttendanceRecord,
  BatchItem,
  CalendarDayStatus,
  InstituteSettings,
  StudentAttendanceDayEntry,
  TimestampLike,
} from '../types';

export const IST_TIMEZONE = 'Asia/Kolkata';

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const WEEKDAY_FULL_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

// Default Mon–Sat schedule when a batch has no explicit scheduledDays yet
export const DEFAULT_SCHEDULED_DAYS: number[] = [1, 2, 3, 4, 5, 6];

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const MONTH_SHORT_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export interface ServerIstTime {
  date: string; // YYYY-MM-DD
  time: string; // hh:mm:ss am/pm
  iso: string;
  epochMs: number;
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  weekday: number; // 0..6
  timezone: string;
}

export function toDateObj(val: TimestampLike | number | Date | null | undefined): Date | null {
  if (!val) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number') {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'object') {
    if (typeof val.toDate === 'function') {
      const d = val.toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof val.seconds === 'number') {
      return new Date(val.seconds * 1000);
    }
  }
  return null;
}

export function toEpochMs(val: TimestampLike | number | Date | null | undefined): number | null {
  const d = toDateObj(val);
  return d ? d.getTime() : null;
}

export function formatIstDateYmd(val: TimestampLike | number | Date | null | undefined): string {
  const d = toDateObj(val);
  if (!d) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !day) return '';
  return `${y}-${m}-${day}`;
}

export function formatIstDisplayDate(dateYmd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return dateYmd || '—';
  const [y, m, d] = dateYmd.split('-').map(Number);
  const shortMonth = MONTH_SHORT_NAMES[m - 1] || '';
  return `${String(d).padStart(2, '0')} ${shortMonth} ${y}`;
}

export function formatIstTime(val: TimestampLike | number | Date | null | undefined): string {
  const d = toDateObj(val);
  if (!d) return '—';
  return (
    new Intl.DateTimeFormat('en-IN', {
      timeZone: IST_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(d) + ' IST'
  );
}

export function formatIstShortTime(val: TimestampLike | number | Date | null | undefined): string {
  const d = toDateObj(val);
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

export function formatIstDateTime(val: TimestampLike | number | Date | null | undefined): string {
  const d = toDateObj(val);
  if (!d) return '—';
  return (
    new Intl.DateTimeFormat('en-IN', {
      timeZone: IST_TIMEZONE,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(d) + ' IST'
  );
}

let serverClockOffsetMs = 0;
let lastServerClockSyncAt = 0;

function buildIstTimeFromEpoch(epochMs: number): ServerIstTime {
  const d = new Date(epochMs);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(d);

  const yearStr = parts.find((p) => p.type === 'year')?.value || String(d.getFullYear());
  const monthStr = parts.find((p) => p.type === 'month')?.value || String(d.getMonth() + 1).padStart(2, '0');
  const dayStr = parts.find((p) => p.type === 'day')?.value || String(d.getDate()).padStart(2, '0');
  const weekdayShort = parts.find((p) => p.type === 'weekday')?.value || 'Mon';
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
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(d);

  return {
    date: `${yearStr}-${monthStr}-${dayStr}`,
    time: timeStr,
    iso: d.toISOString(),
    epochMs,
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
    weekday: weekdayMap[weekdayShort] ?? 1,
    timezone: IST_TIMEZONE,
  };
}

export function getClientIstNow(): ServerIstTime {
  return buildIstTimeFromEpoch(Date.now());
}

/**
 * Synchronous IST timestamp adjusted by the pre-synced server clock offset.
 * Eliminates a 150-350ms HTTP round-trip on every QR scan while Firestore
 * security rules still enforce serverTimestamp() (`request.time`) on writes.
 */
export function getSyncedServerIstNow(): ServerIstTime {
  if (Date.now() - lastServerClockSyncAt > 5 * 60 * 1000) {
    void syncServerIstOffset();
  }
  return buildIstTimeFromEpoch(Date.now() + serverClockOffsetMs);
}

/**
 * Warms and calibrates the server IST clock offset in the background.
 */
export async function syncServerIstOffset(): Promise<void> {
  const start = Date.now();
  try {
    const res = await fetch('/api/time/ist', { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as ServerIstTime;
      if (data && typeof data.epochMs === 'number' && Number.isFinite(data.epochMs)) {
        const end = Date.now();
        const midpoint = start + (end - start) / 2;
        serverClockOffsetMs = data.epochMs - midpoint;
        lastServerClockSyncAt = end;
      }
    }
  } catch {
    // Non-fatal: client clock remains fallback; Firestore serverTimestamp() stays authoritative
  }
}

export async function fetchServerIstTime(): Promise<ServerIstTime> {
  const start = Date.now();
  try {
    const res = await fetch('/api/time/ist', { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as ServerIstTime;
      if (data && typeof data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
        if (typeof data.epochMs === 'number' && Number.isFinite(data.epochMs)) {
          const end = Date.now();
          serverClockOffsetMs = data.epochMs - (start + (end - start) / 2);
          lastServerClockSyncAt = end;
        }
        return data;
      }
    }
  } catch {
    // Fallback below if offline or preview proxy transient
  }
  return getSyncedServerIstNow();
}

export interface ResolvedBatchSchedule {
  batchId: string;
  batchName: string;
  batchTiming: string;
  scheduledDays: number[];
  scheduleStartDate: string;
}

export function sanitizeBatchSlug(raw: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_').slice(0, 60);
  return cleaned || 'default_batch';
}

export function resolveStudentBatch(batchValue: string, batches: BatchItem[]): ResolvedBatchSchedule {
  const norm = (batchValue || '').trim().toLowerCase();
  const matched = batches.find(
    (b) =>
      b.id.toLowerCase() === norm ||
      b.timing.trim().toLowerCase() === norm ||
      b.name.trim().toLowerCase() === norm
  );

  if (matched) {
    const days =
      Array.isArray(matched.scheduledDays) && matched.scheduledDays.length > 0
        ? [...new Set(matched.scheduledDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
            (a, b) => a - b
          )
        : DEFAULT_SCHEDULED_DAYS;
    return {
      batchId: matched.id,
      batchName: matched.name,
      batchTiming: matched.timing,
      scheduledDays: days,
      scheduleStartDate: matched.scheduleStartDate || '',
    };
  }

  return {
    batchId: sanitizeBatchSlug(batchValue),
    batchName: batchValue || 'Assigned Batch',
    batchTiming: batchValue || 'Regular Batch',
    scheduledDays: DEFAULT_SCHEDULED_DAYS,
    scheduleStartDate: '',
  };
}

export function formatScheduledDaysSummary(days?: number[]): string {
  const list =
    Array.isArray(days) && days.length > 0
      ? [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
      : DEFAULT_SCHEDULED_DAYS;
  if (list.length === 7) return 'All Days (Sun–Sat)';
  if (list.length === 6 && !list.includes(0)) return 'Mon – Sat';
  if (list.length === 5 && !list.includes(0) && !list.includes(6)) return 'Mon – Fri';
  return list.map((d) => WEEKDAY_LABELS[d]).join(', ');
}

export function buildAttendanceDocId(studentId: string, batchId: string, attendanceDate: string): string {
  const sId = studentId.trim().replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 48);
  const bId = batchId.trim().replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 48);
  const datePart = attendanceDate.trim().replace(/[^0-9\-]/g, '').slice(0, 10);
  return `att_${sId}_${bId}_${datePart}`.slice(0, 128);
}

export interface AttendanceSummaryMetrics {
  scheduledDays: number;
  presentDays: number;
  absentDays: number;
  holidayDays: number;
  notScheduledDays: number;
  percentage: number;
}

export interface MonthlyAttendanceBreakdown extends AttendanceSummaryMetrics {
  month: number; // 1..12
  monthName: string;
  monthShort: string;
}

export interface CalendarDayCell {
  date: string; // YYYY-MM-DD
  dayNumber: number;
  weekday: number; // 0..6
  status: CalendarDayStatus;
  record?: StudentAttendanceDayEntry;
  holidayTitle?: string;
  batchTiming: string;
}

export interface StudentAttendanceAnalytics {
  year: number;
  selectedMonth: number; // 1..12
  yearlySummary: AttendanceSummaryMetrics;
  currentMonthSummary: MonthlyAttendanceBreakdown;
  selectedMonthSummary: MonthlyAttendanceBreakdown;
  monthlyBreakdown: MonthlyAttendanceBreakdown[];
  calendarDays: CalendarDayCell[];
  leadingEmptyCells: number;
}

function getDaysInMonth(year: number, month1Based: number): number {
  return new Date(year, month1Based, 0).getDate();
}

function getWeekdayOfYmd(year: number, month1Based: number, day: number): number {
  return new Date(year, month1Based - 1, day).getDay();
}

function computePct(present: number, scheduled: number): number {
  if (scheduled <= 0) return 0;
  return Math.round((present / scheduled) * 1000) / 10;
}

export function buildRecordsMapFromAttendanceList(
  records: AttendanceRecord[],
  year?: number
): Record<string, StudentAttendanceDayEntry> {
  const map: Record<string, StudentAttendanceDayEntry> = {};
  for (const r of records) {
    if (year && !r.attendanceDate.startsWith(`${year}-`)) continue;
    map[r.attendanceDate] = {
      status: r.attendanceStatus,
      entryTimeMs: toEpochMs(r.entryTime),
      exitTimeMs: toEpochMs(r.exitTime),
      batchTiming: r.batchTiming || '',
    };
  }
  return map;
}

/**
 * Core attendance engine enforcing the strict institute rule:
 * - Only officially scheduled class days for the student's assigned batch count toward scheduledDays.
 * - Holidays (Grey) and Not Scheduled days (Yellow) are NEVER counted as absences.
 * - Days before enrollment/batch start without explicit records are marked NotScheduled, never Absent.
 * - Future dates after todayIst are Upcoming, never Absent.
 */
export function computeStudentAttendanceAnalytics(params: {
  batchId: string;
  batchTiming: string;
  enrolledDate?: string;
  scheduleStartDate?: string;
  scheduledDays: number[];
  recordsByDate: Record<string, StudentAttendanceDayEntry>;
  holidays: AttendanceHoliday[];
  year: number;
  selectedMonth: number; // 1..12
  todayIst: string; // YYYY-MM-DD
}): StudentAttendanceAnalytics {
  const {
    batchId,
    batchTiming,
    enrolledDate,
    scheduleStartDate,
    scheduledDays,
    recordsByDate,
    holidays,
    year,
    selectedMonth,
    todayIst,
  } = params;

  const scheduledDaySet = new Set(
    scheduledDays && scheduledDays.length > 0 ? scheduledDays : DEFAULT_SCHEDULED_DAYS
  );

  // Build holiday override map: batch-specific overrides 'ALL'
  const holidayByDate = new Map<string, AttendanceHoliday>();
  for (const h of holidays) {
    if (!h.date.startsWith(`${year}-`)) continue;
    if (h.batchId === 'ALL') {
      if (!holidayByDate.has(h.date)) {
        holidayByDate.set(h.date, h);
      }
    } else if (h.batchId === batchId) {
      holidayByDate.set(h.date, h);
    }
  }

  // Determine effective start date so pre-enrollment dates are never penalized as absences
  let effectiveStartDate = '';
  if (enrolledDate && /^\d{4}-\d{2}-\d{2}$/.test(enrolledDate)) {
    effectiveStartDate = enrolledDate;
  }
  if (scheduleStartDate && /^\d{4}-\d{2}-\d{2}$/.test(scheduleStartDate)) {
    if (!effectiveStartDate || scheduleStartDate > effectiveStartDate) {
      effectiveStartDate = scheduleStartDate;
    }
  }

  const todayMonth = Number(todayIst.slice(5, 7)) || selectedMonth;
  const todayYear = Number(todayIst.slice(0, 4)) || year;

  let yearlyScheduled = 0;
  let yearlyPresent = 0;
  let yearlyAbsent = 0;
  let yearlyHoliday = 0;
  let yearlyNotScheduled = 0;

  const monthlyBreakdown: MonthlyAttendanceBreakdown[] = [];
  const calendarDays: CalendarDayCell[] = [];

  for (let m = 1; m <= 12; m++) {
    const numDays = getDaysInMonth(year, m);
    let mScheduled = 0;
    let mPresent = 0;
    let mAbsent = 0;
    let mHoliday = 0;
    let mNotScheduled = 0;

    for (let d = 1; d <= numDays; d++) {
      const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const weekday = getWeekdayOfYmd(year, m, d);
      const rec = recordsByDate[dateStr];
      const holiday = holidayByDate.get(dateStr);

      let status: CalendarDayStatus;
      if (rec?.status === 'Present') {
        status = 'Present';
        mScheduled += 1;
        mPresent += 1;
      } else if (rec?.status === 'Absent') {
        status = 'Absent';
        mScheduled += 1;
        mAbsent += 1;
      } else if (holiday?.dayType === 'Holiday') {
        status = 'Holiday';
        mHoliday += 1;
      } else if (holiday?.dayType === 'NotScheduled') {
        status = 'NotScheduled';
        mNotScheduled += 1;
      } else if (dateStr > todayIst) {
        status = 'Upcoming';
      } else if (effectiveStartDate && dateStr < effectiveStartDate) {
        status = 'NotScheduled';
        mNotScheduled += 1;
      } else if (!scheduledDaySet.has(weekday)) {
        status = 'NotScheduled';
        mNotScheduled += 1;
      } else {
        status = 'Absent';
        mScheduled += 1;
        mAbsent += 1;
      }

      if (m === selectedMonth) {
        calendarDays.push({
          date: dateStr,
          dayNumber: d,
          weekday,
          status,
          record: rec,
          holidayTitle: holiday?.title,
          batchTiming: rec?.batchTiming || batchTiming,
        });
      }
    }

    yearlyScheduled += mScheduled;
    yearlyPresent += mPresent;
    yearlyAbsent += mAbsent;
    yearlyHoliday += mHoliday;
    yearlyNotScheduled += mNotScheduled;

    monthlyBreakdown.push({
      month: m,
      monthName: MONTH_NAMES[m - 1],
      monthShort: MONTH_SHORT_NAMES[m - 1],
      scheduledDays: mScheduled,
      presentDays: mPresent,
      absentDays: mAbsent,
      holidayDays: mHoliday,
      notScheduledDays: mNotScheduled,
      percentage: computePct(mPresent, mScheduled),
    });
  }

  const currentMonthIdx = year === todayYear ? todayMonth - 1 : selectedMonth - 1;
  const currentMonthSummary = monthlyBreakdown[Math.max(0, Math.min(11, currentMonthIdx))];
  const selectedMonthSummary = monthlyBreakdown[Math.max(0, Math.min(11, selectedMonth - 1))];

  return {
    year,
    selectedMonth,
    yearlySummary: {
      scheduledDays: yearlyScheduled,
      presentDays: yearlyPresent,
      absentDays: yearlyAbsent,
      holidayDays: yearlyHoliday,
      notScheduledDays: yearlyNotScheduled,
      percentage: computePct(yearlyPresent, yearlyScheduled),
    },
    currentMonthSummary,
    selectedMonthSummary,
    monthlyBreakdown,
    calendarDays,
    leadingEmptyCells: getWeekdayOfYmd(year, selectedMonth, 1),
  };
}

// -----------------------------------------------------------------------------
// Spreadsheet / Excel Formula-Injection Guard & Export Helpers
// -----------------------------------------------------------------------------
export function sanitizeSpreadsheetCell(val: string | number | null | undefined): string {
  const str = val === null || val === undefined ? '' : String(val);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

function escapeXml(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates an Excel-compatible SpreadsheetML (.xls) file with styled headers
 * and formula-injection protection — zero external heavy packages required.
 */
export function downloadAdminAttendanceExcel(
  fileName: string,
  sheetTitle: string,
  headers: string[],
  rows: Array<Array<string | number>>
): void {
  const safeSheet = escapeXml(sheetTitle.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  const headerCells = headers
    .map(
      (h) =>
        `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(
          sanitizeSpreadsheetCell(h)
        )}</Data></Cell>`
    )
    .join('');

  const bodyRows = rows
    .map((row) => {
      const cells = row
        .map((cell) => {
          if (typeof cell === 'number' && Number.isFinite(cell)) {
            return `<Cell><Data ss:Type="Number">${cell}</Data></Cell>`;
          }
          return `<Cell><Data ss:Type="String">${escapeXml(
            sanitizeSpreadsheetCell(cell)
          )}</Data></Cell>`;
        })
        .join('');
      return `<Row>${cells}</Row>`;
    })
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Header">
      <Font ss:Bold="1" ss:Color="#FFFFFF"/>
      <Interior ss:Color="#6D28D9" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="${safeSheet}">
    <Table>
      <Row>${headerCells}</Row>
      ${bodyRows}
    </Table>
  </Worksheet>
</Workbook>`;

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.xls') ? fileName : `${fileName}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// -----------------------------------------------------------------------------
// PDF Export Helpers (jsPDF)
// -----------------------------------------------------------------------------
export function downloadStudentAttendancePdf(params: {
  studentName: string;
  studentId: string;
  fatherName?: string;
  studentClass: string;
  course: string;
  batchTiming: string;
  analytics: StudentAttendanceAnalytics;
  settings: InstituteSettings;
}): void {
  const { studentName, studentId, fatherName, studentClass, course, batchTiming, analytics, settings } =
    params;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header Banner
  doc.setFillColor(109, 40, 217);
  doc.rect(0, 0, pageWidth, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(settings.instituteName.toUpperCase(), 14, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`${settings.teacherName}  |  Official Student Attendance Report (${analytics.year})`, 14, 19);
  doc.setFontSize(8);
  doc.text(`Generated: ${formatIstDateTime(new Date())}`, 14, 24.5);

  // Student Details Card
  doc.setTextColor(17, 24, 39);
  doc.setDrawColor(229, 231, 235);
  doc.setFillColor(249, 250, 251);
  doc.roundedRect(14, 34, pageWidth - 28, 28, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(studentName, 18, 42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(75, 85, 99);
  doc.text(`Student ID: ${studentId}`, 18, 48);
  if (fatherName) {
    doc.text(`Father's Name: ${fatherName}`, 18, 54);
  }
  doc.text(`Class: ${studentClass}   |   Course: ${course}`, 108, 48);
  doc.text(`Batch: ${batchTiming}`, 108, 54);

  // KPI Boxes
  const kpis = [
    { label: 'Scheduled Days', value: String(analytics.yearlySummary.scheduledDays) },
    { label: 'Present Days', value: String(analytics.yearlySummary.presentDays) },
    { label: 'Absent Days', value: String(analytics.yearlySummary.absentDays) },
    { label: 'Attendance %', value: `${analytics.yearlySummary.percentage.toFixed(1)}%` },
  ];
  const boxW = (pageWidth - 28 - 9) / 4;
  kpis.forEach((k, idx) => {
    const x = 14 + idx * (boxW + 3);
    doc.setDrawColor(229, 231, 235);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, 68, boxW, 18, 2, 2, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text(k.label, x + 3, 74);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(109, 40, 217);
    doc.text(k.value, x + 3, 82);
  });

  // 12-Month Breakdown Table
  let y = 95;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(17, 24, 39);
  doc.text(`Month-Wise Attendance Summary — ${analytics.year}`, 14, y);
  y += 5;

  // Table header
  doc.setFillColor(109, 40, 217);
  doc.rect(14, y, pageWidth - 28, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8.5);
  doc.text('Month', 17, y + 5.3);
  doc.text('Scheduled', 64, y + 5.3);
  doc.text('Present', 92, y + 5.3);
  doc.text('Absent', 118, y + 5.3);
  doc.text('Holidays', 144, y + 5.3);
  doc.text('Percentage', 170, y + 5.3);
  y += 8;

  doc.setFont('helvetica', 'normal');
  analytics.monthlyBreakdown.forEach((m, idx) => {
    if (idx % 2 === 1) {
      doc.setFillColor(249, 250, 251);
      doc.rect(14, y, pageWidth - 28, 7.2, 'F');
    }
    doc.setTextColor(17, 24, 39);
    doc.text(m.monthName, 17, y + 5);
    doc.text(String(m.scheduledDays), 64, y + 5);
    doc.setTextColor(22, 163, 74);
    doc.text(String(m.presentDays), 92, y + 5);
    doc.setTextColor(220, 38, 38);
    doc.text(String(m.absentDays), 118, y + 5);
    doc.setTextColor(107, 114, 128);
    doc.text(String(m.holidayDays), 144, y + 5);
    doc.setTextColor(17, 24, 39);
    doc.text(m.scheduledDays > 0 ? `${m.percentage.toFixed(1)}%` : '—', 170, y + 5);
    y += 7.2;
  });

  // Selected Month Daily Log (Present / Absent entries)
  const monthEntries = analytics.calendarDays.filter(
    (c) => c.status === 'Present' || c.status === 'Absent'
  );
  y += 8;
  if (y > 240) {
    doc.addPage();
    y = 20;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(17, 24, 39);
  doc.text(
    `Daily Attendance Log — ${MONTH_NAMES[analytics.selectedMonth - 1]} ${analytics.year}`,
    14,
    y
  );
  y += 5;

  if (monthEntries.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    doc.text('No scheduled class days recorded for this month yet.', 14, y + 4);
  } else {
    doc.setFillColor(243, 244, 246);
    doc.rect(14, y, pageWidth - 28, 7.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(55, 65, 81);
    doc.text('Date (IST)', 17, y + 5);
    doc.text('Status', 55, y + 5);
    doc.text('Entry Time', 85, y + 5);
    doc.text('Exit Time', 125, y + 5);
    doc.text('Batch', 162, y + 5);
    y += 7.5;

    doc.setFont('helvetica', 'normal');
    for (const day of monthEntries) {
      if (y > 276) {
        doc.addPage();
        y = 20;
      }
      doc.setTextColor(17, 24, 39);
      doc.text(formatIstDisplayDate(day.date), 17, y + 4.8);
      if (day.status === 'Present') doc.setTextColor(22, 163, 74);
      else doc.setTextColor(220, 38, 38);
      doc.text(day.status, 55, y + 4.8);
      doc.setTextColor(55, 65, 81);
      doc.text(day.record?.entryTimeMs ? formatIstShortTime(day.record.entryTimeMs) : '—', 85, y + 4.8);
      doc.text(day.record?.exitTimeMs ? formatIstShortTime(day.record.exitTimeMs) : '—', 125, y + 4.8);
      doc.text((day.batchTiming || batchTiming).slice(0, 22), 162, y + 4.8);
      y += 6.5;
    }
  }

  // Footer Note
  doc.setFontSize(7.5);
  doc.setTextColor(107, 114, 128);
  doc.text(
    'Note: Only officially scheduled batch class days are counted. Institute holidays and non-scheduled days are never counted as absences.',
    14,
    290
  );

  doc.save(`Attendance_${studentId}_${analytics.year}.pdf`);
}

export function downloadAdminAttendancePdf(params: {
  title: string;
  subtitle: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  summaryPairs: Array<{ label: string; value: string }>;
  settings: InstituteSettings;
  fileName: string;
}): void {
  const { title, subtitle, headers, rows, summaryPairs, settings, fileName } = params;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(109, 40, 217);
  doc.rect(0, 0, pageWidth, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(`${settings.instituteName.toUpperCase()} — ${title}`, 12, 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`${subtitle}  |  Generated: ${formatIstDateTime(new Date())}`, 12, 18.5);

  let y = 30;
  if (summaryPairs.length > 0) {
    const bw = (pageWidth - 24 - (summaryPairs.length - 1) * 4) / summaryPairs.length;
    summaryPairs.forEach((s, i) => {
      const x = 12 + i * (bw + 4);
      doc.setDrawColor(229, 231, 235);
      doc.setFillColor(249, 250, 251);
      doc.roundedRect(x, y, bw, 15, 2, 2, 'FD');
      doc.setFontSize(7.5);
      doc.setTextColor(107, 114, 128);
      doc.text(s.label, x + 3, y + 5.5);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(109, 40, 217);
      doc.text(s.value, x + 3, y + 12);
      doc.setFont('helvetica', 'normal');
    });
    y += 20;
  }

  const colCount = headers.length;
  const tableWidth = pageWidth - 24;
  const colW = tableWidth / Math.max(1, colCount);

  const drawTableHeader = () => {
    doc.setFillColor(109, 40, 217);
    doc.rect(12, y, tableWidth, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    headers.forEach((h, i) => {
      doc.text(h.slice(0, 22), 14 + i * colW, y + 5.3);
    });
    y += 8;
    doc.setFont('helvetica', 'normal');
  };

  drawTableHeader();

  rows.forEach((row, rIdx) => {
    if (y > 192) {
      doc.addPage();
      y = 16;
      drawTableHeader();
    }
    if (rIdx % 2 === 1) {
      doc.setFillColor(249, 250, 251);
      doc.rect(12, y, tableWidth, 6.8, 'F');
    }
    doc.setTextColor(17, 24, 39);
    doc.setFontSize(8);
    row.forEach((cell, cIdx) => {
      const txt = String(cell ?? '—').slice(0, 26);
      doc.text(txt, 14 + cIdx * colW, y + 4.7);
    });
    y += 6.8;
  });

  doc.save(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`);
}
