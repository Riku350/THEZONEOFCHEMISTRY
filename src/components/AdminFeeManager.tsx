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
  const [subTab, setSubTab] = useState<'record' | 'ledger' | 'rules' | 'receipts'>('record');

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
