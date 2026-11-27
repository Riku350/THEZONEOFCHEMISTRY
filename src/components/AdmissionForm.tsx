import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Copy,
  FileText,
  IndianRupee,
  Loader2,
  Upload,
  User,
  UserCheck,
} from 'lucide-react';
import { CLASS_OPTIONS, INDIAN_STATES, STREAM_OPTIONS } from '../config/defaults';
import {
  calculateEffectiveFee,
  generateApplicationNumber,
  submitAdmissionApplication,
} from '../lib/firestoreService';
import {
  BatchItem,
  CourseItem,
  FeeRule,
  Gender,
  InstituteSettings,
  PublicView,
  StudentClass,
  StudentStream,
} from '../types';
import { BrandLogo } from './BrandLogo';

interface AdmissionFormProps {
  settings: InstituteSettings;
  courses: CourseItem[];
  batches: BatchItem[];
  feeRules: FeeRule[];
  preselectedCourse?: string;
  onNavigate: (view: PublicView) => void;
}

const INPUT_CLASS =
  'w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none transition-colors';

export const AdmissionForm: React.FC<AdmissionFormProps> = ({
  settings,
  courses,
  batches,
  feeRules,
  preselectedCourse,
  onNavigate,
}) => {
  const sessionAppNumberRef = useRef<string>(generateApplicationNumber());

  const [studentName, setStudentName] = useState('');
  const [studentMobile, setStudentMobile] = useState('');
  const [studentWhatsapp, setStudentWhatsapp] = useState('');
  const [sameAsMobile, setSameAsMobile] = useState(true);
  const [fatherName, setFatherName] = useState('');
  const [fatherMobile, setFatherMobile] = useState('');
  const [motherName, setMotherName] = useState('');
  const [motherMobile, setMotherMobile] = useState('');
  const [gender, setGender] = useState<Gender>('Male');
  const [address, setAddress] = useState('');
  const [village, setVillage] = useState('');
  const [postOffice, setPostOffice] = useState('');
  const [district, setDistrict] = useState('');
  const [stateName, setStateName] = useState('Bihar');
  const [pinCode, setPinCode] = useState('');

  const [studentClass, setStudentClass] = useState<StudentClass>('Class 12');
  const [stream, setStream] = useState<StudentStream>('Science');
  const [course, setCourse] = useState<string>(
    preselectedCourse || courses[0]?.title || 'NEET Preparation'
  );
  const [batch, setBatch] = useState<string>(batches[0]?.timing || '8 AM – 10 AM');

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>('');
  const [idProofFile, setIdProofFile] = useState<File | null>(null);
  const [marksheetFile, setMarksheetFile] = useState<File | null>(null);

  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [submittedResult, setSubmittedResult] = useState<{
    applicationNumber: string;
    studentName: string;
    studentMobile: string;
    course: string;
    batch: string;
    feeAmount: number;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (preselectedCourse) setCourse(preselectedCourse);
  }, [preselectedCourse]);

  useEffect(() => {
    if (sameAsMobile) setStudentWhatsapp(studentMobile);
  }, [sameAsMobile, studentMobile]);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreview('');
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  const effectiveFee = useMemo(
    () =>
      calculateEffectiveFee(
        studentClass,
        course,
        batch,
        courses,
        batches,
        feeRules,
        settings.defaultFee
      ),
    [studentClass, course, batch, courses, batches, feeRules, settings.defaultFee]
  );

  const validateMobile = (val: string) => /^[0-9]{10}$/.test(val.replace(/[^0-9]/g, ''));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg('');

    if (studentName.trim().length < 2) {
      setErrorMsg('Please enter the student full name.');
      return;
    }
    if (!validateMobile(studentMobile)) {
      setErrorMsg('Please enter a valid 10-digit Student Mobile Number.');
      return;
    }
    const finalWhatsapp = sameAsMobile ? studentMobile : studentWhatsapp;
    if (!validateMobile(finalWhatsapp)) {
      setErrorMsg('Please enter a valid 10-digit Student WhatsApp Number.');
      return;
    }
    if (fatherName.trim().length < 2 || !validateMobile(fatherMobile)) {
      setErrorMsg("Please enter Father's Full Name and a valid 10-digit Father's Mobile Number.");
      return;
    }
    if (motherName.trim().length < 2 || !validateMobile(motherMobile)) {
      setErrorMsg("Please enter Mother's Full Name and a valid 10-digit Mother's Mobile Number.");
      return;
    }
    if (
      address.trim().length < 3 ||
      !village.trim() ||
      !postOffice.trim() ||
      !district.trim() ||
      !stateName.trim()
    ) {
      setErrorMsg('Please complete all residential address fields.');
      return;
    }
    if (!/^[0-9]{6}$/.test(pinCode.trim())) {
      setErrorMsg('Please enter a valid 6-digit PIN Code.');
      return;
    }
    if (!photoFile) {
      setErrorMsg('Please upload a Student Passport Size Photograph.');
      return;
    }
    if (!idProofFile) {
      setErrorMsg('Please upload Student Identity Proof (Aadhaar / School ID).');
      return;
    }
    if (!declarationAccepted) {
      setErrorMsg('Please accept the student declaration before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      const appNo = sessionAppNumberRef.current;
      const result = await submitAdmissionApplication({
        applicationNumber: appNo,
        studentName,
        studentMobile,
        studentWhatsapp: finalWhatsapp,
        fatherName,
        fatherMobile,
        motherName,
        motherMobile,
        gender,
        address,
        village,
        postOffice,
        district,
        state: stateName,
        pinCode,
        studentClass,
        stream,
        course,
        batch,
        feeAmount: effectiveFee,
        declarationAccepted,
        academicSession: settings.academicSession,
        photoFile,
        idProofFile,
        marksheetFile,
      });

      setSubmittedResult({
        applicationNumber: result.applicationNumber,
        studentName: studentName.trim(),
        studentMobile: studentMobile.replace(/[^0-9]/g, '').slice(-10),
        course,
        batch,
        feeAmount: effectiveFee,
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error('Admission submit error:', err);
      const rawMsg = err instanceof Error ? err.message : 'Unable to submit admission form.';
      if (rawMsg.includes('already exists') || rawMsg.includes('PERMISSION_DENIED')) {
        sessionAppNumberRef.current = generateApplicationNumber();
      }
      setErrorMsg(
        'Submission could not be completed. Please verify all fields and uploaded files, then try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (submittedResult) {
    return (
      <div className="max-w-lg mx-auto px-4 py-10 pb-24">
        <div className="app-card rounded-2xl p-6 sm:p-8 text-center">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h1 className="font-display text-xl sm:text-2xl font-bold text-gray-900">
            Application Submitted
          </h1>
          <p className="mt-2 text-sm text-gray-600 leading-relaxed">
            Your admission application has been submitted successfully. Please wait for admin approval.
          </p>

          <div className="mt-6 rounded-xl bg-gray-50 border border-gray-200 p-4 text-left space-y-3">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-gray-200">
              <div>
                <p className="text-xs text-gray-500">Application Number</p>
                <p className="font-mono text-lg font-bold text-violet-700 tabular-nums">
                  {submittedResult.applicationNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(submittedResult.applicationNumber);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-100 text-xs font-semibold text-gray-700 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs sm:text-sm">
              <div>
                <p className="text-xs text-gray-500">Student</p>
                <p className="font-semibold text-gray-900">{submittedResult.studentName}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Mobile</p>
                <p className="font-mono text-gray-900 tabular-nums">{submittedResult.studentMobile}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Course</p>
                <p className="font-medium text-gray-800">{submittedResult.course}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Batch</p>
                <p className="font-medium text-gray-800">{submittedResult.batch}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Course Fee</p>
                <p className="font-mono font-semibold text-gray-900 tabular-nums">
                  ₹{submittedResult.feeAmount.toLocaleString('en-IN')}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Status</p>
                <p className="font-semibold text-amber-600">PENDING</p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate('track')}
              className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold cursor-pointer"
            >
              Track Application
            </button>
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className="flex-1 py-2.5 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium cursor-pointer"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 pb-24 md:pb-14">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 mb-2 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
          <div className="flex items-center gap-3 mt-1">
            <BrandLogo settings={settings} sizeClass="w-10 h-10" iconSizeClass="w-5 h-5" />
            <div>
              <h1 className="font-display text-2xl font-bold text-gray-900">
                Student Admission Form
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
                {settings.instituteName} · No account needed · Session {settings.academicSession}
              </p>
            </div>
          </div>
        </div>

        <div className="app-card rounded-2xl px-4 py-3 bg-violet-50/50 border-violet-200 shrink-0">
          <p className="text-[11px] font-medium text-violet-700">Applicable Fee</p>
          <p className="font-mono text-xl font-bold text-gray-900 tabular-nums flex items-center gap-0.5">
            <IndianRupee className="w-4 h-4 text-violet-600" />
            {effectiveFee.toLocaleString('en-IN')}
          </p>
          <p className="text-[11px] text-gray-500">Payment: PENDING</p>
        </div>
      </div>

      {!settings.admissionsOpen && (
        <div className="mb-5 rounded-xl bg-amber-50 border border-amber-200 p-3.5 text-xs text-amber-800">
          Online admissions are currently marked closed. For help call {settings.phone}.
        </div>
      )}

      {errorMsg && (
        <div className="mb-5 rounded-xl bg-red-50 border border-red-200 p-3.5 flex items-start gap-2.5 text-xs sm:text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 1. PERSONAL DETAILS */}
        <section className="app-card rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-2 pb-3.5 border-b border-gray-100">
            <User className="w-4 h-4 text-violet-600" />
            <h2 className="font-display text-base font-bold text-gray-900">Personal Details</h2>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Student Full Name *
              </label>
              <input
                type="text"
                required
                maxLength={120}
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="Full name"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Student Mobile *
              </label>
              <input
                type="tel"
                required
                maxLength={10}
                value={studentMobile}
                onChange={(e) => setStudentMobile(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                placeholder="10-digit mobile"
                className={`${INPUT_CLASS} font-mono`}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-700">WhatsApp Number *</label>
                <label className="inline-flex items-center gap-1 text-[11px] text-violet-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sameAsMobile}
                    onChange={(e) => setSameAsMobile(e.target.checked)}
                    className="accent-violet-600"
                  />
                  Same
                </label>
              </div>
              <input
                type="tel"
                required
                maxLength={10}
                disabled={sameAsMobile}
                value={sameAsMobile ? studentMobile : studentWhatsapp}
                onChange={(e) =>
                  setStudentWhatsapp(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))
                }
                placeholder="10-digit WhatsApp"
                className={`${INPUT_CLASS} font-mono disabled:opacity-60`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Father&apos;s Full Name *
              </label>
              <input
                type="text"
                required
                maxLength={120}
                value={fatherName}
                onChange={(e) => setFatherName(e.target.value)}
                placeholder="Father's name"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Father&apos;s Mobile *
              </label>
              <input
                type="tel"
                required
                maxLength={10}
                value={fatherMobile}
                onChange={(e) => setFatherMobile(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                placeholder="10-digit mobile"
                className={`${INPUT_CLASS} font-mono`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Mother&apos;s Full Name *
              </label>
              <input
                type="text"
                required
                maxLength={120}
                value={motherName}
                onChange={(e) => setMotherName(e.target.value)}
                placeholder="Mother's name"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Mother&apos;s Mobile *
              </label>
              <input
                type="tel"
                required
                maxLength={10}
                value={motherMobile}
                onChange={(e) => setMotherMobile(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                placeholder="10-digit mobile"
                className={`${INPUT_CLASS} font-mono`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Gender *</label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value as Gender)}
                className={INPUT_CLASS}
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Complete Home Address *
              </label>
              <textarea
                required
                rows={2}
                maxLength={380}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="House No., Street, Landmark"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Village / Town *</label>
              <input
                type="text"
                required
                maxLength={120}
                value={village}
                onChange={(e) => setVillage(e.target.value)}
                placeholder="Village"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Post Office *</label>
              <input
                type="text"
                required
                maxLength={120}
                value={postOffice}
                onChange={(e) => setPostOffice(e.target.value)}
                placeholder="Post office"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">District *</label>
              <input
                type="text"
                required
                maxLength={120}
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                placeholder="District"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">State *</label>
              <select
                value={stateName}
                onChange={(e) => setStateName(e.target.value)}
                className={INPUT_CLASS}
              >
                {INDIAN_STATES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">PIN Code *</label>
              <input
                type="text"
                required
                maxLength={6}
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder="6-digit PIN"
                className={`${INPUT_CLASS} font-mono`}
              />
            </div>
          </div>
        </section>

        {/* 2. ACADEMIC, COURSE & BATCH */}
        <section className="app-card rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-2 pb-3.5 border-b border-gray-100">
            <BookOpen className="w-4 h-4 text-violet-600" />
            <h2 className="font-display text-base font-bold text-gray-900">
              Academic, Course & Batch
            </h2>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Class *</label>
              <select
                value={studentClass}
                onChange={(e) => setStudentClass(e.target.value as StudentClass)}
                className={INPUT_CLASS}
              >
                {CLASS_OPTIONS.map((cls) => (
                  <option key={cls} value={cls}>
                    {cls}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Stream *</label>
              <select
                value={stream}
                onChange={(e) => setStream(e.target.value as StudentStream)}
                className={INPUT_CLASS}
              >
                {STREAM_OPTIONS.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Course *</label>
              <select
                value={course}
                onChange={(e) => setCourse(e.target.value)}
                className={INPUT_CLASS}
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.title}>
                    {c.title} — ₹{c.feeAmount.toLocaleString('en-IN')}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Batch Timing *</label>
              <select
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
                className={INPUT_CLASS}
              >
                {batches.map((b) => (
                  <option key={b.id} value={b.timing}>
                    {b.timing} ({b.name})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* 3. DOCUMENTS */}
        <section className="app-card rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-2 pb-3.5 border-b border-gray-100">
            <Upload className="w-4 h-4 text-violet-600" />
            <h2 className="font-display text-base font-bold text-gray-900">Upload Documents</h2>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Passport Photo */}
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 flex flex-col justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-900">Passport Photograph *</p>
                <p className="text-[11px] text-gray-500 mt-0.5">JPG or PNG for ID card</p>
              </div>
              {photoPreview && (
                <img
                  src={photoPreview}
                  alt="Passport preview"
                  className="mt-3 w-20 h-24 object-cover rounded-lg border border-gray-200 mx-auto"
                />
              )}
              <label className="mt-3 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-violet-50 border border-gray-200 text-xs font-semibold text-violet-700 cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5" />
                {photoFile ? 'Change Photo' : 'Select Photo'}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>
              {photoFile && (
                <p className="mt-1.5 text-[11px] text-emerald-700 truncate text-center">
                  {photoFile.name}
                </p>
              )}
            </div>

            {/* Identity Proof */}
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 flex flex-col justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-900">Identity Proof *</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Aadhaar / School ID</p>
              </div>
              <div className="my-3 flex justify-center">
                <FileText className="w-7 h-7 text-violet-400" />
              </div>
              <label className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-violet-50 border border-gray-200 text-xs font-semibold text-violet-700 cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5" />
                {idProofFile ? 'Change File' : 'Select ID Proof'}
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setIdProofFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>
              {idProofFile && (
                <p className="mt-1.5 text-[11px] text-emerald-700 truncate text-center">
                  {idProofFile.name}
                </p>
              )}
            </div>

            {/* Optional Marksheet */}
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 flex flex-col justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-900">Marksheet (Optional)</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Previous exam report</p>
              </div>
              <div className="my-3 flex justify-center">
                <FileText className="w-7 h-7 text-gray-300" />
              </div>
              <label className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-gray-100 border border-gray-200 text-xs font-semibold text-gray-700 cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5" />
                {marksheetFile ? 'Change File' : 'Select Marksheet'}
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setMarksheetFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>
              {marksheetFile && (
                <p className="mt-1.5 text-[11px] text-emerald-700 truncate text-center">
                  {marksheetFile.name}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* 4. FEE SUMMARY & SUBMIT */}
        <section className="app-card rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-500">Course & Batch</p>
              <p className="font-semibold text-gray-900 mt-0.5">{course}</p>
              <p className="text-xs text-violet-700">{batch}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Total Fee</p>
              <p className="font-mono text-lg font-bold text-gray-900 tabular-nums mt-0.5">
                ₹{effectiveFee.toLocaleString('en-IN')}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Payment Status</p>
              <p className="text-sm font-semibold text-amber-600 mt-0.5">PENDING</p>
              <p className="text-[11px] text-gray-500">Verified by admin at institute</p>
            </div>
          </div>

          <label className="flex items-start gap-2.5 text-xs sm:text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={declarationAccepted}
              onChange={(e) => setDeclarationAccepted(e.target.checked)}
              className="mt-0.5 accent-violet-600"
            />
            <span>
              I confirm that all submitted details and documents are accurate. Admission and Student ID Card issuance are subject to verification by {settings.instituteName}.
            </span>
          </label>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
            <p className="text-xs text-gray-500">
              Ref: <span className="font-mono text-violet-700">{sessionAppNumberRef.current}</span>
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <UserCheck className="w-4 h-4" />
                  Submit Admission Form
                </>
              )}
            </button>
          </div>
        </section>
      </form>
    </div>
  );
};
