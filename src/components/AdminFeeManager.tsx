import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileText,
  IndianRupee,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { CLASS_OPTIONS } from '../config/defaults';
import {
  deleteFeeRule,
  recordVerifiedPayment,
  saveFeeRule,
  updateStudentProfile,
} from '../lib/firestoreService';
import { downloadPaymentReceiptPdf, exportFeeReportCsv } from '../lib/idCardRenderer';
import {
  AdmissionApplication,
  BatchItem,
  CourseItem,
  FeeRule,
  InstituteSettings,
  PaymentMethod,
  PaymentRecord,
  StudentRecord,
} from '../types';

interface AdminFeeManagerProps {
  adminEmail: string;
  settings: InstituteSettings;
  students: StudentRecord[];
  applications: AdmissionApplication[];
  courses: CourseItem[];
  batches: BatchItem[];
  feeRules: FeeRule[];
  payments: PaymentRecord[];
}

const inputCls =
  'w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none transition-colors';

export const AdminFeeManager: React.FC<AdminFeeManagerProps> = ({
  adminEmail,
  settings,
  students,
  applications,
  courses,
  batches,
  feeRules,
  payments,
}) => {
  const [subTab, setSubTab] = useState<'record' | 'pending' | 'ledger' | 'rules' | 'receipts'>('pending');

  const [selectedTargetKey, setSelectedTargetKey] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('Cash');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  const [ruleLabel, setRuleLabel] = useState('');
  const [ruleClass, setRuleClass] = useState('');
  const [ruleCourse, setRuleCourse] = useState('');
  const [ruleBatch, setRuleBatch] = useState('');
  const [ruleAmount, setRuleAmount] = useState('5500');

  const [editingFeeStudentId, setEditingFeeStudentId] = useState<string | null>(null);
  const [overrideFeeValue, setOverrideFeeValue] = useState('');

  const selectablePayees = useMemo(() => {
    const list: {
      key: string;
      label: string;
      feeAmount: number;
      paidAmount: number;
      student?: StudentRecord;
      application?: AdmissionApplication;
    }[] = [];

    students.forEach((s) => {
      list.push({
        key: `student:${s.studentId}`,
        label: `[Student] ${s.studentName} (${s.studentId}) — Bal: ₹${Math.max(0, s.feeAmount - s.paidAmount).toLocaleString('en-IN')}`,
        feeAmount: s.feeAmount,
        paidAmount: s.paidAmount,
        student: s,
      });
    });

    applications
      .filter((a) => a.status === 'pending')
      .forEach((a) => {
        list.push({
          key: `app:${a.id}`,
          label: `[Pending] ${a.studentName} (${a.applicationNumber}) — Bal: ₹${Math.max(0, a.feeAmount - a.paidAmount).toLocaleString('en-IN')}`,
          feeAmount: a.feeAmount,
          paidAmount: a.paidAmount,
          application: a,
        });
      });

    return list;
  }, [students, applications]);

  const pendingPayees = useMemo(() => {
    const list: {
      id: string;
      name: string;
      identifier: string;
      mobile: string;
      classOrCourse: string;
      batch: string;
      feeAmount: number;
      paidAmount: number;
      balance: number;
      status: string;
      isApplication?: boolean;
    }[] = [];

    students.forEach((s) => {
      const balance = Math.max(0, (s.feeAmount || 0) - (s.paidAmount || 0));
      if (balance > 0 || s.paymentStatus === 'PENDING' || s.paymentStatus === 'PARTIAL') {
        list.push({
          id: s.studentId,
          name: s.studentName,
          identifier: s.studentId,
          mobile: s.studentMobile || '',
          classOrCourse: `${s.studentClass} • ${s.course}`,
          batch: s.batch,
          feeAmount: s.feeAmount || 0,
          paidAmount: s.paidAmount || 0,
          balance,
          status: s.paymentStatus || (balance > 0 ? 'PENDING' : 'PAID'),
        });
      }
    });

    applications
      .filter((a) => a.status === 'pending' || (a.feeAmount - a.paidAmount > 0))
      .forEach((a) => {
        const balance = Math.max(0, (a.feeAmount || 0) - (a.paidAmount || 0));
        if (balance > 0 || a.paymentStatus === 'PENDING') {
          list.push({
            id: a.id,
            name: a.studentName,
            identifier: a.applicationNumber,
            mobile: a.studentMobile || a.studentWhatsapp || '',
            classOrCourse: `${a.studentClass} • ${a.course}`,
            batch: a.batch,
            feeAmount: a.feeAmount || 0,
            paidAmount: a.paidAmount || 0,
            balance,
            status: a.paymentStatus || 'PENDING',
            isApplication: true,
          });
        }
      });

    return list.sort((a, b) => b.balance - a.balance);
  }, [students, applications]);

  const handleNotifyWhatsapp = (item: { name: string; identifier: string; mobile: string; balance: number }) => {
    const cleanMob = item.mobile.replace(/[^0-9]/g, '');
    const phone = cleanMob.length === 10 ? `91${cleanMob}` : cleanMob;
    const msg = `Hello ${item.name}, this is a fee payment reminder from ${settings.instituteName || 'The Zone of Chemistry'}. Your pending fee balance is ₹${item.balance.toLocaleString('en-IN')}. Please clear your dues at your earliest convenience. Thank you! — Sonu Sir (#BABA)`;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  };

  const selectedPayee = selectablePayees.find((p) => p.key === selectedTargetKey);

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPayee) return;
    const numericAmt = Number(payAmount);
    if (!numericAmt || numericAmt <= 0) return;

    setBusy(true);
    setFeedback('');
    try {
      const receipt = await recordVerifiedPayment({
        student: selectedPayee.student,
        application: selectedPayee.application,
        amount: numericAmt,
        method: payMethod,
        referenceNo: payRef,
        notes: payNotes,
        adminEmail,
      });
      setPayAmount('');
      setPayRef('');
      setPayNotes('');
      setFeedback(`Payment verified & recorded. Receipt #${receipt.receiptNumber}`);
    } finally {
      setBusy(false);
    }
  };

  const handleAddFeeRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleLabel.trim() || Number(ruleAmount) < 0) return;
    setBusy(true);
    try {
      await saveFeeRule({
        label: ruleLabel,
        studentClass: ruleClass,
        course: ruleCourse,
        batch: ruleBatch,
        amount: Number(ruleAmount),
        active: true,
      });
      setRuleLabel('');
      setRuleClass('');
      setRuleCourse('');
      setRuleBatch('');
      setRuleAmount('5500');
      setFeedback('Fee rule saved.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveStudentFee = async (student: StudentRecord) => {
    const newFee = Number(overrideFeeValue);
    if (isNaN(newFee) || newFee < 0) return;
    setBusy(true);
    try {
      await updateStudentProfile(student, { feeAmount: newFee });
      setEditingFeeStudentId(null);
      setFeedback(`Updated fee for ${student.studentName} to ₹${newFee.toLocaleString('en-IN')}.`);
    } finally {
      setBusy(false);
    }
  };

  const totalCollected = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const totalOutstanding = students.reduce(
    (sum, s) => sum + Math.max(0, (s.feeAmount || 0) - (s.paidAmount || 0)),
    0
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900">
            Fee Management
          </h2>
          <p className="text-xs sm:text-sm text-gray-500">
            Record verified payments, adjust course/batch fees, and download receipts.
          </p>
        </div>

        <button
          type="button"
          onClick={() => exportFeeReportCsv(payments)}
          disabled={payments.length === 0}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 disabled:opacity-40 text-gray-700 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
        >
          <Download className="w-4 h-4 text-violet-600" />
          Export CSV
        </button>
      </div>

      {/* Live Financial Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="app-card rounded-2xl p-4">
          <p className="text-[11px] sm:text-xs text-gray-500">Collected</p>
          <p className="mt-1 font-mono text-base sm:text-xl font-bold text-emerald-600 tabular-nums">
            ₹{totalCollected.toLocaleString('en-IN')}
          </p>
        </div>
        <div className="app-card rounded-2xl p-4">
          <p className="text-[11px] sm:text-xs text-gray-500">Outstanding</p>
          <p className="mt-1 font-mono text-base sm:text-xl font-bold text-amber-600 tabular-nums">
            ₹{totalOutstanding.toLocaleString('en-IN')}
          </p>
        </div>
        <div className="app-card rounded-2xl p-4">
          <p className="text-[11px] sm:text-xs text-gray-500">Receipts</p>
          <p className="mt-1 font-mono text-base sm:text-xl font-bold text-gray-900 tabular-nums">
            {payments.length}
          </p>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-gray-100 border border-gray-200/80 w-fit">
        {(
          [
            ['pending', 'Pending Dues & Reminders'],
            ['record', 'Record Payment'],
            ['ledger', 'Student Ledger'],
            ['rules', 'Fee Rules'],
            ['receipts', 'Receipts'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              subTab === id
                ? 'bg-white text-violet-700 shadow-2xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {feedback && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 flex items-center gap-2 text-xs sm:text-sm text-emerald-800">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{feedback}</span>
        </div>
      )}

      {/* PENDING DUES & REMINDERS TAB */}
      {subTab === 'pending' && (
        <div className="app-card rounded-2xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-gray-100">
            <div>
              <h3 className="font-display text-base font-bold text-gray-900">
                Students with Pending &amp; Outstanding Dues
              </h3>
              <p className="text-xs text-gray-500">
                Highlighting students with pending payments and remaining balances. Send instant WhatsApp payment reminders with one click.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold">
              {pendingPayees.length} Pending Accounts
            </span>
          </div>

          {pendingPayees.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              All student fee accounts are fully paid! No pending dues.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-500 uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-3">Student / ID</th>
                    <th className="py-3 px-3">Class &amp; Course</th>
                    <th className="py-3 px-3">Batch</th>
                    <th className="py-3 px-3 text-right">Fee / Paid</th>
                    <th className="py-3 px-3 text-right">Balance Due</th>
                    <th className="py-3 px-3 text-center">Status</th>
                    <th className="py-3 px-3 text-right">WhatsApp Reminder</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pendingPayees.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="py-3.5 px-3">
                        <p className="font-bold text-gray-900">{p.name}</p>
                        <p className="font-mono text-xs text-violet-700 tabular-nums">{p.identifier}</p>
                      </td>
                      <td className="py-3.5 px-3 text-gray-700">{p.classOrCourse}</td>
                      <td className="py-3.5 px-3 text-gray-600">{p.batch || '—'}</td>
                      <td className="py-3.5 px-3 text-right font-mono tabular-nums">
                        <span className="text-gray-900">₹{p.feeAmount.toLocaleString('en-IN')}</span>
                        <span className="text-gray-400 mx-1">/</span>
                        <span className="text-emerald-600">₹{p.paidAmount.toLocaleString('en-IN')}</span>
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono font-bold text-amber-600 tabular-nums">
                        ₹{p.balance.toLocaleString('en-IN')}
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            p.status === 'PENDING'
                              ? 'bg-red-50 text-red-700 border border-red-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleNotifyWhatsapp(p)}
                          disabled={!p.mobile}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold transition-colors shadow-2xs cursor-pointer"
                          title={p.mobile ? `Send WhatsApp reminder to ${p.mobile}` : 'No mobile number available'}
                        >
                          <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                            <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                          </svg>
                          Notify ({p.mobile || 'No Mobile'})
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

      {/* TAB 1: RECORD PAYMENT */}
      {subTab === 'record' && (
        <form onSubmit={handleRecordPayment} className="app-card rounded-2xl p-5 max-w-2xl space-y-4">
          <h3 className="font-display text-base font-bold text-gray-900">
            Record Full or Partial Payment
          </h3>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Student or Applicant *
            </label>
            <select
              required
              value={selectedTargetKey}
              onChange={(e) => {
                setSelectedTargetKey(e.target.value);
                const found = selectablePayees.find((p) => p.key === e.target.value);
                if (found) {
                  const bal = Math.max(0, found.feeAmount - found.paidAmount);
                  setPayAmount(bal > 0 ? String(bal) : '');
                }
              }}
              className={inputCls}
            >
              <option value="">-- Choose Student --</option>
              {selectablePayees.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {selectedPayee && (
            <div className="rounded-xl bg-violet-50/70 border border-violet-200/80 p-3.5 grid grid-cols-3 gap-3 text-xs">
              <div>
                <p className="text-gray-500">Total Fee</p>
                <p className="font-mono text-sm font-bold text-gray-900 tabular-nums mt-0.5">
                  ₹{selectedPayee.feeAmount.toLocaleString('en-IN')}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Paid</p>
                <p className="font-mono text-sm font-bold text-emerald-600 tabular-nums mt-0.5">
                  ₹{selectedPayee.paidAmount.toLocaleString('en-IN')}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Balance</p>
                <p className="font-mono text-sm font-bold text-amber-600 tabular-nums mt-0.5">
                  ₹{Math.max(0, selectedPayee.feeAmount - selectedPayee.paidAmount).toLocaleString('en-IN')}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Amount Received (INR) *
              </label>
              <input
                type="number"
                min={1}
                required
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="e.g., 5500"
                className={`${inputCls} font-mono`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Payment Mode *
              </label>
              <select
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                className={inputCls}
              >
                <option value="Cash">Cash</option>
                <option value="UPI">UPI</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Card">Card</option>
                <option value="Cheque">Cheque</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                UPI / Ref No. (Optional)
              </label>
              <input
                type="text"
                maxLength={100}
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="UTR / Reference ID"
                className={`${inputCls} font-mono`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Notes (Optional)
              </label>
              <input
                type="text"
                maxLength={280}
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                placeholder="Installment 1 / Full Fee"
                className={inputCls}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy || !selectedPayee}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors cursor-pointer"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <IndianRupee className="w-4 h-4" />}
            Verify & Save Payment
          </button>
        </form>
      )}

      {/* TAB 2: STUDENT FEE LEDGER */}
      {subTab === 'ledger' && (
        <div className="app-card rounded-2xl p-4 sm:p-5">
          <h3 className="font-display text-base font-bold text-gray-900 mb-3">
            Student Fee Balances
          </h3>
          {students.length === 0 ? (
            <p className="text-xs sm:text-sm text-gray-500 py-8 text-center">
              No approved students yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs text-gray-500">
                    <th className="pb-2.5 font-medium">Student</th>
                    <th className="pb-2.5 font-medium">Course & Batch</th>
                    <th className="pb-2.5 font-medium text-right">Total</th>
                    <th className="pb-2.5 font-medium text-right">Paid</th>
                    <th className="pb-2.5 font-medium text-right">Balance</th>
                    <th className="pb-2.5 font-medium">Status</th>
                    <th className="pb-2.5 font-medium text-right">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {students.map((s) => {
                    const balance = Math.max(0, s.feeAmount - s.paidAmount);
                    return (
                      <tr key={s.studentId} className="hover:bg-gray-50/70">
                        <td className="py-3">
                          <p className="font-semibold text-gray-900">{s.studentName}</p>
                          <p className="text-[11px] font-mono text-gray-500">{s.studentId}</p>
                        </td>
                        <td className="py-3 text-xs text-gray-600">
                          {s.course} · {s.batch}
                        </td>
                        <td className="py-3 text-right font-mono tabular-nums text-gray-900">
                          {editingFeeStudentId === s.studentId ? (
                            <div className="inline-flex items-center gap-1">
                              <input
                                type="number"
                                value={overrideFeeValue}
                                onChange={(e) => setOverrideFeeValue(e.target.value)}
                                className="w-20 rounded-lg bg-white border border-violet-500 px-2 py-1 text-xs font-mono text-gray-900 text-right"
                              />
                              <button
                                type="button"
                                onClick={() => void handleSaveStudentFee(s)}
                                className="px-2 py-1 rounded-lg bg-violet-600 text-xs text-white cursor-pointer"
                              >
                                Save
                              </button>
                            </div>
                          ) : (
                            `₹${s.feeAmount.toLocaleString('en-IN')}`
                          )}
                        </td>
                        <td className="py-3 text-right font-mono text-emerald-600 tabular-nums">
                          ₹{s.paidAmount.toLocaleString('en-IN')}
                        </td>
                        <td className="py-3 text-right font-mono text-amber-600 tabular-nums">
                          ₹{balance.toLocaleString('en-IN')}
                        </td>
                        <td className="py-3">
                          <span
                            className={`text-xs font-semibold ${
                              s.paymentStatus === 'PAID'
                                ? 'text-emerald-600'
                                : s.paymentStatus === 'PARTIAL'
                                ? 'text-amber-600'
                                : 'text-red-600'
                            }`}
                          >
                            {s.paymentStatus}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingFeeStudentId(s.studentId);
                              setOverrideFeeValue(String(s.feeAmount));
                            }}
                            className="text-xs font-semibold text-violet-700 hover:text-violet-900 cursor-pointer"
                          >
                            Edit
                          </button>
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

      {/* TAB 3: CLASS / COURSE / BATCH FEE RULES */}
      {subTab === 'rules' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <form onSubmit={handleAddFeeRule} className="lg:col-span-5 app-card rounded-2xl p-5 space-y-3.5">
            <h3 className="font-display text-base font-bold text-gray-900">Add Custom Fee Rule</h3>
            <p className="text-xs text-gray-500">
              Override default fee (₹{settings.defaultFee.toLocaleString('en-IN')}) by class, course, or batch.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Rule Label *</label>
              <input
                type="text"
                required
                value={ruleLabel}
                onChange={(e) => setRuleLabel(e.target.value)}
                placeholder="e.g., NEET Morning Special Fee"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Class</label>
              <select
                value={ruleClass}
                onChange={(e) => setRuleClass(e.target.value)}
                className={inputCls}
              >
                <option value="">Any Class</option>
                {CLASS_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Course</label>
              <select
                value={ruleCourse}
                onChange={(e) => setRuleCourse(e.target.value)}
                className={inputCls}
              >
                <option value="">Any Course</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.title}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Batch</label>
              <select
                value={ruleBatch}
                onChange={(e) => setRuleBatch(e.target.value)}
                className={inputCls}
              >
                <option value="">Any Batch</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.timing}>
                    {b.timing}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Fee Amount (INR) *</label>
              <input
                type="number"
                required
                min={0}
                value={ruleAmount}
                onChange={(e) => setRuleAmount(e.target.value)}
                className={`${inputCls} font-mono`}
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Save Fee Rule
            </button>
          </form>

          <div className="lg:col-span-7 app-card rounded-2xl p-5">
            <h3 className="font-display text-base font-bold text-gray-900 mb-3">Active Fee Rules</h3>
            {feeRules.length === 0 ? (
              <p className="text-xs sm:text-sm text-gray-500 py-8 text-center">
                No custom override rules yet. Standard course fees apply automatically.
              </p>
            ) : (
              <div className="space-y-2.5">
                {feeRules.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-xl bg-gray-50 border border-gray-200 p-3.5 flex items-center justify-between gap-3"
                  >
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{r.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Class: {r.studentClass || 'Any'} · Course: {r.course || 'Any'} · Batch:{' '}
                        {r.batch || 'Any'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="font-mono font-bold text-violet-700 tabular-nums text-sm">
                        ₹{r.amount.toLocaleString('en-IN')}
                      </span>
                      <button
                        type="button"
                        aria-label="Delete fee rule"
                        onClick={() => void deleteFeeRule(r.id)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: PAYMENT RECEIPTS */}
      {subTab === 'receipts' && (
        <div className="app-card rounded-2xl p-4 sm:p-5">
          <h3 className="font-display text-base font-bold text-gray-900 mb-3">
            Payment Receipts
          </h3>
          {payments.length === 0 ? (
            <p className="text-xs sm:text-sm text-gray-500 py-8 text-center">
              No payments recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs text-gray-500">
                    <th className="pb-2.5 font-medium">Receipt #</th>
                    <th className="pb-2.5 font-medium">Date</th>
                    <th className="pb-2.5 font-medium">Student</th>
                    <th className="pb-2.5 font-medium">Mode</th>
                    <th className="pb-2.5 font-medium text-right">Amount</th>
                    <th className="pb-2.5 font-medium text-right">PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {payments.map((p) => {
                    const matchedStudent = students.find((s) => s.studentId === p.studentId);
                    return (
                      <tr key={p.id} className="hover:bg-gray-50/70">
                        <td className="py-3 font-mono text-xs text-violet-700 font-medium">
                          {p.receiptNumber}
                        </td>
                        <td className="py-3 font-mono text-xs text-gray-500 tabular-nums">
                          {p.paidAt?.toDate ? p.paidAt.toDate().toLocaleDateString('en-IN') : 'Today'}
                        </td>
                        <td className="py-3">
                          <p className="font-semibold text-gray-900">{p.studentName}</p>
                          <p className="text-[11px] text-gray-500">{p.course || '—'}</p>
                        </td>
                        <td className="py-3 text-xs text-gray-600">
                          {p.method}
                          {p.referenceNo ? ` · ${p.referenceNo}` : ''}
                        </td>
                        <td className="py-3 text-right font-mono font-bold text-emerald-600 tabular-nums">
                          ₹{p.amount.toLocaleString('en-IN')}
                        </td>
                        <td className="py-3 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              downloadPaymentReceiptPdf(
                                p,
                                settings,
                                matchedStudent?.feeAmount,
                                matchedStudent?.paidAmount
                              )
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 border border-violet-200 text-violet-700 text-xs font-semibold cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            PDF
                          </button>
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
    </div>
  );
};
