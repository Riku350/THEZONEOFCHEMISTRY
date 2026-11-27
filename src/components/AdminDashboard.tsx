import React, { useEffect, useMemo, useRef, useState } from 'react';
import { signOut, User } from 'firebase/auth';
import {
  AlertCircle,
  Atom,
  Ban,
  Bell,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Database,
  Download,
  Edit3,
  Eye,
  GraduationCap,
  Home,
  IdCard,
  Image as ImageIcon,
  LayoutDashboard,
  LayoutTemplate,
  Loader2,
  LogOut,
  MoreHorizontal,
  QrCode,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { CLASS_OPTIONS, DEFAULT_SETTINGS, STREAM_OPTIONS } from '../config/defaults';
import { getClientIstNow } from '../lib/attendanceUtils';
import { auth } from '../lib/firebase';
import {
  approveApplicationAndCreateStudent,
  deleteApplicationRecord,
  initializeDefaultCatalogInFirestore,
  markApplicationUnderReview,
  regenerateStudentSecurityCode,
  rejectApplication,
  saveInstituteSettings,
  subscribeAdminCollections,
  syncApprovedStudentsPublicAttendance,
  syncMissingTrackingRecords,
  toggleStudentStatus,
  updateApplicationDetails,
  updateStudentProfile,
} from '../lib/firestoreService';
import { exportStudentsCsv } from '../lib/idCardRenderer';
import {
  AdminTab,
  AdminUserRecord,
  AdmissionApplication,
  AttendanceAuditLog,
  AttendanceHoliday,
  AttendanceRecord,
  BannerItem,
  BatchItem,
  CourseItem,
  FeeRule,
  GalleryItem,
  InstituteSettings,
  NoticeItem,
  PaymentRecord,
  PublicView,
  ScanHistoryEntry,
  StudentClass,
  StudentRecord,
  StudentStream,
} from '../types';
import { AdminAttendancePanel } from './AdminAttendancePanel';
import {
  AdminBannersPanel,
  AdminGalleryPanel,
  AdminNoticesAndCatalogPanel,
  AdminSettingsPanel,
} from './AdminCmsManager';
import { AdminFeeManager } from './AdminFeeManager';
import { AdminQrScanner } from './AdminQrScanner';
import { DigitalIdCardModal } from './DigitalIdCardModal';
import { ResolvedImage } from './ResolvedImage';

interface AdminDashboardProps {
  user: User;
  onNavigatePublic: (view: PublicView) => void;
  onPublicDataChanged: () => void;
}

const inputCls =
  'w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 px-3 py-2 text-xs sm:text-sm text-gray-900 placeholder-gray-400 focus:outline-none transition-colors';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  user,
  onNavigatePublic,
  onPublicDataChanged,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);

  // Live Firestore collections
  const [applications, setApplications] = useState<AdmissionApplication[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [scanHistory, setScanHistory] = useState<ScanHistoryEntry[]>([]);
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [feeRules, setFeeRules] = useState<FeeRule[]>([]);
  const [admins, setAdmins] = useState<AdminUserRecord[]>([]);
  const [settings, setSettings] = useState<InstituteSettings>(DEFAULT_SETTINGS);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [attendanceAuditLogs, setAttendanceAuditLogs] = useState<AttendanceAuditLog[]>([]);
  const [attendanceHolidays, setAttendanceHolidays] = useState<AttendanceHoliday[]>([]);
  const [syncError, setSyncError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [toast, setToast] = useState('');

  // Applications search & filters
  const [appSearch, setAppSearch] = useState('');
  const [appFilterClass, setAppFilterClass] = useState('');
  const [appFilterCourse, setAppFilterCourse] = useState('');
  const [appFilterBatch, setAppFilterBatch] = useState('');
  const [appFilterStatus, setAppFilterStatus] = useState('');

  // Selected Application profile modal & edit/reject/delete state
  const [selectedApp, setSelectedApp] = useState<AdmissionApplication | null>(null);
  const [editingApp, setEditingApp] = useState(false);
  const [editAppForm, setEditAppForm] = useState<Partial<AdmissionApplication>>({});
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [confirmDeleteAppId, setConfirmDeleteAppId] = useState<string | null>(null);

  // Students search & modals
  const [studentSearch, setStudentSearch] = useState('');
  const [studentFilterClass, setStudentFilterClass] = useState('');
  const [studentFilterBatch, setStudentFilterBatch] = useState('');
  const [idCardStudent, setIdCardStudent] = useState<StudentRecord | null>(null);
  const [editingStudent, setEditingStudent] = useState<StudentRecord | null>(null);
  const [editStudentForm, setEditStudentForm] = useState<Partial<StudentRecord>>({});

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 4500);
  };

  useEffect(() => {
    const unsub = subscribeAdminCollections({
      onApplications: setApplications,
      onStudents: (list) => {
        setStudents(list);
        setIdCardStudent((prev) =>
          prev ? list.find((s) => s.studentId === prev.studentId) || prev : null
        );
      },
      onPayments: setPayments,
      onScanHistory: setScanHistory,
      onBanners: setBanners,
      onGallery: setGallery,
      onNotices: setNotices,
      onCourses: setCourses,
      onBatches: setBatches,
      onFees: setFeeRules,
      onAdmins: setAdmins,
      onSettings: setSettings,
      onAttendance: setAttendance,
      onAttendanceAuditLogs: setAttendanceAuditLogs,
      onAttendanceHolidays: setAttendanceHolidays,
      onError: (err) => setSyncError(err.message),
    });

    return () => {
      unsub();
      onPublicDataChanged();
    };
  }, [onPublicDataChanged]);

  const trackingBackfilledRef = useRef(false);
  const attendanceBackfilledRef = useRef(false);

  useEffect(() => {
    if (trackingBackfilledRef.current) return;
    if (applications.length === 0) return;
    trackingBackfilledRef.current = true;
    void syncMissingTrackingRecords(applications, students, settings.academicSession);
  }, [applications, students, settings.academicSession]);

  useEffect(() => {
    if (attendanceBackfilledRef.current) return;
    if (students.length === 0) return;
    attendanceBackfilledRef.current = true;
    const currentIstYear = getClientIstNow().year;
    void syncApprovedStudentsPublicAttendance(students, attendance, batches, currentIstYear);
  }, [students, attendance, batches]);

  useEffect(() => {
    if (!selectedApp) return;
    const latest = applications.find((a) => a.id === selectedApp.id);
    if (latest) setSelectedApp(latest);
  }, [applications, selectedApp]);

  const handleOpenApplicationProfile = (app: AdmissionApplication) => {
    setSelectedApp(app);
    setEditingApp(false);
    setShowRejectBox(false);
    if (app.status === 'pending') {
      void markApplicationUnderReview(app, settings.academicSession);
    }
  };

  // 8 Real Live KPIs (Zero Fake Statistics)
  const kpis = useMemo(() => {
    const todayStr = new Date().toDateString();
    const pendingApps = applications.filter((a) => a.status === 'pending');
    const approvedApps = applications.filter((a) => a.status === 'approved');
    const rejectedApps = applications.filter((a) => a.status === 'rejected');
    const todaysAdmissions = applications.filter((a) => {
      const dt = a.submittedAt?.toDate ? a.submittedAt.toDate() : null;
      return dt ? dt.toDateString() === todayStr : false;
    });

    const totalFeesCollected = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const pendingStudentFees = students.reduce(
      (sum, s) => sum + Math.max(0, (s.feeAmount || 0) - (s.paidAmount || 0)),
      0
    );
    const pendingAppFees = pendingApps.reduce(
      (sum, a) => sum + Math.max(0, (a.feeAmount || 0) - (a.paidAmount || 0)),
      0
    );

    return {
      totalStudents: students.length,
      newApplications: applications.length,
      approvedStudents: students.filter((s) => s.status === 'active').length,
      approvedApplicationsCount: approvedApps.length,
      rejectedApplications: rejectedApps.length,
      pendingApplications: pendingApps.length,
      totalFeesCollected,
      pendingFees: pendingStudentFees + pendingAppFees,
      todaysAdmissions: todaysAdmissions.length,
    };
  }, [applications, students, payments]);

  const filteredApplications = useMemo(() => {
    const q = appSearch.trim().toLowerCase();
    return applications.filter((a) => {
      if (q) {
        const hit =
          a.studentName.toLowerCase().includes(q) ||
          a.studentMobile.includes(q) ||
          a.applicationNumber.toLowerCase().includes(q) ||
          a.fatherName.toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (appFilterClass && a.studentClass !== appFilterClass) return false;
      if (appFilterCourse && a.course !== appFilterCourse) return false;
      if (appFilterBatch && a.batch !== appFilterBatch) return false;
      if (appFilterStatus && a.status !== appFilterStatus) return false;
      return true;
    });
  }, [applications, appSearch, appFilterClass, appFilterCourse, appFilterBatch, appFilterStatus]);

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return students.filter((s) => {
      if (q) {
        const hit =
          s.studentName.toLowerCase().includes(q) ||
          s.studentId.toLowerCase().includes(q) ||
          s.studentMobile.includes(q) ||
          s.securityCode.includes(q);
        if (!hit) return false;
      }
      if (studentFilterClass && s.studentClass !== studentFilterClass) return false;
      if (studentFilterBatch && s.batch !== studentFilterBatch) return false;
      return true;
    });
  }, [students, studentSearch, studentFilterClass, studentFilterBatch]);

  const handleInitCatalog = async () => {
    setActionBusy(true);
    try {
      await initializeDefaultCatalogInFirestore();
      onPublicDataChanged();
      showToast('Default Courses, Batches, Banners, Gallery, Notices & Settings synced.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleApproveApp = async (app: AdmissionApplication) => {
    setActionBusy(true);
    try {
      const createdStudent = await approveApplicationAndCreateStudent(
        app,
        user.email || 'admin',
        settings.academicSession
      );
      setSelectedApp(null);
      setIdCardStudent(createdStudent);
      showToast(
        `Approved ${createdStudent.studentName}. Student ID ${createdStudent.studentId} & Code ${createdStudent.securityCode} generated.`
      );
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Approval failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleRejectApp = async (app: AdmissionApplication) => {
    setActionBusy(true);
    try {
      await rejectApplication(app, rejectReason || 'Application rejected after review.');
      setShowRejectBox(false);
      setRejectReason('');
      showToast(`Application ${app.applicationNumber} rejected.`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleSaveAppEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedApp) return;
    setActionBusy(true);
    try {
      await updateApplicationDetails(selectedApp, editAppForm);
      setEditingApp(false);
      showToast('Application updated.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteApp = async (app: AdmissionApplication) => {
    setActionBusy(true);
    try {
      await deleteApplicationRecord(app);
      setConfirmDeleteAppId(null);
      if (selectedApp?.id === app.id) setSelectedApp(null);
      showToast(`Deleted application ${app.applicationNumber}.`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleSaveStudentEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;
    setActionBusy(true);
    try {
      await updateStudentProfile(editingStudent, editStudentForm);
      setEditingStudent(null);
      showToast(`Updated profile for ${editingStudent.studentName}.`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleRegenerateCode = async (student: StudentRecord) => {
    const newCode = await regenerateStudentSecurityCode(student);
    showToast(`New 4-digit security code for ${student.studentName}: ${newCode}`);
  };

  const navItems: { id: AdminTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    {
      id: 'applications',
      label: 'Applications',
      icon: <ClipboardList className="w-4 h-4" />,
      badge: kpis.pendingApplications > 0 ? kpis.pendingApplications : undefined,
    },
    { id: 'students', label: 'Students', icon: <GraduationCap className="w-4 h-4" /> },
    { id: 'attendance', label: 'Attendance', icon: <CalendarCheck className="w-4 h-4" /> },
    { id: 'scanner', label: 'QR Scanner', icon: <QrCode className="w-4 h-4" /> },
    { id: 'fees', label: 'Fees', icon: <CreditCard className="w-4 h-4" /> },
    { id: 'banners', label: 'Banners', icon: <LayoutTemplate className="w-4 h-4" /> },
    { id: 'gallery', label: 'Gallery', icon: <ImageIcon className="w-4 h-4" /> },
    { id: 'notices', label: 'Notices & Courses', icon: <Bell className="w-4 h-4" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  const moreMenuTabs: AdminTab[] = ['students', 'fees', 'banners', 'gallery', 'notices', 'settings'];
  const isMoreTabActive = moreMenuTabs.includes(activeTab);

  const uniqueCourseNames = Array.from(
    new Set([...courses.map((c) => c.title), ...applications.map((a) => a.course)])
  );
  const uniqueBatchNames = Array.from(
    new Set([...batches.map((b) => b.timing), ...applications.map((a) => a.batch)])
  );

  // Real-data ratios for minimal charts
  const totalAppCount = applications.length;
  const approvedPct = totalAppCount > 0 ? Math.round((kpis.approvedApplicationsCount / totalAppCount) * 100) : 0;
  const pendingPct = totalAppCount > 0 ? Math.round((kpis.pendingApplications / totalAppCount) * 100) : 0;
  const rejectedPct = totalAppCount > 0 ? Math.max(0, 100 - approvedPct - pendingPct) : 0;

  const totalFeeVolume = kpis.totalFeesCollected + kpis.pendingFees;
  const collectedPct =
    totalFeeVolume > 0 ? Math.round((kpis.totalFeesCollected / totalFeeVolume) * 100) : 0;

  const currentTabLabel = navItems.find((n) => n.id === activeTab)?.label || 'Overview';

  return (
    <div className="min-h-screen bg-white text-gray-900 flex">
      {/* Desktop White Sidebar */}
      <aside className="no-print hidden lg:flex lg:flex-col w-60 shrink-0 border-r border-gray-200 bg-white sticky top-0 h-screen">
        <div className="px-4 h-14 border-b border-gray-200 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0">
            <Atom className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="font-display text-xs font-bold text-gray-900 truncate">
              {settings.instituteName}
            </p>
            <p className="text-[11px] text-violet-700 font-medium">Admin Panel</p>
          </div>
        </div>

        <nav className="flex-1 px-2.5 py-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === item.id
                  ? 'bg-violet-50 text-violet-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <span className="flex items-center gap-2.5 whitespace-nowrap">
                {item.icon}
                {item.label}
              </span>
              {item.badge !== undefined && (
                <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-violet-600 text-white tabular-nums">
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-200 space-y-1.5">
          <div className="px-2 pb-1.5">
            <p className="text-xs font-semibold text-gray-900 truncate">
              {user.displayName || 'Institute Admin'}
            </p>
            <p className="text-[11px] text-gray-500 truncate">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              onPublicDataChanged();
              onNavigatePublic('home');
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 hover:bg-gray-100 text-xs font-semibold text-gray-700 transition-colors cursor-pointer"
          >
            <Home className="w-4 h-4 text-gray-500" />
            Public Website
          </button>
          <button
            type="button"
            onClick={() => void signOut(auth)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-red-50 text-xs font-semibold text-red-600 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        {/* Compact Top Workspace Bar */}
        <header className="no-print sticky top-0 z-30 h-14 border-b border-gray-200 bg-white/95 backdrop-blur-sm px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="lg:hidden w-7 h-7 rounded-lg bg-violet-600 text-white flex items-center justify-center shrink-0">
              <Atom className="w-4 h-4" />
            </div>
            <span className="text-xs sm:text-sm font-semibold text-gray-900 truncate">
              {currentTabLabel}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('scanner')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              <QrCode className="w-3.5 h-3.5" />
              Scan ID
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 pb-20 lg:pb-8 max-w-6xl w-full mx-auto space-y-5">
          {toast && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-center justify-between gap-3 text-xs sm:text-sm text-emerald-800">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{toast}</span>
              </div>
              <button
                type="button"
                onClick={() => setToast('')}
                className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {syncError && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex items-start justify-between gap-3 text-xs text-red-700">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span className="break-words">{syncError}</span>
              </div>
              <button
                type="button"
                onClick={() => setSyncError('')}
                className="text-red-600 hover:text-red-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* =============================================================== */}
          {/* TAB 1: OVERVIEW (8 LIVE KPIs + 2 MINIMAL REAL-DATA CHARTS)      */}
          {/* =============================================================== */}
          {activeTab === 'overview' && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h1 className="font-display text-lg sm:text-xl font-bold text-gray-900">
                    Institute Overview
                  </h1>
                  <p className="text-xs sm:text-sm text-gray-500">
                    Live statistics from Firebase Firestore.
                  </p>
                </div>

                {courses.length === 0 && (
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => void handleInitCatalog()}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-violet-50 hover:bg-violet-100 border border-violet-200 text-violet-700 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {actionBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Database className="w-3.5 h-3.5" />
                    )}
                    Sync Default Courses & Batches
                  </button>
                )}
              </div>

              {/* 8 Compact Live Stat Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: 'Total Students', value: kpis.totalStudents, tone: 'text-gray-900' },
                  { label: 'Applications', value: kpis.newApplications, tone: 'text-violet-700' },
                  { label: 'Active Students', value: kpis.approvedStudents, tone: 'text-emerald-600' },
                  { label: 'Pending Apps', value: kpis.pendingApplications, tone: 'text-amber-600' },
                  { label: 'Rejected Apps', value: kpis.rejectedApplications, tone: 'text-red-600' },
                  {
                    label: 'Fees Collected',
                    value: `₹${kpis.totalFeesCollected.toLocaleString('en-IN')}`,
                    tone: 'text-emerald-600',
                  },
                  {
                    label: 'Pending Fees',
                    value: `₹${kpis.pendingFees.toLocaleString('en-IN')}`,
                    tone: 'text-amber-600',
                  },
                  { label: "Today's Apps", value: kpis.todaysAdmissions, tone: 'text-violet-700' },
                ].map((stat) => (
                  <div key={stat.label} className="app-card rounded-2xl p-4">
                    <p className="text-[11px] sm:text-xs text-gray-500 font-medium">{stat.label}</p>
                    <p className={`mt-1.5 font-mono text-xl sm:text-2xl font-bold tabular-nums ${stat.tone}`}>
                      {stat.value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Minimal Real-Data Charts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Chart 1: Application Status Distribution */}
                <div className="app-card rounded-2xl p-4 sm:p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-sm font-bold text-gray-900">
                      Application Breakdown
                    </h2>
                    <span className="text-xs font-mono text-gray-500 tabular-nums">
                      {totalAppCount} total
                    </span>
                  </div>

                  {totalAppCount === 0 ? (
                    <p className="text-xs text-gray-400 py-3">No applications submitted yet.</p>
                  ) : (
                    <>
                      <div className="h-2.5 w-full rounded-full bg-gray-100 overflow-hidden flex">
                        {approvedPct > 0 && (
                          <div
                            className="h-full bg-emerald-500 transition-all"
                            style={{ width: `${approvedPct}%` }}
                          />
                        )}
                        {pendingPct > 0 && (
                          <div
                            className="h-full bg-amber-400 transition-all"
                            style={{ width: `${pendingPct}%` }}
                          />
                        )}
                        {rejectedPct > 0 && (
                          <div
                            className="h-full bg-red-400 transition-all"
                            style={{ width: `${rejectedPct}%` }}
                          />
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                        <div>
                          <p className="text-gray-500">Approved</p>
                          <p className="font-mono font-semibold text-emerald-600 tabular-nums">
                            {kpis.approvedApplicationsCount} ({approvedPct}%)
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-500">Pending</p>
                          <p className="font-mono font-semibold text-amber-600 tabular-nums">
                            {kpis.pendingApplications} ({pendingPct}%)
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-500">Rejected</p>
                          <p className="font-mono font-semibold text-red-600 tabular-nums">
                            {kpis.rejectedApplications} ({rejectedPct}%)
                          </p>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Chart 2: Fee Collection Progress */}
                <div className="app-card rounded-2xl p-4 sm:p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-sm font-bold text-gray-900">
                      Fee Collection Progress
                    </h2>
                    <span className="text-xs font-mono font-semibold text-violet-700 tabular-nums">
                      {collectedPct}%
                    </span>
                  </div>

                  {totalFeeVolume === 0 ? (
                    <p className="text-xs text-gray-400 py-3">No fee records yet.</p>
                  ) : (
                    <>
                      <div className="h-2.5 w-full rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full bg-violet-600 rounded-full transition-all"
                          style={{ width: `${collectedPct}%` }}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                        <div>
                          <p className="text-gray-500">Collected</p>
                          <p className="font-mono font-semibold text-emerald-600 tabular-nums">
                            ₹{kpis.totalFeesCollected.toLocaleString('en-IN')}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-gray-500">Pending</p>
                          <p className="font-mono font-semibold text-amber-600 tabular-nums">
                            ₹{kpis.pendingFees.toLocaleString('en-IN')}
                          </p>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Pending Applications Quick List */}
              <div className="app-card rounded-2xl p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-display text-sm sm:text-base font-bold text-gray-900">
                    Pending Applications
                  </h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab('applications')}
                    className="text-xs font-semibold text-violet-700 hover:text-violet-900 cursor-pointer"
                  >
                    View All →
                  </button>
                </div>

                {applications.filter((a) => a.status === 'pending').length === 0 ? (
                  <p className="text-xs sm:text-sm text-gray-500 py-6 text-center">
                    No pending applications right now.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs sm:text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-xs text-gray-500">
                          <th className="pb-2.5 font-medium">App No.</th>
                          <th className="pb-2.5 font-medium">Student</th>
                          <th className="pb-2.5 font-medium">Course</th>
                          <th className="pb-2.5 font-medium">Batch</th>
                          <th className="pb-2.5 font-medium text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-gray-700">
                        {applications
                          .filter((a) => a.status === 'pending')
                          .slice(0, 8)
                          .map((app) => (
                            <tr key={app.id} className="hover:bg-gray-50/70">
                              <td className="py-2.5 font-mono text-xs text-violet-700">
                                {app.applicationNumber}
                              </td>
                              <td className="py-2.5">
                                <p className="font-semibold text-gray-900">{app.studentName}</p>
                                <p className="text-[11px] font-mono text-gray-500">
                                  {app.studentMobile}
                                </p>
                              </td>
                              <td className="py-2.5 text-xs text-gray-600">
                                {app.studentClass} · {app.course}
                              </td>
                              <td className="py-2.5 text-xs text-gray-600">{app.batch}</td>
                              <td className="py-2.5 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleOpenApplicationProfile(app)}
                                  className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold cursor-pointer"
                                >
                                  Review
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* TAB 2: APPLICATION MANAGEMENT                                   */}
          {/* =============================================================== */}
          {activeTab === 'applications' && (
            <div className="space-y-4">
              <div>
                <h1 className="font-display text-lg sm:text-xl font-bold text-gray-900">
                  Applications ({filteredApplications.length})
                </h1>
                <p className="text-xs sm:text-sm text-gray-500">
                  Review documents, approve to issue ID cards, or reject applications.
                </p>
              </div>

              {/* Search & Filter Bar */}
              <div className="app-card rounded-2xl p-3.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={appSearch}
                    onChange={(e) => setAppSearch(e.target.value)}
                    placeholder="Name, phone, app no..."
                    className="w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 pl-9 pr-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
                  />
                </div>
                <select
                  value={appFilterClass}
                  onChange={(e) => setAppFilterClass(e.target.value)}
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
                  value={appFilterCourse}
                  onChange={(e) => setAppFilterCourse(e.target.value)}
                  className={inputCls}
                >
                  <option value="">All Courses</option>
                  {uniqueCourseNames.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <select
                  value={appFilterBatch}
                  onChange={(e) => setAppFilterBatch(e.target.value)}
                  className={inputCls}
                >
                  <option value="">All Batches</option>
                  {uniqueBatchNames.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <select
                  value={appFilterStatus}
                  onChange={(e) => setAppFilterStatus(e.target.value)}
                  className={inputCls}
                >
                  <option value="">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>

              <div className="app-card rounded-2xl p-4 sm:p-5">
                {filteredApplications.length === 0 ? (
                  <p className="text-xs sm:text-sm text-gray-500 py-8 text-center">
                    No applications match your filters.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs sm:text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-xs text-gray-500">
                          <th className="pb-2.5 font-medium">App No.</th>
                          <th className="pb-2.5 font-medium">Student</th>
                          <th className="pb-2.5 font-medium">Course & Batch</th>
                          <th className="pb-2.5 font-medium">Fee</th>
                          <th className="pb-2.5 font-medium">Status</th>
                          <th className="pb-2.5 font-medium text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-gray-700">
                        {filteredApplications.map((app) => (
                          <tr key={app.id} className="hover:bg-gray-50/70">
                            <td className="py-3 font-mono text-xs text-violet-700 whitespace-nowrap">
                              {app.applicationNumber}
                              <div className="text-[11px] text-gray-400 mt-0.5 tabular-nums">
                                {app.submittedAt?.toDate
                                  ? app.submittedAt.toDate().toLocaleDateString('en-IN')
                                  : 'Today'}
                              </div>
                            </td>
                            <td className="py-3">
                              <p className="font-semibold text-gray-900">{app.studentName}</p>
                              <p className="text-[11px] text-gray-500">
                                {app.fatherName} ·{' '}
                                <span className="font-mono">{app.studentMobile}</span>
                              </p>
                            </td>
                            <td className="py-3 text-xs">
                              <p className="font-medium text-gray-900">{app.course}</p>
                              <p className="text-gray-500">
                                {app.studentClass} · {app.batch}
                              </p>
                            </td>
                            <td className="py-3 font-mono text-xs tabular-nums">
                              <p className="text-gray-900">₹{app.feeAmount.toLocaleString('en-IN')}</p>
                              <p className="text-gray-500">{app.paymentStatus}</p>
                            </td>
                            <td className="py-3">
                              <span
                                className={`text-xs font-semibold uppercase ${
                                  app.status === 'approved'
                                    ? 'text-emerald-600'
                                    : app.status === 'rejected'
                                    ? 'text-red-600'
                                    : 'text-amber-600'
                                }`}
                              >
                                {app.status}
                              </span>
                            </td>
                            <td className="py-3 text-right whitespace-nowrap space-x-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenApplicationProfile(app)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 border border-violet-200 text-violet-700 text-xs font-semibold cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                Profile
                              </button>
                              {confirmDeleteAppId === app.id ? (
                                <button
                                  type="button"
                                  disabled={actionBusy}
                                  onClick={() => void handleDeleteApp(app)}
                                  className="px-2.5 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold cursor-pointer"
                                >
                                  Confirm
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  aria-label="Delete application"
                                  onClick={() => setConfirmDeleteAppId(app.id)}
                                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* TAB 3: APPROVED STUDENTS & DIGITAL ID CARDS                     */}
          {/* =============================================================== */}
          {activeTab === 'students' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h1 className="font-display text-lg sm:text-xl font-bold text-gray-900">
                    Approved Students ({filteredStudents.length})
                  </h1>
                  <p className="text-xs sm:text-sm text-gray-500">
                    View ID cards, edit student details, suspend/reactivate, or export CSV.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={students.length === 0}
                  onClick={() => exportStudentsCsv(students)}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 disabled:opacity-40 text-gray-700 text-xs font-semibold whitespace-nowrap cursor-pointer"
                >
                  <Download className="w-4 h-4 text-violet-600" />
                  Export CSV
                </button>
              </div>

              <div className="app-card rounded-2xl p-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    placeholder="Name, ID, phone, or 4-digit code..."
                    className="w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 pl-9 pr-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
                  />
                </div>
                <select
                  value={studentFilterClass}
                  onChange={(e) => setStudentFilterClass(e.target.value)}
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
                  value={studentFilterBatch}
                  onChange={(e) => setStudentFilterBatch(e.target.value)}
                  className={inputCls}
                >
                  <option value="">All Batches</option>
                  {uniqueBatchNames.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              <div className="app-card rounded-2xl p-4 sm:p-5">
                {filteredStudents.length === 0 ? (
                  <p className="text-xs sm:text-sm text-gray-500 py-8 text-center">
                    No approved students yet. Approve a pending application to generate an ID card.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs sm:text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-xs text-gray-500">
                          <th className="pb-2.5 font-medium">ID & Code</th>
                          <th className="pb-2.5 font-medium">Student</th>
                          <th className="pb-2.5 font-medium">Course & Batch</th>
                          <th className="pb-2.5 font-medium">Fees</th>
                          <th className="pb-2.5 font-medium">Status</th>
                          <th className="pb-2.5 font-medium text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-gray-700">
                        {filteredStudents.map((st) => (
                          <tr key={st.studentId} className="hover:bg-gray-50/70">
                            <td className="py-3 font-mono text-xs whitespace-nowrap">
                              <p className="font-bold text-violet-700">{st.studentId}</p>
                              <p className="text-gray-500 mt-0.5 tabular-nums">
                                PIN: {st.securityCode}
                              </p>
                            </td>
                            <td className="py-3">
                              <p className="font-semibold text-gray-900">{st.studentName}</p>
                              <p className="text-[11px] text-gray-500">
                                {st.fatherName} · <span className="font-mono">{st.studentMobile}</span>
                              </p>
                            </td>
                            <td className="py-3 text-xs">
                              <p className="text-gray-900 font-medium">{st.course}</p>
                              <p className="text-gray-500">
                                {st.studentClass} · {st.batch}
                              </p>
                            </td>
                            <td className="py-3 font-mono text-xs tabular-nums">
                              <p className="text-gray-900">
                                ₹{st.paidAmount.toLocaleString('en-IN')} / ₹
                                {st.feeAmount.toLocaleString('en-IN')}
                              </p>
                              <p
                                className={
                                  st.paymentStatus === 'PAID'
                                    ? 'text-emerald-600 font-semibold'
                                    : st.paymentStatus === 'PARTIAL'
                                    ? 'text-amber-600 font-semibold'
                                    : 'text-red-600 font-semibold'
                                }
                              >
                                {st.paymentStatus}
                              </p>
                            </td>
                            <td className="py-3">
                              <span
                                className={`text-xs font-semibold uppercase ${
                                  st.status === 'active' ? 'text-emerald-600' : 'text-red-600'
                                }`}
                              >
                                {st.status}
                              </span>
                            </td>
                            <td className="py-3 text-right whitespace-nowrap space-x-1.5">
                              <button
                                type="button"
                                onClick={() => setIdCardStudent(st)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold cursor-pointer"
                              >
                                <IdCard className="w-3.5 h-3.5" />
                                ID Card
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingStudent(st);
                                  setEditStudentForm(st);
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void toggleStudentStatus(st)}
                                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                                  st.status === 'active'
                                    ? 'bg-red-50 hover:bg-red-100 text-red-600'
                                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                                }`}
                              >
                                {st.status === 'active' ? (
                                  <>
                                    <Ban className="w-3.5 h-3.5" />
                                    Suspend
                                  </>
                                ) : (
                                  <>
                                    <ShieldCheck className="w-3.5 h-3.5" />
                                    Activate
                                  </>
                                )}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: ATTENDANCE MANAGEMENT */}
          {activeTab === 'attendance' && (
            <AdminAttendancePanel
              adminEmail={user.email || 'admin'}
              students={students}
              batches={batches}
              courses={courses}
              attendance={attendance}
              auditLogs={attendanceAuditLogs}
              holidays={attendanceHolidays}
              settings={settings}
              onOpenScanner={() => setActiveTab('scanner')}
              onToast={showToast}
            />
          )}

          {/* TAB 5: AUTOMATIC QR ATTENDANCE SCANNER */}
          {activeTab === 'scanner' && (
            <AdminQrScanner
              adminEmail={user.email || 'admin'}
              batches={batches}
              attendance={attendance}
              scanHistory={scanHistory}
              settings={settings}
              onToggleExitTracking={async (enabled) => {
                const { id: _id, updatedAt: _u, ...rest } = settings;
                await saveInstituteSettings({ ...rest, attendanceExitTracking: enabled });
                showToast(
                  enabled
                    ? 'Separate Entry & Exit QR tracking enabled.'
                    : 'Single daily attendance scan mode enabled.'
                );
              }}
            />
          )}

          {/* TAB 5: FEE MANAGEMENT */}
          {activeTab === 'fees' && (
            <AdminFeeManager
              adminEmail={user.email || 'admin'}
              settings={settings}
              students={students}
              applications={applications}
              courses={courses}
              batches={batches}
              feeRules={feeRules}
              payments={payments}
            />
          )}

          {/* TAB 6: BANNER MANAGEMENT */}
          {activeTab === 'banners' && <AdminBannersPanel banners={banners} />}

          {/* TAB 7: GALLERY MANAGEMENT */}
          {activeTab === 'gallery' && <AdminGalleryPanel gallery={gallery} />}

          {/* TAB 8: NOTICES, COURSES & BATCHES */}
          {activeTab === 'notices' && (
            <AdminNoticesAndCatalogPanel
              notices={notices}
              courses={courses}
              batches={batches}
            />
          )}

          {/* TAB 9: SETTINGS & ADMINS */}
          {activeTab === 'settings' && (
            <AdminSettingsPanel settings={settings} admins={admins} />
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="no-print lg:hidden fixed bottom-0 left-0 right-0 z-30 h-14 pb-safe bg-white/95 backdrop-blur-sm border-t border-gray-200 grid grid-cols-5">
        {(
          [
            { id: 'overview', label: 'Overview', icon: LayoutDashboard },
            { id: 'applications', label: 'Apps', icon: ClipboardList, badge: kpis.pendingApplications },
            { id: 'attendance', label: 'Attend', icon: CalendarCheck },
            { id: 'scanner', label: 'Scan', icon: QrCode },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setMoreSheetOpen(false);
              }}
              className={`relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold cursor-pointer ${
                active ? 'text-violet-700' : 'text-gray-500'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              {'badge' in tab && tab.badge > 0 && (
                <span className="absolute top-1.5 right-3 min-w-[16px] h-4 px-1 rounded-full bg-violet-600 text-white text-[9px] font-mono font-bold flex items-center justify-center tabular-nums">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setMoreSheetOpen(true)}
          className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold cursor-pointer ${
            isMoreTabActive || moreSheetOpen ? 'text-violet-700' : 'text-gray-500'
          }`}
        >
          <MoreHorizontal className="w-4 h-4" />
          <span>More</span>
        </button>
      </nav>

      {/* Mobile "More" Bottom Sheet */}
      {moreSheetOpen && (
        <div
          className="no-print lg:hidden fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-end"
          onClick={() => setMoreSheetOpen(false)}
        >
          <div
            className="w-full bg-white rounded-t-3xl border-t border-gray-200 p-5 pb-safe space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-display text-sm font-bold text-gray-900">Admin Tools</p>
                <p className="text-[11px] text-gray-500 truncate">{user.email}</p>
              </div>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMoreSheetOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {navItems
                .filter((i) => moreMenuTabs.includes(i.id))
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMoreSheetOpen(false);
                    }}
                    className={`flex items-center gap-2.5 px-3.5 py-3 rounded-2xl border text-xs font-semibold cursor-pointer ${
                      activeTab === item.id
                        ? 'bg-violet-50 border-violet-200 text-violet-700'
                        : 'bg-gray-50 border-gray-200 text-gray-800'
                    }`}
                  >
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </button>
                ))}
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => {
                  setMoreSheetOpen(false);
                  onPublicDataChanged();
                  onNavigatePublic('home');
                }}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gray-100 text-xs font-semibold text-gray-700 cursor-pointer"
              >
                <Home className="w-4 h-4" />
                Public Site
              </button>
              <button
                type="button"
                onClick={() => void signOut(auth)}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-50 text-xs font-semibold text-red-600 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* APPLICATION PROFILE & APPROVAL MODAL                              */}
      {/* ================================================================= */}
      {selectedApp && (
        <div
          className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setSelectedApp(null)}
        >
          <div
            className="max-w-4xl w-full bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-mono text-violet-700">
                  {selectedApp.applicationNumber} · {selectedApp.status.toUpperCase()}
                </p>
                <h3 className="font-display text-lg font-bold text-gray-900">
                  {selectedApp.studentName}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {!editingApp && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditAppForm(selectedApp);
                      setEditingApp(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Close modal"
                  onClick={() => setSelectedApp(null)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-5 max-h-[75vh] overflow-y-auto space-y-5">
              {editingApp ? (
                <form onSubmit={handleSaveAppEdit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Student Name
                      </label>
                      <input
                        type="text"
                        required
                        value={editAppForm.studentName || ''}
                        onChange={(e) =>
                          setEditAppForm({ ...editAppForm, studentName: e.target.value })
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Student Mobile
                      </label>
                      <input
                        type="text"
                        required
                        value={editAppForm.studentMobile || ''}
                        onChange={(e) =>
                          setEditAppForm({ ...editAppForm, studentMobile: e.target.value })
                        }
                        className={`${inputCls} font-mono`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Class</label>
                      <select
                        value={editAppForm.studentClass || 'Class 12'}
                        onChange={(e) =>
                          setEditAppForm({
                            ...editAppForm,
                            studentClass: e.target.value as StudentClass,
                          })
                        }
                        className={inputCls}
                      >
                        {CLASS_OPTIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Stream</label>
                      <select
                        value={editAppForm.stream || 'Science'}
                        onChange={(e) =>
                          setEditAppForm({
                            ...editAppForm,
                            stream: e.target.value as StudentStream,
                          })
                        }
                        className={inputCls}
                      >
                        {STREAM_OPTIONS.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Course</label>
                      <input
                        type="text"
                        value={editAppForm.course || ''}
                        onChange={(e) => setEditAppForm({ ...editAppForm, course: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Batch Timing
                      </label>
                      <input
                        type="text"
                        value={editAppForm.batch || ''}
                        onChange={(e) => setEditAppForm({ ...editAppForm, batch: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Course Fee (INR)
                      </label>
                      <input
                        type="number"
                        value={editAppForm.feeAmount ?? 5500}
                        onChange={(e) =>
                          setEditAppForm({ ...editAppForm, feeAmount: Number(e.target.value) })
                        }
                        className={`${inputCls} font-mono`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
                      <input
                        type="text"
                        value={editAppForm.address || ''}
                        onChange={(e) =>
                          setEditAppForm({ ...editAppForm, address: e.target.value })
                        }
                        className={inputCls}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 pt-2">
                    <button
                      type="submit"
                      disabled={actionBusy}
                      className="px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold cursor-pointer"
                    >
                      Save Changes
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingApp(false)}
                      className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  {/* Uploaded Documents Preview */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    <div className="rounded-xl bg-gray-50 border border-gray-200 p-3">
                      <p className="text-xs font-semibold text-violet-700 mb-2">Passport Photo</p>
                      <div className="aspect-[4/5] rounded-lg overflow-hidden bg-white border border-gray-200">
                        <ResolvedImage
                          url={selectedApp.photoUrl}
                          mediaId={selectedApp.photoMediaId}
                          isPrivate
                          alt={`${selectedApp.studentName} photo`}
                          className="w-full h-full object-cover"
                          fallbackLabel="No Photo"
                        />
                      </div>
                    </div>

                    <div className="rounded-xl bg-gray-50 border border-gray-200 p-3">
                      <p className="text-xs font-semibold text-violet-700 mb-2">Identity Proof</p>
                      <div className="aspect-[4/5] rounded-lg overflow-hidden bg-white border border-gray-200">
                        <ResolvedImage
                          url={selectedApp.idProofUrl}
                          mediaId={selectedApp.idProofMediaId}
                          isPrivate
                          alt={`${selectedApp.studentName} identity proof`}
                          className="w-full h-full object-contain"
                          fallbackLabel="No ID Proof"
                        />
                      </div>
                    </div>

                    <div className="rounded-xl bg-gray-50 border border-gray-200 p-3">
                      <p className="text-xs font-semibold text-gray-600 mb-2">Marksheet</p>
                      <div className="aspect-[4/5] rounded-lg overflow-hidden bg-white border border-gray-200">
                        <ResolvedImage
                          url={selectedApp.marksheetUrl}
                          mediaId={selectedApp.marksheetMediaId}
                          isPrivate
                          alt={`${selectedApp.studentName} marksheet`}
                          className="w-full h-full object-contain"
                          fallbackLabel="Not Uploaded"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Personal & Academic Details */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 text-xs sm:text-sm bg-gray-50 border border-gray-200 rounded-xl p-4">
                    <div>
                      <p className="text-xs text-gray-500">Student Mobile</p>
                      <p className="font-mono text-gray-900">{selectedApp.studentMobile}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">WhatsApp</p>
                      <p className="font-mono text-gray-900">{selectedApp.studentWhatsapp}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">DOB & Gender</p>
                      <p className="text-gray-900">
                        {selectedApp.dob} · {selectedApp.gender}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Father</p>
                      <p className="text-gray-900">
                        {selectedApp.fatherName} ({selectedApp.fatherMobile})
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Mother</p>
                      <p className="text-gray-900">
                        {selectedApp.motherName} ({selectedApp.motherMobile})
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Class & Stream</p>
                      <p className="text-gray-900">
                        {selectedApp.studentClass} · {selectedApp.stream}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Course & Batch</p>
                      <p className="text-violet-700 font-semibold">
                        {selectedApp.course} · {selectedApp.batch}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Fee Status</p>
                      <p className="font-mono text-gray-900 tabular-nums">
                        ₹{selectedApp.paidAmount.toLocaleString('en-IN')} / ₹
                        {selectedApp.feeAmount.toLocaleString('en-IN')} ({selectedApp.paymentStatus})
                      </p>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <p className="text-xs text-gray-500">Address</p>
                      <p className="text-gray-800">
                        {selectedApp.address}, Village: {selectedApp.village}, PO:{' '}
                        {selectedApp.postOffice}, Dist: {selectedApp.district}, {selectedApp.state}{' '}
                        - {selectedApp.pinCode}
                      </p>
                    </div>
                  </div>

                  {/* Reject Remarks Box */}
                  {showRejectBox && (
                    <div className="rounded-xl bg-red-50 border border-red-200 p-4 space-y-3">
                      <p className="text-xs font-semibold text-red-700">
                        Rejection Reason (shown on Track Application page)
                      </p>
                      <input
                        type="text"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="e.g., Unclear identity proof — please resubmit."
                        className="w-full rounded-xl bg-white border border-red-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-red-400"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => void handleRejectApp(selectedApp)}
                          className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer"
                        >
                          Confirm Reject
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowRejectBox(false)}
                          className="px-3 py-2 rounded-xl bg-white border border-gray-200 text-xs font-semibold text-gray-700 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Footer Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-gray-200">
                    {selectedApp.status !== 'approved' ? (
                      <div className="flex flex-wrap items-center gap-2.5">
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => void handleApproveApp(selectedApp)}
                          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold cursor-pointer"
                        >
                          {actionBusy ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4" />
                          )}
                          Approve & Generate ID Card
                        </button>
                        {selectedApp.status !== 'rejected' && !showRejectBox && (
                          <button
                            type="button"
                            onClick={() => setShowRejectBox(true)}
                            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-xs sm:text-sm font-semibold cursor-pointer"
                          >
                            <XCircle className="w-4 h-4" />
                            Reject
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs font-semibold text-emerald-700">
                        Approved · Student ID: {selectedApp.studentId}
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={() => setSelectedApp(null)}
                      className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* EDIT APPROVED STUDENT MODAL                                       */}
      {/* ================================================================= */}
      {editingStudent && (
        <div
          className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setEditingStudent(null)}
        >
          <form
            onSubmit={handleSaveStudentEdit}
            onClick={(e) => e.stopPropagation()}
            className="max-w-xl w-full bg-white border border-gray-200 rounded-2xl shadow-xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-gray-200">
              <div>
                <h3 className="font-display text-base font-bold text-gray-900">Edit Student</h3>
                <p className="text-xs font-mono text-violet-700">{editingStudent.studentId}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingStudent(null)}
                className="p-1.5 text-gray-400 hover:text-gray-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Student Name</label>
                <input
                  type="text"
                  required
                  value={editStudentForm.studentName || ''}
                  onChange={(e) =>
                    setEditStudentForm({ ...editStudentForm, studentName: e.target.value })
                  }
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Father&apos;s Name
                </label>
                <input
                  type="text"
                  required
                  value={editStudentForm.fatherName || ''}
                  onChange={(e) =>
                    setEditStudentForm({ ...editStudentForm, fatherName: e.target.value })
                  }
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Mobile</label>
                <input
                  type="text"
                  required
                  value={editStudentForm.studentMobile || ''}
                  onChange={(e) =>
                    setEditStudentForm({ ...editStudentForm, studentMobile: e.target.value })
                  }
                  className={`${inputCls} font-mono`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Class</label>
                <select
                  value={editStudentForm.studentClass || 'Class 12'}
                  onChange={(e) =>
                    setEditStudentForm({ ...editStudentForm, studentClass: e.target.value })
                  }
                  className={inputCls}
                >
                  {CLASS_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Course</label>
                <input
                  type="text"
                  value={editStudentForm.course || ''}
                  onChange={(e) =>
                    setEditStudentForm({ ...editStudentForm, course: e.target.value })
                  }
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Batch</label>
                <select
                  value={editStudentForm.batch || ''}
                  onChange={(e) =>
                    setEditStudentForm({ ...editStudentForm, batch: e.target.value })
                  }
                  className={inputCls}
                >
                  {uniqueBatchNames.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
                <input
                  type="text"
                  value={editStudentForm.address || ''}
                  onChange={(e) =>
                    setEditStudentForm({ ...editStudentForm, address: e.target.value })
                  }
                  className={inputCls}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-200">
              <button
                type="button"
                onClick={() => setEditingStudent(null)}
                className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionBusy}
                className="px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold cursor-pointer"
              >
                Save Profile
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ================================================================= */}
      {/* DIGITAL STUDENT ID CARD MODAL                                     */}
      {/* ================================================================= */}
      {idCardStudent && (
        <DigitalIdCardModal
          student={idCardStudent}
          settings={settings}
          onClose={() => setIdCardStudent(null)}
          onRegenerateCode={handleRegenerateCode}
        />
      )}
    </div>
  );
};
